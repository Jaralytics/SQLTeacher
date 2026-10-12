import { describe, expect, it } from 'vitest'
import { columns, fail, rows, spanText } from './helpers'

describe('SELECT sin FROM y expresiones', () => {
  it('calcula expresiones sobre una fila vacia', () => {
    expect(rows("SELECT 1 + 2 * 3 AS a, 'x' || 'y' AS b, 7 % 4 AS c, -(2 + 1) AS d")).toEqual([[7, 'xy', 3, -3]])
  })

  it('la division entre cero es un error con span', () => {
    const sql = 'SELECT 1 / 0'
    const e = fail(sql)
    expect(e.message).toContain('cero')
    expect(spanText(sql, e)).toBe('1 / 0')
  })

  it('CASE buscado y simple', () => {
    expect(rows("SELECT CASE WHEN 1 > 2 THEN 'a' WHEN 2 > 1 THEN 'b' ELSE 'c' END")).toEqual([['b']])
    expect(rows("SELECT CASE 2 WHEN 1 THEN 'uno' WHEN 2 THEN 'dos' END")).toEqual([['dos']])
    expect(rows("SELECT CASE WHEN 1 > 2 THEN 'a' END")).toEqual([[null]])
  })

  it('BETWEEN, LIKE e IN', () => {
    expect(rows('SELECT 5 BETWEEN 5 AND 6, 5 NOT BETWEEN 1 AND 4')).toEqual([[true, true]])
    expect(rows("SELECT 'Aceite' LIKE 'A%e', 'Aceite' LIKE 'A_eite', 'Aceite' LIKE 'a%', 'x' NOT LIKE 'y'")).toEqual([
      [true, true, false, true],
    ])
    expect(rows('SELECT 2 IN (1, 2, 3), 4 IN (1, 2, 3), 4 NOT IN (1, 2, 3)')).toEqual([[true, false, true]])
  })
})

describe('SELECT, WHERE y expansiones', () => {
  it('SELECT * y t.*', () => {
    expect(columns('SELECT * FROM Productos')).toEqual(['Producto', 'Marca', 'Proveedor'])
    expect(columns('SELECT p.*, v.IdVenta FROM Productos p JOIN Ventas v ON p.Producto = v.Producto')).toEqual([
      'Producto',
      'Marca',
      'Proveedor',
      'IdVenta',
    ])
  })

  it('WHERE conserva solo las filas verdaderas', () => {
    expect(rows("SELECT IdVenta FROM Ventas WHERE Ciudad = 'Cali' AND Cantidad >= 2")).toEqual([[3], [9], [10]])
    expect(rows("SELECT IdVenta FROM Ventas WHERE Ciudad = 'Cali' OR Cantidad = 1")).toEqual([[3], [5], [9], [10]])
    expect(rows('SELECT IdVenta FROM Ventas WHERE NOT Cantidad >= 3')).toEqual([[3], [5], [9]])
  })

  it('el texto distingue mayusculas', () => {
    expect(rows("SELECT IdVenta FROM Ventas WHERE Producto = 'aceite'")).toEqual([])
    expect(rows("SELECT IdVenta FROM Ventas WHERE LOWER(Producto) = 'sal'")).toEqual([[10]])
  })

  it('comparar fechas ISO', () => {
    expect(rows("SELECT IdVenta FROM Ventas WHERE FechaVenta >= '2026-03-01'")).toEqual([[9], [10]])
    expect(rows("SELECT IdVenta FROM Ventas WHERE FechaVenta > DATE '2026-02-15'")).toEqual([[9], [10]])
  })

  it('comparar numero con texto no numerico es un error', () => {
    expect(fail("SELECT 1 FROM Ventas WHERE Cantidad = 'abc'").message).toContain('comparar')
  })
})

