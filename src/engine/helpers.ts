import { run } from './index'
import type { Phase, RunResult, SqlError, Trace, Value } from './types'
import { sampleModel } from '../data/sampleModel'

/** Utilidades compartidas por las pruebas del motor. */
export function exec(sql: string): RunResult {
  return run(sql, sampleModel)
}

export function trace(sql: string): Trace {
  const r = exec(sql)
  if (!r.ok) throw new Error(`${r.error.message} [${sql}]`)
  return r.trace
}

export function rows(sql: string): Value[][] {
  return trace(sql).result.table.rows.map((r) => r.cells)
}

export function columns(sql: string): string[] {
  return trace(sql).result.table.columns.map((c) => c.name)
}

export function fail(sql: string): SqlError {
  const r = exec(sql)
  if (r.ok) throw new Error(`Se esperaba un error pero la consulta funcionó: ${sql}`)
  return r.error
}

/** Texto de la consulta cubierto por el span del error. */
export function spanText(sql: string, e: SqlError): string {
  return e.span ? sql.slice(e.span.start, e.span.end) : ''
}

/** Fases del nivel indicado, sin repetir consecutivas. */
export function phases(t: Trace, depth = 0): Phase[] {
  const out: Phase[] = []
  for (const s of t.steps) {
    if (s.depth !== depth) continue
    if (out[out.length - 1] !== s.phase) out.push(s.phase)
  }
  return out
}
