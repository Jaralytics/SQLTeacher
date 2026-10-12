import { describe, expect, it } from 'vitest'
import { fail, rows, spanText, trace } from './helpers'

describe('logica de tres valores', () => {
  it('comparar con NULL da NULL', () => {
    expect(rows('SELECT NULL = NULL, 1 = NULL, NULL <> 1, NULL < 1')).toEqual([[null, null, null, null]])
  })

  it('IS NULL e IS NOT NULL siempre dan VERDADERO o FALSO', () => {
    expect(rows('SELECT NULL IS NULL, 1 IS NULL, NULL IS NOT NULL, 1 IS NOT NULL')).toEqual([[true, false, false, true]])
  })

  it('AND, OR y NOT con NULL', () => {
    expect(rows('SELECT NULL AND (1 = 2), NULL AND (1 = 1), NULL OR (1 = 1), NULL OR (1 = 2), NOT NULL')).toEqual([
      [false, null, true, null, null],
    ])
  })

  it('la aritmetica y || propagan NULL', () => {
    expect(rows("SELECT 1 + NULL, NULL * 2, 'a' || NULL, -NULL, UPPER(NULL)")).toEqual([[null, null, null, null, null]])
  })

  it('WHERE descarta las filas con resultado NULL', () => {
    expect(rows("SELECT IdVenta FROM Ventas WHERE FechaEntrega <> '2026-01-20'").map((r) => r[0])).toEqual([2, 5, 6, 8, 9, 10])
    expect(rows('SELECT IdVenta FROM Ventas WHERE FechaEntrega = NULL')).toEqual([])
    expect(rows('SELECT IdVenta FROM Ventas WHERE FechaEntrega IS NULL')).toEqual([[3], [7]])
  })

  it('la traza de WHERE anota NULL en las filas desconocidas', () => {
    const t = trace("SELECT IdVenta FROM Ventas WHERE FechaEntrega <> '2026-01-20'")
    const step = t.steps.find((s) => s.phase === 'where')
    const row3 = step?.tables[0].rows.find((r) => r.cells[0] === 3)
    expect(row3?.status).toBe('removed')
    expect(row3?.note).toBe('NULL')
    expect(step?.explanation).toContain('NULL')
  })

  it('IN y NOT IN con NULL en la lista', () => {
    expect(rows('SELECT 1 IN (1, NULL), 2 IN (1, NULL), 2 NOT IN (1, NULL), 3 NOT IN (1, 2), NULL IN (1, 2)')).toEqual([
      [true, null, null, true, null],
    ])
  })

  it('NOT IN con una subconsulta que devuelve NULL no devuelve filas', () => {
    expect(
      rows(
        'SELECT IdVenta FROM Ventas WHERE FechaEntrega NOT IN (SELECT FechaEntrega FROM Ventas WHERE IdVenta IN (1, 3))',
      ),
    ).toEqual([])
  })

  it('BETWEEN y LIKE con NULL', () => {
    expect(rows("SELECT NULL BETWEEN 1 AND 2, 1 BETWEEN NULL AND 2, 3 BETWEEN NULL AND 2, NULL LIKE 'a'")).toEqual([
      [null, null, false, null],
    ])
  })

  it('CASE trata NULL como no verdadero', () => {
    expect(rows("SELECT CASE WHEN NULL THEN 'si' ELSE 'no' END")).toEqual([['no']])
  })

  it('COALESCE y NULLIF', () => {
    expect(rows('SELECT IdVenta, COALESCE(FechaEntrega, FechaVenta) FROM Ventas WHERE IdVenta = 3')).toEqual([[3, '2026-01-20']])
  })

  it('una condicion que no es logica es un error', () => {
    const sql = 'SELECT 1 FROM Ventas WHERE Cantidad'
    expect(fail(sql).message).toContain('condición')
    expect(spanText(sql, fail(sql))).toBe('Cantidad')
  })
})

describe('agregados y NULL', () => {
  it('COUNT(*) cuenta filas y COUNT(x) ignora NULL', () => {
    expect(rows('SELECT COUNT(*), COUNT(FechaEntrega), COUNT(DISTINCT FechaEntrega), COUNT(DISTINCT Ciudad) FROM Ventas')).toEqual([
      [10, 8, 5, 3],
    ])
  })

  it('SUM, AVG, MIN y MAX ignoran NULL', () => {
    expect(rows('SELECT SUM(Cantidad), AVG(Precio), MIN(FechaEntrega), MAX(FechaEntrega) FROM Ventas')).toEqual([
      [38, 6.4, '2026-01-20', '2026-03-12'],
    ])
  })

  it('sobre un conjunto vacio COUNT da 0 y los demas NULL', () => {
    expect(rows('SELECT COUNT(*), COUNT(Cantidad), SUM(Cantidad), AVG(Cantidad), MAX(Cantidad) FROM Ventas WHERE 1 = 0')).toEqual([
      [0, 0, null, null, null],
    ])
  })

  it('AVG divide entre los valores no nulos', () => {
    expect(rows('SELECT AVG(CASE WHEN FechaEntrega IS NULL THEN NULL ELSE Cantidad END) FROM Ventas')).toEqual([[4]])
  })

  it('los NULL forman un grupo propio en GROUP BY', () => {
    const r = rows('SELECT Proveedor, COUNT(*) FROM Productos GROUP BY Proveedor')
    expect(r).toContainEqual([null, 1])
    expect(r).toHaveLength(4)
  })

  it('DISTINCT trata dos NULL como iguales', () => {
    expect(rows('SELECT DISTINCT FechaEntrega FROM Ventas WHERE FechaEntrega IS NULL')).toEqual([[null]])
  })
})
