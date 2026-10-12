import type { Phase, TraceStep } from '../engine'

interface PhaseInfo {
  phase: Phase
  label: string
}

/** Fases en el orden logico de procesamiento, no en el orden en que se escriben. */
const ORDER: PhaseInfo[] = [
  { phase: 'from', label: 'FROM' },
  { phase: 'join', label: 'JOIN' },
  { phase: 'where', label: 'WHERE' },
  { phase: 'groupBy', label: 'GROUP BY' },
  { phase: 'aggregate', label: 'Agregados' },
  { phase: 'having', label: 'HAVING' },
  { phase: 'select', label: 'SELECT' },
  { phase: 'window', label: 'Ventanas' },
  { phase: 'distinct', label: 'DISTINCT' },
  { phase: 'setOp', label: 'Conjuntos' },
  { phase: 'orderBy', label: 'ORDER BY' },
  { phase: 'limit', label: 'LIMIT' },
]

type PhaseState = 'current' | 'done' | 'todo' | 'unused'

const STATE_LABEL: Record<PhaseState, string> = {
  current: 'en curso',
  done: 'hecho',
  todo: 'pendiente',
  unused: 'no se usa',
}

/** Estado de cada fase en el paso `index`. Los pasos anidados cuentan como la fase externa que los espera. */
export function phaseStates(steps: TraceStep[], index: number): { phase: Phase; label: string; state: PhaseState }[] {
  const used = new Set(steps.map((s) => s.phase))
  const step = steps[index]
  let current: Phase | null = null
  for (let i = index; i >= 0 && step; i--) {
    const p = steps[i].phase
    if ((i === index || steps[i].depth === 0) && ORDER.some((o) => o.phase === p)) {
      current = p
      break
    }
  }
  const finished = step?.phase === 'result'
  const seen = new Set<Phase>()
  for (let i = 0; i < index; i++) if (steps[i].depth === 0) seen.add(steps[i].phase)

  return ORDER.map(({ phase, label }) => {
    let state: PhaseState
    if (!used.has(phase)) state = 'unused'
    else if (finished) state = 'done'
    else if (phase === current) state = 'current'
    else if (seen.has(phase)) state = 'done'
    else state = 'todo'
    return { phase, label, state }
  })
}

interface Props {
  steps: TraceStep[] | null
  index: number
}

export function LogicalOrder({ steps, index }: Props) {
  if (!steps || steps.length === 0) return null
  const items = phaseStates(steps, index)
  return (
    <section className="logic-order" aria-labelledby="logic-order-title">
      <h3 id="logic-order-title">Orden lógico</h3>
      <ol className="phase-list">
        {items.map((p) => (
          <li
            key={p.phase}
            className={`phase phase-${p.state}`}
            aria-current={p.state === 'current' ? 'step' : undefined}
          >
            {p.label}
            <span className="sr-only"> ({STATE_LABEL[p.state]})</span>
          </li>
        ))}
      </ol>
      <p className="logic-hint">SQL se procesa en este orden, no en el que se escribe.</p>
    </section>
  )
}
