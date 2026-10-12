import { useState } from 'react'
import type { FunctionDoc } from '../data/functions'
import type { Relationship, Table } from '../engine'
import { FunctionsPanel } from './FunctionsPanel'
import { RelationsPanel } from './RelationsPanel'
import { TablesPanel } from './TablesPanel'

interface Props {
  tables: Table[]
  relationships: Relationship[]
  catalog: FunctionDoc[]
  onInsert: (text: string) => void
  onExample: (formula: string) => void
}

export function Sidebar({ tables, relationships, catalog, onInsert, onExample }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Modelo y referencia SQL">
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={open}
        aria-controls="sidebar-body"
        onClick={() => setOpen((v) => !v)}
      >
        Tablas y referencia
        <span className="chevron" aria-hidden="true" />
      </button>
      <div className="sidebar-body" id="sidebar-body">
        <TablesPanel tables={tables} relationships={relationships} onInsert={onInsert} />
        <RelationsPanel tables={tables} relationships={relationships} onInsert={onInsert} />
        <FunctionsPanel catalog={catalog} onInsert={onInsert} onExample={onExample} />
      </div>
    </aside>
  )
}
