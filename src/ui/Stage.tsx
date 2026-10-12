import type { TableSnapshot, TraceStep } from '../engine'
import { DataTable } from './DataTable'
import { useGhosts } from './useGhosts'

const tableKey = (t: TableSnapshot) => t.id
const EMPTY: TableSnapshot[] = []

interface Props {
  step: TraceStep | null
}

export function Stage({ step }: Props) {
  const list = useGhosts(step ? step.tables : EMPTY, tableKey)
  const liveCount = step ? step.tables.length : 0
  const nested = !!step && step.depth > 0

  return (
    <div className={`stage${liveCount === 2 ? ' is-pair' : ''}${nested ? ' is-nested' : ''}`}>
      {step && (
        // Se reserva siempre la altura para que la escena no salte entre pasos.
        <p className={`stage-caption${nested ? ' is-on' : ''}`} aria-live="off">
          {nested && (
            <>
              <span className="scope-tag" data-depth={Math.min(step.depth, 3)}>
                {step.scope ?? 'Subconsulta'}
              </span>
              <span className="scope-depth">nivel {step.depth}</span>
            </>
          )}
        </p>
      )}
      {list.length === 0 && (
        <p className="stage-empty">
          Pulsa <strong>Ejecutar</strong> para ver cómo se transforman las tablas paso a paso.
        </p>
      )}
      {list.map(({ item, leaving }) => (
        <DataTable key={item.id} table={item} leaving={leaving} />
      ))}
    </div>
  )
}
