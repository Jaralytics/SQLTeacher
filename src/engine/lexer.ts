import { EngineError } from './errors'

export type TokenKind = 'num' | 'str' | 'ident' | 'qident' | 'op' | 'punct' | 'eof'

export interface Token {
  kind: TokenKind
  /** Texto util: contenido de la cadena, nombre o simbolo. */
  text: string
  start: number
  end: number
  num?: number
}

const TWO_CHAR_OPS = ['||', '<>', '!=', '<=', '>=', '::']
const ONE_CHAR_OPS = '+-*/%=<>'
const PUNCT = '(),.;'

const NUMBER_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const IDENT_RE = /[\p{L}_][\p{L}\p{N}_$]*/uy

/** Lee un texto delimitado por `quote` donde la comilla repetida es una comilla literal. */
function readQuoted(src: string, start: number, quote: string, open: string): { text: string; end: number } {
  let j = start + 1
  let out = ''
  for (;;) {
    if (j >= src.length) {
      throw new EngineError(`Falta cerrar ${open}.`, { start, end: src.length })
    }
    if (src[j] === quote) {
      if (src[j + 1] === quote) {
        out += quote
        j += 2
        continue
      }
      return { text: out, end: j + 1 }
    }
    out += src[j]
    j++
  }
}

export function lex(src: string): Token[] {
  const out: Token[] = []
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '-' && src[i + 1] === '-') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      if (e < 0) throw new EngineError('Falta cerrar el comentario /* ... */.', { start: i, end: n })
      i = e + 2
      continue
    }
    if (c === "'") {
      const r = readQuoted(src, i, "'", 'el texto entre comillas simples')
      out.push({ kind: 'str', text: r.text, start: i, end: r.end })
      i = r.end
      continue
    }
    if (c === '"') {
      const r = readQuoted(src, i, '"', 'el nombre entre comillas dobles')
      out.push({ kind: 'qident', text: r.text, start: i, end: r.end })
      i = r.end
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      NUMBER_RE.lastIndex = i
      const m = NUMBER_RE.exec(src)
      if (m) {
        if (/[\p{L}_]/u.test(src[i + m[0].length] ?? '')) {
          throw new EngineError('Texto inesperado justo después de un número; separa el número del texto siguiente.', {
            start: i,
            end: i + m[0].length + 1,
          })
        }
        out.push({ kind: 'num', text: m[0], start: i, end: i + m[0].length, num: Number(m[0]) })
        i += m[0].length
        continue
      }
    }
    IDENT_RE.lastIndex = i
    const im = IDENT_RE.exec(src)
    if (im) {
      out.push({ kind: 'ident', text: im[0], start: i, end: i + im[0].length })
      i += im[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO_CHAR_OPS.includes(two)) {
      out.push({ kind: 'op', text: two === '!=' ? '<>' : two, start: i, end: i + 2 })
      i += 2
      continue
    }
    if (ONE_CHAR_OPS.includes(c)) {
      out.push({ kind: 'op', text: c, start: i, end: i + 1 })
      i++
      continue
    }
    if (PUNCT.includes(c)) {
      out.push({ kind: 'punct', text: c, start: i, end: i + 1 })
      i++
      continue
    }
    throw new EngineError(`Carácter no reconocido: '${c}'.`, { start: i, end: i + 1 })
  }
  out.push({ kind: 'eof', text: '', start: n, end: n })
  return out
}
