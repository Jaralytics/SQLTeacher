import { describe, expect, it } from 'vitest'
import { functionCatalog } from '../data/functions'
import { sampleModel } from '../data/sampleModel'
import { run } from '../engine'
import {
  applySuggestion,
  findAliases,
  getCompletionContext,
  getSignatureContext,
  getSuggestions,
  signatureParts,
} from './autocomplete'

const tables = sampleModel.tables

function suggest(text: string, caret = text.length, explicit = false) {
  const ctx = getCompletionContext(text, caret, explicit)
  return ctx ? { ctx, list: getSuggestions(ctx, functionCatalog, tables) } : null
}

describe('catalogo', () => {
  it('todos los ejemplos se ejecutan sin error', () => {
    for (const f of functionCatalog) {
      const r = run(f.example, sampleModel)
      expect(r.ok, `${f.name}: ${f.example} -> ${r.ok ? '' : r.error.message}`).toBe(true)
    }
  })

  it('las funciones llaman con parentesis y las cláusulas no', () => {
    const select = functionCatalog.find((f) => f.name === 'SELECT')!
    const sum = functionCatalog.find((f) => f.name === 'SUM')!
    expect(select.snippet.endsWith('(')).toBe(false)
    expect(sum.snippet).toBe('SUM(')
  })
})

describe('autocompletado', () => {
  it('sugiere palabras clave y funciones al escribir un prefijo', () => {
    const r = suggest('sel')
    expect(r?.ctx.mode).toBe('word')
    expect(r?.list[0]).toMatchObject({ label: 'SELECT', kind: 'palabra', insert: 'SELECT ' })
    const sum = suggest('su')?.list.find((s) => s.label === 'SUM')
    expect(sum).toMatchObject({ kind: 'función', insert: 'SUM(' })
  })

  it('ordena prefijos antes que subcadenas, sin distinguir mayusculas', () => {
    const labels = suggest('cou')?.list.map((s) => s.label) ?? []
    expect(labels[0]).toBe('COUNT')
    expect(suggest('ount')?.list.map((s) => s.label)).toContain('COUNT')
  })

  it('encuentra una entrada agrupada por cualquiera de sus nombres', () => {
    expect(suggest('ceil')?.list.map((s) => s.label)).toContain('FLOOR / CEIL')
  })

  it('sugiere columnas sin calificar y tablas en modo palabra', () => {
    const cols = suggest('Prec')?.list ?? []
    expect(cols.find((s) => s.label === 'Precio')?.kind).toBe('columna')
    expect(suggest('Ven')?.list.some((s) => s.label === 'Ventas' && s.kind === 'tabla')).toBe(true)
  })

  it('una columna compartida por varias tablas aparece una sola vez', () => {
    const list = suggest('Producto')?.list.filter((s) => s.kind === 'columna') ?? []
    expect(list.filter((s) => s.label === 'Producto')).toHaveLength(1)
  })

  it('tras FROM o JOIN solo sugiere tablas', () => {
    const r = suggest('SELECT * FROM ')
    expect(r).toBeNull()
    const explicit = suggest('SELECT * FROM ', 14, true)
    expect(explicit?.ctx.expectTable).toBe(true)
    expect(explicit?.list.map((s) => s.label)).toEqual(['Calendario', 'Devoluciones', 'Productos', 'Ventas'])
    const join = suggest('SELECT * FROM Ventas v JOIN Pro')
    expect(join?.list.map((s) => s.label)).toEqual(['Productos'])
  })

  it('tras alias. sugiere las columnas de la tabla del alias', () => {
    const r = suggest('SELECT v.Pr FROM Ventas v', 11)
    expect(r?.ctx.mode).toBe('member')
    expect(r?.list.map((s) => s.label)).toEqual(['Precio', 'Producto'])
  })

  it('tras tabla. y con AS sugiere columnas', () => {
    expect(suggest('SELECT Calendario.')?.list.map((s) => s.label)).toEqual(['Fecha', 'Mes', 'NombreMes'])
    expect(suggest('SELECT p.Ma FROM Productos AS p', 11)?.list.map((s) => s.label)).toEqual(['Marca'])
  })

  it('con un calificador desconocido no sugiere nada', () => {
    expect(suggest('SELECT x.')?.list).toEqual([])
  })

  it('una consulta de varias lineas conserva el contexto', () => {
    const text = 'SELECT p.Producto\nFROM Ventas p\nWHERE p.Ca'
    expect(suggest(text)?.list.map((s) => s.label)).toEqual(['Cantidad', 'Categoria'])
  })

  it('reconoce alias de FROM y JOIN sin confundir palabras clave', () => {
    expect(findAliases('SELECT * FROM Ventas v JOIN Productos AS p ON v.Producto = p.Producto WHERE 1 = 1')).toEqual({
      ventas: 'Ventas',
      v: 'Ventas',
      productos: 'Productos',
      p: 'Productos',
    })
    expect(findAliases('SELECT * FROM Ventas WHERE Cantidad > 1')).toEqual({ ventas: 'Ventas' })
  })

  it('no sugiere dentro de cadenas ni comentarios', () => {
    expect(suggest("SELECT * FROM Ventas WHERE Producto = 'Ace")).toBeNull()
    expect(suggest('-- SEL')).toBeNull()
    expect(suggest('/* SEL')).toBeNull()
    expect(suggest('SELECT 1 -- otra SU')).toBeNull()
    expect(suggest("SELECT 'a' || SU")?.list.some((s) => s.label === 'SUM')).toBe(true)
  })

  it('no sugiere sin texto salvo Ctrl+Espacio', () => {
    expect(suggest('SELECT ')).toBeNull()
    expect(suggest('SELECT ', 7, true)?.list.length).toBeGreaterThan(10)
  })

  it('un numero con punto decimal no abre sugerencias', () => {
    expect(suggest('SELECT 1.5')).toBeNull()
  })

  it('acepta una palabra clave reemplazando el prefijo', () => {
    const r = suggest('SEL')!
    expect(applySuggestion('SEL', r.ctx, r.list[0])).toEqual({ value: 'SELECT ', caret: 7 })
  })

  it('acepta una funcion sin duplicar el parentesis', () => {
    const text = 'SELECT SU(Cantidad) FROM Ventas'
    const r = suggest(text, 9)!
    const sum = r.list.find((s) => s.label === 'SUM')!
    const out = applySuggestion(text, r.ctx, sum)
    expect(out.value).toBe('SELECT SUM(Cantidad) FROM Ventas')
    expect(out.caret).toBe(11)
  })

  it('acepta una columna tras alias.', () => {
    const text = 'SELECT v.Pr FROM Ventas v'
    const r = suggest(text, 11)!
    expect(applySuggestion(text, r.ctx, r.list[0])).toEqual({ value: 'SELECT v.Precio FROM Ventas v', caret: 15 })
  })

  it('pone comillas dobles a nombres con espacios', () => {
    const model = [{ name: 'Mis ventas', columns: [] }]
    const ctx = getCompletionContext('FROM Mi', 7)!
    expect(getSuggestions(ctx, [], model)[0].insert).toBe('"Mis ventas"')
  })
})

