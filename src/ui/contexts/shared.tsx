import type { ReactNode } from 'react'
import type { ColumnType, RowStatus, SourceSpan, TableSnapshot, Value } from '../../engine'
import { LinkIcon } from '../icons'
import { panelId, tabId } from './Segmented'

interface FrameProps {
  idPrefix: string
  tabKey: string
  title: string
  definition: string
  idea: string
  children: ReactNode
}

/** Marco comun de una leccion: definicion arriba, contenido interactivo e idea clave abajo. */
export function LessonFrame({ idPrefix, tabKey, title, definition, idea, children }: FrameProps) {
  return (
    <div className="lesson" role="tabpanel" id={panelId(idPrefix)} aria-labelledby={tabId(idPrefix, tabKey)}>
      <h2 className="lesson-title">{title}</h2>
      <p className="lesson-def">{definition}</p>
      {children}
      <p className="lesson-idea">
        <strong>Idea clave.</strong> {idea}
      </p>
    </div>
  )
}

/** Convierte el texto entre backticks en elementos <code>. */
export function inlineCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}

interface QueryProps {
  query: string
  /** Fragmento a resaltar (la parte que procesa el paso actual). */
  span?: SourceSpan | null
  onOpenInPlayer?: (query: string) => void
}

/** Consulta de solo lectura, en monoespaciada, con acceso opcional al reproductor. */
export function QueryBlock({ query, span, onOpenInPlayer }: QueryProps) {
  const valid = span && span.start >= 0 && span.end <= query.length && span.start < span.end
  return (
    <section className="query-card" aria-label="Consulta">
      <pre className="query-text">
        <code>
          {valid ? (
            <>
              {query.slice(0, span.start)}
              <mark className="query-mark">{query.slice(span.start, span.end)}</mark>
              {query.slice(span.end)}
            </>
          ) : (
            query
          )}
        </code>
      </pre>
      {onOpenInPlayer && (
        <button type="button" className="query-open" onClick={() => onOpenInPlayer(query)}>
          <LinkIcon />
          Abrir en el reproductor
        </button>
      )}
    </section>
  )
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function cellText(value: Value, type?: ColumnType): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'VERDADERO' : 'FALSO'
  if (type === 'date' && typeof value === 'string') {
    const m = ISO_DATE.exec(value)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value
  }
  return String(value)
}

/** Valor de un resultado escalar: NULL explicito y hasta dos decimales. */
export function formatResult(value: Value): string {
  if (typeof value === 'number') return String(Math.round(value * 100) / 100)
  return cellText(value)
}

const STATUS_LABEL: Record<RowStatus, string> = {
  normal: '',
  active: 'Fila en evaluación',
  kept: 'Fila conservada',
  removed: 'Fila descartada',
  added: 'Fila nueva',
  matched: 'Con pareja',
  unmatched: 'Sin pareja',
}

interface TableProps {
  table: TableSnapshot
  /** Reemplaza el titulo de la tabla. */
  title?: string
  /** Etiqueta pequena a la derecha; por defecto, el numero de filas. */
  tag?: string
}

/** Tabla de una foto del motor: estado por fila, NULL de relleno, grupos y notas. */
export function SnapshotTable({ table, title, tag }: TableProps) {
  const hasNotes = table.rows.some((r) => r.note)
  const kept = table.rows.filter((r) => r.status !== 'removed').length
  const hasRemoved = kept !== table.rows.length
  const count = hasRemoved ? `${kept} de ${table.rows.length} filas` : `${table.rows.length} filas`

  return (
    <section className="ctx-table" aria-label={title ?? table.title}>
      <header className="ctx-table-head">
        <h3>{title ?? table.title}</h3>
        <span className="ctx-tag">{tag ?? count}</span>
      </header>
      <div className="ctx-table-scroll">
        <table>
          <thead>
            <tr>
              <th className="mark-col" aria-label="Estado" />
              {table.columns.map((c, i) => (
                <th key={i} scope="col" className={c.isNew ? 'is-new' : c.highlight ? 'is-highlight' : ''}>
                  {c.name}
                </th>
              ))}
              {hasNotes && <th scope="col">Nota</th>}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr className="row-empty">
                <td colSpan={table.columns.length + 1 + (hasNotes ? 1 : 0)}>Sin filas</td>
              </tr>
            )}
            {table.rows.map((row) => (
              <tr
                key={row.key}
                className={`status-${row.status}${row.group !== undefined ? ` group-${row.group % 3}` : ''}`}
              >
                <td className="mark-col">
                  <span className="sr-only">{STATUS_LABEL[row.status]}</span>
                </td>
                {row.cells.map((cell, j) => {
                  const padded = row.padded?.includes(j) ?? false
                  const cls = [
                    typeof cell === 'number' ? 'num' : '',
                    padded ? 'is-padded' : cell === null ? 'is-null' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <td key={j} className={cls} title={padded ? 'NULL producido por el JOIN' : undefined}>
                      {cellText(cell, table.columns[j]?.type)}
                    </td>
                  )
                })}
                {hasNotes && <td className="note-cell">{row.note}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Leyenda de los marcadores de fila usados en una leccion. */
export function Legend({ items }: { items: { className: string; label: string }[] }) {
  return (
    <ul className="legend" aria-label="Leyenda">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`legend-swatch ${it.className}`} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

/** Muestra el mensaje de error del motor para una consulta invalida. */
export function ErrorCard({ message }: { message: string }) {
  return (
    <section className="error-card" role="alert" aria-label="Error de la consulta">
      <h3 className="card-title">El motor rechaza la consulta</h3>
      <p>{message}</p>
    </section>
  )
}
