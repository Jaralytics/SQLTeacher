import { describe, expect, it } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser'
import { columns, fail, rows, spanText } from './helpers'

describe('lexer', () => {
  it('reconoce cadenas con comilla escapada, identificadores entre comillas dobles y comentarios', () => {
    const toks = lex(`SELECT 'it''s', "Mi Col" -- uno\n/* dos */ , 1.5e1 <> != ::`)
    expect(toks.map((t) => [t.kind, t.text])).toEqual([
      ['ident', 'SELECT'],
      ['str', "it's"],
      ['punct', ','],
      ['qident', 'Mi Col'],
      ['punct', ','],
      ['num', '1.5e1'],
      ['op', '<>'],
      ['op', '<>'],
      ['op', '::'],
      ['eof', ''],
    ])
  })

  it('una cadena sin cerrar apunta desde la comilla hasta el final', () => {
    const sql = "SELECT 'abc FROM Ventas"
    const e = fail(sql)
    expect(e.message).toContain('Falta cerrar')
    expect(e.span).toEqual({ start: 7, end: sql.length })
  })

  it('un comentario de bloque sin cerrar es un error con span', () => {
    const e = fail('SELECT 1 /* nunca termina')
    expect(e.message).toContain('comentario')
    expect(e.span?.start).toBe(9)
  })

  it('un caracter desconocido apunta solo a ese caracter', () => {
    const sql = 'SELECT 1 # 2'
    const e = fail(sql)
    expect(spanText(sql, e)).toBe('#')
  })
})

describe('parser', () => {
  it('ignora mayusculas, comentarios y el punto y coma final', () => {
    expect(rows('select "Producto" /* c */ from ventas -- fin\nwhere idventa = 1;')).toEqual([['Aceite']])
  })

  it('acepta alias con y sin AS en columnas y tablas', () => {
    expect(columns('SELECT v.IdVenta id, Cantidad AS c FROM Ventas v')).toEqual(['id', 'c'])
  })

  it('el arbol conserva spans de las clausulas', () => {
    const sql = 'SELECT Producto FROM Ventas WHERE Cantidad > 2 ORDER BY Producto LIMIT 3'
    const q = parse(sql)
    const core = q.body
    expect(core.t).toBe('select')
    if (core.t !== 'select') return
    expect(sql.slice(core.whereSpan?.start, core.whereSpan?.end)).toBe('WHERE Cantidad > 2')
    expect(sql.slice(core.fromSpan?.start, core.fromSpan?.end)).toBe('FROM Ventas')
    expect(sql.slice(q.orderSpan?.start, q.orderSpan?.end)).toBe('ORDER BY Producto')
    expect(sql.slice(q.limitSpan?.start, q.limitSpan?.end)).toBe('LIMIT 3')
  })

  it('una consulta vacia no tiene span', () => {
    const e = fail('   -- nada\n')
    expect(e.message).toContain('vacía')
    expect(e.span).toBeNull()
  })

  it('falta una expresion: el span cubre la palabra que sobra', () => {
    const sql = 'SELECT FROM Ventas'
    const e = fail(sql)
    expect(e.message).toContain('expresión')
    expect(spanText(sql, e)).toBe('FROM')
  })

  it('al final de la consulta el span apunta al ultimo token', () => {
    const sql = 'SELECT * FROM Ventas WHERE'
    const e = fail(sql)
    expect(e.message).toContain('final de la consulta')
    expect(spanText(sql, e)).toBe('WHERE')
  })

  it('un parentesis sin cerrar se reporta', () => {
    const sql = 'SELECT (1 + 2 FROM Ventas'
    const e = fail(sql)
    expect(e.message).toContain('")"')
    expect(spanText(sql, e)).toBe('FROM')
  })

  it('JOIN sin ON pide la condicion', () => {
    const sql = 'SELECT * FROM Ventas v JOIN Productos p WHERE 1 = 1'
    const e = fail(sql)
    expect(e.message).toContain('ON')
    expect(spanText(sql, e)).toBe('WHERE')
  })

  it('una tabla derivada necesita alias', () => {
    const e = fail('SELECT * FROM (SELECT 1)')
    expect(e.message).toContain('alias')
  })

  it('solo se admite una sentencia', () => {
    const sql = 'SELECT 1; SELECT 2'
    const e = fail(sql)
    expect(e.message).toContain('una sentencia')
    expect(spanText(sql, e)).toBe('SELECT')
  })

  it('no se aceptan palabras que no inician una consulta', () => {
    const e = fail('SELEC 1')
    expect(e.message).toContain('debe empezar con SELECT')
    expect(e.span).toEqual({ start: 0, end: 5 })
  })

  it.each([
    ['INSERT INTO Ventas VALUES (1)', 'INSERT'],
    ['UPDATE Ventas SET Cantidad = 1', 'UPDATE'],
    ['DELETE FROM Ventas', 'DELETE'],
    ['DROP TABLE Ventas', 'DROP'],
    ['CREATE TABLE x (a int)', 'CREATE'],
    ['ALTER TABLE Ventas ADD c int', 'ALTER'],
    ['TRUNCATE Ventas', 'TRUNCATE'],
  ])('rechaza %s con un mensaje amable', (sql, kw) => {
    const e = fail(sql)
    expect(e.message).toContain('solo ejecuta consultas')
    expect(spanText(sql, e)).toBe(kw)
  })

  it('tambien rechaza DDL despues de una consulta', () => {
    const sql = 'SELECT 1; DROP TABLE Ventas'
    const e = fail(sql)
    expect(e.message).toContain('solo ejecuta consultas')
    expect(spanText(sql, e)).toBe('DROP')
  })

  it('rechaza construcciones no soportadas con un mensaje claro', () => {
    expect(fail('WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r').message).toContain('RECURSIVE')
    expect(fail('SELECT SUM(Cantidad) OVER (ORDER BY IdVenta ROWS 2 PRECEDING) FROM Ventas').message).toContain('marco')
    expect(fail('SELECT * FROM Ventas JOIN Productos USING (Producto)').message).toContain('USING')
  })
})

