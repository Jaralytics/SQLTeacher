import { describe, expect, it } from 'vitest'
import { fail, rows, trace } from './helpers'
import type { TraceStep } from './types'

// Datos de apoyo: Ventas tiene 10 filas y la venta 10 es de 'Sal', que no existe en Productos;
// Productos tiene 6 filas y 'Cafe' no tiene ventas.

const joinResult = (sql: string): TraceStep => {
  const steps = trace(sql).steps.filter((s) => s.phase === 'join' && s.tables.some((t) => t.id === 'work'))
  return steps[steps.length - 1]
}

describe('tipos de JOIN frente a las filas sin pareja', () => {
  it('INNER JOIN descarta las filas sin pareja de ambos lados', () => {
    const r = rows('SELECT v.IdVenta, p.Producto FROM Ventas v INNER JOIN Productos p ON v.Producto = p.Producto')
    expect(r).toHaveLength(9)
    expect(r.map((x) => x[0])).not.toContain(10)
    expect(r.map((x) => x[1])).not.toContain('Cafe')
  })

  it('JOIN sin tipo equivale a INNER JOIN', () => {
    expect(rows('SELECT v.IdVenta FROM Ventas v JOIN Productos p ON v.Producto = p.Producto')).toHaveLength(9)
  })

  it('LEFT JOIN conserva la venta sin producto y rellena con NULL', () => {
    const r = rows('SELECT v.IdVenta, p.Producto, p.Marca FROM Ventas v LEFT JOIN Productos p ON v.Producto = p.Producto')
    expect(r).toHaveLength(10)
    expect(r.find((x) => x[0] === 10)).toEqual([10, null, null])
  })

  it('LEFT JOIN desde Productos conserva el producto sin ventas', () => {
    const r = rows('SELECT p.Producto, v.IdVenta FROM Productos p LEFT OUTER JOIN Ventas v ON p.Producto = v.Producto')
    expect(r).toHaveLength(10)
    expect(r.filter((x) => x[1] === null)).toEqual([['Cafe', null]])
  })

  it('RIGHT JOIN conserva todo Productos y descarta la venta huerfana', () => {
    const r = rows('SELECT v.IdVenta, p.Producto FROM Ventas v RIGHT JOIN Productos p ON v.Producto = p.Producto')
    expect(r).toHaveLength(10)
    expect(r.filter((x) => x[0] === null)).toEqual([[null, 'Cafe']])
    expect(r.map((x) => x[0])).not.toContain(10)
  })

  it('FULL JOIN conserva las filas sin pareja de los dos lados', () => {
    const r = rows('SELECT v.IdVenta, p.Producto FROM Ventas v FULL OUTER JOIN Productos p ON v.Producto = p.Producto')
    expect(r).toHaveLength(11)
    expect(r).toContainEqual([10, null])
    expect(r).toContainEqual([null, 'Cafe'])
  })

  it('CROSS JOIN y la coma generan el producto cartesiano', () => {
    expect(rows('SELECT * FROM Productos CROSS JOIN Calendario')).toHaveLength(36)
    expect(rows('SELECT * FROM Productos p, Calendario c')).toHaveLength(36)
  })

  it('anti-join: LEFT JOIN con IS NULL encuentra los productos sin ventas', () => {
    expect(
      rows('SELECT p.Producto FROM Productos p LEFT JOIN Ventas v ON p.Producto = v.Producto WHERE v.IdVenta IS NULL'),
    ).toEqual([['Cafe']])
  })

  it('NULL nunca coincide en ON', () => {
    // Solo las ventas con FechaEntrega no nula se emparejan entre si (4 + 1 + 4 + 1 + 4 pares).
    expect(rows('SELECT 1 FROM Ventas a JOIN Ventas b ON a.FechaEntrega = b.FechaEntrega')).toHaveLength(14)
  })

  it('JOIN de varias tablas y ON con condiciones compuestas', () => {
    const r = rows(
      'SELECT v.IdVenta, p.Marca, c.NombreMes FROM Ventas v JOIN Productos p ON v.Producto = p.Producto JOIN Calendario c ON v.FechaVenta = c.Fecha AND c.Mes = 3',
    )
    expect(r).toEqual([[9, 'La Pradera', 'Marzo']])
  })

  it('una relacion uno a muchos repite la fila del lado uno', () => {
    const r = rows("SELECT d.IdDevolucion FROM Ventas v JOIN Devoluciones d ON v.Producto = d.Producto WHERE d.Producto = 'Aceite'")
    expect(r).toHaveLength(6)
  })

  it('un JOIN con un alias repetido de columna pide prefijo', () => {
    expect(fail('SELECT Producto FROM Ventas v JOIN Devoluciones d ON v.Producto = d.Producto').message).toContain('ambigua')
  })

  it('no se pueden usar agregados en ON', () => {
    expect(fail('SELECT 1 FROM Ventas v JOIN Productos p ON COUNT(*) > 1').message).toContain('ON')
  })
})

describe('trazas de JOIN', () => {
  it('el resultado marca parejas, filas sin pareja y las celdas rellenadas', () => {
    const step = joinResult('SELECT * FROM Ventas v FULL JOIN Productos p ON v.Producto = p.Producto')
    const t = step.tables[0]
    expect(t.rows).toHaveLength(11)
    expect(t.rows.filter((r) => r.status === 'matched')).toHaveLength(9)
    const un = t.rows.filter((r) => r.status === 'unmatched')
    expect(un).toHaveLength(2)
    const left = un.find((r) => r.cells[0] === 10)
    expect(left?.padded).toEqual([8, 9, 10])
    const right = un.find((r) => r.cells[0] === null)
    expect(right?.padded).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(right?.cells[8]).toBe('Cafe')
  })

  it('el paso previo muestra las dos tablas con sus filas emparejadas y sin pareja', () => {
    const tr = trace('SELECT * FROM Productos p LEFT JOIN Ventas v ON p.Producto = v.Producto')
    const step = tr.steps.find((s) => s.phase === 'join' && s.tables.length === 2)
    expect(step).toBeDefined()
    const [left, right] = step?.tables ?? []
    expect(left.rows.filter((r) => r.status === 'unmatched').map((r) => r.cells[0])).toEqual(['Cafe'])
    expect(right.rows.filter((r) => r.status === 'unmatched').map((r) => r.cells[0])).toEqual([10])
    expect(left.columns.some((c) => c.highlight)).toBe(true)
  })

  it('INNER JOIN marca como sin pareja las filas que se descartaran', () => {
    const tr = trace('SELECT * FROM Productos p JOIN Ventas v ON p.Producto = v.Producto')
    const step = tr.steps.find((s) => s.phase === 'join' && s.tables.length === 2)
    const note = step?.tables[0].rows.find((r) => r.status === 'unmatched')?.note
    expect(note).toContain('descarta')
  })
})
