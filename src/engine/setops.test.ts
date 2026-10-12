import { describe, expect, it } from 'vitest'
import { fail, phases, rows, spanText, trace } from './helpers'

const names = (sql: string) => rows(sql).map((r) => r[0])

describe('operaciones de conjuntos', () => {
  it('UNION elimina duplicados', () => {
    expect(names('SELECT Producto FROM Ventas UNION SELECT Producto FROM Devoluciones')).toEqual([
      'Aceite',
      'Arroz',
      'Leche',
      'Queso',
      'Jabon',
      'Sal',
    ])
  })

  it('UNION ALL conserva todas las filas', () => {
    expect(rows('SELECT Producto FROM Ventas UNION ALL SELECT Producto FROM Devoluciones')).toHaveLength(15)
  })

  it('UNION trata dos NULL como iguales', () => {
    expect(rows('SELECT NULL UNION SELECT NULL')).toEqual([[null]])
    expect(rows('SELECT NULL UNION ALL SELECT NULL')).toEqual([[null], [null]])
  })

  it('INTERSECT deja las filas comunes', () => {
    expect(names('SELECT Producto FROM Ventas INTERSECT SELECT Producto FROM Devoluciones')).toEqual([
      'Aceite',
      'Arroz',
      'Leche',
      'Jabon',
    ])
  })

  it('EXCEPT resta y el orden importa', () => {
    expect(names('SELECT Producto FROM Productos EXCEPT SELECT Producto FROM Ventas')).toEqual(['Cafe'])
    expect(names('SELECT Producto FROM Ventas EXCEPT SELECT Producto FROM Productos')).toEqual(['Sal'])
  })

  it('INTERSECT ALL y EXCEPT ALL respetan las repeticiones', () => {
    expect(rows('SELECT Producto FROM Ventas INTERSECT ALL SELECT Producto FROM Devoluciones')).toHaveLength(5)
    expect(rows('SELECT Producto FROM Ventas EXCEPT ALL SELECT Producto FROM Devoluciones')).toHaveLength(5)
  })

  it('INTERSECT se evalua antes que UNION y los parentesis cambian el orden', () => {
    expect(rows('SELECT 1 UNION SELECT 2 INTERSECT SELECT 3')).toEqual([[1]])
    expect(rows('(SELECT 1 UNION SELECT 2) INTERSECT SELECT 2')).toEqual([[2]])
  })

  it('los nombres de columna vienen de la consulta izquierda', () => {
    const t = trace('SELECT Producto AS a FROM Ventas UNION SELECT Marca FROM Productos')
    expect(t.result.table.columns.map((c) => c.name)).toEqual(['a'])
  })

  it('ORDER BY y LIMIT se aplican al resultado combinado', () => {
    expect(
      names('SELECT Producto FROM Ventas UNION SELECT Producto FROM Devoluciones ORDER BY Producto DESC LIMIT 2'),
    ).toEqual(['Sal', 'Queso'])
    expect(names('SELECT Marca FROM Productos UNION SELECT Producto FROM Ventas ORDER BY 1 LIMIT 1')).toEqual(['Aceite'])
  })

  it('un numero distinto de columnas es un error sobre el operador', () => {
    const sql = 'SELECT Producto FROM Ventas UNION SELECT Producto, Marca FROM Productos'
    const e = fail(sql)
    expect(e.message).toContain('mismo número de columnas')
    expect(spanText(sql, e)).toBe('UNION')
  })

  it('la traza marca los duplicados descartados', () => {
    const t = trace('SELECT Producto FROM Ventas UNION SELECT Producto FROM Devoluciones')
    const step = t.steps.find((s) => s.phase === 'setOp' && s.tables.length === 1)
    const tbl = step?.tables[0]
    expect(tbl?.rows).toHaveLength(15)
    expect(tbl?.rows.filter((r) => r.status === 'removed')).toHaveLength(9)
    expect(tbl?.rows.filter((r) => r.status === 'kept')).toHaveLength(6)
    expect(t.steps.some((s) => s.scope === 'Consulta izquierda de UNION')).toBe(true)
  })

  it('INTERSECT marca las filas con pareja', () => {
    const t = trace('SELECT Producto FROM Productos INTERSECT SELECT Producto FROM Ventas')
    const tbl = t.steps.find((s) => s.phase === 'setOp' && s.tables.length === 1)?.tables[0]
    expect(tbl?.rows.filter((r) => r.status === 'matched')).toHaveLength(5)
    expect(tbl?.rows.filter((r) => r.status === 'unmatched').map((r) => r.cells[0])).toEqual(['Cafe'])
  })
})

