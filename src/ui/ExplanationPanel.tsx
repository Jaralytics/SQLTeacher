import type { TraceStep } from '../engine'
import { formatPlain, renderInlineCode } from './format'
import { LogicalOrder } from './LogicalOrder'

interface Props {
  step: TraceStep | null
  steps: TraceStep[] | null
  index: number
  count: number
}

export function ExplanationPanel({ step, steps, index, count }: Props) {
  return (
    <div className="panel-inner">
      <p className="sr-only" aria-live="polite">
        {step ? step.title : ''}
      </p>
      {step ? (
        <>
          <p className="step-counter">
            Paso {index + 1} de {count}
          </p>
          {step.depth > 0 && step.scope && <p className="step-scope">{step.scope}</p>}
          <h2 className="step-title">{step.title}</h2>
          <p className="step-text">{renderInlineCode(step.explanation)}</p>
          {step.scalar && (
            <div className="scalar">
              <span className="scalar-label">{step.scalar.label}</span>
              <span className="scalar-value">{formatPlain(step.scalar.value)}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <h2 className="step-title">Sin ejecución</h2>
          <p className="step-text">
            Escribe una consulta o elige un ejemplo y pulsa <code>Ejecutar</code>. Aquí verás la explicación de cada
            paso.
          </p>
        </>
      )}
      <LogicalOrder steps={steps} index={index} />
    </div>
  )
}
