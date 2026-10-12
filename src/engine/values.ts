import type { ColumnType, SourceSpan, Value } from './types'
import { EngineError } from './errors'

/** Columna de una relacion interna. `qual` es el alias o nombre de tabla del que viene. */
export interface RCol {
  name: string
  qual: string | null
  type?: ColumnType
  /** Columna calculada por la consulta. */
  isNew?: boolean
}

export interface RRow {
  key: string
  cells: Value[]
}

/** Tabla interna: del modelo, de un JOIN o producida por una fase de la consulta. */
export interface Rel {
  id: string
  title: string
  cols: RCol[]
  rows: RRow[]
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export const isIsoDate = (v: Value): boolean => typeof v === 'string' && ISO_DATE.test(v)

/** AAAA-MM-DD -> dd/mm/aaaa */
export function showDate(v: string): string {
  const m = ISO_DATE.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}

export function inferType(vals: Value[]): ColumnType | undefined {
  const v = vals.find((x) => x !== null)
  if (v === undefined) return undefined
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  return isIsoDate(v) ? 'date' : 'string'
}

export const round = (x: number): number => Math.round(x * 1e10) / 1e10

/** Texto de un valor para notas y explicaciones. */
export function fmt(v: Value): string {
  if (v === null) return 'NULL'
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'
  return String(round(v))
}

/** Texto de un valor sin comillas, para listas de valores. */
export function plain(v: Value): string {
  return typeof v === 'string' ? v : fmt(v)
}

/** Clave para agrupar y deduplicar: NULL es igual a NULL, el texto distingue mayusculas. */
export function normKey(v: Value): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return 's:' + v
  if (typeof v === 'number') return 'n:' + round(v)
  return 'b:' + v
}

export const tupleKey = (vs: Value[]): string => vs.map(normKey).join('\u0001')

export function toNum(v: Value, span: SourceSpan | null): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  if (typeof v === 'string') throw new EngineError(`No se puede usar el texto ${fmt(v)} como número.`, span)
  throw new EngineError('No se puede usar un valor lógico como número.', span)
}

export function toText(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(round(v))
  return v
}

/** Compara dos valores no nulos; mezclar numero y texto numerico esta permitido. */
export function compareValues(a: Value, b: Value, span: SourceSpan | null): number {
  let x = a as Exclude<Value, null>
  let y = b as Exclude<Value, null>
  if (typeof x === 'number' && typeof y === 'string') y = toNumOrFail(y, x, span)
  else if (typeof x === 'string' && typeof y === 'number') x = toNumOrFail(x, y, span)
  if (typeof x !== typeof y) {
    throw new EngineError(`No se pueden comparar valores de distinto tipo: ${fmt(a)} y ${fmt(b)}.`, span)
  }
  if (typeof x === 'boolean') return Number(x) - Number(y)
  return x === y ? 0 : x < y ? -1 : 1
}

function toNumOrFail(s: string, other: number, span: SourceSpan | null): number {
  if (s.trim() === '' || Number.isNaN(Number(s))) {
    throw new EngineError(`No se pueden comparar un número (${other}) con el texto ${fmt(s)}.`, span)
  }
  return Number(s)
}

/** Orden para ORDER BY y funciones de ventana. Por defecto NULL es el mayor valor. */
export function compareForSort(a: Value, b: Value, desc: boolean, nulls: 'first' | 'last' | null, span: SourceSpan | null): number {
  if (a === null || b === null) {
    if (a === null && b === null) return 0
    const nullsFirst = nulls ? nulls === 'first' : desc
    return a === null ? (nullsFirst ? -1 : 1) : nullsFirst ? 1 : -1
  }
  const c = compareValues(a, b, span)
  return desc ? -c : c
}

