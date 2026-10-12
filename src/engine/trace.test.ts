import { describe, expect, it } from 'vitest'
import { phases, trace } from './helpers'
import type { Phase } from './types'

const ORDER: Phase[] = [
  'from',
  'join',
  'where',
  'groupBy',
  'aggregate',
  'having',
  'select',
  'window',
  'distinct',
  'setOp',
  'orderBy',
  'limit',
  'result',
]

const ALL_CLAUSES = `SELECT DISTINCT p.Marca, COUNT(*) AS n
FROM Ventas v
JOIN Productos p ON v.Producto = p.Producto
WHERE v.Cantidad > 1
GROUP BY p.Marca
HAVING COUNT(*) >= 1
ORDER BY n DESC, p.Marca
LIMIT 2`

describe('forma de la traza', () => {
  it('las fases aparecen en el orden logico y no en el orden en que se escriben', () => {
    const t = trace(ALL_CLAUSES)
    expect(phases(t)).toEqual([
      'from',
      'join',
      'where',
      'groupBy',
      'aggregate',
      'having',
      'select',
      'distinct',
      'orderBy',
      'limit',
      'result',
    ])
  })

  it('el orden de fases nunca retrocede en el nivel principal', () => {
    for (const sql of [
      ALL_CLAUSES,
      'SELECT IdVenta, SUM(Cantidad) OVER (ORDER BY IdVenta) FROM Ventas WHERE Cantidad > 1 ORDER BY IdVenta DESC LIMIT 3',
      'SELECT Producto FROM Ventas UNION SELECT Producto FROM Devoluciones ORDER BY 1 LIMIT 3',
    ]) {
      const ranks = trace(sql)
        .steps.filter((s) => s.depth === 0 && s.scope === undefined)
        .map((s) => ORDER.indexOf(s.phase))
      expect(ranks.every((r) => r >= 0)).toBe(true)
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    }
  })

  it('una consulta con ventana pasa por SELECT, ventana y DISTINCT en ese orden', () => {
    const t = trace('SELECT DISTINCT Ciudad, ROW_NUMBER() OVER (ORDER BY IdVenta) AS n FROM Ventas ORDER BY n')
    expect(phases(t)).toEqual(['from', 'select', 'window', 'distinct', 'orderBy', 'result'])
  })

  it('cada paso tiene titulo, explicacion, tablas y un span valido', () => {
    const t = trace(ALL_CLAUSES)
    for (const s of t.steps) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.explanation.length).toBeGreaterThan(0)
      expect(['major', 'minor']).toContain(s.detail)
      if (s.span) {
        expect(s.span.start).toBeGreaterThanOrEqual(0)
        expect(s.span.end).toBeLessThanOrEqual(ALL_CLAUSES.length)
        expect(s.span.end).toBeGreaterThan(s.span.start)
      }
      const ids = s.tables.map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const tbl of s.tables) {
        const keys = tbl.rows.map((r) => r.key)
        expect(new Set(keys).size).toBe(keys.length)
        for (const r of tbl.rows) expect(r.cells).toHaveLength(tbl.columns.length)
      }
    }
  })

  it('los spans de cada fase apuntan a su clausula', () => {
    const t = trace(ALL_CLAUSES)
    const text = (phase: Phase) => {
      const s = t.steps.find((x) => x.phase === phase && x.span)
      return s?.span ? ALL_CLAUSES.slice(s.span.start, s.span.end) : ''
    }
    expect(text('where')).toBe('WHERE v.Cantidad > 1')
    expect(text('groupBy')).toBe('GROUP BY p.Marca')
    expect(text('having')).toBe('HAVING COUNT(*) >= 1')
    expect(text('orderBy')).toBe('ORDER BY n DESC, p.Marca')
    expect(text('limit')).toBe('LIMIT 2')
    expect(text('join')).toBe('JOIN Productos p ON v.Producto = p.Producto')
  })

  it('WHERE marca filas conservadas y descartadas sobre la misma tabla que FROM', () => {
    const t = trace("SELECT * FROM Ventas WHERE Ciudad = 'Cali'")
    const from = t.steps.find((s) => s.phase === 'from' && s.kind !== 'start')
    const where = t.steps.find((s) => s.phase === 'where')
    expect(where?.tables[0].id).toBe(from?.tables[0].id)
    expect(where?.tables[0].rows.map((r) => r.key)).toEqual(from?.tables[0].rows.map((r) => r.key))
    expect(where?.tables[0].rows.filter((r) => r.status === 'kept')).toHaveLength(3)
    expect(where?.tables[0].rows.filter((r) => r.status === 'removed')).toHaveLength(7)
    expect(where?.tables[0].columns.find((c) => c.highlight)?.name).toBe('Ciudad')
  })

  it('ORDER BY conserva las claves de fila y cambia su orden', () => {
    const t = trace('SELECT IdVenta FROM Ventas ORDER BY IdVenta DESC')
    const select = t.steps.find((s) => s.phase === 'select')?.tables[0]
    const order = t.steps.find((s) => s.phase === 'orderBy')?.tables[0]
    expect(order?.rows.map((r) => r.key)).toEqual([...(select?.rows.map((r) => r.key) ?? [])].reverse())
  })

  it('LIMIT y OFFSET marcan las filas que quedan fuera', () => {
    const t = trace('SELECT IdVenta FROM Ventas ORDER BY IdVenta LIMIT 2 OFFSET 1')
    const status = t.steps.find((s) => s.phase === 'limit')?.tables[0].rows.map((r) => r.status)
    expect(status?.slice(0, 4)).toEqual(['removed', 'kept', 'kept', 'removed'])
  })

  it('DISTINCT marca las filas repetidas', () => {
    const t = trace('SELECT DISTINCT Ciudad FROM Ventas')
    const rows = t.steps.find((s) => s.phase === 'distinct')?.tables[0].rows ?? []
    expect(rows.filter((r) => r.status === 'kept')).toHaveLength(3)
    expect(rows.filter((r) => r.status === 'removed')).toHaveLength(7)
  })

  it('el ultimo paso es el resultado y coincide con trace.result', () => {
    const t = trace(ALL_CLAUSES)
    const last = t.steps[t.steps.length - 1]
    expect(last.phase).toBe('result')
    expect(last.kind).toBe('result')
    expect(last.tables).toEqual([t.result.table])
    expect(t.result.table.role).toBe('result')
    expect(t.formula).toBe(ALL_CLAUSES)
  })

  it('la traza es JSON puro, sin celdas que no sean valores', () => {
    const t = trace(ALL_CLAUSES)
    expect(JSON.parse(JSON.stringify(t))).toEqual(t)
  })
})
