import type { ReactNode } from 'react'
import type { ColumnType, Value } from '../engine'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function dateText(value: string): string {
  const m = ISO_DATE.exec(value)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

export function formatValue(value: Value, type?: ColumnType): ReactNode {
  if (value === null) return <span className="blank">NULL</span>
  if (typeof value === 'boolean') return value ? 'VERDADERO' : 'FALSO'
  if (type === 'date' && typeof value === 'string') return dateText(value)
  return String(value)
}

export function typeLabel(type: string): string {
  if (type === 'number') return 'número'
  if (type === 'boolean') return 'lógico'
  if (type === 'date') return 'fecha'
  return 'texto'
}

export function formatPlain(value: Value, type?: ColumnType): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'VERDADERO' : 'FALSO'
  if (type === 'date' && typeof value === 'string') return dateText(value)
  return typeof value === 'string' ? `'${value}'` : String(value)
}

/** Convierte el texto entre backticks en elementos <code>. */
export function renderInlineCode(text: string): ReactNode[] {
  return text
    .split('`')
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}