describe('resolucion de nombres', () => {
  it('tabla inexistente: lista las disponibles', () => {
    const sql = 'SELECT * FROM Clientes'
    const e = fail(sql)
    expect(e.message).toContain('Ventas')
    expect(spanText(sql, e)).toBe('Clientes')
  })

  it('columna inexistente: el span es la columna', () => {
    const sql = 'SELECT Foo FROM Ventas'
    const e = fail(sql)
    expect(e.message).toContain('"Foo"')
    expect(spanText(sql, e)).toBe('Foo')
  })

  it('columna ambigua entre dos tablas', () => {
    const sql = 'SELECT Producto FROM Ventas v JOIN Productos p ON v.Producto = p.Producto'
    const e = fail(sql)
    expect(e.message).toContain('ambigua')
    expect(spanText(sql, e)).toBe('Producto')
  })

  it('alias de tabla desconocido', () => {
    expect(fail('SELECT x.IdVenta FROM Ventas v').message).toContain('"x"')
  })

  it('un alias del SELECT no existe todavia en WHERE', () => {
    const sql = 'SELECT Cantidad * Precio AS Total FROM Ventas WHERE Total > 10'
    const e = fail(sql)
    expect(e.message).toContain('alias')
    expect(e.message).toContain('antes que SELECT')
    expect(spanText(sql, e)).toBe('Total')
  })

  it('funcion desconocida', () => {
    const sql = 'SELECT FOO(1) FROM Ventas'
    const e = fail(sql)
    expect(e.message).toContain('"FOO"')
    expect(spanText(sql, e)).toBe('FOO')
  })
})

describe('sintaxis no soportada y literales', () => {
  it('un número seguido de letras es un error', () => {
    expect(fail('SELECT 1abc').message).toContain('número')
    expect(fail('SELECT 1e').message).toContain('número')
    expect(rows('SELECT 1e3, 1.5, 2 AS a')).toEqual([[1000, 1.5, 2]])
  })

  it('LIKE respeta la barra invertida como escape', () => {
    expect(rows("SELECT 'a%' LIKE 'a\\%', 'a_c' LIKE 'a\\_c', 'abc' LIKE 'a\\%'")).toEqual([[true, true, false]])
  })

  it('ILIKE, IS TRUE, IS DISTINCT FROM y ANY indican que no están soportados', () => {
    const cases: [string, string, string][] = [
      ['SELECT Producto FROM Ventas WHERE Producto ILIKE \'a%\'', 'ILIKE', 'ILIKE'],
      ['SELECT 1 WHERE (1 = 1) IS TRUE', 'IS TRUE', 'IS TRUE'],
      ['SELECT 1 WHERE 1 IS NOT DISTINCT FROM 1', 'DISTINCT FROM', 'IS NOT DISTINCT'],
      ['SELECT 1 WHERE 1 = ANY (SELECT 1)', 'ANY', '= ANY'],
    ]
    for (const [sql, msg, text] of cases) {
      const e = fail(sql)
      expect(e.message).toContain(msg)
      expect(e.message).toContain('no está soportado')
      expect(spanText(sql, e)).toBe(text)
    }
  })

  it('LIMIT NULL no limita y HAVING sin GROUP BY trata todo como un grupo', () => {
    expect(rows('SELECT Producto FROM Ventas LIMIT NULL')).toHaveLength(10)
    expect(rows('SELECT 1 FROM Ventas HAVING 1 = 1')).toEqual([[1]])
    expect(rows('SELECT 1 FROM Ventas HAVING 1 = 2')).toEqual([])
  })
})
