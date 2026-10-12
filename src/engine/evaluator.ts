import type {
  ColumnType,
  DataModel,
  Phase,
  RowStatus,
  SourceSpan,
  StepKind,
  TableSnapshot,
  Trace,
  TraceStep,
  Value,
} from './types'
import { EngineError } from './errors'
import type { Expr, FromNode, OrderItem, Query, QueryBody, SelectCore, WindowSpec } from './parser'
import { snapshotRel } from './tracer'
import type { SnapOpts } from './tracer'
import { AGGREGATES, aggregate, castValue, compareForSort, compareValues, datePart, fmt, likeMatch, plain, round, toNum, toText, tupleKey } from './values'
import type { RCol, Rel, RRow } from './values'
import { SCALAR_NAMES, callScalar, checkArity } from './scalars'

const MAX_STEPS = 2000
const MAX_ROWS = 5000

type CallExpr = Extract<Expr, { t: 'call' }>

const WINDOW_ONLY = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD'])

// ---------- estructuras internas ----------

/** Contexto de evaluacion de una expresion: una fila o un grupo, mas el contexto de la consulta externa. */
interface Scope {
  cols: RCol[]
  cells: Value[]
  parent: Scope | null
  /** Nivel de anidamiento de subconsultas, para detectar correlacion. */
  level: number
  /** Relacion y posicion de la fila, para mostrar la fila actual al ejecutar una subconsulta. */
  rel?: Rel
  index?: number
  /** Filas del grupo (solo en un grupo). */
  groupRows?: Scope[]
  aggs?: Map<string, Value>
  windows?: Map<Expr, Value>
}

interface Unit {
  key: string
  scope: Scope
}

interface OutRow {
  key: string
  cells: Value[]
  scope: Scope
}

interface Out {
  cols: RCol[]
  rows: OutRow[]
}

interface Item {
  expr: Expr
  name: string
  type?: ColumnType
  qual: string | null
  plainCol: boolean
  hasWindow: boolean
}

interface SubInfo {
  count: number
  correlated: boolean
  cache: Rel | null
}

interface WinInfo {
  call: CallExpr
  label: string
  order: number[]
  part: number[]
}

interface StepInput {
  kind?: StepKind
  phase: Phase
  detail?: 'major' | 'minor'
  title: string
  explanation: string
  span: SourceSpan | null
  tables: () => TableSnapshot[]
  scalar?: { label: string; value: Value }
}

// ---------- utilidades sobre el arbol ----------

function children(e: Expr): Expr[] {
  switch (e.t) {
    case 'unary':
      return [e.arg]
    case 'bin':
      return [e.left, e.right]
    case 'isnull':
      return [e.arg]
    case 'between':
      return [e.arg, e.lo, e.hi]
    case 'like':
      return [e.arg, e.pattern]
    case 'in':
      return [e.arg, ...e.list]
    case 'insub':
      return [e.arg]
    case 'case': {
      const out: Expr[] = e.operand ? [e.operand] : []
      for (const w of e.whens) out.push(w.cond, w.then)
      if (e.otherwise) out.push(e.otherwise)
      return out
    }
    case 'call':
      return e.over
        ? [...e.args, ...e.over.partitionBy, ...e.over.orderBy.map((o) => o.expr)]
        : e.args
    case 'cast':
    case 'extract':
      return [e.arg]
    default:
      return []
  }
}

/** Recorre en preorden; si `fn` devuelve false no baja a los hijos. Las subconsultas no se recorren. */
function walk(e: Expr, fn: (x: Expr) => boolean | void): void {
  if (fn(e) === false) return
  for (const c of children(e)) walk(c, fn)
}

function matchCols(cols: RCol[], table: string | null, name: string): number[] {
  const t = table?.toLowerCase()
  const n = name.toLowerCase()
  const out: number[] = []
  cols.forEach((c, i) => {
    if (c.name.toLowerCase() === n && (t === undefined || c.qual?.toLowerCase() === t)) out.push(i)
  })
  return out
}

/** Clave estructural de una expresion, sin posiciones; las columnas se identifican por su posicion. */
function exprKey(e: Expr, cols: RCol[]): string {
  return JSON.stringify(e, (k, v) => {
    if (k === 'span' || k === 'nameSpan') return undefined
    if (v && typeof v === 'object' && v.t === 'col') {
      const m = matchCols(cols, v.table, v.name)
      return m.length === 1 ? `#${m[0]}` : `${(v.table ?? '').toLowerCase()}.${v.name.toLowerCase()}`
    }
    return v
  })
}

const isAggCall = (e: Expr): e is CallExpr => e.t === 'call' && !e.over && AGGREGATES.has(e.name)
const isWindowCall = (e: Expr): e is CallExpr => e.t === 'call' && e.over !== null

