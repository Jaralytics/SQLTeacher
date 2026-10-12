import { describe, expect, it } from 'vitest'
import { run } from '../engine'
import { examples } from './examples'
import { functionCatalog } from './functions'
import { sampleModel } from './sampleModel'

describe('ejemplos', () => {
  it('hay entre 30 y 40 ejemplos con ids unicos', () => {
    expect(examples.length).toBeGreaterThanOrEqual(30)
    expect(examples.length).toBeLessThanOrEqual(40)
    expect(new Set(examples.map((e) => e.id)).size).toBe(examples.length)
  })

  it.each(examples.map((e) => [e.id, e] as const))('%s se ejecuta y produce una traza', (_id, ex) => {
    const r = run(ex.formula, sampleModel)
    if (!r.ok) throw new Error(`${ex.id}: ${r.error.message}`)
    expect(r.trace.steps.length).toBeGreaterThan(0)
    expect(r.trace.result.table.columns.length).toBeGreaterThan(0)
  })

  it('todos los campos de texto estan completos', () => {
    for (const e of examples) {
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.topic.length).toBeGreaterThan(0)
      expect(e.description.length).toBeGreaterThan(0)
    }
  })

  it('cubren cada tipo de JOIN, subconsultas, conjuntos, CTE y ventanas', () => {
    const all = examples.map((e) => e.formula.toUpperCase()).join('\n')
    for (const kw of [
      'INNER JOIN',
      'LEFT JOIN',
      'RIGHT JOIN',
      'FULL JOIN',
      'CROSS JOIN',
      'GROUP BY',
      'HAVING',
      'EXISTS',
      'UNION ALL',
      'INTERSECT',
      'EXCEPT',
      'WITH ',
      'ROW_NUMBER',
      'RANK()',
      'LAG(',
      'CASE WHEN',
      'IS NULL',
      'LIMIT',
    ]) {
      expect(all).toContain(kw)
    }
  })
})

describe('catalogo de funciones', () => {
  it.each(functionCatalog.map((f) => [f.name, f] as const))('el ejemplo de %s se ejecuta', (_name, f) => {
    const r = run(f.example, sampleModel)
    if (!r.ok) throw new Error(`${f.name}: ${r.error.message}`)
    expect(r.trace.steps.length).toBeGreaterThan(0)
  })

  it('no repite nombres y tiene los campos completos', () => {
    expect(new Set(functionCatalog.map((f) => f.name)).size).toBe(functionCatalog.length)
    for (const f of functionCatalog) {
      expect(f.syntax.length).toBeGreaterThan(0)
      expect(f.description.length).toBeGreaterThan(0)
      expect(f.returnsDescription.length).toBeGreaterThan(0)
    }
  })
})

describe('modelo de ejemplo', () => {
  const table = (name: string) => sampleModel.tables.find((t) => t.name === name)

  it('tiene las cuatro tablas con filas del ancho correcto', () => {
    expect(sampleModel.tables.map((t) => t.name)).toEqual(['Ventas', 'Devoluciones', 'Productos', 'Calendario'])
    for (const t of sampleModel.tables) {
      expect(t.rows.length).toBeLessThanOrEqual(12)
      for (const r of t.rows) expect(r).toHaveLength(t.columns.length)
    }
  })

  it('permite distinguir los JOIN: un producto sin ventas y una venta sin producto', () => {
    const productos = new Set(table('Productos')?.rows.map((r) => r[0]))
    const vendidos = new Set(table('Ventas')?.rows.map((r) => r[1]))
    expect([...productos].filter((p) => !vendidos.has(p)).length).toBeGreaterThan(0)
    expect([...vendidos].filter((p) => !productos.has(p)).length).toBeGreaterThan(0)
  })

  it('tiene NULL y valores repetidos', () => {
    const ventas = table('Ventas')
    expect(ventas?.rows.some((r) => r[7] === null)).toBe(true)
    const ciudades = ventas?.rows.map((r) => r[3]) ?? []
    expect(new Set(ciudades).size).toBeLessThan(ciudades.length)
  })

  it('las relaciones apuntan a tablas y columnas existentes', () => {
    for (const rel of sampleModel.relationships) {
      expect(table(rel.fromTable)?.columns.some((c) => c.name === rel.fromColumn)).toBe(true)
      expect(table(rel.toTable)?.columns.some((c) => c.name === rel.toColumn)).toBe(true)
    }
  })
})

describe('texto sin emojis', () => {
  it('ejemplos y catalogo no contienen emojis', () => {
    const text = JSON.stringify([examples, functionCatalog])
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false)
  })
})
