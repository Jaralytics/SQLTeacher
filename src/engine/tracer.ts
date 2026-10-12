import type { RowStatus, SnapshotColumn, SnapshotRow, TableRole, TableSnapshot } from './types'
import type { Rel } from './values'
import { inferType } from './values'

export interface SnapOpts {
  role: TableRole
  title?: string
  id?: string
  status?: RowStatus[]
  notes?: (string | undefined)[]
  /** Numero de grupo por fila (GROUP BY, PARTITION BY). */
  groups?: (number | undefined)[]
  /** Posiciones de celda rellenadas con NULL por un JOIN externo, por fila. */
  padded?: (number[] | undefined)[]
  /** Posiciones de columna a resaltar. */
  highlight?: Set<number>
}

export function snapshotRel(t: Rel, o: SnapOpts): TableSnapshot {
  const columns: SnapshotColumn[] = t.cols.map((c, i) => {
    const col: SnapshotColumn = { name: c.name }
    if (o.highlight?.has(i)) col.highlight = true
    if (c.isNew) col.isNew = true
    if (c.qual) col.source = c.qual
    const type = c.type ?? inferType(t.rows.map((r) => r.cells[i]))
    if (type) col.type = type
    return col
  })
  const rows: SnapshotRow[] = t.rows.map((r, i) => {
    const row: SnapshotRow = { key: r.key, cells: [...r.cells], status: o.status?.[i] ?? 'normal' }
    const note = o.notes?.[i]
    if (note) row.note = note
    const group = o.groups?.[i]
    if (group !== undefined) row.group = group
    const padded = o.padded?.[i]
    if (padded && padded.length > 0) row.padded = padded
    return row
  })
  return { id: o.id ?? t.id, title: o.title ?? t.title, role: o.role, columns, rows }
}
