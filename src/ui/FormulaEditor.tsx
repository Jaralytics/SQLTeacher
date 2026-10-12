import { useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, Ref } from 'react'
import type { FunctionDoc } from '../data/functions'
import type { SourceSpan } from '../engine'
import {
  applySuggestion,
  getCompletionContext,
  getSignatureContext,
  getSuggestions,
  signatureParts,
} from './autocomplete'
import type { ModelTable, Suggestion } from './autocomplete'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface CaretPos {
  left: number
  top: number
  height: number
  /** true si no hay espacio debajo del cursor para la lista. */
  above: boolean
}

export interface EditorHandle {
  /** Inserta texto en el cursor (reemplaza la seleccion) y deja el cursor al final. */
  insert: (text: string) => void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  /** Rango resaltado del paso actual (solo con traza cargada). */
  highlight: SourceSpan | null
  /** Rango subrayado del error. */
  errorSpan: SourceSpan | null
  /** Rango resaltado de forma secundaria (resultado parcial bajo el cursor). */
  hoverSpan?: SourceSpan | null
  catalog: FunctionDoc[]
  tables: ModelTable[]
  ref?: Ref<EditorHandle>
}

const KIND_CLASS: Record<Suggestion['kind'], string> = {
  palabra: 'keyword',
  función: 'function',
  tabla: 'table',
  columna: 'column',
}

const POPUP_WIDTH = 420
const LIST_SPACE = 270

function measure(mirror: HTMLElement, wrap: HTMLElement, span: SourceSpan | null): Rect[] {
  const node = mirror.firstChild
  if (!span || !node || node.nodeType !== Node.TEXT_NODE) return []
  const length = node.textContent?.length ?? 0
  const start = Math.max(0, Math.min(span.start, length))
  const end = Math.max(0, Math.min(span.end, length))
  if (end <= start) return []
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const box = wrap.getBoundingClientRect()
  return Array.from(range.getClientRects())
    .filter((r) => r.width > 0)
    .map((r) => ({
      left: r.left - box.left - wrap.clientLeft,
      top: r.top - box.top - wrap.clientTop,
      width: r.width,
      height: r.height,
    }))
}

function measureCaret(mirror: HTMLElement, wrap: HTMLElement, pos: number): CaretPos | null {
  const node = mirror.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const length = node.textContent?.length ?? 0
  const at = Math.max(0, Math.min(pos, length))
  const range = document.createRange()
  let left = 0
  let top = 0
  let height = 0
  let found = false
  if (at < length) {
    range.setStart(node, at)
    range.setEnd(node, at + 1)
    const r = range.getClientRects()[0]
    if (r) {
      left = r.left
      top = r.top
      height = r.height
      found = true
    }
  }
  if (!found && at > 0) {
    range.setStart(node, at - 1)
    range.setEnd(node, at)
    const rs = range.getClientRects()
    const r = rs[rs.length - 1]
    if (r) {
      left = r.right
      top = r.top
      height = r.height
      found = true
    }
  }
  const box = wrap.getBoundingClientRect()
  if (!found) {
    const m = mirror.getBoundingClientRect()
    left = m.left + 16
    top = m.top + 14
    height = 24
  }
  const rel = { left: left - box.left - wrap.clientLeft, top: top - box.top - wrap.clientTop, height }
  const below = window.innerHeight - (top + height)
  const above = top
  return { ...rel, above: below < LIST_SPACE && above > below }
}

