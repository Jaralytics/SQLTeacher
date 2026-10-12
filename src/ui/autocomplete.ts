// Logica pura del autocompletado y la ayuda de firma. Sin dependencias del DOM.
import type { FunctionDoc } from '../data/functions'

export type SuggestionKind = 'palabra' | 'función' | 'tabla' | 'columna'

export interface ModelTable {
  name: string
  columns: { name: string; type: string }[]
}

export interface Suggestion {
  kind: SuggestionKind
  /** Texto que se muestra en la lista. */
  label: string
  /** Texto que se inserta. */
  insert: string
  /** Sintaxis (solo palabras clave y funciones). */
  detail?: string
  /** Descripcion corta para el pie de la lista. */
  description: string
}

interface Frame {
  name: string | null
  argIndex: number
}

interface ScanState {
  /** Dentro de una cadena `'...'` sin cerrar. */
  inString: boolean
  /** Dentro de un identificador entre comillas dobles sin cerrar. */
  inQuoted: boolean
  inComment: boolean
  stack: Frame[]
}

const IDENT = '[\\p{L}_][\\p{L}\\p{N}_]*'
const WORD_CHAR = /[\p{L}\p{N}_]/u
const WORD_AT_END = /[\p{L}_][\p{L}\p{N}_]*$/u
const IDENT_AT_END = new RegExp(`(${IDENT})$`, 'u')

function nameBefore(text: string, index: number): string | null {
  const m = /([\p{L}_][\p{L}\p{N}_]*)\s*$/u.exec(text.slice(0, index))
  return m ? m[1] : null
}

/** Recorre el texto hasta el cursor para saber en que contexto sintactico esta. */
export function scan(text: string, caret: number): ScanState {
  const state: ScanState = { inString: false, inQuoted: false, inComment: false, stack: [] }
  const n = Math.min(caret, text.length)
  let i = 0
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '-' && next === '-') {
      let j = i
      while (j < n && text[j] !== '\n') j++
      if (j >= n) {
        state.inComment = true
        return state
      }
      i = j + 1
      continue
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0 || end + 2 > n) {
        state.inComment = true
        return state
      }
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let closed = false
      while (j < n) {
        if (text[j] === c) {
          if (text[j + 1] === c && j + 1 < n) {
            j += 2
            continue
          }
          closed = true
          break
        }
        j++
      }
      if (!closed) {
        if (c === "'") state.inString = true
        else state.inQuoted = true
        return state
      }
      i = j + 1
      continue
    }
    if (c === '(') state.stack.push({ name: nameBefore(text, i), argIndex: 0 })
    else if (c === ')') state.stack.pop()
    else if (c === ',') {
      const top = state.stack[state.stack.length - 1]
      if (top) top.argIndex++
    }
    i++
  }
  return state
}

/** Palabras que aparecen tras un nombre de tabla y que no son un alias. */
const NOT_ALIAS = new Set(
  [
    'where', 'on', 'using', 'join', 'inner', 'left', 'right', 'full', 'cross', 'outer', 'natural', 'group',
    'order', 'having', 'limit', 'offset', 'union', 'intersect', 'except', 'select', 'as', 'window',
  ].map((w) => w.toLowerCase()),
)

/** Alias (y nombres) de tabla declarados con FROM / JOIN, en minusculas, hacia el nombre escrito. */
export function findAliases(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = new RegExp(`\\b(?:FROM|JOIN)\\s+"?(${IDENT})"?(?:\\s+(?:AS\\s+)?(${IDENT}))?`, 'giu')
  for (const m of text.matchAll(re)) {
    out[m[1].toLowerCase()] = m[1]
    const alias = m[2]
    if (alias && !NOT_ALIAS.has(alias.toLowerCase())) out[alias.toLowerCase()] = m[1]
  }
  return out
}

export interface CompletionContext {
  /** `word`: palabra suelta. `member`: tras `alias.` o `tabla.`. */
  mode: 'word' | 'member'
  /** Alias o tabla escrita antes del punto, o null. */
  qualifier: string | null
  /** Texto ya escrito que se usa para filtrar. */
  prefix: string
  /** Donde empieza el texto que se reemplaza al aceptar. */
  replaceStart: number
  /** Donde termina (incluye el resto de la palabra tras el cursor). */
  replaceEnd: number
  /** Justo despues de FROM o JOIN: solo caben nombres de tabla. */
  expectTable: boolean
  /** Alias declarados en la consulta (minusculas -> nombre de tabla escrito). */
  aliases: Record<string, string>
}

/**
 * Determina que se esta escribiendo en el cursor. Devuelve null si no corresponde
 * sugerir nada (cadena, comentario, sin identificador). `explicit` permite
 * mostrar sugerencias sin texto escrito (Ctrl+Espacio).
 */
