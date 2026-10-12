import { describe, expect, it } from 'vitest'
import { fail, phases, rows, spanText, trace } from './helpers'

describe('funciones de ventana', () => {
  it('ROW_NUMBER reinicia en cada particion', () => {
    expect(
      rows(
        'SELECT IdVenta, ROW_NUMBER() OVER (PARTITION BY Ciudad ORDER BY IdVenta) AS n FROM Ventas ORDER BY IdVenta',
      ),
    ).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [6, 3],
      [7, 3],
      [8, 4],
      [9, 2],
      [10, 3],
    ])
  })

  it('RANK deja huecos y DENSE_RANK no', () => {
    const r = rows(
      'SELECT IdVenta, RANK() OVER (ORDER BY Precio DESC) AS r, DENSE_RANK() OVER (ORDER BY Precio DESC) AS d FROM Ventas ORDER BY IdVenta',
    )
    const byId = Object.fromEntries(r.map((x) => [x[0] as number, [x[1], x[2]]]))
    expect(byId[6]).toEqual([1, 1])
    expect(byId[1]).toEqual([2, 2])
    expect(byId[3]).toEqual([2, 2])
    expect(byId[5]).toEqual([4, 3])
    expect(byId[2]).toEqual([5, 4])
    expect(byId[10]).toEqual([9, 6])
  })

  it('SUM con ORDER BY es acumulado e incluye los empates', () => {
    const r = rows('SELECT IdVenta, SUM(Cantidad) OVER (ORDER BY FechaVenta) AS acum FROM Ventas ORDER BY IdVenta')
    expect(r.map((x) => x[1])).toEqual([8, 8, 15, 15, 21, 21, 30, 30, 32, 38])
  })

  it('un agregado sin ORDER BY cubre toda la particion', () => {
    const r = rows('SELECT DISTINCT Ciudad, SUM(Cantidad) OVER (PARTITION BY Ciudad) AS t FROM Ventas ORDER BY Ciudad')
    expect(r).toEqual([
      ['Bogota', 19],
      ['Cali', 10],
      ['Medellin', 9],
    ])
    expect(rows('SELECT COUNT(*) OVER () FROM Ventas LIMIT 1')).toEqual([[10]])
  })

  it('AVG, MIN y MAX como ventana', () => {
    const r = rows(
      "SELECT AVG(Precio) OVER (PARTITION BY Producto), MIN(Precio) OVER (PARTITION BY Producto), MAX(Precio) OVER (PARTITION BY Producto) FROM Ventas WHERE Producto = 'Aceite' LIMIT 1",
    )
    expect(r[0][1]).toBe(12)
    expect(r[0][2]).toBe(13)
    expect(r[0][0]).toBeCloseTo(12.3333, 3)
  })

  it('LAG y LEAD con desplazamiento y valor por defecto', () => {
    const r = rows(
      "SELECT IdVenta, LAG(Precio) OVER (ORDER BY IdVenta), LEAD(Precio, 2, -1) OVER (ORDER BY IdVenta) FROM Ventas WHERE Producto IN ('Aceite', 'Arroz') ORDER BY IdVenta",
    )
    expect(r).toEqual([
      [1, null, 12],
      [2, 12, 13],
      [3, 4, 4],
      [6, 12, -1],
      [8, 13, -1],
    ])
  })

  it('una expresion puede combinar una ventana con otros valores', () => {
    const r = rows('SELECT IdVenta, Cantidad - AVG(Cantidad) OVER () AS dif FROM Ventas WHERE IdVenta <= 2 ORDER BY IdVenta')
    expect(r).toEqual([
      [1, 1],
      [2, -1],
    ])
  })

  it('una ventana puede ordenar por un agregado en una consulta agrupada', () => {
    expect(
      rows('SELECT Ciudad, SUM(Cantidad) AS t, RANK() OVER (ORDER BY SUM(Cantidad) DESC) AS r FROM Ventas GROUP BY Ciudad ORDER BY r'),
    ).toEqual([
      ['Bogota', 19, 1],
      ['Cali', 10, 2],
      ['Medellin', 9, 3],
    ])
  })

  it('las ventanas no se pueden usar en WHERE', () => {
    const sql = 'SELECT IdVenta FROM Ventas WHERE ROW_NUMBER() OVER (ORDER BY IdVenta) = 1'
    const e = fail(sql)
    expect(e.message).toContain('WHERE')
    expect(spanText(sql, e)).toBe('ROW_NUMBER() OVER (ORDER BY IdVenta)')
  })

  it('una funcion de ventana necesita OVER', () => {
    expect(fail('SELECT ROW_NUMBER() FROM Ventas').message).toContain('OVER')
    expect(fail('SELECT UPPER(Producto) OVER (ORDER BY IdVenta) FROM Ventas').message).toContain('OVER')
  })

  it('la traza agrega la ventana despues del SELECT y numera las particiones', () => {
    const t = trace('SELECT IdVenta, Ciudad, ROW_NUMBER() OVER (PARTITION BY Ciudad ORDER BY IdVenta) AS n FROM Ventas')
    expect(phases(t)).toEqual(['from', 'select', 'window', 'result'])
    const win = t.steps.filter((s) => s.phase === 'window')
    expect(win).toHaveLength(2)
    const first = win[0].tables[0]
    expect(new Set(first.rows.map((r) => r.group))).toEqual(new Set([0, 1, 2]))
    expect(first.columns[first.columns.length - 1].isNew).toBe(true)
    const select = t.steps.find((s) => s.phase === 'select')
    expect(select?.tables[0].columns.map((c) => c.name)).toEqual(['IdVenta', 'Ciudad'])
    expect(win[1].tables[0].columns).toHaveLength(3)
  })
})
