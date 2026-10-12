import type { SourceSpan } from './types'

/** Error del motor con la posicion del texto que lo causo. */
export class EngineError extends Error {
  span: SourceSpan | null

  constructor(message: string, span: SourceSpan | null) {
    super(message)
    this.span = span
  }
}