export function getCompletionContext(text: string, caret: number, explicit = false): CompletionContext | null {
  const st = scan(text, caret)
  if (st.inString || st.inQuoted || st.inComment) return null

  const m = WORD_AT_END.exec(text.slice(0, caret))
  // Un identificador pegado a un numero (`5a`) no es un nombre.
  if (m && m.index > 0 && /[0-9]/.test(text[m.index - 1])) return null
  if (!m && caret > 0 && WORD_CHAR.test(text[caret - 1])) return null
  const start = m ? m.index : caret
  let end = caret
  while (end < text.length && WORD_CHAR.test(text[end])) end++
  const prefix = m ? m[0] : ''
  const aliases = findAliases(text)

  if (start > 0 && text[start - 1] === '.') {
    const q = IDENT_AT_END.exec(text.slice(0, start - 1))
    if (!q) return null
    return { mode: 'member', qualifier: q[1], prefix, replaceStart: start, replaceEnd: end, expectTable: false, aliases }
  }

  if (!m && !explicit) return null
  const expectTable = /\b(?:FROM|JOIN)\s+$/i.test(text.slice(0, start))
  return { mode: 'word', qualifier: null, prefix, replaceStart: start, replaceEnd: end, expectTable, aliases }
}

const KIND_ORDER: Record<SuggestionKind, number> = { palabra: 0, función: 1, tabla: 2, columna: 3 }

/** Palabras sueltas que no tienen entrada propia en el catalogo. */
const EXTRA_KEYWORDS: { word: string; description: string }[] = [
  { word: 'AS', description: 'Da un nombre (alias) a una columna, una tabla o una subconsulta.' },
  { word: 'ON', description: 'Condición que une dos tablas en un JOIN.' },
  { word: 'ASC', description: 'Orden ascendente en ORDER BY.' },
  { word: 'DESC', description: 'Orden descendente en ORDER BY.' },
  { word: 'NULL', description: 'Valor desconocido o ausente.' },
  { word: 'ALL', description: 'Conserva las filas repetidas (UNION ALL).' },
  { word: 'OFFSET', description: 'Salta las primeras filas tras LIMIT.' },
  { word: 'PARTITION BY', description: 'Divide las filas en grupos dentro de OVER (...).' },
  { word: 'WHEN', description: 'Rama de un CASE: WHEN condición THEN valor.' },
  { word: 'THEN', description: 'Valor de una rama de CASE.' },
  { word: 'ELSE', description: 'Valor de un CASE si ninguna rama se cumple.' },
  { word: 'END', description: 'Cierra un CASE.' },
]

