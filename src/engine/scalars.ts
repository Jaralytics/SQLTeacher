import type { SourceSpan, Value } from './types'
import { EngineError } from './errors'
import { fmt, round, toNum, toText } from './values'

/** Funciones escalares con argumentos ya evaluados. COALESCE se resuelve aparte (evaluacion perezosa). */
export const SCALAR_NAMES = [
  'UPPER',
  'LOWER',
  'LENGTH',
  'TRIM',
  'LTRIM',
  'RTRIM',
  'SUBSTRING',
  'SUBSTR',
  'CONCAT',
  'REPLACE',
  'ROUND',
  'ABS',
  'FLOOR',
  'CEIL',
  'CEILING',
  'COALESCE',
  'NULLIF',
]

const ARITY: Record<string, [number, number]> = {
  UPPER: [1, 1],
  LOWER: [1, 1],
  LENGTH: [1, 1],
  TRIM: [1, 1],
  LTRIM: [1, 1],
  RTRIM: [1, 1],
  SUBSTRING: [2, 3],
  SUBSTR: [2, 3],
  CONCAT: [1, Infinity],
  REPLACE: [3, 3],
  ROUND: [1, 2],
  ABS: [1, 1],
  FLOOR: [1, 1],
  CEIL: [1, 1],
  CEILING: [1, 1],
  COALESCE: [1, Infinity],
  NULLIF: [2, 2],
}

export function checkArity(name: string, n: number, span: SourceSpan): void {
  const [min, max] = ARITY[name]
  if (n >= min && n <= max) return
  const exp = min === max ? `${min}` : max === Infinity ? `al menos ${min}` : `entre ${min} y ${max}`
  throw new EngineError(`La función ${name} espera ${exp} ${exp === '1' ? 'argumento' : 'argumentos'}.`, span)
}

function needText(v: Value, name: string, span: SourceSpan): string {
  if (typeof v === 'string') return v
  throw new EngineError(`${name} necesita un texto y recibió ${fmt(v)}.`, span)
}

function roundTo(x: number, digits: number): number {
  const f = 10 ** digits
  const s = Math.sign(x)
  return (s * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f
}

export function callScalar(name: string, args: Value[], span: SourceSpan): Value {
  if (name === 'CONCAT') return args.map((a) => toText(a)).join('')
  if (name === 'NULLIF') {
    const [a, b] = args
    if (a === null || b === null) return a
    return typeof a === typeof b ? (a === b ? null : a) : String(a) === String(b) ? null : a
  }
  if (args.some((a) => a === null)) return null
  switch (name) {
    case 'UPPER':
      return needText(args[0], name, span).toUpperCase()
    case 'LOWER':
      return needText(args[0], name, span).toLowerCase()
    case 'LENGTH':
      return [...needText(args[0], name, span)].length
    case 'TRIM':
      return needText(args[0], name, span).trim()
    case 'LTRIM':
      return needText(args[0], name, span).trimStart()
    case 'RTRIM':
      return needText(args[0], name, span).trimEnd()
    case 'SUBSTRING':
    case 'SUBSTR': {
      const s = needText(args[0], name, span)
      const from = Math.floor(toNum(args[1], span))
      if (args.length === 2) return s.slice(Math.max(from, 1) - 1)
      const len = Math.floor(toNum(args[2], span))
      if (len < 0) throw new EngineError('La longitud de SUBSTRING no puede ser negativa.', span)
      return s.slice(Math.max(from, 1) - 1, Math.max(from + len - 1, 0))
    }
    case 'REPLACE':
      return needText(args[0], name, span).split(needText(args[1], name, span)).join(needText(args[2], name, span))
    case 'ROUND': {
      const x = toNum(args[0], span)
      return round(roundTo(x, args.length === 2 ? Math.floor(toNum(args[1], span)) : 0))
    }
    case 'ABS':
      return Math.abs(toNum(args[0], span))
    case 'FLOOR':
      return Math.floor(toNum(args[0], span))
    case 'CEIL':
    case 'CEILING':
      return Math.ceil(toNum(args[0], span))
  }
  throw new EngineError(`La función ${name} no está soportada.`, span)
}
