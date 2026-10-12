import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FunctionDoc } from '../data/functions'
import { Collapsible } from './Collapsible'

interface Props {
  catalog: FunctionDoc[]
  onInsert: (text: string) => void
  onExample: (formula: string) => void
}

interface CardState {
  doc: FunctionDoc
  anchor: DOMRect
  /** Fijada por el boton de informacion: no se cierra al salir el raton. */
  pinned: boolean
}

const OPEN_DELAY = 350
const SWITCH_DELAY = 90
const CLOSE_DELAY = 160
const MARGIN = 8

function FunctionCard({
  card,
  id,
  onExample,
  onEnter,
  onLeave,
}: {
  card: CardState
  id: string
  onExample: (formula: string) => void
  onEnter: () => void
  onLeave: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const { doc, anchor } = card

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const clampTop = (t: number) => Math.max(MARGIN, Math.min(t, vh - h - MARGIN))
    let left: number
    let top: number
    if (anchor.right + MARGIN + w <= vw - MARGIN) {
      left = anchor.right + MARGIN
      top = clampTop(anchor.top)
    } else if (anchor.left - MARGIN - w >= MARGIN) {
      left = anchor.left - MARGIN - w
      top = clampTop(anchor.top)
    } else {
      left = Math.max(MARGIN, Math.min(anchor.left, vw - w - MARGIN))
      top = anchor.bottom + 6 + h <= vh - MARGIN ? anchor.bottom + 6 : clampTop(anchor.top - h - 6)
    }
    setPos({ left, top })
  }, [anchor, doc])

  return (
    <div
      ref={ref}
      id={id}
      className="fn-card"
      role="group"
      aria-label={`Ayuda de ${doc.name}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="fn-card-head">
        <h3>{doc.name}</h3>
        <span className="role-tag">{doc.category}</span>
      </div>
      <code className="fn-syntax">{doc.syntax}</code>
      <p className="fn-desc">{doc.description}</p>
      {doc.parameters.length > 0 && (
        <dl className="fn-params">
          {doc.parameters.map((p) => (
            <div key={p.name}>
              <dt>{p.name}</dt>
              <dd>{p.description}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="fn-returns">
        <strong>Devuelve</strong> <span className="type-tag">{doc.returns}</span> {doc.returnsDescription}
      </p>
      <code className="fn-example">{doc.example}</code>
      <button type="button" className="fn-example-btn" onClick={() => onExample(doc.example)}>
        Ver ejemplo
      </button>
    </div>
  )
}

export function FunctionsPanel({ catalog, onInsert, onExample }: Props) {
  const [query, setQuery] = useState('')
  const [card, setCard] = useState<CardState | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const cardRef = useRef<CardState | null>(null)
  const cardId = useId()

  useEffect(() => {
    cardRef.current = card
  }, [card])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? catalog.filter((f) => f.name.toLowerCase().includes(q)) : catalog
    const categories = Array.from(new Set(list.map((f) => f.category)))
    return categories.map((c) => ({ category: c, items: list.filter((f) => f.category === c) }))
  }, [catalog, query])

  const clear = useCallback(() => window.clearTimeout(timer.current), [])

  const scheduleOpen = useCallback(
    (doc: FunctionDoc, el: HTMLElement) => {
      clear()
      const current = cardRef.current
      if (current?.pinned) return
      const delay = current ? SWITCH_DELAY : OPEN_DELAY
      timer.current = window.setTimeout(() => {
        setCard({ doc, anchor: el.getBoundingClientRect(), pinned: false })
      }, delay)
    },
    [clear],
  )

  const scheduleClose = useCallback(() => {
    clear()
    if (cardRef.current?.pinned) return
    timer.current = window.setTimeout(() => setCard(null), CLOSE_DELAY)
  }, [clear])

  const togglePinned = useCallback(
    (doc: FunctionDoc, el: HTMLElement) => {
      clear()
      const current = cardRef.current
      if (current?.pinned && current.doc.name === doc.name) setCard(null)
      else setCard({ doc, anchor: el.getBoundingClientRect(), pinned: true })
    },
    [clear],
  )

  useEffect(() => clear, [clear])

  // Escape, desplazamiento y toque fuera cierran la tarjeta.
  const isOpen = card !== null
  useEffect(() => {
    if (!isOpen) return
    const close = () => setCard(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.fn-card, .fn-row')) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [isOpen])

  return (
    <Collapsible id="side-functions" title="Cláusulas y funciones" meta={catalog.length}>
      <input
        type="search"
        className="fn-search"
        placeholder="Buscar cláusula o función"
        aria-label="Buscar cláusula o función"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {groups.length === 0 && <p className="ctx-empty">Sin resultados</p>}
      {groups.map((g) => (
        <div key={g.category} className="fn-group">
          <h3 className="fn-group-title">{g.category}</h3>
          <ul className="fn-list">
            {g.items.map((f) => {
              const active = card?.doc.name === f.name
              return (
                <li
                  key={f.name}
                  className={`fn-row${active ? ' is-open' : ''}`}
                  onMouseEnter={(e) => scheduleOpen(f, e.currentTarget)}
                  onMouseLeave={scheduleClose}
                  onFocus={(e) => scheduleOpen(f, e.currentTarget)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose()
                  }}
                >
                  <button
                    type="button"
                    className="fn-name"
                    onClick={() => onInsert(f.snippet)}
                    aria-describedby={active ? cardId : undefined}
                    title={f.syntax}
                  >
                    {f.name}
                  </button>
                  <button
                    type="button"
                    className="fn-mini"
                    aria-label={`Información de ${f.name}`}
                    aria-expanded={active && card?.pinned === true}
                    onClick={(e) => togglePinned(f, e.currentTarget.parentElement ?? e.currentTarget)}
                  >
                    i
                  </button>
                  <button
                    type="button"
                    className="fn-mini fn-mini-text"
                    aria-label={`Ver ejemplo de ${f.name}`}
                    onClick={() => onExample(f.example)}
                  >
                    Ver
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {card && (
        <FunctionCard
          card={card}
          id={cardId}
          onExample={onExample}
          onEnter={clear}
          onLeave={scheduleClose}
        />
      )}
    </Collapsible>
  )
}
