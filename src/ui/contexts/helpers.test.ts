import { describe, expect, it } from 'vitest'
import type { AggKind } from './helpers'
import {
  AGG_KINDS,
  ENTREGAS_QUERY,
  markCounted,
  JOIN_KINDS,
  ORDER_QUERY,
  STAGES,
  activeStages,
  aggregateQuery,
  aliasQuery,
  allValidLessonQueries,
  joinInputs,
  joinQuery,
  joinResult,
  joinSurvivors,
  nullFilterQuery,
  runLesson,
  stageSteps,
} from './helpers'

function trace(query: string) {
  const r = runLesson(query)
  if (!r.ok) throw new Error(r.error.message)
  return r.trace
}

describe('consultas de las lecciones', () => {
  it('toda consulta valida se ejecuta sin error', () => {
    for (const q of allValidLessonQueries()) {
      const r = runLesson(q)
      expect(r.ok, q).toBe(true)
    }
  })

  it('el alias en WHERE devuelve un error en espanol', () => {
    const r = runLesson(aliasQuery('where'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toContain('alias')
  })

  it('el alias en ORDER BY es valido', () => {
    expect(runLesson(aliasQuery('orderBy')).ok).toBe(true)
  })
})

describe('joinQuery', () => {
  it('CROSS no lleva ON y los demas si', () => {
    expect(joinQuery('CROSS')).not.toContain(' ON ')
    expect(joinQuery('LEFT')).toContain('LEFT JOIN Productos p ON v.Producto = p.Producto')
  })

  it('cada tipo conserva las filas esperadas', () => {
    const survivors = Object.fromEntries(JOIN_KINDS.map((k) => [k, joinSurvivors(trace(joinQuery(k)).result.table)]))
    expect(survivors.INNER).toEqual({ orphanSale: false, unsoldProduct: false })
    expect(survivors.LEFT).toEqual({ orphanSale: true, unsoldProduct: false })
    expect(survivors.RIGHT).toEqual({ orphanSale: false, unsoldProduct: true })
    expect(survivors.FULL).toEqual({ orphanSale: true, unsoldProduct: true })
    expect(survivors.CROSS).toEqual({ orphanSale: true, unsoldProduct: true })
  })

  it('las tablas de entrada marcan filas con y sin pareja', () => {
    const inputs = joinInputs(trace(joinQuery('FULL')))
    expect(inputs).toHaveLength(2)
    const statuses = inputs.flatMap((t) => t.rows.map((r) => r.status))
    expect(statuses).toContain('matched')
    expect(statuses).toContain('unmatched')
  })

  it('los resultados externos traen celdas rellenadas con NULL', () => {
    const rows = joinResult(trace(joinQuery('LEFT'))).rows
    expect(rows.some((r) => (r.padded ?? []).length > 0)).toBe(true)
  })
})

describe('stageSteps', () => {
  const t = trace(ORDER_QUERY)

  it('la consulta fija recorre todas las etapas en orden logico', () => {
    expect(activeStages(t).map((s) => s.id)).toEqual(STAGES.map((s) => s.id))
  })

  it('cada etapa tiene al menos un paso con tabla', () => {
    const steps = stageSteps(t)
    for (const s of STAGES) {
      expect(steps[s.id].length, s.id).toBeGreaterThan(0)
      expect(steps[s.id][0].tables.length).toBeGreaterThan(0)
    }
  })

  it('WHERE y HAVING descartan filas, LIMIT recorta', () => {
    const steps = stageSteps(t)
    const statuses = (id: 'where' | 'having') =>
      steps[id].flatMap((s) => s.tables.flatMap((tb) => tb.rows.map((r) => r.status)))
    expect(statuses('where')).toContain('removed')
    expect(statuses('having')).toContain('removed')
    const last = steps.limit[steps.limit.length - 1].tables[0]
    expect(last.rows.filter((r) => r.status === 'kept').length).toBe(1)
  })
})

describe('agregados y NULL', () => {
  function resultado(q: string) {
    return trace(q).result.table.rows[0].cells[0]
  }

  it('COUNT(*) cuenta mas filas que COUNT(columna)', () => {
    expect(resultado(aggregateQuery('count-star'))).toBe(10)
    expect(resultado(aggregateQuery('count-col'))).toBe(8)
  })

  it('COUNT(DISTINCT) cuenta valores distintos no nulos', () => {
    expect(resultado(aggregateQuery('count-distinct'))).toBe(5)
  })

  it('hay una consulta por cada agregado', () => {
    expect(new Set(AGG_KINDS.map((k) => aggregateQuery(k.id))).size).toBe(AGG_KINDS.length)
  })

  it('= NULL no devuelve filas e IS NULL devuelve las ventas sin entrega', () => {
    expect(trace(nullFilterQuery('equals')).result.table.rows).toHaveLength(0)
    expect(trace(nullFilterQuery('is')).result.table.rows).toHaveLength(2)
  })
})

describe('markCounted', () => {
  const source = trace(ENTREGAS_QUERY).result.table
  const kept = (kind: AggKind) => markCounted(source, kind).rows.filter((r) => r.status === 'kept').length

  it('las filas contadas coinciden con el resultado del motor', () => {
    for (const kind of ['count-star', 'count-col', 'count-distinct'] as const) {
      expect(kept(kind), kind).toBe(trace(aggregateQuery(kind)).result.table.rows[0].cells[0])
    }
  })

  it('SUM y AVG ignoran las filas con NULL', () => {
    expect(kept('sum')).toBe(8)
    expect(kept('avg')).toBe(8)
  })
})
