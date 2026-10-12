import { describe, expect, it } from 'vitest'
import { exec, fail, phases, rows, spanText, trace } from './helpers'

describe('subconsultas', () => {
  it('escalar en WHERE', () => {
    expect(rows('SELECT IdVenta FROM Ventas WHERE Precio > (SELECT AVG(Precio) FROM Ventas)')).toEqual([[1], [3], [5], [6]])
  })

  it('escalar en la lista del SELECT', () => {
    expect(
      rows('SELECT Producto, (SELECT COUNT(*) FROM Devoluciones d WHERE d.Producto = p.Producto) AS n FROM Productos p'),
    ).toEqual([
      ['Aceite', 2],
      ['Arroz', 1],
      ['Leche', 1],
      ['Queso', 0],
      ['Jabon', 1],
      ['Cafe', 0],
    ])
  })

  it('una subconsulta escalar sin filas da NULL', () => {
    expect(rows("SELECT (SELECT Marca FROM Productos WHERE Producto = 'Nada')")).toEqual([[null]])
  })

  it('una subconsulta escalar con varias filas o columnas es un error', () => {
    const sql = 'SELECT IdVenta FROM Ventas WHERE Precio = (SELECT Precio FROM Ventas)'
    const e = fail(sql)
    expect(e.message).toContain('10 filas')
    expect(spanText(sql, e)).toBe('SELECT Precio FROM Ventas')
    expect(fail('SELECT (SELECT Precio, Cantidad FROM Ventas LIMIT 1)').message).toContain('una sola columna')
  })

  it('IN y NOT IN con subconsulta', () => {
    expect(rows('SELECT IdVenta FROM Ventas WHERE Producto IN (SELECT Producto FROM Devoluciones)')).toHaveLength(8)
    expect(
      rows('SELECT IdVenta FROM Ventas WHERE Producto NOT IN (SELECT Producto FROM Devoluciones)'),
    ).toEqual([[5], [10]])
    expect(fail('SELECT 1 WHERE 1 IN (SELECT 1, 2)').message).toContain('una sola columna')
  })

  it('EXISTS y NOT EXISTS correlacionados', () => {
    expect(
      rows('SELECT p.Producto FROM Productos p WHERE EXISTS (SELECT 1 FROM Ventas v WHERE v.Producto = p.Producto)'),
    ).toHaveLength(5)
    expect(
      rows('SELECT p.Producto FROM Productos p WHERE NOT EXISTS (SELECT 1 FROM Ventas v WHERE v.Producto = p.Producto)'),
    ).toEqual([['Cafe']])
  })

  it('subconsulta correlacionada con agregado', () => {
    expect(
      rows(
        'SELECT v.IdVenta FROM Ventas v WHERE v.Precio > (SELECT AVG(v2.Precio) FROM Ventas v2 WHERE v2.Producto = v.Producto)',
      ),
    ).toEqual([[6]])
  })

  it('tabla derivada con alias', () => {
    expect(rows('SELECT x.T FROM (SELECT Cantidad * Precio AS T FROM Ventas) x WHERE x.T > 60')).toEqual([[65]])
    expect(rows('SELECT T FROM (SELECT Cantidad * Precio AS T FROM Ventas) AS x WHERE T < 10')).toEqual([[9], [8], [6]])
  })

  it('subconsulta dentro de otra subconsulta', () => {
    expect(
      rows(
        'SELECT Producto FROM Productos WHERE Producto IN (SELECT Producto FROM Ventas WHERE Precio > (SELECT AVG(Precio) FROM Ventas))',
      ),
    ).toEqual([['Aceite'], ['Queso']])
  })

  it('una columna de la consulta externa no se ve desde una tabla derivada', () => {
    expect(fail('SELECT * FROM Productos p WHERE EXISTS (SELECT 1 FROM (SELECT p.Producto FROM Ventas) t)').message).toContain('"p"')
  })
})

describe('trazas de subconsultas', () => {
  const sql = 'SELECT v.IdVenta FROM Ventas v WHERE v.Precio > (SELECT AVG(v2.Precio) FROM Ventas v2 WHERE v2.Producto = v.Producto)'

  it('la subconsulta correlacionada se detalla una vez y se resume el resto', () => {
    const t = trace(sql)
    const inner = t.steps.filter((s) => s.depth === 1)
    expect(inner.length).toBeGreaterThan(0)
    expect(new Set(inner.map((s) => s.scope))).toEqual(new Set(['Subconsulta 1']))
    expect(t.steps.filter((s) => s.title.includes('primera evaluación'))).toHaveLength(1)
    const where = t.steps.find((s) => s.phase === 'where' && s.depth === 0)
    expect(where?.explanation).toContain('se evaluó 10 veces')
    expect(where?.explanation).toContain('correlacionada')
  })

  it('el detalle de la subconsulta muestra la fila externa actual', () => {
    const t = trace(sql)
    const step = t.steps.find((s) => s.depth === 1 && s.phase === 'where')
    const ctx = step?.tables.find((x) => x.id.startsWith('ctx:'))
    expect(ctx?.rows.filter((r) => r.status === 'active')).toHaveLength(1)
    expect(ctx?.rows[0].status).toBe('active')
  })

  it('el paso de resultado de la subconsulta devuelve el valor escalar', () => {
    const t = trace('SELECT IdVenta FROM Ventas WHERE Precio > (SELECT AVG(Precio) FROM Ventas)')
    const step = t.steps.find((s) => s.kind === 'scalar-result')
    expect(step?.scalar).toEqual({ label: 'Valor', value: 6.4 })
    expect(step?.explanation).toContain('una sola vez')
  })

  it('una subconsulta independiente se calcula una sola vez', () => {
    const t = trace('SELECT IdVenta FROM Ventas WHERE Precio > (SELECT AVG(Precio) FROM Ventas)')
    expect(t.steps.filter((s) => s.title.includes('primera evaluación'))).toHaveLength(1)
    const where = t.steps.find((s) => s.phase === 'where' && s.depth === 0)
    expect(where?.explanation).toContain('se calculó una sola vez')
  })

  it('las tablas derivadas se ejecutan en un nivel interior', () => {
    const t = trace('SELECT * FROM (SELECT Producto FROM Ventas) x')
    expect(phases(t, 1)).toEqual(['from', 'select'])
    expect(t.steps.find((s) => s.phase === 'subquery' && s.depth === 0)?.title).toContain('x')
  })

  it('las pruebas de trazas no cambian el resultado', () => {
    const r = exec(sql)
    expect(r.ok && r.trace.result.table.rows.map((x) => x.cells)).toEqual([[6]])
  })
})
