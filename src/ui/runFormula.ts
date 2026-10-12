import { run } from '../engine'
import type { RunResult } from '../engine'
import { sampleModel } from '../data/sampleModel'

export function runFormula(formula: string): RunResult {
  return run(formula, sampleModel)
}
