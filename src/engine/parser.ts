import type { SourceSpan, Value } from './types'
import { EngineError } from './errors'
import { lex } from './lexer'
import type { Token } from './lexer'

// ---------- AST ----------

export type Expr =
  | { t: 'lit'; value: Value; span: SourceSpan }
  | { t: 'col'; table: string | null; name: string; span: SourceSpan }
  | { t: 'star'; table: string | null; span: SourceSpan }
  | { t: 'unary'; op: '-' | '+' | 'not'; arg: Expr; span: SourceSpan }
  | { t: 'bin'; op: string; left: Expr; right: Expr; span: SourceSpan }
  | { t: 'isnull'; arg: Expr; negated: boolean; span: SourceSpan }
  | { t: 'between'; arg: Expr; lo: Expr; hi: Expr; negated: boolean; span: SourceSpan }
  | { t: 'like'; arg: Expr; pattern: Expr; negated: boolean; span: SourceSpan }
  | { t: 'in'; arg: Expr; list: Expr[]; negated: boolean; span: SourceSpan }
  | { t: 'insub'; arg: Expr; query: Query; negated: boolean; span: SourceSpan }
  | { t: 'exists'; query: Query; span: SourceSpan }
  | { t: 'subq'; query: Query; span: SourceSpan }
  | { t: 'case'; operand: Expr | null; whens: { cond: Expr; then: Expr }[]; otherwise: Expr | null; span: SourceSpan }
  | {
      t: 'call'
      name: string
      args: Expr[]
      distinct: boolean
      star: boolean
      over: WindowSpec | null
      span: SourceSpan
      nameSpan: SourceSpan
    }
  | { t: 'cast'; arg: Expr; type: string; span: SourceSpan }
  | { t: 'extract'; field: string; arg: Expr; span: SourceSpan }

export interface WindowSpec {
  partitionBy: Expr[]
  orderBy: OrderItem[]
  span: SourceSpan
}

export interface OrderItem {
  expr: Expr
  desc: boolean
  nulls: 'first' | 'last' | null
  span: SourceSpan
}

export interface SelectItem {
  expr: Expr
  alias: string | null
  span: SourceSpan
}

export type JoinKind = 'inner' | 'left' | 'right' | 'full' | 'cross'

export type FromNode =
  | { t: 'table'; name: string; alias: string | null; span: SourceSpan }
  | { t: 'derived'; query: Query; alias: string; span: SourceSpan }
  | { t: 'join'; kind: JoinKind; left: FromNode; right: FromNode; on: Expr | null; span: SourceSpan; joinSpan: SourceSpan }

export interface SelectCore {
  t: 'select'
  distinct: boolean
  items: SelectItem[]
  from: FromNode | null
  where: Expr | null
  groupBy: Expr[]
  having: Expr | null
  span: SourceSpan
  selectSpan: SourceSpan
  fromSpan: SourceSpan | null
  whereSpan: SourceSpan | null
  groupSpan: SourceSpan | null
  havingSpan: SourceSpan | null
}

export type SetOpKind = 'union' | 'intersect' | 'except'

export type QueryBody =
  | SelectCore
  | { t: 'setop'; op: SetOpKind; all: boolean; left: QueryBody; right: QueryBody; span: SourceSpan; opSpan: SourceSpan }
  | { t: 'paren'; query: Query; span: SourceSpan }

export interface Cte {
  name: string
  query: Query
  span: SourceSpan
}

export interface Query {
  ctes: Cte[]
  body: QueryBody
  orderBy: OrderItem[]
  limit: Expr | null
  offset: Expr | null
  span: SourceSpan
  orderSpan: SourceSpan | null
  limitSpan: SourceSpan | null
}

// ---------- palabras reservadas ----------

const RESERVED = new Set(
  (
    'SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET UNION INTERSECT EXCEPT JOIN INNER LEFT RIGHT FULL OUTER CROSS ' +
    'NATURAL USING ON AS AND OR NOT IN IS NULL LIKE BETWEEN CASE WHEN THEN ELSE END DISTINCT ALL ASC DESC NULLS EXISTS ' +
    'WITH OVER PARTITION TRUE FALSE ROWS RANGE'
  ).split(' '),
)

