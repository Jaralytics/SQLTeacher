import { useMemo, useState } from 'react'
import {
  AGG_KINDS,
  AGG_TEXT,
  ENTREGAS_QUERY,
  NULL_TESTS,
  NULL_TEXT,
  aggregateQuery,
  markCounted,
  nullFilterQuery,
  runLesson,
} from './helpers'
import type { AggKind, NullTest } from './helpers'
import { ErrorCard, Legend, LessonFrame, QueryBlock, SnapshotTable, formatResult } from './shared'

interface Props {
  idPrefix: string
  onOpenInPlayer: (query: string) => void
}

export function NullLesson({ idPrefix, onOpenInPlayer }: Props) {
  const [agg, setAgg] = useState<AggKind>('count-star')
  const [test, setTest] = useState<NullTest>('equals')

  const source = useMemo(() => runLesson(ENTREGAS_QUERY), [])
  const aggQuery = aggregateQuery(agg)
  const aggOutcome = useMemo(() => runLesson(aggQuery), [aggQuery])
  const filterQuery = nullFilterQuery(test)
  const filterOutcome = useMemo(() => runLesson(filterQuery), [filterQuery])

  const whereStep = filterOutcome.ok
    ? filterOutcome.trace.steps.find((s) => s.depth === 0 && s.phase === 'where' && s.kind === 'table-result')
    : undefined

  return (
    <LessonFrame
      idPrefix={idPrefix}
      tabKey="null"
      title="NULL y agregados"
      definition="NULL significa dato desconocido o ausente, no cero ni texto vacío. Las ventas 3 y 7 aún no tienen fecha de entrega, así que su cantidad entregada es NULL."
      idea="Los agregados ignoran los NULL (salvo COUNT(*)) y una comparación con NULL nunca es verdadera: para detectarlos hay que usar IS NULL."
    >
      <h3 className="lesson-subtitle">Agregados sobre una columna con NULL</h3>
      <div className="ctx-form">
        <div className="field">
          <span id={`${idPrefix}-agg-label`}>Agregado</span>
          <div className="chip-row" role="group" aria-labelledby={`${idPrefix}-agg-label`}>
            {AGG_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="chip chip-mono"
                aria-pressed={k.id === agg}
                onClick={() => setAgg(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <QueryBlock query={aggQuery} onOpenInPlayer={onOpenInPlayer} />
      <p className="join-note" aria-live="polite">
        {AGG_TEXT[agg]}
      </p>
      {source.ok && aggOutcome.ok ? (
        <>
          <Legend
            items={[
              { className: 'is-matched', label: 'Fila que entra en el agregado' },
              { className: 'is-removed', label: 'Fila ignorada' },
            ]}
          />
          <div className="ctx-split">
            <SnapshotTable table={markCounted(source.trace.result.table, agg)} title="entregas" />
            <section className="card result-card" aria-label="Resultado">
              <h3 className="card-title">Resultado</h3>
              <p className="result-value" aria-live="polite">
                {formatResult(aggOutcome.trace.result.table.rows[0]?.cells[0] ?? null)}
              </p>
            </section>
          </div>
        </>
      ) : (
        <ErrorCard message={!aggOutcome.ok ? aggOutcome.error.message : !source.ok ? source.error.message : ''} />
      )}

      <h3 className="lesson-subtitle">Comparar con NULL en WHERE</h3>
      <div className="ctx-form">
        <div className="field">
          <span id={`${idPrefix}-test-label`}>Condición</span>
          <div className="chip-row" role="group" aria-labelledby={`${idPrefix}-test-label`}>
            {NULL_TESTS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip chip-mono"
                aria-pressed={t.id === test}
                onClick={() => setTest(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <QueryBlock query={filterQuery} onOpenInPlayer={onOpenInPlayer} />
      <p className="join-note" aria-live="polite">
        {NULL_TEXT[test]}
      </p>
      {filterOutcome.ok ? (
        <div className="ctx-tables">
          {whereStep?.tables.map((t) => <SnapshotTable key={t.id} table={t} title="WHERE: evaluación por fila" />)}
          <SnapshotTable table={filterOutcome.trace.result.table} title="Resultado" />
        </div>
      ) : (
        <ErrorCard message={filterOutcome.error.message} />
      )}

      <section className="card" aria-label="Lógica de tres valores">
        <h3 className="card-title">Lógica de tres valores</h3>
        <p className="lesson-note">
          Una condición SQL puede dar VERDADERO, FALSO o DESCONOCIDO. Cualquier comparación con NULL da DESCONOCIDO, y
          WHERE y HAVING solo conservan las filas VERDADERAS.
        </p>
        <ul className="ctx-captions">
          <li>
            <code>NULL = NULL</code> es DESCONOCIDO, no VERDADERO.
          </li>
          <li>
            <code>NULL &lt;&gt; 5</code> también es DESCONOCIDO, así que <code>&lt;&gt;</code> tampoco devuelve los NULL.
          </li>
          <li>
            <code>NULL IS NULL</code> es VERDADERO: es la forma correcta de preguntar por ausencia.
          </li>
        </ul>
      </section>
    </LessonFrame>
  )
}