function hasNode(e: Expr, pred: (x: Expr) => boolean): boolean {
  let found = false
  walk(e, (x) => {
    if (pred(x)) found = true
    return !found
  })
  return found
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

// ---------- ejecucion ----------

export class Runner {
  private steps: TraceStep[] = []
  private depth = 0
  private labels: string[] = []
  private quiet = 0
  private ctxTables: TableSnapshot[] = []
  private cteEnv = new Map<string, Rel>()
  private minLevel = Infinity
  private subInfo = new Map<Query, SubInfo>()
  private phaseSubs = new Map<SubInfo, number>()
  private subSeq = 0
  private aliases = new Set<string>()
  private fromFirst = true

  private src: string
  private model: DataModel

  constructor(src: string, model: DataModel) {
    this.src = src
    this.model = model
  }

  execute(q: Query): Trace {
    this.emit({
      kind: 'start',
      phase: 'from',
      title: 'Orden lógico de la consulta',
      explanation: this.startText(q),
      span: null,
      tables: () => this.usedTables(q.body),
    })
    const rel = this.execQuery(q, null)
    const table = snapshotRel(rel, { role: 'result', id: 'result', title: 'Resultado' })
    this.emit({
      kind: 'result',
      phase: 'result',
      title: 'Resultado final',
      explanation: `La consulta devuelve ${plural(rel.rows.length, 'fila', 'filas')} y ${plural(rel.cols.length, 'columna', 'columnas')}.`,
      span: null,
      tables: () => [table],
    })
    return { formula: this.src, steps: this.steps, result: { kind: 'table', table } }
  }

  // ---------- trazas ----------

  private emit(s: StepInput): void {
    if (this.quiet > 0) return
    if (this.steps.length >= MAX_STEPS) {
      throw new EngineError(
        'La consulta genera demasiados pasos (más de 2000) para mostrarla. Prueba con una consulta más simple.',
        null,
      )
    }
    const step: TraceStep = {
      kind: s.kind ?? 'table-result',
      phase: s.phase,
      detail: s.detail ?? 'major',
      title: s.title,
      explanation: s.explanation,
      span: s.span,
      tables: [...this.ctxTables, ...s.tables()],
      depth: this.depth,
    }
    if (this.labels.length > 0) step.scope = this.labels[this.labels.length - 1]
    if (s.scalar) step.scalar = s.scalar
    this.steps.push(step)
  }

  private snap(rel: Rel, o: SnapOpts): TableSnapshot {
    const s = snapshotRel(rel, o)
    const base = o.id ?? rel.id
    s.id = this.depth > 0 ? `d${this.depth}:${base}` : base
    return s
  }

  private text(span: SourceSpan): string {
    return this.src.slice(span.start, span.end).replace(/\s+/g, ' ').trim()
  }

  private label(e: Expr): string {
    if (e.t === 'call' && e.over) {
      const full = this.text(e.span)
      return full.length > 40 ? `${this.text({ start: e.span.start, end: e.over.span.start })} OVER (...)` : full
    }
    return this.text(e.span)
  }

  private startText(q: Query): string {
    const parts: string[] = []
    const b = q.body
    if (q.ctes.length > 0) parts.push('las CTE (WITH)')
    if (b.t === 'select') {
      if (b.from) parts.push(b.from.t === 'join' ? 'FROM y JOIN' : 'FROM')
      if (b.where) parts.push('WHERE')
      if (b.groupBy.length > 0) parts.push('GROUP BY')
      if (b.having) parts.push('HAVING')
      parts.push('SELECT')
      if (b.distinct) parts.push('DISTINCT')
    } else {
      parts.push('cada consulta por separado', 'la operación de conjuntos')
    }
    if (q.orderBy.length > 0) parts.push('ORDER BY')
    if (q.limit || q.offset) parts.push('LIMIT / OFFSET')
    return (
      'SQL no ejecuta la consulta en el orden en que se escribe. ' +
      `Aquí se procesará así: ${parts.join(', luego ')}. ` +
      'En cada paso verás la tabla intermedia que produce esa fase.'
    )
  }

  private usedTables(body: QueryBody): TableSnapshot[] {
    const names: { name: string; alias: string | null }[] = []
    const visit = (n: FromNode | null) => {
      if (!n) return
      if (n.t === 'table') names.push({ name: n.name, alias: n.alias })
      else if (n.t === 'join') {
        visit(n.left)
        visit(n.right)
      }
    }
    if (body.t === 'select') visit(body.from)
    const seen = new Set<string>()
    const out: TableSnapshot[] = []
    for (const nm of names) {
      const t = this.model.tables.find((x) => x.name.toLowerCase() === nm.name.toLowerCase())
      const qual = nm.alias ?? t?.name ?? ''
      if (!t || seen.has(qual)) continue
      seen.add(qual)
      const rel: Rel = {
        id: `src:${qual}`,
        title: nm.alias ? `${t.name} (${qual})` : t.name,
        cols: t.columns.map((c) => ({ name: c.name, qual, type: c.type })),
        rows: t.rows.map((r, i) => ({ key: `${qual}#${i + 1}`, cells: [...r] })),
      }
      out.push(this.snap(rel, { role: 'source' }))
    }
    return out
  }

  private beginPhase(): void {
    this.phaseSubs = new Map()
  }

  /** Resumen de las subconsultas evaluadas durante la fase actual. */
  private subNote(): string {
    const parts: string[] = []
    for (const [info, base] of this.phaseSubs) {
      const n = info.count - base
      if (n <= 1) continue
      parts.push(
        info.correlated
          ? `La subconsulta correlacionada se evaluó ${n} veces, una por fila; arriba está el detalle de la primera y las demás se resumen aquí.`
          : `La subconsulta no depende de la consulta externa: se calculó una sola vez y su resultado se reutilizó ${n - 1} ${n - 1 === 1 ? 'vez' : 'veces'}.`,
      )
    }
    return parts.length > 0 ? ' ' + parts.join(' ') : ''
  }

  // ---------- consulta ----------

  private execQuery(q: Query, outer: Scope | null): Rel {
    const savedEnv = this.cteEnv
    if (q.ctes.length > 0) this.cteEnv = new Map(savedEnv)
    try {
      for (const cte of q.ctes) this.runCte(cte.name, cte.query, cte.span)
      let out = this.execBody(q.body, outer, q.orderBy)
      out = this.applyOrder(out, q)
      out = this.applyLimit(out, q, outer)
      return this.outToRel(out)
    } finally {
      this.cteEnv = savedEnv
    }
  }

  private outToRel(out: Out): Rel {
    return { id: 'out', title: 'Resultado', cols: out.cols, rows: out.rows.map((r) => ({ key: r.key, cells: r.cells })) }
  }

  private outFromRel(rel: Rel, outer: Scope | null): Out {
    const level = outer ? outer.level + 1 : 0
    return {
      cols: rel.cols,
      rows: rel.rows.map((r) => ({ key: r.key, cells: r.cells, scope: { cols: rel.cols, cells: r.cells, parent: outer, level } })),
    }
  }

  private withLabel<T>(label: string, fn: () => T): T {
    this.labels.push(label)
    try {
      return fn()
    } finally {
      this.labels.pop()
    }
  }

  private runCte(name: string, query: Query, span: SourceSpan): void {
    this.emit({
      kind: 'enter',
      phase: 'cte',
      title: `CTE ${name}`,
      explanation: `WITH define una tabla temporal con nombre. Primero se ejecuta la consulta de \`${name}\`; después el resto de la consulta podrá usarla en FROM como si fuera una tabla.`,
      span,
      tables: () => [],
    })
    this.depth++
    let rel: Rel
    try {
      rel = this.withLabel(`CTE ${name}`, () => this.execQuery(query, null))
      const cteRel: Rel = { ...rel, id: `cte:${name}`, title: name, cols: rel.cols.map((c) => ({ ...c, qual: name, isNew: false })) }
      this.withLabel(`CTE ${name}`, () =>
        this.emit({
          phase: 'cte',
          title: `CTE ${name} lista`,
          explanation: `La CTE \`${name}\` produjo ${plural(rel.rows.length, 'fila', 'filas')}. A partir de aquí se puede consultar por su nombre.`,
          span,
          tables: () => [this.snap(cteRel, { role: 'working' })],
        }),
      )
    } finally {
      this.depth--
    }
    this.cteEnv.set(name.toLowerCase(), { ...rel, id: `cte:${name}`, title: name })
  }

  private execBody(body: QueryBody, outer: Scope | null, orderBy: OrderItem[]): Out {
    if (body.t === 'select') return this.execCore(body, outer, orderBy)
    if (body.t === 'paren') return this.outFromRel(this.execQuery(body.query, outer), outer)
    return this.execSetOp(body, outer)
  }

  // ---------- operaciones de conjuntos ----------

  private execSetOp(body: Extract<QueryBody, { t: 'setop' }>, outer: Scope | null): Out {
    const opName = body.op.toUpperCase() + (body.all ? ' ALL' : '')
    const left = this.withLabel(`Consulta izquierda de ${opName}`, () => this.execBody(body.left, outer, []))
    const right = this.withLabel(`Consulta derecha de ${opName}`, () => this.execBody(body.right, outer, []))
    if (left.cols.length !== right.cols.length) {
      throw new EngineError(
        `Las dos consultas de ${opName} deben devolver el mismo número de columnas (${left.cols.length} y ${right.cols.length}).`,
        body.opSpan,
      )
    }
    const kindName = { number: 'numérico', string: 'texto', boolean: 'booleano' } as const
    const colKind = (o: Out, i: number) => {
      const r = o.rows.find((x) => x.cells[i] !== null)
      return r ? (typeof r.cells[i] as keyof typeof kindName) : null
    }
    for (let i = 0; i < left.cols.length; i++) {
      const lk = colKind(left, i)
      const rk = colKind(right, i)
      if (lk && rk && lk !== rk) {
        throw new EngineError(
          `Los tipos ${kindName[lk]} y ${kindName[rk]} no se pueden emparejar en ${opName} (columna ${i + 1}).`,
          body.opSpan,
        )
      }
    }
    const cols: RCol[] = left.cols.map((c) => ({ name: c.name, qual: null, type: c.type }))
    const lrel: Rel = { id: 'setop:left', title: 'Consulta izquierda', cols, rows: left.rows.map((r) => ({ key: `L${r.key}`, cells: r.cells })) }
    const rrel: Rel = {
      id: 'setop:right',
      title: 'Consulta derecha',
      cols: right.cols.map((c) => ({ name: c.name, qual: null, type: c.type })),
      rows: right.rows.map((r) => ({ key: `R${r.key}`, cells: r.cells })),
    }
    this.emit({
      phase: 'setOp',
      detail: 'minor',
      title: `${opName}: las dos consultas`,
      explanation: `Cada lado de ${opName} se ejecuta como una consulta independiente. Los dos resultados deben tener el mismo número de columnas; los nombres de columna salen del lado izquierdo.`,
      span: body.opSpan,
      tables: () => [this.snap(lrel, { role: 'working' }), this.snap(rrel, { role: 'working' })],
    })

    const rightKeys = new Map<string, number>()
    for (const r of right.rows) rightKeys.set(tupleKey(r.cells), (rightKeys.get(tupleKey(r.cells)) ?? 0) + 1)
    const leftKeys = new Map<string, number>()
    for (const r of left.rows) leftKeys.set(tupleKey(r.cells), (leftKeys.get(tupleKey(r.cells)) ?? 0) + 1)

    // Filas candidatas con su destino.
    const cand: { key: string; cells: Value[]; keep: boolean; status: RowStatus; note?: string }[] = []
    const seen = new Set<string>()
    const budget = new Map(rightKeys)
    const consider = (key: string, cells: Value[], side: 'L' | 'R') => {
      const k = tupleKey(cells)
      const dup = seen.has(k)
      if (body.op === 'union') {
        const keep = body.all || !dup
        seen.add(k)
        cand.push({ key, cells, keep, status: keep ? 'kept' : 'removed', note: keep ? undefined : 'duplicada' })
        return
      }
      if (side === 'R') return
      const inRight = (rightKeys.get(k) ?? 0) > 0
      if (body.op === 'intersect') {
        let keep = inRight
        if (keep && body.all) {
          const left = budget.get(k) ?? 0
          keep = left > 0
          budget.set(k, left - 1)
        } else if (keep && dup) keep = false
        seen.add(k)
        cand.push({ key, cells, keep, status: keep ? 'matched' : 'unmatched', note: keep ? 'está en ambos' : inRight ? 'duplicada' : 'solo a la izquierda' })
      } else {
        let keep = !inRight
        if (body.all) {
          const left = budget.get(k) ?? 0
          if (left > 0) {
            keep = false
            budget.set(k, left - 1)
          } else keep = true
        } else if (keep && dup) keep = false
        seen.add(k)
        cand.push({ key, cells, keep, status: keep ? 'kept' : 'removed', note: keep ? undefined : inRight ? 'también está a la derecha' : 'duplicada' })
      }
    }
    for (const r of lrel.rows) consider(r.key, r.cells, 'L')
    for (const r of rrel.rows) consider(r.key, r.cells, 'R')

    const cmb: Rel = { id: 'setop', title: `Resultado de ${opName}`, cols, rows: cand.map((c) => ({ key: c.key, cells: c.cells })) }
    const kept = cand.filter((c) => c.keep)
    const explain: Record<string, string> = {
      union: body.all
        ? 'UNION ALL apila las filas de las dos consultas sin quitar nada, aunque se repitan.'
        : 'UNION apila las filas de las dos consultas y elimina las repetidas (comparando todas las columnas; dos NULL se consideran iguales).',
      intersect: 'INTERSECT conserva solo las filas que aparecen en las dos consultas.',
      except: 'EXCEPT conserva las filas de la consulta izquierda que no aparecen en la derecha.',
    }
    this.emit({
      phase: 'setOp',
      title: opName,
      explanation: `${explain[body.op]} Quedan ${plural(kept.length, 'fila', 'filas')} de ${cand.length}.`,
      span: body.opSpan,
      tables: () => [this.snap(cmb, { role: 'working', status: cand.map((c) => c.status), notes: cand.map((c) => c.note) })],
    })
    const level = outer ? outer.level + 1 : 0
    return {
      cols,
      rows: kept.map((c, i) => ({
        key: `s${i + 1}`,
        cells: c.cells,
        scope: { cols, cells: c.cells, parent: outer, level },
      })),
    }
  }

  // ---------- FROM y JOIN ----------

  private rowScopes(rel: Rel, outer: Scope | null): Scope[] {
    const level = outer ? outer.level + 1 : 0
    return rel.rows.map((r, i) => ({ cols: rel.cols, cells: r.cells, parent: outer, level, rel, index: i }))
  }

  private execFrom(node: FromNode, outer: Scope | null): Rel {
    if (node.t === 'join') return this.execJoin(node, outer)
    const first = this.fromFirst
    this.fromFirst = false
    if (node.t === 'derived') {
      this.emit({
        kind: 'enter',
        phase: 'subquery',
        title: `Tabla derivada ${node.alias}`,
        explanation: `Una subconsulta en FROM se ejecuta primero y su resultado se trata como una tabla llamada \`${node.alias}\`.`,
        span: node.span,
        tables: () => [],
      })
      this.depth++
      let inner: Rel
      try {
        inner = this.withLabel(`Tabla derivada ${node.alias}`, () => this.execQuery(node.query, null))
      } finally {
        this.depth--
      }
      const rel: Rel = {
        id: `src:${node.alias}`,
        title: node.alias,
        cols: inner.cols.map((c) => ({ ...c, qual: node.alias, isNew: false })),
        rows: inner.rows.map((r, i) => ({ key: `${node.alias}#${i + 1}`, cells: r.cells })),
      }
      this.emit({
        phase: 'from',
        detail: first ? 'major' : 'minor',
        title: `FROM ${node.alias}`,
        explanation: `La tabla derivada \`${node.alias}\` tiene ${plural(rel.rows.length, 'fila', 'filas')} y ${plural(rel.cols.length, 'columna', 'columnas')}; es el punto de partida de la consulta externa.`,
        span: node.span,
        tables: () => [this.snap(rel, { role: 'source' })],
      })
      return rel
    }
    const nm = node.name.toLowerCase()
    const cte = this.cteEnv.get(nm)
    const tbl = cte ? null : this.model.tables.find((t) => t.name.toLowerCase() === nm)
    if (!cte && !tbl) {
      const avail = [...this.cteEnv.values()].map((c) => c.title).concat(this.model.tables.map((t) => t.name))
      throw new EngineError(`La tabla "${node.name}" no existe. Tablas disponibles: ${avail.join(', ')}.`, node.span)
    }
    const real = cte ? cte.title : (tbl as NonNullable<typeof tbl>).name
    const qual = node.alias ?? real
    const cols: RCol[] = cte
      ? cte.cols.map((c) => ({ ...c, qual }))
      : (tbl as NonNullable<typeof tbl>).columns.map((c) => ({ name: c.name, qual, type: c.type }))
    const srcRows = cte ? cte.rows.map((r) => r.cells) : (tbl as NonNullable<typeof tbl>).rows
    const rel: Rel = {
      id: `src:${qual}`,
      title: node.alias ? `${real} (${qual})` : real,
      cols,
      rows: srcRows.map((r, i) => ({ key: `${qual}#${i + 1}`, cells: [...r] })),
    }
    this.emit({
      phase: 'from',
      detail: first ? 'major' : 'minor',
      title: `FROM ${real}`,
      explanation:
        `FROM decide de dónde salen las filas. Se lee ${cte ? 'la CTE' : 'la tabla'} \`${real}\`` +
        `${node.alias ? ` con el alias \`${qual}\`` : ''}: ${plural(rel.rows.length, 'fila', 'filas')} y ${plural(cols.length, 'columna', 'columnas')}.`,
      span: node.span,
      tables: () => [this.snap(rel, { role: 'source' })],
    })
    return rel
  }

  private execJoin(node: Extract<FromNode, { t: 'join' }>, outer: Scope | null): Rel {
    const L = this.execFrom(node.left, outer)
    const R = this.execFrom(node.right, outer)
    const cols = [...L.cols, ...R.cols]
    const kindName = node.kind.toUpperCase()
    const level = outer ? outer.level + 1 : 0
    if (node.on) {
      this.forbidAgg(node.on, 'la condición ON', 'ON se evalúa al unir filas, antes de agrupar.')
      this.validate([node.on], cols, outer)
    }
    this.beginPhase()
    const lMatches = new Array<number>(L.rows.length).fill(0)
    const rMatches = new Array<number>(R.rows.length).fill(0)
    const pairs: { l: number; r: number }[] = []
    if (L.rows.length * R.rows.length > MAX_ROWS * 20) {
      throw new EngineError('El cruce de estas tablas es demasiado grande para mostrarlo.', node.joinSpan)
    }
    L.rows.forEach((lr, i) => {
      R.rows.forEach((rr, j) => {
        let ok = true
        if (node.on) {
          const scope: Scope = { cols, cells: [...lr.cells, ...rr.cells], parent: outer, level }
          ok = this.truth(this.evalExpr(node.on, scope), node.on.span) === true
        }
        if (ok) {
          pairs.push({ l: i, r: j })
          lMatches[i]++
          rMatches[j]++
        }
      })
    })
    const keepL = node.kind === 'left' || node.kind === 'full'
    const keepR = node.kind === 'right' || node.kind === 'full'
    const nullsR = R.cols.map(() => null)
    const nullsL = L.cols.map(() => null)
    const padR = R.cols.map((_, i) => L.cols.length + i)
    const padL = L.cols.map((_, i) => i)

    const rows: RRow[] = []
    const status: RowStatus[] = []
    const padded: (number[] | undefined)[] = []
    const notes: (string | undefined)[] = []
    L.rows.forEach((lr, i) => {
      for (const p of pairs.filter((x) => x.l === i)) {
        const rr = R.rows[p.r]
        rows.push({ key: `${lr.key}+${rr.key}`, cells: [...lr.cells, ...rr.cells] })
        status.push('matched')
        padded.push(undefined)
        notes.push(undefined)
      }
      if (lMatches[i] === 0 && keepL) {
        rows.push({ key: `${lr.key}+null`, cells: [...lr.cells, ...nullsR] })
        status.push('unmatched')
        padded.push(padR)
        notes.push('sin pareja')
      }
    })
    if (keepR) {
      R.rows.forEach((rr, j) => {
        if (rMatches[j] > 0) return
        rows.push({ key: `null+${rr.key}`, cells: [...nullsL, ...rr.cells] })
        status.push('unmatched')
        padded.push(padL)
        notes.push('sin pareja')
      })
    }
    if (rows.length > MAX_ROWS) throw new EngineError('El JOIN produce demasiadas filas para mostrarlo.', node.joinSpan)

    const hl = node.on ? colsReferenced([node.on], cols) : new Set<number>()
    const hlL = new Set([...hl].filter((i) => i < L.cols.length))
    const hlR = new Set([...hl].filter((i) => i >= L.cols.length).map((i) => i - L.cols.length))
    const cond = node.on ? ` \`${this.text(node.on.span)}\`` : ''
    const unL = lMatches.filter((n) => n === 0).length
    const unR = rMatches.filter((n) => n === 0).length

    const how: Record<string, string> = {
      inner: 'INNER JOIN solo conserva las filas que tienen pareja en los dos lados.',
      left: 'LEFT JOIN conserva todas las filas de la izquierda; si una no tiene pareja, las columnas de la derecha quedan en NULL.',
      right: 'RIGHT JOIN conserva todas las filas de la derecha; si una no tiene pareja, las columnas de la izquierda quedan en NULL.',
      full: 'FULL JOIN conserva todas las filas de ambos lados; las que no tienen pareja se completan con NULL en el otro lado.',
      cross: 'CROSS JOIN combina cada fila de la izquierda con cada fila de la derecha (producto cartesiano), sin condición.',
    }
    if (node.kind !== 'cross') {
      this.emit({
        phase: 'join',
        detail: 'minor',
        title: `${kindName} JOIN: buscar parejas`,
        explanation:
          `Para cada fila de la izquierda se buscan en la derecha las filas que cumplen${cond}. ` +
          `${plural(pairs.length, 'combinación cumple', 'combinaciones cumplen')} la condición; ` +
          `${plural(unL, 'fila izquierda queda', 'filas izquierdas quedan')} sin pareja y ${plural(unR, 'derecha', 'derechas')}. ${how[node.kind]}` +
          this.subNote(),
        span: node.joinSpan,
        tables: () => [
          this.snap(L, {
            role: 'working',
            status: lMatches.map((n) => (n > 0 ? 'matched' : 'unmatched')),
            notes: lMatches.map((n) =>
              n > 0 ? `${plural(n, 'pareja', 'parejas')}` : keepL ? 'sin pareja: se completa con NULL' : 'sin pareja: se descarta',
            ),
            highlight: hlL,
          }),
          this.snap(R, {
            role: 'working',
            status: rMatches.map((n) => (n > 0 ? 'matched' : 'unmatched')),
            notes: rMatches.map((n) =>
              n > 0 ? `${plural(n, 'pareja', 'parejas')}` : keepR ? 'sin pareja: se completa con NULL' : 'sin pareja: se descarta',
            ),
            highlight: hlR,
          }),
        ],
      })
    }
    const out: Rel = { id: 'work', title: `Filas combinadas (${kindName} JOIN)`, cols, rows }
    this.emit({
      phase: 'join',
      title: `${kindName} JOIN`,
      explanation:
        `${how[node.kind]} El resultado tiene ${plural(rows.length, 'fila', 'filas')}` +
        (node.kind === 'cross' ? ` (${L.rows.length} × ${R.rows.length}).` : '.') +
        (padded.some((p) => p) ? ' Las celdas en NULL aparecen por el relleno del JOIN, no porque el dato sea NULL.' : ''),
      span: node.joinSpan,
      tables: () => [this.snap(out, { role: 'working', status, notes, padded, highlight: hl })],
    })
    return out
  }

  // ---------- SELECT ----------

  private execCore(core: SelectCore, outer: Scope | null, orderBy: OrderItem[]): Out {
    const savedAliases = this.aliases
    const savedFirst = this.fromFirst
    this.aliases = new Set(core.items.flatMap((i) => (i.alias ? [i.alias.toLowerCase()] : [])))
    this.fromFirst = true
    try {
      return this.coreInner(core, outer, orderBy)
    } finally {
      this.aliases = savedAliases
      this.fromFirst = savedFirst
    }
  }

  private coreInner(core: SelectCore, outer: Scope | null, orderBy: OrderItem[]): Out {
    const level = outer ? outer.level + 1 : 0
    let rel: Rel
    if (core.from) rel = this.execFrom(core.from, outer)
    else {
      rel = { id: 'work', title: 'Una fila vacía', cols: [], rows: [{ key: 'row', cells: [] }] }
      this.emit({
        phase: 'from',
        title: 'Sin FROM',
        explanation: 'Sin FROM no hay tabla de origen: la consulta trabaja con una única fila vacía, por eso se pueden calcular expresiones como `SELECT 1 + 1`.',
        span: core.selectSpan,
        tables: () => [this.snap(rel, { role: 'working' })],
      })
    }

    const items = this.expandItems(core, rel)
    if (core.distinct) {
      const itemKeys = new Set(items.map((i) => exprKey(i.expr, rel.cols)))
      for (const o of orderBy) {
        if (this.orderUsesOutput(o.expr, items) || itemKeys.has(exprKey(o.expr, rel.cols))) continue
        throw new EngineError(
          'En un SELECT DISTINCT, las expresiones de ORDER BY deben aparecer en la lista de selección.',
          o.expr.span,
        )
      }
    }
    const groupExprs = core.groupBy.map((g) => this.resolveGroupExpr(g, core, items, rel))

    // ----- WHERE -----
    if (core.where && core.whereSpan) {
      const where = core.where
      this.forbidAgg(where, 'WHERE', 'WHERE se evalúa antes de formar los grupos; para filtrar por un agregado usa HAVING.')
      this.forbidWindow(where, 'WHERE')
      this.validate([where], rel.cols, outer)
      this.beginPhase()
      const scopes = this.rowScopes(rel, outer)
      const results = scopes.map((s) => this.truth(this.evalExpr(where, s), where.span))
      const status: RowStatus[] = results.map((r) => (r === true ? 'kept' : 'removed'))
      const kept = results.filter((r) => r === true).length
      const nulls = results.filter((r) => r === null).length
      const before = rel
      this.emit({
        phase: 'where',
        title: 'WHERE: filtrar filas',
        explanation:
          `Cada fila se evalúa con la condición \`${this.text(where.span)}\`. WHERE solo deja pasar las filas donde da VERDADERO: ` +
          `se conservan ${kept} de ${before.rows.length} y se descartan ${before.rows.length - kept}` +
          (nulls > 0 ? `, de las cuales ${plural(nulls, 'dio', 'dieron')} NULL (desconocido), que tampoco pasa` : '') +
          '.' +
          this.subNote(),
        span: core.whereSpan,
        tables: () => [
          this.snap(before, {
            role: 'working',
            status,
            notes: results.map((r) => (r === true ? 'VERDADERO' : r === false ? 'FALSO' : 'NULL')),
            highlight: colsReferenced([where], before.cols),
          }),
        ],
      })
      rel = { ...rel, rows: rel.rows.filter((_, i) => results[i] === true) }
    }

    // ----- agrupar -----
    const havingExpr = core.having
    if (havingExpr) {
      this.forbidWindow(havingExpr, 'HAVING')
    }
    for (const g of groupExprs) {
      this.forbidAgg(g, 'GROUP BY', 'GROUP BY se evalúa antes de calcular los agregados.')
      this.forbidWindow(g, 'GROUP BY')
    }
    const aggCalls = new Map<string, CallExpr>()
    const collect = (e: Expr) =>
      walk(e, (x) => {
        if (isAggCall(x)) {
          for (const a of x.args) {
            if (hasNode(a, isAggCall)) throw new EngineError('No se puede anidar una función de agregación dentro de otra.', a.span)
          }
          const k = exprKey(x, rel.cols)
          if (!aggCalls.has(k)) aggCalls.set(k, x)
          return false
        }
      })
    for (const it of items) collect(it.expr)
    if (havingExpr) collect(havingExpr)
    for (const o of orderBy) collect(o.expr)
    const grouped = groupExprs.length > 0 || aggCalls.size > 0 || !!havingExpr

    this.validate(
      [...items.map((i) => i.expr), ...groupExprs, ...(havingExpr ? [havingExpr] : [])],
      rel.cols,
      outer,
    )

    let units: Unit[]
    if (grouped) {
      units = this.groupPhase(core, rel, items, groupExprs, [...aggCalls.values()], orderBy, outer, level)
    } else {
      units = this.rowScopes(rel, outer).map((s, i) => ({ key: rel.rows[i].key, scope: s }))
    }

    // ----- ventanas -----
    const winCalls: CallExpr[] = []
    const collectWin = (e: Expr) =>
      walk(e, (x) => {
        if (isWindowCall(x)) winCalls.push(x)
      })
    for (const it of items) collectWin(it.expr)
    for (const o of orderBy) collectWin(o.expr)
    const winInfos = winCalls.map((c) => this.computeWindow(c, units))

    // ----- SELECT -----
    this.beginPhase()
    const outCols: RCol[] = items.map((it) => ({
      name: it.name,
      qual: it.plainCol ? it.qual : null,
      type: it.type,
      isNew: !it.plainCol,
    }))
    const rows: OutRow[] = units.map((u) => ({
      key: u.key,
      cells: items.map((it) => this.evalExpr(it.expr, u.scope)),
      scope: u.scope,
    }))
    const visible = items.map((it, i) => (it.hasWindow ? -1 : i)).filter((i) => i >= 0)
    if (visible.length > 0) {
      const part: Rel = {
        id: 'out',
        title: 'Resultado de SELECT',
        cols: visible.map((i) => outCols[i]),
        rows: rows.map((r) => ({ key: r.key, cells: visible.map((i) => r.cells[i]) })),
      }
      this.emit({
        phase: 'select',
        title: 'SELECT: elegir y calcular columnas',
        explanation: this.selectText(items, grouped, visible.length < items.length) + this.subNote(),
        span: core.selectSpan,
        tables: () => [this.snap(part, { role: 'working' })],
      })
    }
    if (winInfos.length > 0) {
      winInfos.forEach((w, k) => {
        const cols: RCol[] = [...visible.map((i) => outCols[i]), ...winInfos.slice(0, k + 1).map((x) => ({ name: x.label, qual: null, isNew: true }))]
        const rel2: Rel = {
          id: 'out',
          title: 'Funciones de ventana',
          cols,
          rows: w.order.map((idx) => ({
            key: units[idx].key,
            cells: [
              ...visible.map((i) => rows[idx].cells[i]),
              ...winInfos.slice(0, k + 1).map((x) => units[idx].scope.windows?.get(x.call) ?? null),
            ],
          })),
        }
        const spec = w.call.over as WindowSpec
        this.emit({
          phase: 'window',
          detail: winInfos.length > 1 ? 'minor' : 'major',
          title: `Ventana: ${w.call.name}`,
          explanation: this.windowText(w.call, spec),
          span: w.call.span,
          tables: () => [this.snap(rel2, { role: 'working', groups: w.order.map((idx) => w.part[idx]) })],
        })
      })
      const full: Rel = { id: 'out', title: 'Resultado con ventanas', cols: outCols, rows: rows.map((r) => ({ key: r.key, cells: r.cells })) }
      this.emit({
        phase: 'window',
        title: 'Columnas de ventana incorporadas',
        explanation:
          'Las funciones de ventana no reducen filas: cada fila conserva su identidad y recibe un valor calculado sobre su partición. Ahora la tabla tiene todas las columnas del SELECT.',
        span: core.selectSpan,
        tables: () => [this.snap(full, { role: 'working' })],
      })
    }

    // ----- DISTINCT -----
    let outRows = rows
    if (core.distinct) {
      const seen = new Map<string, number>()
      const status: RowStatus[] = []
      const notes: (string | undefined)[] = []
      const keep: OutRow[] = []
      rows.forEach((r, i) => {
        const k = tupleKey(r.cells)
        const first = seen.get(k)
        if (first === undefined) {
          seen.set(k, i)
          status.push('kept')
          notes.push(undefined)
          keep.push(r)
        } else {
          status.push('removed')
          notes.push(`repite la fila ${first + 1}`)
        }
      })
      const rel3: Rel = { id: 'out', title: 'DISTINCT', cols: outCols, rows: rows.map((r) => ({ key: r.key, cells: r.cells })) }
      this.emit({
        phase: 'distinct',
        title: 'DISTINCT: quitar duplicados',
        explanation: `DISTINCT compara filas completas (dos NULL cuentan como iguales) y deja la primera de cada valor repetido: se conservan ${keep.length} de ${rows.length}.`,
        span: core.selectSpan,
        tables: () => [this.snap(rel3, { role: 'working', status, notes })],
      })
      outRows = keep
    }
    return { cols: outCols, rows: outRows }
  }

  private selectText(items: Item[], grouped: boolean, hasWin: boolean): string {
    const plainNames = items.filter((i) => i.plainCol && !i.hasWindow).map((i) => `\`${i.name}\``)
    const calc = items.filter((i) => !i.plainCol && !i.hasWindow).map((i) => `\`${i.name}\``)
    const parts: string[] = []
    if (plainNames.length > 0) parts.push(`se eligen las columnas ${plainNames.join(', ')}`)
    if (calc.length > 0) parts.push(`se calculan ${calc.join(', ')}`)
    let t = `SELECT se evalúa después de WHERE, GROUP BY y HAVING: ${parts.join(' y ')}.`
    if (grouped) t += ' Como la consulta está agrupada, se evalúa una vez por grupo.'
    if (hasWin) t += ' Las columnas con funciones de ventana se muestran en el paso siguiente.'
    return t
  }

  private windowText(call: CallExpr, spec: WindowSpec): string {
    const part = spec.partitionBy.length > 0 ? `Las filas se dividen en particiones por ${spec.partitionBy.map((e) => `\`${this.text(e.span)}\``).join(', ')}` : 'Todas las filas forman una sola partición'
    const ord = spec.orderBy.length > 0 ? ` y dentro de cada una se ordenan por ${spec.orderBy.map((o) => `\`${this.text(o.span)}\``).join(', ')}` : ''
    const what: Record<string, string> = {
      ROW_NUMBER: 'ROW_NUMBER numera las filas de la partición 1, 2, 3...',
      RANK: 'RANK da la misma posición a los empates y deja huecos después de ellos.',
      DENSE_RANK: 'DENSE_RANK da la misma posición a los empates sin dejar huecos.',
      LAG: 'LAG toma el valor de la fila anterior de la partición.',
      LEAD: 'LEAD toma el valor de la fila siguiente de la partición.',
    }
    const agg = AGGREGATES.has(call.name)
      ? spec.orderBy.length > 0
        ? `${call.name} se calcula de forma acumulada: desde el inicio de la partición hasta la fila actual (incluidos los empates).`
        : `${call.name} se calcula sobre toda la partición y el mismo valor se repite en cada fila.`
      : ''
    return `${part}${ord}. ${what[call.name] ?? agg} Los grupos se distinguen por color y la tabla se muestra ordenada por partición.`
  }

  /** Expande * y t.* y calcula el nombre de cada columna de salida. */
  private expandItems(core: SelectCore, rel: Rel): Item[] {
    const out: Item[] = []
    for (const it of core.items) {
      const e = it.expr
      if (e.t === 'star') {
        const idxs = rel.cols.map((_, i) => i).filter((i) => e.table === null || rel.cols[i].qual?.toLowerCase() === e.table.toLowerCase())
        if (idxs.length === 0) {
          throw new EngineError(
            e.table ? `La tabla o alias "${e.table}" no existe en este FROM.` : 'SELECT * necesita una cláusula FROM.',
            e.span,
          )
        }
        for (const i of idxs) {
          const c = rel.cols[i]
          out.push({
            expr: { t: 'col', table: c.qual, name: c.name, span: e.span },
            name: c.name,
            type: c.type,
            qual: c.qual,
            plainCol: true,
            hasWindow: false,
          })
        }
        continue
      }
      let type: ColumnType | undefined
      let qual: string | null = null
      if (e.t === 'col') {
        const m = matchCols(rel.cols, e.table, e.name)
        if (m.length === 1) {
          type = rel.cols[m[0]].type
          qual = rel.cols[m[0]].qual
        }
      }
      out.push({
        expr: e,
        name: it.alias ?? (e.t === 'col' ? e.name : this.label(e)),
        type,
        qual,
        plainCol: e.t === 'col',
        hasWindow: hasNode(e, isWindowCall),
      })
    }
    return out
  }

  /** GROUP BY admite posicion (GROUP BY 1) y alias del SELECT cuando no hay una columna con ese nombre. */
  private resolveGroupExpr(g: Expr, core: SelectCore, items: Item[], rel: Rel): Expr {
    if (g.t === 'lit' && typeof g.value === 'number' && Number.isInteger(g.value)) {
      if (g.value < 1 || g.value > items.length) {
        throw new EngineError(`GROUP BY ${g.value} no es válido: el SELECT tiene ${items.length} columnas.`, g.span)
      }
      return items[g.value - 1].expr
    }
    if (g.t === 'col' && g.table === null && matchCols(rel.cols, null, g.name).length === 0) {
      const hit = core.items.find((i) => i.alias?.toLowerCase() === g.name.toLowerCase())
      if (hit) return hit.expr
    }
    return g
  }

  // ---------- GROUP BY / agregados / HAVING ----------

  private groupPhase(
    core: SelectCore,
    rel: Rel,
    items: Item[],
    groupExprs: Expr[],
    aggs: CallExpr[],
    orderBy: OrderItem[],
    outer: Scope | null,
    level: number,
  ): Unit[] {
    const gKeys = new Set(groupExprs.map((g) => exprKey(g, rel.cols)))
    const check = (e: Expr) => this.checkGrouped(e, rel.cols, gKeys, groupExprs.length === 0)
    for (const it of core.items) {
      if (it.expr.t === 'star') {
        throw new EngineError('No se puede usar * en una consulta agrupada: lista las columnas que están en GROUP BY o agregados.', it.expr.span)
      }
    }
    for (const it of items) check(it.expr)
    if (core.having) check(core.having)
    for (const o of orderBy) {
      if (!this.orderUsesOutput(o.expr, items)) check(o.expr)
    }

    // Agrupar filas.
    const scopes = this.rowScopes(rel, outer)
    const groups = new Map<string, { vals: Value[]; rows: Scope[]; idx: number[] }>()
    scopes.forEach((s, i) => {
      const vals = groupExprs.map((g) => this.evalExpr(g, s))
      const k = tupleKey(vals)
      let grp = groups.get(k)
      if (!grp) {
        grp = { vals, rows: [], idx: [] }
        groups.set(k, grp)
      }
      grp.rows.push(s)
      grp.idx.push(i)
    })
    let list = [...groups.values()]
    if (groupExprs.length === 0) list = [{ vals: [], rows: scopes, idx: scopes.map((_, i) => i) }]

    const ordered: RRow[] = []
    const groupNo: number[] = []
    const gnotes: (string | undefined)[] = []
    list.forEach((g, gi) => {
      g.idx.forEach((i, n) => {
        ordered.push(rel.rows[i])
        groupNo.push(gi)
        gnotes.push(n === 0 ? (groupExprs.length > 0 ? `grupo ${g.vals.map(plain).join(', ')}` : 'grupo único') : undefined)
      })
    })
    const gl = groupExprs.map((g) => `\`${this.text(g.span)}\``).join(', ')
    this.emit({
      phase: 'groupBy',
      title: groupExprs.length > 0 ? 'GROUP BY: formar grupos' : 'Un solo grupo',
      explanation:
        groupExprs.length > 0
          ? `Las filas se reúnen en grupos según el valor de ${gl}: filas con el mismo valor (dos NULL cuentan como iguales) van al mismo grupo. Hay ${plural(list.length, 'grupo', 'grupos')}.`
          : 'Hay funciones de agregación pero no GROUP BY, así que todas las filas forman un único grupo (incluso si no queda ninguna fila).',
      span: core.groupSpan ?? core.selectSpan,
      tables: () => [
        this.snap({ ...rel, rows: ordered }, { role: 'working', groups: groupNo, notes: gnotes, highlight: colsReferenced(groupExprs, rel.cols) }),
      ],
    })

    // Contextos de grupo y agregados.
    const nulls = rel.cols.map(() => null)
    const gscopes: Scope[] = list.map((g) => ({
      cols: rel.cols,
      cells: g.rows.length > 0 ? g.rows[0].cells : nulls,
      parent: outer,
      level,
      groupRows: g.rows,
      aggs: new Map<string, Value>(),
    }))
    this.beginPhase()
    gscopes.forEach((gs) => {
      for (const a of aggs) gs.aggs?.set(exprKey(a, rel.cols), this.computeAgg(a, gs))
    })
    const gcols: RCol[] = [
      ...groupExprs.map((g): RCol => {
        const m = g.t === 'col' ? matchCols(rel.cols, g.table, g.name) : []
        return { name: this.label(g), qual: m.length === 1 ? rel.cols[m[0]].qual : null }
      }),
      ...aggs.map((a): RCol => ({ name: this.label(a), qual: null, isNew: true })),
    ]
    const grel: Rel = {
      id: 'groups',
      title: 'Una fila por grupo',
      cols: gcols,
      rows: list.map((g, gi) => ({
        key: `g${gi + 1}`,
        cells: [...g.vals, ...aggs.map((a) => gscopes[gi].aggs?.get(exprKey(a, rel.cols)) ?? null)],
      })),
    }
    const counts = list.map((g) => `${plural(g.rows.length, 'fila', 'filas')}`)
    this.emit({
      phase: 'aggregate',
      title: aggs.length > 0 ? 'Agregados: calcular por grupo' : 'Una fila por grupo',
      explanation:
        (aggs.length > 0
          ? `Cada función de agregación se calcula sobre las filas de su grupo: ${aggs.map((a) => `\`${this.label(a)}\``).join(', ')}. COUNT(*) cuenta filas; COUNT(x), SUM, AVG, MIN y MAX ignoran los NULL. `
          : 'Sin agregados, GROUP BY deja una fila por cada combinación distinta. ') +
        `El resultado tiene ${plural(list.length, 'fila', 'filas')}, una por grupo.` +
        this.subNote(),
      span: aggs.length > 0 ? aggs[0].span : (core.groupSpan ?? core.selectSpan),
      tables: () => [this.snap(grel, { role: 'working', groups: list.map((_, i) => i), notes: counts })],
    })

    // HAVING
    let keep = list.map((_, i) => i)
    if (core.having && core.havingSpan) {
      const having = core.having
      this.beginPhase()
      const results = gscopes.map((gs) => this.truth(this.evalExpr(having, gs), having.span))
      const status: RowStatus[] = results.map((r) => (r === true ? 'kept' : 'removed'))
      keep = list.map((_, i) => i).filter((i) => results[i] === true)
      this.emit({
        phase: 'having',
        title: 'HAVING: filtrar grupos',
        explanation:
          `HAVING hace con los grupos lo que WHERE hace con las filas: evalúa \`${this.text(having.span)}\` sobre cada grupo y conserva los que dan VERDADERO. ` +
          `Quedan ${keep.length} de ${list.length}.` +
          this.subNote(),
        span: core.havingSpan,
        tables: () => [
          this.snap(grel, {
            role: 'working',
            status,
            groups: list.map((_, i) => i),
            notes: results.map((r) => (r === true ? 'VERDADERO' : r === false ? 'FALSO' : 'NULL')),
          }),
        ],
      })
    }
    return keep.map((i) => ({ key: `g${i + 1}`, scope: gscopes[i] }))
  }

  private checkGrouped(e: Expr, cols: RCol[], gKeys: Set<string>, noGroupBy: boolean): void {
    walk(e, (x) => {
      if (gKeys.has(exprKey(x, cols))) return false
      if (isAggCall(x)) return false
      if (x.t === 'col' && matchCols(cols, x.table, x.name).length > 0) {
        throw new EngineError(
          `La columna "${this.text(x.span)}" debe aparecer en GROUP BY o usarse dentro de una función de agregación (COUNT, SUM, AVG, MIN, MAX).` +
            (noGroupBy ? ' Como no hay GROUP BY, todas las filas forman un solo grupo y no se puede mostrar una columna individual.' : ''),
          x.span,
        )
      }
    })
  }

  private computeAgg(a: CallExpr, gs: Scope): Value {
    if (a.star) {
      if (a.name !== 'COUNT') throw new EngineError(`${a.name}(*) no es válido; solo COUNT(*) admite *.`, a.span)
    } else if (a.args.length !== 1) {
      throw new EngineError(`La función ${a.name} espera 1 argumento.`, a.span)
    }
    const rows = gs.groupRows ?? []
    const vals: Value[] = a.star ? rows.map(() => 1) : rows.map((r) => this.evalExpr(a.args[0], r))
    return aggregate(a.name, vals, a.distinct, a.star, a.span)
  }

  // ---------- ventanas ----------

  private computeWindow(call: CallExpr, units: Unit[]): WinInfo {
    const spec = call.over as WindowSpec
    const name = call.name
    const isAgg = AGGREGATES.has(name)
    if (!isAgg && !WINDOW_ONLY.has(name)) {
      throw new EngineError(`La función ${name} no se puede usar con OVER.`, call.nameSpan)
    }
    if (['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(name) && call.args.length > 0) {
      throw new EngineError(`${name}() no lleva argumentos.`, call.span)
    }
    if ((name === 'LAG' || name === 'LEAD') && (call.args.length < 1 || call.args.length > 3)) {
      throw new EngineError(`${name} espera entre 1 y 3 argumentos: expresión, desplazamiento y valor por defecto.`, call.span)
    }
    const n = units.length
    const partVals = units.map((u) => spec.partitionBy.map((e) => this.evalExpr(e, u.scope)))
    const ordVals = units.map((u) => spec.orderBy.map((o) => this.evalExpr(o.expr, u.scope)))
    const parts = new Map<string, number[]>()
    const part = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++) {
      const k = tupleKey(partVals[i])
      let p = parts.get(k)
      if (!p) {
        p = []
        parts.set(k, p)
      }
      part[i] = [...parts.keys()].indexOf(k)
      p.push(i)
    }
    const cmp = (a: number, b: number) => {
      for (let k = 0; k < spec.orderBy.length; k++) {
        const o = spec.orderBy[k]
        const c = compareForSort(ordVals[a][k], ordVals[b][k], o.desc, o.nulls, o.span)
        if (c !== 0) return c
      }
      return 0
    }
    const order: number[] = []
    for (const idxs of parts.values()) {
      const sorted = [...idxs].sort((a, b) => cmp(a, b) || a - b)
      order.push(...sorted)
      const same = (a: number, b: number) => tupleKey(ordVals[a]) === tupleKey(ordVals[b])
      const argVals = call.args.length > 0 && !call.star ? sorted.map((i) => this.evalExpr(call.args[0], units[i].scope)) : []
      sorted.forEach((idx, pos) => {
        let v: Value = null
        if (name === 'ROW_NUMBER') v = pos + 1
        else if (name === 'RANK' || name === 'DENSE_RANK') {
          let rank = 1
          let dense = 1
          for (let q = 1; q <= pos; q++) {
            if (!same(sorted[q], sorted[q - 1])) {
              rank = q + 1
              dense++
            }
          }
          v = name === 'RANK' ? rank : dense
        } else if (name === 'LAG' || name === 'LEAD') {
          const off = call.args[1] ? toNum(this.evalExpr(call.args[1], units[idx].scope), call.args[1].span) : 1
          const at = pos + (name === 'LAG' ? -off : off)
          v = at >= 0 && at < sorted.length ? argVals[at] : call.args[2] ? this.evalExpr(call.args[2], units[idx].scope) : null
        } else {
          let end = sorted.length - 1
          if (spec.orderBy.length > 0) {
            end = pos
            while (end + 1 < sorted.length && same(sorted[end + 1], idx)) end++
          }
          const slice = call.star ? sorted.slice(0, end + 1).map(() => 1 as Value) : argVals.slice(0, end + 1)
          v = aggregate(name, slice, call.distinct, call.star, call.span)
        }
        const sc = units[idx].scope
        sc.windows ??= new Map()
        sc.windows.set(call, v)
      })
    }
    return { call, label: this.label(call), order, part }
  }

  // ---------- ORDER BY / LIMIT ----------

  /** ORDER BY por posicion o por nombre de una columna de salida (sin evaluar expresiones). */
  private orderUsesOutput(e: Expr, items: Item[]): boolean {
    if (e.t === 'lit' && typeof e.value === 'number') return true
    if (e.t === 'col' && e.table === null) return items.some((i) => i.name.toLowerCase() === e.name.toLowerCase())
    return false
  }

  private orderColIndex(e: Expr, out: Out): number {
    if (e.t === 'lit' && typeof e.value === 'number') {
      if (!Number.isInteger(e.value)) {
        throw new EngineError(`ORDER BY ${e.value} no es válido: la posición debe ser un número entero.`, e.span)
      }
      if (e.value < 1 || e.value > out.cols.length) {
        throw new EngineError(`ORDER BY ${e.value} no es válido: la consulta devuelve ${out.cols.length} columnas.`, e.span)
      }
      return e.value - 1
    }
    if (e.t === 'col' && e.table === null) {
      const m = matchCols(out.cols, null, e.name)
      if (m.length === 1) return m[0]
      if (m.length > 1) {
        throw new EngineError(`ORDER BY "${e.name}" es ambiguo: hay ${m.length} columnas de salida con ese nombre. Usa un alias.`, e.span)
      }
    }
    return -1
  }

  private applyOrder(out: Out, q: Query): Out {
    if (q.orderBy.length === 0 || !q.orderSpan) return out
    this.beginPhase()
    const specs = q.orderBy
    const idxs = specs.map((o) => this.orderColIndex(o.expr, out))
    if (q.body.t === 'setop') {
      const op = q.body.op.toUpperCase()
      specs.forEach((o, k) => {
        if (idxs[k] < 0) {
          throw new EngineError(
            `Después de ${op} solo se puede ordenar por el nombre o la posición de una columna de salida, no por una expresión.`,
            o.expr.span,
          )
        }
      })
    }
    const keys = out.rows.map((r) => specs.map((o, k) => (idxs[k] >= 0 ? r.cells[idxs[k]] : this.evalExpr(o.expr, r.scope))))
    const order = out.rows.map((_, i) => i)
    order.sort((a, b) => {
      for (let k = 0; k < specs.length; k++) {
        const c = compareForSort(keys[a][k], keys[b][k], specs[k].desc, specs[k].nulls, specs[k].span)
        if (c !== 0) return c
      }
      return a - b
    })
    const rows = order.map((i) => out.rows[i])
    const rel: Rel = { id: 'out', title: 'Resultado ordenado', cols: out.cols, rows: rows.map((r) => ({ key: r.key, cells: r.cells })) }
    const hl = new Set(idxs.filter((i) => i >= 0))
    const desc = specs.map((o) => `\`${this.text(o.span)}\``).join(', ')
    this.emit({
      phase: 'orderBy',
      title: 'ORDER BY: ordenar',
      explanation:
        `Las filas se ordenan por ${desc}. Sin ASC/DESC el orden es ascendente; por defecto los NULL se consideran el valor más grande (van al final en ASC y al principio en DESC), salvo que uses NULLS FIRST o NULLS LAST. ` +
        'Hasta este paso el orden de las filas no estaba garantizado.' +
        this.subNote(),
      span: q.orderSpan,
      tables: () => [this.snap(rel, { role: 'working', highlight: hl, notes: order.map((i) => keys[i].map(fmt).join(', ')) })],
    })
    return { cols: out.cols, rows }
  }

  private applyLimit(out: Out, q: Query, outer: Scope | null): Out {
    if (!q.limit && !q.offset) return out
    const scope: Scope = { cols: [], cells: [], parent: outer, level: outer ? outer.level + 1 : 0 }
    const num = (e: Expr, what: string): number => {
      const v = this.evalExpr(e, scope)
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new EngineError(`${what} necesita un número entero mayor o igual que cero.`, e.span)
      }
      return v
    }
    const offset = q.offset ? num(q.offset, 'OFFSET') : 0
    const limit = q.limit ? num(q.limit, 'LIMIT') : Infinity
    const status: RowStatus[] = out.rows.map((_, i) => (i >= offset && i < offset + limit ? 'kept' : 'removed'))
    const notes = out.rows.map((_, i) => (i < offset ? 'saltada por OFFSET' : i >= offset + limit ? 'fuera de LIMIT' : undefined))
    const rows = out.rows.filter((_, i) => status[i] === 'kept')
    const rel: Rel = { id: 'out', title: 'LIMIT / OFFSET', cols: out.cols, rows: out.rows.map((r) => ({ key: r.key, cells: r.cells })) }
    this.emit({
      phase: 'limit',
      title: q.limit ? 'LIMIT: recortar filas' : 'OFFSET: saltar filas',
      explanation:
        (q.offset ? `OFFSET ${offset} salta las primeras ${plural(offset, 'fila', 'filas')}. ` : '') +
        (q.limit ? `LIMIT ${limit} deja como máximo ${plural(limit, 'fila', 'filas')}. ` : '') +
        `Se aplican al final, sobre las filas ya ordenadas: quedan ${rows.length} de ${out.rows.length}. Sin ORDER BY, qué filas quedan no está garantizado.`,
      span: q.limitSpan,
      tables: () => [this.snap(rel, { role: 'working', status, notes })],
    })
    return { cols: out.cols, rows }
  }

  // ---------- validacion ----------

  private forbidAgg(e: Expr, clause: string, why: string): void {
    walk(e, (x) => {
      if (isAggCall(x)) {
        throw new EngineError(`No se puede usar la función de agregación ${x.name} en ${clause}. ${why}`, x.span)
      }
    })
  }

  private forbidWindow(e: Expr, clause: string): void {
    walk(e, (x) => {
      if (isWindowCall(x)) {
        throw new EngineError(
          `Las funciones de ventana no se pueden usar en ${clause}: se calculan después, junto al SELECT. Calcula la ventana en una subconsulta o CTE y filtra afuera.`,
          x.span,
        )
      }
    })
  }

  /** Comprueba que todas las columnas citadas existan (en la relacion o en la consulta externa). */
  private validate(exprs: Expr[], cols: RCol[], outer: Scope | null): void {
    for (const e of exprs) {
      walk(e, (x) => {
        if (x.t !== 'col') return
        const m = matchCols(cols, x.table, x.name)
        if (m.length > 1) this.ambiguous(x, cols, m)
        if (m.length === 1) return
        for (let s = outer; s; s = s.parent) {
          const om = matchCols(s.cols, x.table, x.name)
          if (om.length === 1) return
          if (om.length > 1) this.ambiguous(x, s.cols, om)
        }
        this.notFound(x, cols)
      })
    }
  }

  private ambiguous(x: Extract<Expr, { t: 'col' }>, cols: RCol[], m: number[]): never {
    const where = m.map((i) => cols[i].qual ?? '?').join(' y ')
    throw new EngineError(
      `La columna "${x.name}" es ambigua: existe en ${where}. Escribe el prefijo de la tabla, p. ej. ${cols[m[0]].qual ?? 't'}.${x.name}.`,
      x.span,
    )
  }

  private notFound(x: Extract<Expr, { t: 'col' }>, cols: RCol[]): never {
    if (x.table) {
      const quals = [...new Set(cols.map((c) => c.qual).filter((q): q is string => !!q))]
      if (!quals.some((q) => q.toLowerCase() === x.table?.toLowerCase())) {
        throw new EngineError(`La tabla o alias "${x.table}" no existe en este FROM. Disponibles: ${quals.join(', ') || 'ninguna'}.`, x.span)
      }
      const own = cols.filter((c) => c.qual?.toLowerCase() === x.table?.toLowerCase()).map((c) => c.name)
      throw new EngineError(`La tabla "${x.table}" no tiene la columna "${x.name}". Columnas: ${own.join(', ')}.`, x.span)
    }
    if (this.aliases.has(x.name.toLowerCase())) {
      throw new EngineError(
        `"${x.name}" es un alias definido en el SELECT, pero esta cláusula se evalúa antes que SELECT, así que el alias todavía no existe. Repite la expresión original o usa una subconsulta.`,
        x.span,
      )
    }
    throw new EngineError(`La columna "${x.name}" no existe. Columnas disponibles: ${cols.map((c) => c.name).join(', ') || 'ninguna'}.`, x.span)
  }

  // ---------- expresiones ----------

  private truth(v: Value, span: SourceSpan): boolean | null {
    if (v === null || typeof v === 'boolean') return v
    throw new EngineError(`Se esperaba una condición (VERDADERO o FALSO) pero se obtuvo ${fmt(v)}.`, span)
  }

  private lookup(scope: Scope, e: Extract<Expr, { t: 'col' }>): Value {
    for (let s: Scope | null = scope; s; s = s.parent) {
      const m = matchCols(s.cols, e.table, e.name)
      if (m.length > 1) this.ambiguous(e, s.cols, m)
      if (m.length === 1) {
        if (s.level < this.minLevel) this.minLevel = s.level
        return s.cells[m[0]]
      }
    }
    return this.notFound(e, scope.cols)
  }

  private evalExpr(e: Expr, scope: Scope): Value {
    switch (e.t) {
      case 'lit':
        return e.value
      case 'col':
        return this.lookup(scope, e)
      case 'star':
        throw new EngineError('El * solo se puede usar en la lista del SELECT o dentro de COUNT(*).', e.span)
      case 'unary': {
        const v = this.evalExpr(e.arg, scope)
        if (e.op === 'not') {
          const t = this.truth(v, e.arg.span)
          return t === null ? null : !t
        }
        if (v === null) return null
        return e.op === '-' ? -toNum(v, e.span) : toNum(v, e.span)
      }
      case 'bin':
        return this.evalBin(e, scope)
      case 'isnull': {
        const isNull = this.evalExpr(e.arg, scope) === null
        return e.negated ? !isNull : isNull
      }
      case 'between': {
        const v = this.evalExpr(e.arg, scope)
        const lo = this.evalExpr(e.lo, scope)
        const hi = this.evalExpr(e.hi, scope)
        const a = v === null || lo === null ? null : compareValues(v, lo, e.span) >= 0
        const b = v === null || hi === null ? null : compareValues(v, hi, e.span) <= 0
        const r = and3(a, b)
        return e.negated && r !== null ? !r : r
      }
      case 'like': {
        const v = this.evalExpr(e.arg, scope)
        const p = this.evalExpr(e.pattern, scope)
        if (v === null || p === null) return null
        const r = likeMatch(toText(v), toText(p), e.pattern.span)
        return e.negated ? !r : r
      }
      case 'in': {
        const x = this.evalExpr(e.arg, scope)
        const vals = e.list.map((l) => this.evalExpr(l, scope))
        return this.inList(x, vals, e.negated, e.span)
      }
      case 'insub': {
        const x = this.evalExpr(e.arg, scope)
        const rel = this.runSub(e.query, e.span, scope, 'in')
        if (rel.cols.length !== 1) {
          throw new EngineError(`La subconsulta de IN debe devolver una sola columna y devuelve ${rel.cols.length}.`, e.query.span)
        }
        return this.inList(x, rel.rows.map((r) => r.cells[0]), e.negated, e.span)
      }
      case 'exists':
        return this.runSub(e.query, e.span, scope, 'exists').rows.length > 0
      case 'subq': {
        const rel = this.runSub(e.query, e.span, scope, 'scalar')
        if (rel.cols.length !== 1) {
          throw new EngineError(`Una subconsulta escalar debe devolver una sola columna y devuelve ${rel.cols.length}.`, e.query.span)
        }
        if (rel.rows.length > 1) {
          throw new EngineError(`La subconsulta devolvió ${rel.rows.length} filas, pero aquí se esperaba un solo valor.`, e.query.span)
        }
        return rel.rows.length === 0 ? null : rel.rows[0].cells[0]
      }
      case 'case': {
        const op = e.operand ? this.evalExpr(e.operand, scope) : null
        for (const w of e.whens) {
          const c = this.evalExpr(w.cond, scope)
          const hit = e.operand ? op !== null && c !== null && compareValues(op, c, w.cond.span) === 0 : this.truth(c, w.cond.span) === true
          if (hit) return this.evalExpr(w.then, scope)
        }
        return e.otherwise ? this.evalExpr(e.otherwise, scope) : null
      }
      case 'cast':
        return castValue(this.evalExpr(e.arg, scope), e.type, e.span)
      case 'extract':
        return datePart(this.evalExpr(e.arg, scope), e.field, e.span)
      case 'call':
        return this.evalCall(e, scope)
    }
  }

  private inList(x: Value, vals: Value[], negated: boolean, span: SourceSpan): Value {
    let res: boolean | null
    if (x === null) res = vals.length === 0 ? false : null
    else {
      res = false
      for (const v of vals) {
        if (v === null) res = res === true ? true : null
        else if (compareValues(x, v, span) === 0) {
          res = true
          break
        }
      }
    }
    return negated && res !== null ? !res : res
  }

  private evalBin(e: Extract<Expr, { t: 'bin' }>, scope: Scope): Value {
    if (e.op === 'and' || e.op === 'or') {
      const l = this.truth(this.evalExpr(e.left, scope), e.left.span)
      if (e.op === 'and' && l === false) return false
      if (e.op === 'or' && l === true) return true
      const r = this.truth(this.evalExpr(e.right, scope), e.right.span)
      return e.op === 'and' ? and3(l, r) : or3(l, r)
    }
    const l = this.evalExpr(e.left, scope)
    const r = this.evalExpr(e.right, scope)
    if (l === null || r === null) return null
    switch (e.op) {
      case '=':
        return compareValues(l, r, e.span) === 0
      case '<>':
        return compareValues(l, r, e.span) !== 0
      case '<':
        return compareValues(l, r, e.span) < 0
      case '<=':
        return compareValues(l, r, e.span) <= 0
      case '>':
        return compareValues(l, r, e.span) > 0
      case '>=':
        return compareValues(l, r, e.span) >= 0
      case '||':
        return toText(l) + toText(r)
    }
    const a = toNum(l, e.left.span)
    const b = toNum(r, e.right.span)
    if ((e.op === '/' || e.op === '%') && b === 0) throw new EngineError('División entre cero.', e.span)
    switch (e.op) {
      case '+':
        return round(a + b)
      case '-':
        return round(a - b)
      case '*':
        return round(a * b)
      case '/':
        return round(a / b)
      default:
        return round(a % b)
    }
  }

  private evalCall(e: CallExpr, scope: Scope): Value {
    if (e.over) {
      const v = scope.windows?.get(e)
      if (v === undefined) {
        throw new EngineError('Las funciones de ventana solo se pueden usar en la lista del SELECT (y en ORDER BY).', e.span)
      }
      return v
    }
    if (AGGREGATES.has(e.name)) {
      if (!scope.groupRows) {
        throw new EngineError(`No se puede usar la función de agregación ${e.name} aquí: las filas aún no se han agrupado.`, e.span)
      }
      const k = exprKey(e, scope.cols)
      const cached = scope.aggs?.get(k)
      if (cached !== undefined) return cached
      const v = this.computeAgg(e, scope)
      scope.aggs?.set(k, v)
      return v
    }
    if (WINDOW_ONLY.has(e.name)) {
      throw new EngineError(`${e.name} es una función de ventana y necesita la cláusula OVER (...).`, e.span)
    }
    if (!SCALAR_NAMES.includes(e.name)) {
      throw new EngineError(`La función "${e.name}" no existe o no está soportada.`, e.nameSpan)
    }
    if (e.star || e.distinct) throw new EngineError(`${e.name} no admite * ni DISTINCT.`, e.span)
    checkArity(e.name, e.args.length, e.span)
    if (e.name === 'COALESCE') {
      for (const a of e.args) {
        const v = this.evalExpr(a, scope)
        if (v !== null) return v
      }
      return null
    }
    return callScalar(
      e.name,
      e.args.map((a) => this.evalExpr(a, scope)),
      e.span,
    )
  }

  // ---------- subconsultas ----------

  private ctxSnap(scope: Scope): TableSnapshot[] {
    const { rel, index } = scope
    if (!rel || index === undefined) return []
    const status: RowStatus[] = rel.rows.map((_, i) => (i === index ? 'active' : 'normal'))
    return [this.snap(rel, { role: 'working', id: `ctx:${this.depth}`, title: 'Consulta externa: fila actual', status })]
  }

  private runSub(query: Query, span: SourceSpan, scope: Scope, mode: 'scalar' | 'exists' | 'in'): Rel {
    let info = this.subInfo.get(query)
    if (!info) {
      info = { count: 0, correlated: false, cache: null }
      this.subInfo.set(query, info)
    }
    if (!this.phaseSubs.has(info)) this.phaseSubs.set(info, info.count)
    info.count++
    if (info.cache) return info.cache
    const traced = this.quiet === 0 && info.count === 1
    const savedMin = this.minLevel
    const savedPhase = this.phaseSubs
    this.minLevel = Infinity
    let rel: Rel
    try {
      if (traced) {
        const ord = ++this.subSeq
        const name = mode === 'exists' ? `EXISTS ${ord}` : `Subconsulta ${ord}`
        const ctx = this.ctxSnap(scope)
        this.emit({
          kind: ctx.length > 0 ? 'iterate-row' : 'enter',
          phase: 'subquery',
          title: `${name}: primera evaluación`,
          explanation:
            ctx.length > 0
              ? `La consulta externa evalúa una subconsulta para cada fila. Aquí se ve la ejecución para la primera fila (resaltada); en las demás filas el proceso es igual y solo cambian los valores que toma de la fila externa.`
              : 'Se ejecuta la subconsulta completa antes de usar su resultado en la consulta externa.',
          span,
          tables: () => ctx,
        })
        const savedCtx = this.ctxTables
        this.ctxTables = [...savedCtx, ...ctx]
        this.depth++
        try {
          rel = this.withLabel(name, () => this.execQuery(query, scope))
          const value = mode === 'exists' ? rel.rows.length > 0 : mode === 'scalar' && rel.rows.length === 1 && rel.cols.length === 1 ? rel.rows[0].cells[0] : undefined
          const shown: Rel = { ...rel, id: 'sub:result', title: 'Resultado de la subconsulta' }
          const corr = this.minLevel <= scope.level
          this.withLabel(name, () => this.emit({
            kind: value !== undefined ? 'scalar-result' : 'table-result',
            phase: 'subquery',
            title: `${name}: resultado`,
            explanation:
              `La subconsulta devuelve ${plural(rel.rows.length, 'fila', 'filas')}. ` +
              (corr
                ? 'Usa columnas de la consulta externa (es correlacionada), así que se vuelve a ejecutar para cada fila.'
                : 'No usa columnas de la consulta externa, así que se calcula una sola vez y se reutiliza.'),
            span,
            tables: () => [this.snap(shown, { role: 'working' })],
            scalar: value === undefined ? undefined : { label: mode === 'exists' ? 'EXISTS' : 'Valor', value },
          }))
        } finally {
          this.depth--
          this.ctxTables = savedCtx
        }
      } else {
        this.quiet++
        try {
          rel = this.execQuery(query, scope)
        } finally {
          this.quiet--
        }
      }
      info.correlated = this.minLevel <= scope.level
      if (!info.correlated) info.cache = rel
    } finally {
      this.minLevel = Math.min(savedMin, this.minLevel)
      this.phaseSubs = savedPhase
    }
    return rel
  }
}

function and3(a: boolean | null, b: boolean | null): boolean | null {
  if (a === false || b === false) return false
  return a === null || b === null ? null : true
}

function or3(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true
  return a === null || b === null ? null : false
}

function colsReferenced(exprs: Expr[], cols: RCol[]): Set<number> {
  const out = new Set<number>()
  for (const e of exprs) {
    walk(e, (x) => {
      if (x.t === 'col') {
        const m = matchCols(cols, x.table, x.name)
        if (m.length === 1) out.add(m[0])
      }
    })
  }
  return out
}