const FORBIDDEN: Record<string, string> = {
  INSERT: 'inserta datos',
  UPDATE: 'modifica datos',
  DELETE: 'borra datos',
  CREATE: 'crea objetos en la base de datos',
  DROP: 'elimina objetos de la base de datos',
  ALTER: 'cambia la estructura de la base de datos',
  TRUNCATE: 'vacía una tabla',
  MERGE: 'modifica datos',
  GRANT: 'cambia permisos',
  REVOKE: 'cambia permisos',
  REPLACE: 'modifica datos',
  CALL: 'ejecuta procedimientos',
  EXEC: 'ejecuta procedimientos',
  EXECUTE: 'ejecuta procedimientos',
}

export const isReserved = (word: string): boolean => RESERVED.has(word.toUpperCase())

const SPECIAL_FORMS = new Set(['CASE', 'EXISTS', 'CAST', 'EXTRACT'])

// ---------- parser ----------

class Parser {
  private pos = 0
  private toks: Token[]
  private src: string

  constructor(toks: Token[], src: string) {
    this.toks = toks
    this.src = src
  }

  private get tok(): Token {
    return this.toks[this.pos]
  }

  private peek(k = 1): Token {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)]
  }

  private prevEnd(): number {
    return this.pos > 0 ? this.toks[this.pos - 1].end : 0
  }

  private spanOf(a: number): SourceSpan {
    return { start: a, end: this.prevEnd() }
  }

  private tokSpan(t: Token): SourceSpan {
    if (t.kind === 'eof') {
      const last = this.toks[this.toks.length - 2]
      return last ? { start: last.start, end: last.end } : { start: 0, end: this.src.length }
    }
    return { start: t.start, end: t.end }
  }

  private describe(t: Token): string {
    if (t.kind === 'eof') return 'el final de la consulta'
    if (t.kind === 'str') return `el texto '${t.text}'`
    return `"${this.src.slice(t.start, t.end)}"`
  }

  private fail(what: string): never {
    const t = this.tok
    if (t.kind === 'ident' && FORBIDDEN[t.text.toUpperCase()]) this.forbidden(t)
    throw new EngineError(`Se esperaba ${what} pero se encontró ${this.describe(t)}.`, this.tokSpan(t))
  }

  private forbidden(t: Token): never {
    const w = t.text.toUpperCase()
    throw new EngineError(
      `Esta herramienta solo ejecuta consultas (SELECT). ${w} ${FORBIDDEN[w]} y no está permitido aquí.`,
      this.tokSpan(t),
    )
  }

  private isKw(kw: string, t: Token = this.tok): boolean {
    return t.kind === 'ident' && t.text.toUpperCase() === kw
  }

  private isPunct(p: string, t: Token = this.tok): boolean {
    return t.kind === 'punct' && t.text === p
  }

  private isOp(o: string, t: Token = this.tok): boolean {
    return t.kind === 'op' && t.text === o
  }

  private acceptKw(kw: string): boolean {
    if (!this.isKw(kw)) return false
    this.pos++
    return true
  }

  private expectKw(kw: string): Token {
    if (!this.isKw(kw)) this.fail(`la palabra clave ${kw}`)
    return this.toks[this.pos++]
  }

  private acceptPunct(p: string): boolean {
    if (!this.isPunct(p)) return false
    this.pos++
    return true
  }

  private expectPunct(p: string): Token {
    if (!this.isPunct(p)) this.fail(`"${p}"`)
    return this.toks[this.pos++]
  }

  /** Token que puede ser un nombre: entre comillas dobles o una palabra no reservada. */
  private isName(t: Token = this.tok): boolean {
    return t.kind === 'qident' || (t.kind === 'ident' && !isReserved(t.text))
  }

  private name(what: string): string {
    if (!this.isName()) this.fail(what)
    return this.toks[this.pos++].text
  }

  // ----- sentencia -----

  parseStatement(): Query {
    if (this.toks.length === 1) throw new EngineError('La consulta está vacía. Escribe una sentencia SELECT.', null)
    const first = this.tok
    if (first.kind === 'ident' && FORBIDDEN[first.text.toUpperCase()]) this.forbidden(first)
    if (!this.isKw('SELECT') && !this.isKw('WITH') && !this.isPunct('(')) {
      throw new EngineError(
        `La consulta debe empezar con SELECT o WITH, pero empieza con ${this.describe(first)}.`,
        this.tokSpan(first),
      )
    }
    const q = this.parseQuery()
    this.acceptPunct(';')
    if (this.tok.kind !== 'eof') {
      if (this.tok.kind === 'ident' && FORBIDDEN[this.tok.text.toUpperCase()]) this.forbidden(this.tok)
      throw new EngineError(
        `Después de la consulta sobra ${this.describe(this.tok)}. Solo se admite una sentencia.`,
        this.tokSpan(this.tok),
      )
    }
    return q
  }

  private parseQuery(): Query {
    const start = this.tok.start
    const ctes: Cte[] = []
    if (this.isKw('WITH')) {
      this.pos++
      if (this.isKw('RECURSIVE')) {
        throw new EngineError('WITH RECURSIVE no está soportado; usa CTE no recursivas.', this.tokSpan(this.tok))
      }
      do {
        const cs = this.tok.start
        const name = this.name('el nombre de la CTE')
        if (this.isPunct('(')) {
          throw new EngineError(
            'Las CTE con lista de columnas no están soportadas; usa alias en el SELECT.',
            this.tokSpan(this.tok),
          )
        }
        this.expectKw('AS')
        this.expectPunct('(')
        const query = this.parseQuery()
        this.expectPunct(')')
        ctes.push({ name, query, span: this.spanOf(cs) })
      } while (this.acceptPunct(','))
    }
    const body = this.parseSetExpr()
    let orderBy: OrderItem[] = []
    let orderSpan: SourceSpan | null = null
    if (this.isKw('ORDER')) {
      const os = this.tok.start
      this.pos++
      this.expectKw('BY')
      orderBy = this.parseOrderItems()
      orderSpan = this.spanOf(os)
    }
    let limit: Expr | null = null
    let offset: Expr | null = null
    let limitSpan: SourceSpan | null = null
    const ls = this.tok.start
    let seen = false
    for (;;) {
      if (this.isKw('LIMIT') && !seen) {
        this.pos++
        if (!this.acceptKw('ALL') && !this.acceptKw('NULL')) limit = this.parseExpr()
        seen = true
      } else if (this.isKw('OFFSET') && !offset) {
        this.pos++
        offset = this.parseExpr()
        if (!this.acceptKw('ROWS')) this.acceptKw('ROW')
        seen = true
      } else break
    }
    if (this.tok.start !== ls) limitSpan = this.spanOf(ls)
    return { ctes, body, orderBy, limit, offset, span: this.spanOf(start), orderSpan, limitSpan }
  }

  private parseSetExpr(): QueryBody {
    let left = this.parseIntersect()
    while (this.isKw('UNION') || this.isKw('EXCEPT')) {
      const opTok = this.toks[this.pos++]
      const op: SetOpKind = opTok.text.toUpperCase() === 'UNION' ? 'union' : 'except'
      const all = this.acceptKw('ALL')
      if (!all) this.acceptKw('DISTINCT')
      const right = this.parseIntersect()
      left = {
        t: 'setop',
        op,
        all,
        left,
        right,
        span: { start: left.span.start, end: this.prevEnd() },
        opSpan: { start: opTok.start, end: opTok.end },
      }
    }
    return left
  }

  private parseIntersect(): QueryBody {
    let left = this.parseSetTerm()
    while (this.isKw('INTERSECT')) {
      const opTok = this.toks[this.pos++]
      const all = this.acceptKw('ALL')
      if (!all) this.acceptKw('DISTINCT')
      const right = this.parseSetTerm()
      left = {
        t: 'setop',
        op: 'intersect',
        all,
        left,
        right,
        span: { start: left.span.start, end: this.prevEnd() },
        opSpan: { start: opTok.start, end: opTok.end },
      }
    }
    return left
  }

  private parseSetTerm(): QueryBody {
    if (this.isPunct('(')) {
      const s = this.tok.start
      this.pos++
      const query = this.parseQuery()
      this.expectPunct(')')
      return { t: 'paren', query, span: this.spanOf(s) }
    }
    if (!this.isKw('SELECT')) this.fail('SELECT')
    return this.parseSelect()
  }

  private parseSelect(): SelectCore {
    const start = this.tok.start
    this.expectKw('SELECT')
    const distinct = this.acceptKw('DISTINCT')
    if (!distinct) this.acceptKw('ALL')
    const items: SelectItem[] = []
    do {
      items.push(this.parseSelectItem())
    } while (this.acceptPunct(','))
    const selectSpan = this.spanOf(start)

    let from: FromNode | null = null
    let fromSpan: SourceSpan | null = null
    if (this.isKw('FROM')) {
      const fs = this.tok.start
      this.pos++
      from = this.parseFrom()
      fromSpan = this.spanOf(fs)
    }
    let where: Expr | null = null
    let whereSpan: SourceSpan | null = null
    if (this.isKw('WHERE')) {
      const ws = this.tok.start
      this.pos++
      where = this.parseExpr()
      whereSpan = this.spanOf(ws)
    }
    const groupBy: Expr[] = []
    let groupSpan: SourceSpan | null = null
    if (this.isKw('GROUP')) {
      const gs = this.tok.start
      this.pos++
      this.expectKw('BY')
      do {
        groupBy.push(this.parseExpr())
      } while (this.acceptPunct(','))
      groupSpan = this.spanOf(gs)
    }
    let having: Expr | null = null
    let havingSpan: SourceSpan | null = null
    if (this.isKw('HAVING')) {
      const hs = this.tok.start
      this.pos++
      having = this.parseExpr()
      havingSpan = this.spanOf(hs)
    }
    return {
      t: 'select',
      distinct,
      items,
      from,
      where,
      groupBy,
      having,
      span: this.spanOf(start),
      selectSpan,
      fromSpan,
      whereSpan,
      groupSpan,
      havingSpan,
    }
  }

  private parseSelectItem(): SelectItem {
    const start = this.tok.start
    if (this.isOp('*')) {
      this.pos++
      return { expr: { t: 'star', table: null, span: this.spanOf(start) }, alias: null, span: this.spanOf(start) }
    }
    if (
      (this.tok.kind === 'ident' || this.tok.kind === 'qident') &&
      this.isPunct('.', this.peek()) &&
      this.isOp('*', this.peek(2))
    ) {
      const table = this.tok.text
      this.pos += 3
      return { expr: { t: 'star', table, span: this.spanOf(start) }, alias: null, span: this.spanOf(start) }
    }
    const expr = this.parseExpr()
    let alias: string | null = null
    if (this.acceptKw('AS')) alias = this.name('el nombre del alias')
    else if (this.isName()) alias = this.toks[this.pos++].text
    return { expr, alias, span: this.spanOf(start) }
  }

  // ----- FROM -----

  private parseFrom(): FromNode {
    let left = this.parseFromSource()
    for (;;) {
      const js = this.tok.start
      if (this.acceptPunct(',')) {
        const right = this.parseFromSource()
        left = {
          t: 'join',
          kind: 'cross',
          left,
          right,
          on: null,
          span: { start: left.span.start, end: this.prevEnd() },
          joinSpan: this.spanOf(js),
        }
        continue
      }
      let kind: JoinKind | null = null
      if (this.isKw('NATURAL')) {
        throw new EngineError('NATURAL JOIN no está soportado; escribe la condición con ON.', this.tokSpan(this.tok))
      }
      if (this.isKw('JOIN')) {
        kind = 'inner'
        this.pos++
      } else if (this.isKw('INNER')) {
        kind = 'inner'
        this.pos++
        this.expectKw('JOIN')
      } else if (this.isKw('LEFT') || this.isKw('RIGHT') || this.isKw('FULL')) {
        kind = this.tok.text.toLowerCase() as JoinKind
        this.pos++
        this.acceptKw('OUTER')
        this.expectKw('JOIN')
      } else if (this.isKw('CROSS')) {
        kind = 'cross'
        this.pos++
        this.expectKw('JOIN')
      }
      if (!kind) return left
      const right = this.parseFromSource()
      let on: Expr | null = null
      if (kind !== 'cross') {
        if (this.isKw('USING')) {
          throw new EngineError('JOIN ... USING no está soportado; escribe la condición con ON.', this.tokSpan(this.tok))
        }
        if (!this.isKw('ON')) this.fail(`ON con la condición del ${kind.toUpperCase()} JOIN`)
        this.pos++
        on = this.parseExpr()
      }
      left = {
        t: 'join',
        kind,
        left,
        right,
        on,
        span: { start: left.span.start, end: this.prevEnd() },
        joinSpan: this.spanOf(js),
      }
    }
  }

  private parseFromSource(): FromNode {
    const start = this.tok.start
    if (this.isPunct('(')) {
      this.pos++
      if (!this.isKw('SELECT') && !this.isKw('WITH') && !this.isPunct('(')) this.fail('una subconsulta SELECT')
      const query = this.parseQuery()
      this.expectPunct(')')
      this.acceptKw('AS')
      if (!this.isName()) {
        throw new EngineError('Una subconsulta en FROM necesita un alias, p. ej. `(SELECT ...) AS t`.', this.spanOf(start))
      }
      const alias = this.toks[this.pos++].text
      return { t: 'derived', query, alias, span: this.spanOf(start) }
    }
    const name = this.name('el nombre de una tabla')
    let alias: string | null = null
    if (this.acceptKw('AS')) alias = this.name('el alias de la tabla')
    else if (this.isName()) alias = this.toks[this.pos++].text
    return { t: 'table', name, alias, span: this.spanOf(start) }
  }

  // ----- ORDER BY -----

  private parseOrderItems(): OrderItem[] {
    const items: OrderItem[] = []
    do {
      const start = this.tok.start
      const expr = this.parseExpr()
      let desc = false
      if (this.acceptKw('DESC')) desc = true
      else this.acceptKw('ASC')
      let nulls: 'first' | 'last' | null = null
      if (this.acceptKw('NULLS')) {
        if (this.acceptKw('FIRST')) nulls = 'first'
        else if (this.acceptKw('LAST')) nulls = 'last'
        else this.fail('FIRST o LAST')
      }
      items.push({ expr, desc, nulls, span: this.spanOf(start) })
    } while (this.acceptPunct(','))
    return items
  }

  // ----- expresiones -----

  parseExpr(): Expr {
    return this.parseOr()
  }

  private bin(op: string, left: Expr, right: Expr): Expr {
    return { t: 'bin', op, left, right, span: { start: left.span.start, end: right.span.end } }
  }

  private parseOr(): Expr {
    let left = this.parseAnd()
    while (this.acceptKw('OR')) left = this.bin('or', left, this.parseAnd())
    return left
  }

  private parseAnd(): Expr {
    let left = this.parseNot()
    while (this.acceptKw('AND')) left = this.bin('and', left, this.parseNot())
    return left
  }

  private parseNot(): Expr {
    if (this.isKw('NOT')) {
      const s = this.tok.start
      this.pos++
      const arg = this.parseNot()
      return { t: 'unary', op: 'not', arg, span: this.spanOf(s) }
    }
    return this.parsePredicate()
  }

  private parsePredicate(): Expr {
    let left = this.parseAdditive()
    for (;;) {
      const s = left.span.start
      const t = this.tok
      if (t.kind === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.text)) {
        this.pos++
        const q = this.tok
        if ((this.isKw('ANY') || this.isKw('SOME') || this.isKw('ALL')) && this.isPunct('(', this.peek())) {
          throw new EngineError(
            `${q.text.toUpperCase()} con una subconsulta no está soportado por esta herramienta; usa IN, NOT IN o EXISTS.`,
            { start: t.start, end: q.end },
          )
        }
        left = this.bin(t.text, left, this.parseAdditive())
        continue
      }
      if (this.isKw('ILIKE') || (this.isKw('NOT') && this.isKw('ILIKE', this.peek()))) {
        const k = this.isKw('ILIKE') ? this.tok : this.peek()
        throw new EngineError('ILIKE no está soportado por esta herramienta; usa LIKE (distingue mayúsculas) o LOWER(...) LIKE.', this.tokSpan(k))
      }
      if (this.isKw('IS')) {
        this.pos++
        const negated = this.acceptKw('NOT')
        for (const w of ['TRUE', 'FALSE', 'UNKNOWN']) {
          if (this.isKw(w)) {
            throw new EngineError(
              `IS ${negated ? 'NOT ' : ''}${w} no está soportado por esta herramienta; usa una comparación o IS NULL.`,
              { start: t.start, end: this.tok.end },
            )
          }
        }
        if (this.isKw('DISTINCT')) {
          throw new EngineError(
            `IS ${negated ? 'NOT ' : ''}DISTINCT FROM no está soportado por esta herramienta; combina = con IS NULL.`,
            { start: t.start, end: this.tok.end },
          )
        }
        this.expectKw('NULL')
        left = { t: 'isnull', arg: left, negated, span: this.spanOf(s) }
        continue
      }
      let negated = false
      const nx = this.peek()
      if (this.isKw('NOT') && (this.isKw('IN', nx) || this.isKw('BETWEEN', nx) || this.isKw('LIKE', nx))) {
        negated = true
        this.pos++
      }
      if (this.isKw('IN')) {
        this.pos++
        this.expectPunct('(')
        if (this.isKw('SELECT') || this.isKw('WITH')) {
          const query = this.parseQuery()
          this.expectPunct(')')
          left = { t: 'insub', arg: left, query, negated, span: this.spanOf(s) }
        } else {
          const list: Expr[] = []
          do {
            list.push(this.parseExpr())
          } while (this.acceptPunct(','))
          this.expectPunct(')')
          left = { t: 'in', arg: left, list, negated, span: this.spanOf(s) }
        }
        continue
      }
      if (this.isKw('BETWEEN')) {
        this.pos++
        const lo = this.parseAdditive()
        this.expectKw('AND')
        const hi = this.parseAdditive()
        left = { t: 'between', arg: left, lo, hi, negated, span: this.spanOf(s) }
        continue
      }
      if (this.isKw('LIKE')) {
        this.pos++
        const pattern = this.parseAdditive()
        left = { t: 'like', arg: left, pattern, negated, span: this.spanOf(s) }
        continue
      }
      return left
    }
  }

  private parseAdditive(): Expr {
    let left = this.parseMul()
    while (this.tok.kind === 'op' && ['+', '-', '||'].includes(this.tok.text)) {
      const op = this.toks[this.pos++].text
      left = this.bin(op, left, this.parseMul())
    }
    return left
  }

  private parseMul(): Expr {
    let left = this.parseUnary()
    while (this.tok.kind === 'op' && ['*', '/', '%'].includes(this.tok.text)) {
      const op = this.toks[this.pos++].text
      left = this.bin(op, left, this.parseUnary())
    }
    return left
  }

  private parseUnary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const s = this.tok.start
      const op = this.toks[this.pos++].text as '-' | '+'
      const arg = this.parseUnary()
      return { t: 'unary', op, arg, span: this.spanOf(s) }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    while (this.isOp('::')) {
      this.pos++
      const type = this.parseTypeName()
      e = { t: 'cast', arg: e, type, span: this.spanOf(e.span.start) }
    }
    return e
  }

  private parseTypeName(): string {
    const t = this.tok
    if (t.kind !== 'ident') this.fail('un tipo de dato')
    this.pos++
    let name = t.text.toLowerCase()
    if (name === 'double' && this.isKw('PRECISION')) {
      this.pos++
      name = 'double precision'
    }
    if (this.isPunct('(')) {
      this.pos++
      while (!this.isPunct(')') && this.tok.kind !== 'eof') this.pos++
      this.expectPunct(')')
    }
    return name
  }

  private parsePrimary(): Expr {
    const t = this.tok
    const s = t.start
    if (t.kind === 'num') {
      this.pos++
      return { t: 'lit', value: t.num as number, span: this.spanOf(s) }
    }
    if (t.kind === 'str') {
      this.pos++
      return { t: 'lit', value: t.text, span: this.spanOf(s) }
    }
    if (this.isPunct('(')) {
      this.pos++
      if (this.isKw('SELECT') || this.isKw('WITH')) {
        const query = this.parseQuery()
        this.expectPunct(')')
        return { t: 'subq', query, span: this.spanOf(s) }
      }
      const e = this.parseExpr()
      this.expectPunct(')')
      return e
    }
    if (t.kind === 'qident') return this.parseColumn()
    if (t.kind !== 'ident') return this.fail('una expresión')
    const up = t.text.toUpperCase()
    if (up === 'NULL' || up === 'TRUE' || up === 'FALSE') {
      this.pos++
      return { t: 'lit', value: up === 'NULL' ? null : up === 'TRUE', span: this.spanOf(s) }
    }
    if (up === 'CASE') return this.parseCase()
    if (up === 'EXISTS') {
      this.pos++
      this.expectPunct('(')
      const query = this.parseQuery()
      this.expectPunct(')')
      return { t: 'exists', query, span: this.spanOf(s) }
    }
    if (up === 'CAST' && this.isPunct('(', this.peek())) {
      this.pos += 2
      const arg = this.parseExpr()
      this.expectKw('AS')
      const type = this.parseTypeName()
      this.expectPunct(')')
      return { t: 'cast', arg, type, span: this.spanOf(s) }
    }
    if (up === 'EXTRACT' && this.isPunct('(', this.peek())) {
      this.pos += 2
      const f = this.tok
      if (f.kind !== 'ident') this.fail('YEAR, MONTH o DAY')
      this.pos++
      this.expectKw('FROM')
      const arg = this.parseExpr()
      this.expectPunct(')')
      return { t: 'extract', field: f.text.toUpperCase(), arg, span: this.spanOf(s) }
    }
    if (up === 'DATE' && this.peek().kind === 'str') {
      this.pos++
      const lit = this.toks[this.pos++]
      return {
        t: 'cast',
        arg: { t: 'lit', value: lit.text, span: { start: lit.start, end: lit.end } },
        type: 'date',
        span: this.spanOf(s),
      }
    }
    if (this.isPunct('(', this.peek()) && !SPECIAL_FORMS.has(up)) return this.parseCall()
    if (isReserved(t.text)) return this.fail('una expresión')
    return this.parseColumn()
  }

  private parseColumn(): Expr {
    const s = this.tok.start
    const first = this.toks[this.pos++]
    if (this.isPunct('.')) {
      this.pos++
      if (this.isName()) {
        const second = this.toks[this.pos++]
        return { t: 'col', table: first.text, name: second.text, span: this.spanOf(s) }
      }
      this.fail('el nombre de una columna')
    }
    return { t: 'col', table: null, name: first.text, span: this.spanOf(s) }
  }

  private parseCase(): Expr {
    const s = this.tok.start
    this.pos++
    let operand: Expr | null = null
    if (!this.isKw('WHEN')) operand = this.parseExpr()
    const whens: { cond: Expr; then: Expr }[] = []
    while (this.acceptKw('WHEN')) {
      const cond = this.parseExpr()
      this.expectKw('THEN')
      whens.push({ cond, then: this.parseExpr() })
    }
    if (whens.length === 0) this.fail('WHEN')
    const otherwise = this.acceptKw('ELSE') ? this.parseExpr() : null
    this.expectKw('END')
    return { t: 'case', operand, whens, otherwise, span: this.spanOf(s) }
  }

  private parseCall(): Expr {
    const nameTok = this.toks[this.pos++]
    const s = nameTok.start
    const name = nameTok.text.toUpperCase()
    const nameSpan = { start: nameTok.start, end: nameTok.end }
    this.expectPunct('(')
    let distinct = false
    let star = false
    const args: Expr[] = []
    if (this.isOp('*')) {
      this.pos++
      star = true
    } else if (!this.isPunct(')')) {
      distinct = this.acceptKw('DISTINCT')
      if (!distinct) this.acceptKw('ALL')
      args.push(this.parseExpr())
      if ((name === 'SUBSTRING' || name === 'SUBSTR') && this.isKw('FROM')) {
        this.pos++
        args.push(this.parseExpr())
        if (this.acceptKw('FOR')) args.push(this.parseExpr())
      } else {
        while (this.acceptPunct(',')) args.push(this.parseExpr())
      }
    }
    this.expectPunct(')')
    let over: WindowSpec | null = null
    if (this.isKw('OVER')) {
      const os = this.tok.start
      this.pos++
      this.expectPunct('(')
      const partitionBy: Expr[] = []
      let orderBy: OrderItem[] = []
      if (this.acceptKw('PARTITION')) {
        this.expectKw('BY')
        do {
          partitionBy.push(this.parseExpr())
        } while (this.acceptPunct(','))
      }
      if (this.acceptKw('ORDER')) {
        this.expectKw('BY')
        orderBy = this.parseOrderItems()
      }
      if (this.isKw('ROWS') || this.isKw('RANGE') || this.isKw('GROUPS')) {
        throw new EngineError('Las cláusulas de marco (ROWS / RANGE) no están soportadas en OVER.', this.tokSpan(this.tok))
      }
      this.expectPunct(')')
      over = { partitionBy, orderBy, span: this.spanOf(os) }
    }
    return { t: 'call', name, args, distinct, star, over, span: this.spanOf(s), nameSpan }
  }
}

/** Convierte el texto de una consulta SQL en su arbol sintactico. */
export function parse(src: string): Query {
  return new Parser(lex(src), src).parseStatement()
}