describe('ayuda de firma', () => {
  const sig = (text: string) => getSignatureContext(text, text.length, functionCatalog)

  it('detecta la funcion y el argumento actual', () => {
    expect(sig('SELECT ROUND(')).toMatchObject({ argIndex: 0 })
    expect(sig('SELECT ROUND(Precio, ')).toMatchObject({ argIndex: 1 })
    expect(sig('SELECT ROUND(Precio, ')?.doc.name).toBe('ROUND')
  })

  it('usa la llamada interna en llamadas anidadas', () => {
    const r = sig('SELECT ROUND(COALESCE(Precio, ')
    expect(r?.doc.name).toBe('COALESCE')
    expect(r?.argIndex).toBe(1)
  })

  it('vuelve a la llamada externa tras cerrar la interna', () => {
    const r = sig('SELECT ROUND(SUM(Precio), ')
    expect(r?.doc.name).toBe('ROUND')
    expect(r?.argIndex).toBe(1)
  })

  it('ignora comas dentro de cadenas', () => {
    expect(sig("SELECT CONCAT('a,b', 'x,y', ")?.argIndex).toBe(2)
  })

  it('un parentesis de agrupacion no oculta la funcion', () => {
    const r = sig('SELECT ROUND((Precio + ')
    expect(r?.doc.name).toBe('ROUND')
    expect(r?.argIndex).toBe(0)
  })

  it('no hay ayuda para IN, FROM ni fuera de llamadas o dentro de cadenas', () => {
    expect(sig('SELECT * FROM Ventas WHERE Producto IN (')).toBeNull()
    expect(sig('SELECT * FROM (')).toBeNull()
    expect(sig('SELECT Precio')).toBeNull()
    expect(sig("SELECT UPPER('abc")).toBeNull()
  })

  it('resuelve entradas agrupadas por el nombre llamado', () => {
    const r = sig('SELECT CEIL(')
    expect(r?.doc.name).toBe('FLOOR / CEIL')
    expect(signatureParts(r!.doc, 0, r!.fname).name).toBe('CEIL')
  })

  it('separa la sintaxis y resalta el parametro', () => {
    const round = functionCatalog.find((f) => f.name === 'ROUND')!
    expect(signatureParts(round, 0)).toMatchObject({ parts: ['<número>', '<decimales>'], active: 0 })
    expect(signatureParts(round, 5).active).toBe(-1)
    const coalesce = functionCatalog.find((f) => f.name === 'COALESCE')!
    expect(signatureParts(coalesce, 5).active).toBe(1)
    const rowNumber = functionCatalog.find((f) => f.name === 'ROW_NUMBER')!
    expect(signatureParts(rowNumber, 0)).toMatchObject({ parts: [], active: -1 })
  })
})
