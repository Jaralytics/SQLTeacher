import type { Relationship, Table } from '../engine'
import { quoteIdent } from './autocomplete'
import { Collapsible } from './Collapsible'

interface Props {
  tables: Table[]
  relationships: Relationship[]
  onInsert: (text: string) => void
}

const WIDTH = 260
const SLOT = 14
const ROW_GAP = 14

interface Box {
  name: string
  x: number
  y: number
  w: number
  h: number
}

interface Line {
  rel: Relationship
  index: number
  x1: number
  y1: number
  x2: number
  y2: number
}

const qual = (t: string, c: string) => `${quoteIdent(t)}.${quoteIdent(c)}`

/**
 * Disposicion bipartita generica: tablas solo del lado muchos (hechos) a la izquierda,
 * solo del lado uno (dimensiones) a la derecha y las que son ambas en una columna central.
 * Dentro de cada columna se ordena por el promedio de posicion de sus vecinas.
 */
function layout(tables: Table[], relationships: Relationship[]) {
  const names = tables.map((t) => t.name)
  const isMany = new Set(relationships.map((r) => r.fromTable))
  const isOne = new Set(relationships.map((r) => r.toTable))
  const left = names.filter((n) => (isMany.has(n) && !isOne.has(n)) || (!isMany.has(n) && !isOne.has(n)))
  const middle = names.filter((n) => isMany.has(n) && isOne.has(n))
  const right = names.filter((n) => isOne.has(n) && !isMany.has(n))
  const columns = [left, middle, right].filter((c) => c.length > 0)

  const slots = new Map(names.map((n) => [n, 0]))
  for (const r of relationships) {
    slots.set(r.fromTable, (slots.get(r.fromTable) ?? 0) + 1)
    slots.set(r.toTable, (slots.get(r.toTable) ?? 0) + 1)
  }
  const boxW = columns.length >= 3 ? 72 : 88
  const boxH = (n: string) => Math.max(34, Math.min(slots.get(n) ?? 0, 6) * SLOT + 12)
  const colX = (ci: number) => (columns.length === 1 ? 0 : ((WIDTH - boxW) * ci) / (columns.length - 1))

  const neighbours = new Map(names.map((n) => [n, [] as string[]]))
  for (const r of relationships) {
    neighbours.get(r.fromTable)?.push(r.toTable)
    neighbours.get(r.toTable)?.push(r.fromTable)
  }

  const boxes = new Map<string, Box>()
  let total = 0
  const place = () => {
    total = Math.max(
      ...columns.map((c) => c.reduce((sum, n) => sum + boxH(n), 0) + (c.length - 1) * ROW_GAP),
      0,
    )
    columns.forEach((col, ci) => {
      const height = col.reduce((sum, n) => sum + boxH(n), 0) + (col.length - 1) * ROW_GAP
      let y = (total - height) / 2
      for (const n of col) {
        boxes.set(n, { name: n, x: colX(ci), y, w: boxW, h: boxH(n) })
        y += boxH(n) + ROW_GAP
      }
    })
  }
  place()
  // Reduccion simple de cruces: ordenar por el centro medio de las vecinas.
  for (let pass = 0; pass < 4; pass++) {
    columns.forEach((col, ci) => {
      if (columns.length > 1 && ci === 0 && pass === 0) return
      const centre = (n: string) => {
        const ys = (neighbours.get(n) ?? []).map((m) => boxes.get(m)).filter(Boolean).map((b) => b!.y + b!.h / 2)
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : (boxes.get(n)?.y ?? 0)
      }
      const keyed = col.map((n, i) => ({ n, i, c: centre(n) }))
      keyed.sort((a, b) => a.c - b.c || a.i - b.i)
      keyed.forEach((k, i) => (col[i] = k.n))
      place()
    })
  }

  // Puntos de anclaje por lado de caja, repartidos segun la altura del otro extremo,
  // para que dos lineas entre el mismo par de tablas no se superpongan.
  type Anchor = { rel: number; end: 'from' | 'to'; otherY: number }
  const anchors = new Map<string, Anchor[]>()
  const sideOf = (a: Box, b: Box) => (a.x < b.x ? 'r' : 'l')
  relationships.forEach((r, i) => {
    const a = boxes.get(r.fromTable)
    const b = boxes.get(r.toTable)
    if (!a || !b || a === b) return
    const add = (n: string, side: string, e: Anchor) => {
      const k = `${n}|${side}`
      anchors.set(k, [...(anchors.get(k) ?? []), e])
    }
    add(r.fromTable, sideOf(a, b), { rel: i, end: 'from', otherY: b.y + b.h / 2 })
    add(r.toTable, sideOf(b, a), { rel: i, end: 'to', otherY: a.y + a.h / 2 })
  })
  const anchorY = new Map<string, number>()
  for (const [k, list] of anchors) {
    const box = boxes.get(k.split('|')[0])!
    list.sort((p, q) => p.otherY - q.otherY || p.rel - q.rel)
    list.forEach((e, j) => anchorY.set(`${e.rel}|${e.end}`, box.y + box.h / 2 + (j - (list.length - 1) / 2) * SLOT))
  }

  const lines: Line[] = []
  relationships.forEach((r, i) => {
    const a = boxes.get(r.fromTable)
    const b = boxes.get(r.toTable)
    if (!a || !b || a === b) return
    const aLeft = a.x < b.x
    lines.push({
      rel: r,
      index: i,
      x1: aLeft ? a.x + a.w : a.x,
      y1: anchorY.get(`${i}|from`) ?? a.y + a.h / 2,
      x2: aLeft ? b.x : b.x + b.w,
      y2: anchorY.get(`${i}|to`) ?? b.y + b.h / 2,
    })
  })

  return { boxes: [...boxes.values()], lines, height: total }
}

