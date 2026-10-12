import type { RowStatus, SnapshotRow, TableRole, TableSnapshot } from '../engine'
import { CheckIcon, LinkIcon } from './icons'
import { formatValue } from './format'
import { useGhosts } from './useGhosts'

const ROLE_LABEL: Record<TableRole, string> = {
  source: 'Origen',
  working: 'En proceso',
  result: 'Resultado',
}

const STATUS_LABEL: Record<RowStatus, string> = {
  normal: '',
  active: 'Fila actual',
  kept: 'Conservada',
  removed: 'Descartada',
  added: 'Nueva',
  matched: 'Con pareja',
  unmatched: 'Sin pareja',
}

const GROUP_TONES = 6

const rowKey = (row: SnapshotRow) => row.key

interface Props {
  table: TableSnapshot
  leaving?: boolean
}

export function DataTable({ table, leaving = false }: Props) {
  const rows = useGhosts(table.rows, rowKey)
  const hasNotes = rows.some((r) => r.item.note)

  return (
    <section
      className={`table-card role-${table.role}${leaving ? ' is-leaving' : ''}`}
      aria-label={table.title}
    >
      <header className="table-head">
        <h3>{table.title}</h3>
        <span className="role-tag">{ROLE_LABEL[table.role]}</span>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="mark-col" aria-label="Estado" />
              {table.columns.map((col, i) => (
                <th
                  key={`${col.name}-${i}`}
                  scope="col"
                  className={`${col.highlight ? 'is-highlight' : ''}${col.isNew ? ' is-new' : ''}`}
                >
                  {col.source && <span className="col-source">{col.source}</span>}
                  <span className="col-title">
                    {col.name}
                    {col.isNew && <span className="new-tag">nueva</span>}
                  </span>
                </th>
              ))}
              {hasNotes && <th className="note-col" aria-label="Nota" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item: row, leaving: rowLeaving }) => {
              const grouped = row.group !== undefined
              return (
                <tr
                  key={row.key}
                  className={`status-${row.status}${grouped ? ` has-group group-${row.group! % GROUP_TONES}` : ''}${rowLeaving ? ' is-leaving' : ''}`}
                >
                  <td className="mark-col">
                    {row.status === 'kept' && <CheckIcon />}
                    {row.status === 'matched' && <LinkIcon />}
                    {row.status === 'unmatched' && <span className="unmatched-mark" aria-hidden="true">?</span>}
                    {grouped && (
                      <span className="group-badge" title={`Grupo ${row.group! + 1}`}>
                        {row.group! + 1}
                      </span>
                    )}
                    {(STATUS_LABEL[row.status] || grouped) && (
                      <span className="sr-only">
                        {[STATUS_LABEL[row.status], grouped ? `Grupo ${row.group! + 1}` : ''].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </td>
                  {row.cells.map((cell, i) => {
                    const padded = cell === null && row.padded?.includes(i)
                    return (
                      <td
                        key={i}
                        className={`${typeof cell === 'number' ? 'num' : ''}${table.columns[i]?.highlight ? ' is-highlight' : ''}`}
                      >
                        {padded ? (
                          <span className="blank is-padded" title="NULL por el relleno del JOIN externo">
                            NULL
                            <span className="sr-only"> (relleno del JOIN)</span>
                          </span>
                        ) : (
                          formatValue(cell, table.columns[i]?.type)
                        )}
                      </td>
                    )
                  })}
                  {hasNotes && <td className="note-col">{row.note}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
