import type { DataModel, RunResult } from './types'
import { EngineError } from './errors'
import { parse } from './parser'
import { Runner } from './evaluator'

export type * from './types'

/** Ejecuta una consulta SQL sobre el modelo y devuelve la traza paso a paso. */
export function run(query: string, model: DataModel): RunResult {
  try {
    const ast = parse(query)
    const trace = new Runner(query, model).execute(ast)
    return { ok: true, trace }
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: { message: e.message, span: e.span } }
    return { ok: false, error: { message: 'Ocurrió un error inesperado al ejecutar la consulta.', span: null } }
  }
}
