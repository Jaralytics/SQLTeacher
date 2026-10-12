import { useMemo, useState } from 'react'
import type { Trace } from '../../engine'
import { JOIN_KINDS, JOIN_TEXT, joinInputs, joinQuery, joinResult, joinSurvivors, runLesson } from './helpers'
import type { JoinKind } from './helpers'
import { ErrorCard, Legend, LessonFrame, QueryBlock, SnapshotTable } from './shared'

interface Props {
  idPrefix: string
  onOpenInPlayer: (query: string) => void
}

export function JoinLesson({ idPrefix, onOpenInPlayer }: Props) {
  const [kind, setKind] = useState<JoinKind>('LEFT')
  const query = joinQuery(kind)
  const outcome = useMemo(() => runLesson(query), [query])
  const text = JOIN_TEXT[kind]

  return (
    <LessonFrame
      idPrefix={idPrefix}
      tabKey="join"
      title="Tipos de JOIN"
      definition="Un JOIN combina cada fila de Ventas con las filas de Productos que cumplen la condición ON. Lo que cambia entre un tipo y otro es qué pasa con las filas que no encuentran pareja."
      idea="INNER solo conserva parejas; LEFT, RIGHT y FULL además conservan las filas sin pareja de uno o ambos lados, rellenándolas con NULL; CROSS ignora la condición y combina todo con todo."
    >
      <div className="ctx-form">
        <div className="field">
          <span id={`${idPrefix}-join-label`}>Tipo de JOIN</span>
          <div className="chip-row" role="group" aria-labelledby={`${idPrefix}-join-label`}>
            {JOIN_KINDS.map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={k === kind} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      <QueryBlock query={query} onOpenInPlayer={onOpenInPlayer} />

      <div className="join-note" aria-live="polite">
        <p>
          <strong>{kind} JOIN conserva.</strong> {text.keeps}
        </p>
        <p>{text.why}</p>
      </div>

      {outcome.ok ? (
        <>
          <Legend
            items={[
              { className: 'is-matched', label: 'Con pareja' },
              { className: 'is-unmatched', label: 'Sin pareja' },
              { className: 'is-padded', label: 'NULL añadido por el JOIN' },
            ]}
          />
          <div className="ctx-tables">
            {joinInputs(outcome.trace).map((t) => (
              <SnapshotTable key={t.id} table={t} />
            ))}
          </div>
          <JoinResult trace={outcome.trace} />
        </>
      ) : (
        <ErrorCard message={outcome.error.message} />
      )}
    </LessonFrame>
  )
}

function JoinResult({ trace }: { trace: Trace }) {
  const table = trace.result.table
  const { orphanSale, unsoldProduct } = joinSurvivors(table)
  return (
    <div className="ctx-tables">
      <SnapshotTable table={joinResult(trace)} title="Resultado del JOIN" />
      <ul className="ctx-captions" aria-label="Filas especiales">
        <li>La venta 10 (Sal, sin producto en el catálogo) {orphanSale ? 'aparece en el resultado.' : 'no aparece.'}</li>
        <li>Café (producto sin ventas) {unsoldProduct ? 'aparece en el resultado.' : 'no aparece.'}</li>
      </ul>
    </div>
  )
}