export function FormulaEditor({ value, onChange, onRun, highlight, errorSpan, hoverSpan, catalog, tables, ref }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const touched = useRef(false)
  const id = useId()

  const [width, setWidth] = useState(0)
  const [rects, setRects] = useState<{ hl: Rect[]; err: Rect[]; hv: Rect[] }>({ hl: [], err: [], hv: [] })
  const [caret, setCaret] = useState({ start: 0, end: 0 })
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [explicit, setExplicit] = useState(false)
  const [caretPos, setCaretPos] = useState<CaretPos | null>(null)
  const [activeState, setActiveState] = useState({ key: '', index: 0 })

  const collapsed = caret.start === caret.end
  const ctx = useMemo(
    () => (open && focused && collapsed ? getCompletionContext(value, caret.start, explicit) : null),
    [open, focused, collapsed, value, caret.start, explicit],
  )
  const suggestions = useMemo(() => (ctx ? getSuggestions(ctx, catalog, tables) : []), [ctx, catalog, tables])
  const showList = suggestions.length > 0
  const listKey = ctx ? `${ctx.mode}|${ctx.qualifier}|${ctx.expectTable}|${ctx.prefix}` : ''
  const activeIndex = activeState.key === listKey ? Math.min(activeState.index, suggestions.length - 1) : 0
  const activeSuggestion: Suggestion | undefined = suggestions[activeIndex]

  const signature = useMemo(
    () => (focused && collapsed ? getSignatureContext(value, caret.start, catalog) : null),
    [focused, collapsed, value, caret.start, catalog],
  )
  const sigParts = signature ? signatureParts(signature.doc, signature.argIndex, signature.fname) : null

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const ta = inputRef.current
      if (!ta) return
      const start = touched.current ? ta.selectionStart : value.length
      const end = touched.current ? ta.selectionEnd : value.length
      pendingCaret.current = start + text.length
      onChange(value.slice(0, start) + text + value.slice(end))
      setOpen(false)
      ta.focus()
    },
  }))

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setWidth(wrap.clientWidth))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const hlStart = highlight?.start
  const hlEnd = highlight?.end
  const erStart = errorSpan?.start
  const erEnd = errorSpan?.end
  const hvStart = hoverSpan?.start
  const hvEnd = hoverSpan?.end

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const mirror = mirrorRef.current
    if (!wrap || !mirror) return
    setRects({
      hl: measure(
        mirror,
        wrap,
        hlStart === undefined || hlEnd === undefined ? null : { start: hlStart, end: hlEnd },
      ),
      err: measure(
        mirror,
        wrap,
        erStart === undefined || erEnd === undefined ? null : { start: erStart, end: erEnd },
      ),
      hv: measure(
        mirror,
        wrap,
        hvStart === undefined || hvEnd === undefined ? null : { start: hvStart, end: hvEnd },
      ),
    })
  }, [value, hlStart, hlEnd, erStart, erEnd, hvStart, hvEnd, width])

  // Cursor pendiente tras insertar texto o aceptar una sugerencia.
  useLayoutEffect(() => {
    const pos = pendingCaret.current
    const ta = inputRef.current
    if (pos === null || !ta) return
    pendingCaret.current = null
    ta.setSelectionRange(pos, pos)
    setCaret({ start: pos, end: pos })
  }, [value])

  // Posicion del cursor en pantalla, para colocar la lista y la ayuda de firma.
  const needCaret = showList || !!signature
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const mirror = mirrorRef.current
    if (!needCaret || !wrap || !mirror) return
    setCaretPos(measureCaret(mirror, wrap, caret.start))
  }, [needCaret, value, caret.start, width])

  // Mantiene visible el elemento activo sin mover la pagina.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!showList || !list) return
    const el = list.children[activeIndex] as HTMLElement | undefined
    if (!el) return
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight
    }
  }, [activeIndex, showList, listKey])

  function accept(s: Suggestion) {
    if (!ctx) return
    const out = applySuggestion(value, ctx, s)
    pendingCaret.current = out.caret
    onChange(out.value)
    setOpen(false)
    setExplicit(false)
    inputRef.current?.focus()
  }

  function move(delta: number) {
    const n = suggestions.length
    setActiveState({ key: listKey, index: (activeIndex + delta + n) % n })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onRun()
      return
    }
    if (e.code === 'Space' && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      setExplicit(true)
      setOpen(true)
      return
    }
    if (e.key === 'Enter' && !showList && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // Mantiene la sangria de la linea actual al saltar de linea.
      const ta = e.currentTarget
      const from = ta.selectionStart
      const lineStart = value.lastIndexOf('\n', from - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(lineStart, from))?.[0] ?? ''
      if (indent) {
        e.preventDefault()
        const insert = `\n${indent}`
        pendingCaret.current = from + insert.length
        onChange(value.slice(0, from) + insert + value.slice(ta.selectionEnd))
        setOpen(false)
        return
      }
    }
    if (showList) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && activeSuggestion) {
        e.preventDefault()
        accept(activeSuggestion)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.nativeEvent.stopPropagation()
        setOpen(false)
        setExplicit(false)
        return
      }
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) setOpen(false)
  }

  const popupW = Math.min(POPUP_WIDTH, Math.max(width - 8, 160))
  const popLeft = (c: CaretPos) => Math.max(0, Math.min(c.left, width - popupW))
  const listAbove = !!caretPos && caretPos.above
  const wrapH = wrapRef.current?.clientHeight ?? 0

  return (
    <div className="formula-editor" ref={wrapRef}>
      <div className="fe-layer" aria-hidden="true">
        {rects.hl.map((r, i) => (
          <span key={`h${i}`} className="fe-hl" style={r} />
        ))}
        {rects.hv.map((r, i) => (
          <span key={`v${i}`} className="fe-hv" style={r} />
        ))}
        {rects.err.map((r, i) => (
          <span key={`e${i}`} className="fe-err" style={r} />
        ))}
      </div>
      <div className="fe-mirror" ref={mirrorRef} aria-hidden="true">
        {value + '\n'}
      </div>
      <textarea
        ref={inputRef}
        className="fe-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret({ start: e.target.selectionStart, end: e.target.selectionEnd })
          setOpen(true)
          setExplicit(false)
        }}
        onKeyDown={onKeyDown}
        onSelect={(e) => setCaret({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
        onClick={() => setOpen(false)}
        onFocus={() => {
          touched.current = true
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
          setOpen(false)
          setExplicit(false)
        }}
        rows={8}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        role="combobox"
        aria-label="Consulta SQL"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={showList}
        aria-controls={showList ? `${id}-list` : undefined}
        aria-activedescendant={showList ? `${id}-o${activeIndex}` : undefined}
        placeholder="Escribe una consulta SQL"
      />

      {showList && caretPos && (
        <div
          className="ac-pop"
          style={{
            width: popupW,
            left: popLeft(caretPos),
            ...(listAbove
              ? { bottom: wrapH - caretPos.top + 4 }
              : { top: caretPos.top + caretPos.height + 4 }),
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul className="ac-list" id={`${id}-list`} role="listbox" aria-label="Sugerencias" ref={listRef}>
            {suggestions.map((s, i) => (
              <li
                key={`${s.kind}-${s.label}`}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`ac-item${i === activeIndex ? ' is-active' : ''}`}
                onClick={() => accept(s)}
              >
                <span className={`ac-kind kind-${KIND_CLASS[s.kind]}`}>{s.kind}</span>
                <span className="ac-label">{s.label}</span>
                {s.detail && <span className="ac-detail">{s.detail}</span>}
              </li>
            ))}
          </ul>
          {activeSuggestion && <p className="ac-desc">{activeSuggestion.description}</p>}
        </div>
      )}

      {!(showList && listAbove) && sigParts && caretPos && (
        <div
          className="sig-hint"
          style={{ maxWidth: Math.max(width - 8, 160), left: popLeft(caretPos), bottom: wrapH - caretPos.top + 4 }}
        >
          <span className="sig-name">{sigParts.name}</span>
          <span className="sig-punct">(</span>
          {sigParts.parts.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="sig-punct">, </span>}
              <span className={i === sigParts.active ? 'sig-param is-active' : 'sig-param'}>{part}</span>
            </span>
          ))}
          <span className="sig-punct">)</span>
        </div>
      )}
    </div>
  )
}
