import { useMemo, useState } from 'react'
import { NextIcon, PrevIcon } from '../icons'
import { ORDER_QUERY, activeStages, aliasQuery, runLesson, stageSteps } from './helpers'
import type { AliasPlace } from './helpers'
import { ErrorCard, LessonFrame, QueryBlock, SnapshotTable, inlineCode } from './shared'

interface Props {
  idPrefix: string
  onOpenInPlayer: (query: string) => void
}

const ALIAS_PLACES: { id: AliasPlace; label: string }[] = [
  { id: 'orderBy', label: 'Alias en ORDER BY' },
  { id: 'where', label: 'Alias en WHERE' },
]

export function OrderLesson({ idPrefix, onOpenInPlayer }: Props) {
  const [index, setIndex] = useState(0)
  const [place, setPlace] = useState<AliasPlace>('where')
  const outcome = useMemo(() => runLesson(ORDER_QUERY), [])
  const aliasText = aliasQuery(place)
  const alias = useMemo(() => runLesson(aliasText), [aliasText])

  const view = useMemo(() => {
    if (!outcome.ok) return null
    return { stages: activeStages(outcome.trace), steps: stageSteps(outcome.trace) }
  }, [outcome])

  const current = view ? view.stages[Math.min(index, view.stages.length - 1)] : null
  const steps = view && current ? view.steps[current.id] : []
  const last = steps[steps.length - 1]

  return (
    <LessonFrame
      idPrefix={idPrefix}
      tabKey="orden"
      title="Orden lógico de ejecución"
      definition="SQL no ejecuta la consulta en el orden en que se escribe. El motor procesa las cláusulas en otro orden y cada una trabaja con la tabla que dejó la anterior."
      idea="El orden lógico es FROM, WHERE, GROUP BY, HAVING, SELECT, ORDER BY y LIMIT. Por eso un alias creado en SELECT no existe todavía en WHERE, pero sí en ORDER BY."
    >
      {view && current && last ? (
        <>
          <QueryBlock query={ORDER_QUERY} span={last.span} onOpenInPlayer={onOpenInPlayer} />

          <div className="stage-bar">
            <div className="chip-row" role="group" aria-label="Fase de ejecución">
              {view.stages.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip"
                  aria-pressed={s.id === current.id}
                  onClick={() => setIndex(i)}
                >
                  {i + 1}. {s.label}
                </button>
              ))}
            </div>
            <div className="stage-nav">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setIndex(Math.max(0, index - 1))}
                disabled={index === 0}
                aria-label="Fase anterior"
              >
                <PrevIcon />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setIndex(Math.min(view.stages.length - 1, index + 1))}
                disabled={index >= view.stages.length - 1}
                aria-label="Fase siguiente"
              >
                <NextIcon />
              </button>
            </div>
          </div>

          <div className="join-note" aria-live="polite">
            <p>
              <strong>{last.title}</strong>
            </p>
            <p>{inlineCode(last.explanation)}</p>
          </div>

          <div className="ctx-tables">
            {steps.flatMap((s, i) => s.tables.map((t) => <SnapshotTable key={`${i}-${t.id}`} table={t} />))}
          </div>
        </>
      ) : (
        <ErrorCard message={outcome.ok ? 'La consulta no produjo fases.' : outcome.error.message} />
      )}

      <h3 className="lesson-subtitle">Un alias de SELECT no se puede usar en WHERE</h3>
      <p className="lesson-note">
        Como WHERE se evalúa antes que SELECT, el alias <code>Importe</code> todavía no existe en esa cláusula. ORDER BY
        se evalúa después, así que ahí sí lo conoce.
      </p>
      <div className="chip-row" role="group" aria-label="Dónde se usa el alias">
        {ALIAS_PLACES.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={p.id === place} onClick={() => setPlace(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <QueryBlock query={aliasText} onOpenInPlayer={alias.ok ? onOpenInPlayer : undefined} />
      {alias.ok ? (
        <div className="ctx-tables" aria-live="polite">
          <SnapshotTable table={alias.trace.result.table} title="Resultado" />
        </div>
      ) : (
        <ErrorCard message={alias.error.message} />
      )}
    </LessonFrame>
  )
}