export function RelationsPanel({ tables, relationships, onInsert }: Props) {
  if (relationships.length === 0) return null
  const { boxes, lines, height } = layout(tables, relationships)
  const summary = `Claves foráneas del modelo: ${relationships
    .map((r) => `${qual(r.fromTable, r.fromColumn)} referencia a ${qual(r.toTable, r.toColumn)}`)
    .join('; ')}.`

  return (
    <Collapsible id="side-rels" title="Claves foráneas" meta={relationships.length}>
      <svg className="rel-diagram" viewBox={`-2 -4 ${WIDTH + 4} ${height + 8}`} role="img" aria-label={summary}>
        {lines.map((l) => {
          const dx = l.x2 >= l.x1 ? 1 : -1
          return (
            <g key={l.index} className="rel-link">
              <title>{`${qual(l.rel.fromTable, l.rel.fromColumn)} -> ${qual(l.rel.toTable, l.rel.toColumn)}`}</title>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              <text x={l.x1 + 4 * dx} y={l.y1 - 2} textAnchor={dx > 0 ? 'start' : 'end'}>
                *
              </text>
              <text x={l.x2 - 4 * dx} y={l.y2 - 2} textAnchor={dx > 0 ? 'end' : 'start'}>
                1
              </text>
            </g>
          )
        })}
        {boxes.map((b) => (
          <g key={b.name} className="rel-box">
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="5" />
            <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="central">
              {b.name}
            </text>
          </g>
        ))}
      </svg>

      <ul className="rel-items">
        {relationships.map((r) => {
          const from = qual(r.fromTable, r.fromColumn)
          const to = qual(r.toTable, r.toColumn)
          const snippet = `${from} = ${to}`
          return (
            <li key={`${from}|${to}`}>
              <button
                type="button"
                className="rel-item"
                onClick={() => onInsert(snippet)}
                title={`Insertar ${snippet}`}
                aria-label={`Insertar la condición ${snippet}, clave foránea`}
              >
                <span className="rel-item-text">
                  {from} <span className="rel-arrow">-&gt;</span> {to}
                </span>
                <span className="type-tag tag-active">FK</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Collapsible>
  )
}
