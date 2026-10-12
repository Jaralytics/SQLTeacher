import { useState } from 'react'
import type { Relationship, Table } from '../engine'
import { quoteIdent as quote } from './autocomplete'
import { Collapsible } from './Collapsible'
import { LinkIcon } from './icons'
import { formatValue, typeLabel } from './format'

interface Props {
  tables: Table[]
  relationships: Relationship[]
  onInsert: (text: string) => void
}


/** Columnas con las que se relaciona una columna, para marcarla y nombrarla. */
function relatedTo(table: string, column: string, relationships: Relationship[]): string[] {
  const out: string[] = []
  for (const r of relationships) {
    if (r.fromTable === table && r.fromColumn === column) out.push(`${r.toTable}.${r.toColumn}`)
    else if (r.toTable === table && r.toColumn === column) out.push(`${r.fromTable}.${r.fromColumn}`)
  }
  return out
}

interface BlockProps {
  table: Table
  relationships: Relationship[]
  defaultOpen: boolean
  onInsert: (text: string) => void
}

function TableBlock({ table, relationships, defaultOpen, onInsert }: BlockProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [showData, setShowData] = useState(false)
  const bodyId = `tbl-body-${table.name}`
  const dataId = `data-${table.name}`
  const tableName = quote(table.name)
  const isMany = relationships.some((r) => r.fromTable === table.name)
  const isOne = relationships.some((r) => r.toTable === table.name)
  const kind = isOne ? 'referenciada' : isMany ? 'con FK' : null

  return (
    <div className={`tbl-block${expanded ? ' is-expanded' : ''}`}>
      <div className="tbl-head">
        <button
          type="button"
          className="tbl-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? 'Contraer' : 'Expandir'} la tabla ${table.name}`}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="chevron" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tbl-name"
          onClick={() => onInsert(tableName)}
          title={`Insertar ${tableName}`}
          aria-label={`Insertar la tabla ${table.name}`}
        >
          {table.name}
        </button>
        <span className="tbl-count">{table.rows.length} filas</span>
        {kind && <span className="type-tag tbl-kind">{kind}</span>}
      </div>

      {expanded && (
        <div id={bodyId}>
          <ul className="col-list">
            {table.columns.map((col) => {
              const rel = relatedTo(table.name, col.name, relationships)
              const relText = rel.length ? `Clave foránea con ${rel.join(', ')}` : ''
              return (
                <li key={col.name}>
                  <button
                    type="button"
                    className="col-item"
                    onClick={() => onInsert(`${tableName}.${quote(col.name)}`)}
                    title={`Insertar ${tableName}.${quote(col.name)}${relText ? `. ${relText}` : ''}`}
                    aria-label={`Insertar la columna ${col.name}, ${typeLabel(col.type)}${relText ? `. ${relText}` : ''}`}
                  >
                    <span className="col-name">
                      {col.name}
                      {rel.length > 0 && (
                        <span className="key-mark" title={relText}>
                          <LinkIcon />
                        </span>
                      )}
                    </span>
                    <span className={`type-tag type-${col.type}`}>{typeLabel(col.type)}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <button
            type="button"
            className="link-btn data-toggle"
            aria-expanded={showData}
            aria-controls={dataId}
            onClick={() => setShowData((v) => !v)}
          >
            {showData ? 'Ocultar datos' : 'Ver datos'}
          </button>

          {showData && (
            <div
              className="table-scroll mini-data"
              id={dataId}
              tabIndex={0}
              role="region"
              aria-label={`Datos de ${table.name}`}
            >
              <table>
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c.name} scope="col">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className={typeof cell === 'number' ? 'num' : ''}>
                          {formatValue(cell, table.columns[j]?.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TablesPanel({ tables, relationships, onInsert }: Props) {
  return (
    <Collapsible id="side-tables" title="Tablas">
      {tables.map((t, i) => (
        <TableBlock key={t.name} table={t} relationships={relationships} defaultOpen={i === 0} onInsert={onInsert} />
      ))}
    </Collapsible>
  )
}