describe('CTE', () => {
  it('una CTE se usa como una tabla', () => {
    expect(
      rows(
        'WITH totales AS (SELECT Producto, SUM(Cantidad * Precio) AS Total FROM Ventas GROUP BY Producto) SELECT Producto FROM totales WHERE Total > 40 ORDER BY Total DESC',
      ),
    ).toEqual([['Aceite']])
  })

  it('una CTE puede usar las anteriores y se puede referir con alias', () => {
    expect(
      rows(
        'WITH a AS (SELECT Cantidad FROM Ventas WHERE Cantidad > 4), b AS (SELECT COUNT(*) AS n FROM a) SELECT b.n, x.Cantidad FROM b, a x LIMIT 1',
      ),
    ).toEqual([[5, 5]])
  })

  it('una CTE tapa a una tabla con el mismo nombre', () => {
    expect(rows('WITH Productos AS (SELECT 1 AS x) SELECT * FROM Productos')).toEqual([[1]])
  })

  it('una CTE no es visible fuera de su consulta', () => {
    expect(fail('SELECT * FROM (WITH c AS (SELECT 1 AS x) SELECT x FROM c) t, c').message).toContain('"c"')
  })

  it('la traza muestra cada CTE antes de la consulta principal', () => {
    const t = trace('WITH c AS (SELECT Producto FROM Ventas) SELECT * FROM c')
    expect(phases(t, 0).slice(0, 3)).toEqual(['from', 'cte', 'from'])
    expect(t.steps.filter((s) => s.phase === 'cte')).toHaveLength(2)
    expect(t.steps.find((s) => s.depth === 1)?.scope).toBe('CTE c')
  })

  it('demasiados pasos devuelven un error en lugar de colgarse', () => {
    const parts = Array.from({ length: 700 }, (_, i) => `c${i} AS (SELECT ${i} AS x)`)
    const e = fail(`WITH ${parts.join(', ')} SELECT * FROM c0`)
    expect(e.message).toContain('demasiados pasos')
  })
})

describe('reglas estrictas de ORDER BY y tipos', () => {
  it('SELECT DISTINCT exige que ORDER BY aparezca en la lista de selección', () => {
    const sql = 'SELECT DISTINCT Categoria FROM Ventas ORDER BY Ciudad'
    const e = fail(sql)
    expect(e.message).toContain('DISTINCT')
    expect(spanText(sql, e)).toBe('Ciudad')
    expect(rows('SELECT DISTINCT Categoria FROM Ventas ORDER BY Categoria').length).toBeGreaterThan(0)
    expect(rows('SELECT DISTINCT Categoria FROM Ventas ORDER BY 1').length).toBeGreaterThan(0)
  })

  it('tras UNION solo se ordena por nombre o posición de columna', () => {
    const sql = "SELECT Producto FROM Ventas UNION ALL SELECT Marca FROM Productos ORDER BY Producto || 'x'"
    const e = fail(sql)
    expect(e.message).toContain('UNION')
    expect(spanText(sql, e)).toBe("Producto || 'x'")
    expect(rows('SELECT Producto FROM Ventas UNION ALL SELECT Marca FROM Productos ORDER BY Producto').length).toBeGreaterThan(0)
    expect(rows('SELECT Producto FROM Ventas UNION ALL SELECT Marca FROM Productos ORDER BY 1').length).toBeGreaterThan(0)
  })

  it('UNION rechaza columnas de tipos incompatibles pero acepta NULL', () => {
    expect(fail("SELECT 1 UNION SELECT 'a'").message).toContain('tipos')
    expect(rows('SELECT 1 UNION SELECT NULL')).toHaveLength(2)
  })

  it('ORDER BY con un número no entero o fuera de rango es un error', () => {
    expect(fail('SELECT Producto FROM Ventas ORDER BY 1.5').message).toContain('entero')
    expect(fail('SELECT Producto FROM Ventas ORDER BY 3').message).toContain('no es válido')
  })
})