export function quoteIdent(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

function typeLabel(type: string): string {
  if (type === 'date') return 'fecha'
  return type === 'number' ? 'número' : type === 'boolean' ? 'lógico' : 'texto'
}

function firstSentence(text: string): string {
  const m = /^.*?[.!?](?:\s|$)/.exec(text)
  return (m ? m[0] : text).trim()
}

/** Rango de coincidencia: 0 prefijo, 1 subcadena, -1 no coincide. */
function matchRank(candidate: string, prefix: string): number {
  if (!prefix) return 0
  const c = candidate.toLowerCase()
  const p = prefix.toLowerCase()
  if (c.startsWith(p)) return 0
  return c.includes(p) ? 1 : -1
}

/** Una entrada del catalogo puede agrupar varios nombres (`FLOOR / CEIL`). */
function bestRank(name: string, prefix: string): number {
  const ranks = name.split(' / ').map((n) => matchRank(n, prefix)).filter((r) => r >= 0)
  return ranks.length ? Math.min(...ranks) : -1
}

const FUNCTION_SNIPPET = /^[A-Z_]+\($/

export function getSuggestions(
  ctx: CompletionContext,
  catalog: FunctionDoc[],
  tables: ModelTable[],
): Suggestion[] {
  const scored: { s: Suggestion; rank: number }[] = []
  const push = (s: Suggestion, rank: number) => {
    if (rank >= 0) scored.push({ s, rank })
  }
  const byName = (name: string) => tables.find((t) => t.name.toLowerCase() === name.toLowerCase())

  const tableSuggestion = (t: ModelTable): Suggestion => ({
    kind: 'tabla',
    label: t.name,
    insert: quoteIdent(t.name),
    description: `Tabla del modelo con ${t.columns.length} columnas.`,
  })

  if (ctx.mode === 'member') {
    const q = ctx.qualifier?.toLowerCase() ?? ''
    const table = byName(ctx.aliases[q] ?? ctx.qualifier ?? '')
    for (const col of table?.columns ?? []) {
      push(
        {
          kind: 'columna',
          label: col.name,
          insert: quoteIdent(col.name),
          description: `Columna de ${typeLabel(col.type)} de la tabla ${table!.name}.`,
        },
        matchRank(col.name, ctx.prefix),
      )
    }
  } else if (ctx.expectTable) {
    for (const t of tables) push(tableSuggestion(t), matchRank(t.name, ctx.prefix))
  } else {
    const seen = new Set<string>()
    for (const f of catalog) {
      if (!f.snippet.trim()) continue
      seen.add(f.name.toUpperCase())
      push(
        {
          kind: FUNCTION_SNIPPET.test(f.snippet) ? 'función' : 'palabra',
          label: f.name,
          insert: f.snippet,
          detail: f.syntax,
          description: firstSentence(f.description),
        },
        bestRank(f.name, ctx.prefix),
      )
    }
    for (const k of EXTRA_KEYWORDS) {
      if (seen.has(k.word)) continue
      push({ kind: 'palabra', label: k.word, insert: `${k.word} `, description: k.description }, matchRank(k.word, ctx.prefix))
    }
    for (const t of tables) push(tableSuggestion(t), matchRank(t.name, ctx.prefix))
    const owners = new Map<string, { name: string; type: string; tables: string[] }>()
    for (const t of tables) {
      for (const col of t.columns) {
        const key = col.name.toLowerCase()
        const entry = owners.get(key) ?? { name: col.name, type: col.type, tables: [] }
        entry.tables.push(t.name)
        owners.set(key, entry)
      }
    }
    for (const col of owners.values()) {
      push(
        {
          kind: 'columna',
          label: col.name,
          insert: quoteIdent(col.name),
          description: `Columna de ${typeLabel(col.type)} de ${col.tables.join(', ')}.`,
        },
        matchRank(col.name, ctx.prefix),
      )
    }
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      KIND_ORDER[a.s.kind] - KIND_ORDER[b.s.kind] ||
      a.s.label.localeCompare(b.s.label, 'es'),
  )
  return scored.map((x) => x.s)
}

/** Aplica una sugerencia y devuelve el texto nuevo y la posicion del cursor. */
export function applySuggestion(
  text: string,
  ctx: CompletionContext,
  suggestion: Suggestion,
): { value: string; caret: number } {
  let insert = suggestion.insert
  const end = ctx.replaceEnd
  // Si ya hay un espacio o `(` tras el cursor, no se duplica; el cursor lo salta.
  const last = insert[insert.length - 1]
  const skipLast = (last === '(' || last === ' ') && text[end] === last
  if (skipLast) insert = insert.slice(0, -1)
  // Un espacio inicial (` OVER (`) sobra si ya hay espacio antes.
  const before = text[ctx.replaceStart - 1]
  if (insert.startsWith(' ') && (before === undefined || /\s/.test(before))) insert = insert.slice(1)
  const value = text.slice(0, ctx.replaceStart) + insert + text.slice(end)
  const caret = ctx.replaceStart + insert.length + (skipLast ? 1 : 0)
  return { value, caret }
}

export interface SignatureContext {
  doc: FunctionDoc
  /** Nombre de la funcion tal como se llama (`CEIL` dentro de `FLOOR / CEIL`). */
  fname: string
  argIndex: number
}

/** Variante de la sintaxis que describe `fname(...)`, o null si el nombre no es una llamada. */
function callSyntax(doc: FunctionDoc, fname: string): string | null {
  const alt = doc.syntax.split(/\s+\|\s+/).find((p) => p.toUpperCase().startsWith(`${fname.toUpperCase()}(`))
  return alt ?? null
}

/** Funcion cuya llamada contiene el cursor y el indice del argumento actual. */
export function getSignatureContext(text: string, caret: number, catalog: FunctionDoc[]): SignatureContext | null {
  const st = scan(text, caret)
  if (st.inString || st.inQuoted || st.inComment) return null
  for (let i = st.stack.length - 1; i >= 0; i--) {
    const f = st.stack[i]
    if (!f.name) continue
    const doc = catalog.find((d) => d.name.split(' / ').some((n) => n === f.name!.toUpperCase()) && callSyntax(d, f.name!))
    if (doc) return { doc, fname: f.name.toUpperCase(), argIndex: f.argIndex }
  }
  return null
}

export interface SignatureParts {
  name: string
  parts: string[]
  active: number
}

/** Separa la sintaxis de una funcion en sus parametros y decide cual resaltar. */
export function signatureParts(doc: FunctionDoc, argIndex: number, fname: string = doc.name): SignatureParts {
  const syntax = callSyntax(doc, fname) ?? doc.syntax
  const open = syntax.indexOf('(')
  let depth = 0
  let close = syntax.length
  for (let i = open; i >= 0 && i < syntax.length; i++) {
    if (syntax[i] === '(') depth++
    else if (syntax[i] === ')' && --depth === 0) {
      close = i
      break
    }
  }
  const inner = open < 0 ? '' : syntax.slice(open + 1, close).replace(/[[\]]/g, '')
  const parts = inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const repeats = parts[parts.length - 1] === '...'
  const real = repeats ? parts.length - 1 : parts.length
  let active = argIndex
  if (active >= real) active = repeats ? real - 1 : -1
  if (real === 0) active = -1
  return { name: fname.toUpperCase(), parts, active }
}
