import { describe, expect, it } from 'vitest'
import { fail, rows, spanText, trace } from './helpers'

describe('GROUP BY y agregados', () => {
  it('agrupa por una columna', () => {
    expect(rows('SELECT Ciudad, COUNT(*) AS n, SUM(Cantidad * Precio) AS total FROM Ventas GROUP BY Ciudad')).toEqual([
      ['Bogota', 4, 103],
      ['Medellin', 3, 86],
      ['Cali', 3, 42],
    ])
  })

  it('agrupa por varias columnas y por una expresion', () => {
    expect(rows('SELECT Categoria, Ciudad FROM Ventas GROUP BY Categoria, Ciudad')).toHaveLength(7)
    expect(
      rows('SELECT EXTRACT(MONTH FROM FechaVenta) AS mes, COUNT(*) FROM Ventas GROUP BY EXTRACT(MONTH FROM FechaVenta)'),
    ).toEqual([
      [1, 4],
      [2, 4],
      [3, 2],
    ])
  })

  it('GROUP BY admite posicion y alias del SELECT', () => {
    expect(rows('SELECT Ciudad, COUNT(*) FROM Ventas GROUP BY 1')).toHaveLength(3)
    expect(rows('SELECT Ciudad AS c, COUNT(*) FROM Ventas GROUP BY c')).toHaveLength(3)
  })

  it('un agregado sin GROUP BY forma un solo grupo', () => {
    expect(rows('SELECT COUNT(*), SUM(Cantidad), MIN(Precio), MAX(Precio) FROM Ventas')).toEqual([[10, 38, 2, 13]])
  })

  it('COUNT(DISTINCT) y expresiones dentro del agregado', () => {
    expect(rows('SELECT Categoria, COUNT(DISTINCT Producto) AS productos FROM Ventas GROUP BY Categoria')).toEqual([
      ['Despensa', 3],
      ['Lacteos', 2],
      ['Aseo', 1],
    ])
  })

  it('operar con agregados en SELECT', () => {
    expect(rows('SELECT Ciudad, SUM(Cantidad) * 2 AS doble FROM Ventas GROUP BY Ciudad ORDER BY doble DESC LIMIT 1')).toEqual([['Bogota', 38]])
  })

  it('ORDER BY puede usar un agregado que no esta en el SELECT', () => {
    expect(rows('SELECT Ciudad FROM Ventas GROUP BY Ciudad ORDER BY COUNT(*) DESC, Ciudad')).toEqual([['Bogota'], ['Cali'], ['Medellin']])
  })

  it('HAVING filtra grupos con agregados', () => {
    expect(rows('SELECT Producto FROM Ventas GROUP BY Producto HAVING SUM(Cantidad) >= 6')).toEqual([
      ['Aceite'],
      ['Arroz'],
      ['Leche'],
      ['Sal'],
    ])
  })

  it('WHERE filtra filas antes de agrupar y HAVING grupos despues', () => {
    expect(
      rows('SELECT Producto, COUNT(*) FROM Ventas WHERE Cantidad >= 3 GROUP BY Producto HAVING COUNT(*) > 1'),
    ).toEqual([
      ['Aceite', 2],
      ['Arroz', 2],
    ])
  })

  it('HAVING sin GROUP BY trabaja sobre el grupo unico', () => {
    expect(rows('SELECT COUNT(*) FROM Ventas HAVING COUNT(*) > 100')).toEqual([])
    expect(rows('SELECT COUNT(*) FROM Ventas HAVING COUNT(*) > 5')).toEqual([[10]])
  })
})

describe('errores de agrupacion', () => {
  it('una columna sin agrupar ni agregar tiene un mensaje claro y su span', () => {
    const sql = 'SELECT Ciudad, Producto, COUNT(*) FROM Ventas GROUP BY Ciudad'
    const e = fail(sql)
    expect(e.message).toContain('GROUP BY')
    expect(e.message).toContain('"Producto"')
    expect(spanText(sql, e)).toBe('Producto')
  })

  it('mezclar columnas y agregados sin GROUP BY', () => {
    const sql = 'SELECT Ciudad, COUNT(*) FROM Ventas'
    const e = fail(sql)
    expect(e.message).toContain('Como no hay GROUP BY')
    expect(spanText(sql, e)).toBe('Ciudad')
  })

  it('HAVING no puede usar columnas sin agrupar', () => {
    const sql = 'SELECT Ciudad FROM Ventas GROUP BY Ciudad HAVING Cantidad > 2'
    expect(spanText(sql, fail(sql))).toBe('Cantidad')
  })

  it('SELECT * no se puede usar con GROUP BY', () => {
    expect(fail('SELECT * FROM Ventas GROUP BY Ciudad').message).toContain('*')
  })

  it('no se permiten agregados en WHERE y la sugerencia es HAVING', () => {
    const sql = 'SELECT Ciudad FROM Ventas WHERE COUNT(*) > 1 GROUP BY Ciudad'
    const e = fail(sql)
    expect(e.message).toContain('HAVING')
    expect(spanText(sql, e)).toBe('COUNT(*)')
  })

  it('no se permiten agregados dentro de agregados ni en GROUP BY', () => {
    expect(fail('SELECT SUM(COUNT(*)) FROM Ventas').message).toContain('anidar')
    expect(fail('SELECT 1 FROM Ventas GROUP BY COUNT(*)').message).toContain('GROUP BY')
  })

  it('HAVING sin GROUP BY no admite columnas sueltas', () => {
    expect(fail('SELECT Ciudad FROM Ventas HAVING Ciudad = 1').message).toContain('GROUP BY')
  })

  it('SUM de texto es un error', () => {
    expect(fail('SELECT SUM(Producto) FROM Ventas').message).toContain('SUM')
  })

  it('SUM(*) no es valido', () => {
    expect(fail('SELECT SUM(*) FROM Ventas').message).toContain('COUNT')
  })
})

describe('trazas de agrupacion', () => {
  const sql = 'SELECT Ciudad, COUNT(*) AS n FROM Ventas GROUP BY Ciudad HAVING COUNT(*) > 3'

  it('GROUP BY numera los grupos y reordena las filas', () => {
    const step = trace(sql).steps.find((s) => s.phase === 'groupBy')
    const t = step?.tables[0]
    expect(t?.rows).toHaveLength(10)
    expect(new Set(t?.rows.map((r) => r.group))).toEqual(new Set([0, 1, 2]))
    const groups = t?.rows.map((r) => r.group) ?? []
    expect(groups).toEqual([...groups].sort())
    expect(t?.columns.filter((c) => c.highlight).map((c) => c.name)).toEqual(['Ciudad'])
  })

  it('el paso de agregados muestra una fila por grupo con columnas nuevas', () => {
    const step = trace(sql).steps.find((s) => s.phase === 'aggregate')
    const t = step?.tables[0]
    expect(t?.rows.map((r) => r.cells)).toEqual([
      ['Bogota', 4],
      ['Medellin', 3],
      ['Cali', 3],
    ])
    expect(t?.columns.map((c) => !!c.isNew)).toEqual([false, true])
  })

  it('HAVING marca los grupos conservados y descartados', () => {
    const step = trace(sql).steps.find((s) => s.phase === 'having')
    expect(step?.tables[0].rows.map((r) => r.status)).toEqual(['kept', 'removed', 'removed'])
  })
})