describe('DISTINCT, ORDER BY, LIMIT', () => {
  it('DISTINCT compara filas completas', () => {
    expect(rows('SELECT DISTINCT Categoria FROM Ventas')).toEqual([['Despensa'], ['Lacteos'], ['Aseo']])
    expect(rows('SELECT DISTINCT Categoria, Ciudad FROM Ventas')).toHaveLength(7)
  })

  it('ORDER BY por columna, alias, posicion y expresion', () => {
    expect(rows('SELECT IdVenta FROM Ventas ORDER BY Precio DESC, IdVenta DESC LIMIT 3')).toEqual([[6], [3], [1]])
    expect(rows('SELECT IdVenta, Cantidad * Precio AS T FROM Ventas ORDER BY T DESC LIMIT 2')).toEqual([
      [6, 65],
      [1, 60],
    ])
    expect(rows('SELECT Producto, Cantidad FROM Ventas ORDER BY 2 DESC, 1 LIMIT 2')).toEqual([
      ['Sal', 6],
      ['Aceite', 5],
    ])
    expect(rows('SELECT IdVenta FROM Ventas ORDER BY Cantidad * Precio LIMIT 1')).toEqual([[9]])
  })

  it('ORDER BY puede usar columnas que no se muestran', () => {
    expect(rows('SELECT Producto FROM Ventas ORDER BY IdVenta DESC LIMIT 1')).toEqual([['Sal']])
  })

  it('ORDER BY con una posicion invalida es un error', () => {
    const sql = 'SELECT IdVenta FROM Ventas ORDER BY 3'
    expect(spanText(sql, fail(sql))).toBe('3')
  })

  it('NULL se ordena como el valor mayor y NULLS FIRST/LAST lo cambia', () => {
    const asc = rows('SELECT IdVenta FROM Ventas ORDER BY FechaEntrega, IdVenta').map((r) => r[0])
    expect(asc.slice(-2)).toEqual([3, 7])
    const desc = rows('SELECT IdVenta FROM Ventas ORDER BY FechaEntrega DESC, IdVenta').map((r) => r[0])
    expect(desc.slice(0, 2)).toEqual([3, 7])
    const first = rows('SELECT IdVenta FROM Ventas ORDER BY FechaEntrega NULLS FIRST, IdVenta').map((r) => r[0])
    expect(first.slice(0, 2)).toEqual([3, 7])
    const last = rows('SELECT IdVenta FROM Ventas ORDER BY FechaEntrega DESC NULLS LAST, IdVenta').map((r) => r[0])
    expect(last.slice(-2)).toEqual([3, 7])
  })

  it('LIMIT y OFFSET', () => {
    expect(rows('SELECT IdVenta FROM Ventas ORDER BY IdVenta LIMIT 2 OFFSET 3')).toEqual([[4], [5]])
    expect(rows('SELECT IdVenta FROM Ventas ORDER BY IdVenta OFFSET 8')).toEqual([[9], [10]])
    expect(rows('SELECT IdVenta FROM Ventas LIMIT 0')).toEqual([])
    expect(fail('SELECT IdVenta FROM Ventas LIMIT -1').message).toContain('LIMIT')
  })
})

describe('funciones escalares', () => {
  it('texto', () => {
    expect(
      rows(
        "SELECT UPPER('ab'), LOWER('AB'), LENGTH('hola'), TRIM('  x '), SUBSTRING('abcdef', 2, 3), SUBSTR('abcdef', 4), SUBSTRING('abcdef' FROM 2 FOR 2), CONCAT('a', NULL, 'b'), REPLACE('aXbX', 'X', '-')",
      ),
    ).toEqual([['AB', 'ab', 4, 'x', 'bcd', 'def', 'bc', 'ab', 'a-b-']])
  })

  it('numeros', () => {
    expect(rows('SELECT ROUND(2.5), ROUND(-2.5), ROUND(3.14159, 2), ABS(-4), FLOOR(2.7), CEIL(2.1)')).toEqual([
      [3, -3, 3.14, 4, 2, 3],
    ])
  })

  it('CAST y ::', () => {
    expect(
      rows("SELECT CAST('12' AS integer), CAST(2.5 AS integer), CAST(7 AS text), '5'::numeric + 1, CAST('2026-03-01' AS date)"),
    ).toEqual([[12, 3, '7', 6, '2026-03-01']])
    expect(fail("SELECT CAST('abc' AS integer)").message).toContain('entero')
    expect(fail("SELECT CAST('2026-13-45' AS date)").message).toContain('fecha')
    expect(fail('SELECT CAST(1 AS blob)').message).toContain('no soportado')
  })

  it('EXTRACT de fechas', () => {
    expect(
      rows(
        'SELECT EXTRACT(YEAR FROM FechaVenta), EXTRACT(MONTH FROM FechaVenta), EXTRACT(DAY FROM FechaVenta) FROM Ventas WHERE IdVenta = 5',
      ),
    ).toEqual([[2026, 2, 5]])
  })

  it('COALESCE es perezoso y NULLIF devuelve NULL al coincidir', () => {
    expect(rows('SELECT COALESCE(NULL, 2, 1 / 0), NULLIF(3, 3), NULLIF(3, 4)')).toEqual([[2, null, 3]])
  })

  it('aridad incorrecta', () => {
    expect(fail('SELECT UPPER()').message).toContain('UPPER')
  })
})