/** Coincidencia de LIKE: % cualquier secuencia, _ un caracter, \ hace literal el siguiente. */
export function likeMatch(text: string, pattern: string, span: SourceSpan | null = null): boolean {
  let re = ''
  let escaped = false
  for (const ch of pattern) {
    if (escaped) {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      escaped = false
    } else if (ch === '\\') escaped = true
    else if (ch === '%') re += '[\\s\\S]*'
    else if (ch === '_') re += '[\\s\\S]'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  if (escaped) throw new EngineError('El patrón de LIKE no puede terminar en una barra invertida (\\).', span)
  return new RegExp(`^${re}$`, 'u').test(text)
}

function validDate(s: string): boolean {
  const m = ISO_DATE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

const INT_TYPES = new Set(['integer', 'int', 'bigint', 'smallint'])
const NUM_TYPES = new Set(['numeric', 'decimal', 'float', 'real', 'double precision', 'double'])
const TEXT_TYPES = new Set(['text', 'varchar', 'char', 'character', 'string'])

export function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

export function castValue(v: Value, type: string, span: SourceSpan | null): Value {
  if (v === null) return null
  if (INT_TYPES.has(type) || NUM_TYPES.has(type)) {
    let n: number
    if (typeof v === 'number') n = v
    else if (typeof v === 'boolean') n = v ? 1 : 0
    else {
      n = Number(v)
      if (v.trim() === '' || Number.isNaN(n)) {
        throw new EngineError(`No se puede convertir el texto ${fmt(v)} a ${INT_TYPES.has(type) ? 'entero' : 'número'}.`, span)
      }
    }
    return INT_TYPES.has(type) ? roundHalfAway(n) : n
  }
  if (TEXT_TYPES.has(type)) return toText(v)
  if (type === 'date') {
    const s = typeof v === 'string' ? v.trim().slice(0, 10) : ''
    if (!validDate(s)) throw new EngineError(`${fmt(v)} no es una fecha válida (formato AAAA-MM-DD).`, span)
    return s
  }
  if (type === 'boolean' || type === 'bool') {
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0
    const t = v.trim().toLowerCase()
    if (['true', 't', 'yes', 'y', '1'].includes(t)) return true
    if (['false', 'f', 'no', 'n', '0'].includes(t)) return false
    throw new EngineError(`No se puede convertir el texto ${fmt(v)} a lógico.`, span)
  }
  throw new EngineError(
    `Tipo de dato no soportado en CAST: "${type}". Usa integer, numeric, text, date o boolean.`,
    span,
  )
}

export function datePart(v: Value, field: string, span: SourceSpan | null): Value {
  if (v === null) return null
  if (typeof v !== 'string' || !validDate(v.slice(0, 10))) {
    throw new EngineError(`EXTRACT necesita una fecha (AAAA-MM-DD) y recibió ${fmt(v)}.`, span)
  }
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  if (field === 'YEAR') return y
  if (field === 'MONTH') return m
  if (field === 'DAY') return d
  if (field === 'QUARTER') return Math.ceil(m / 3)
  throw new EngineError(`EXTRACT no soporta el campo ${field}. Usa YEAR, MONTH, DAY o QUARTER.`, span)
}

export const AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'])

/** Calcula un agregado sobre los valores de un grupo; los NULL se ignoran. */
export function aggregate(name: string, vals: Value[], distinct: boolean, star: boolean, span: SourceSpan | null): Value {
  if (star) return vals.length
  let xs = vals.filter((x) => x !== null)
  if (distinct) {
    const seen = new Set<string>()
    xs = xs.filter((x) => {
      const k = normKey(x)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  if (name === 'COUNT') return xs.length
  if (xs.length === 0) return null
  if (name === 'SUM' || name === 'AVG') {
    let total = 0
    for (const x of xs) {
      if (typeof x !== 'number') throw new EngineError(`${name} solo funciona con números y recibió ${fmt(x)}.`, span)
      total += x
    }
    return round(name === 'SUM' ? total : total / xs.length)
  }
  let best = xs[0]
  for (const x of xs.slice(1)) {
    const c = compareValues(x, best, span)
    if (name === 'MIN' ? c < 0 : c > 0) best = x
  }
  return best
}
