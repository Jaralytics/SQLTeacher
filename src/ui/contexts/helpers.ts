// Ayudas puras (sin DOM) de la vista "Conceptos": construyen las consultas de cada
// leccion y extraen de la traza del motor lo que se muestra en pantalla.
import { sampleModel } from '../../data/sampleModel'
import { run } from '../../engine'
import type { RunResult, TableSnapshot, Trace, TraceStep, Value } from '../../engine'

/** Ejecuta una consulta de leccion sobre el modelo de ejemplo. */
export function runLesson(query: string): RunResult {
  return run(query, sampleModel)
}

// ---------- Leccion 1: tipos de JOIN ----------

export type JoinKind = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS'

export const JOIN_KINDS: JoinKind[] = ['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS']

export function joinQuery(kind: JoinKind): string {
  const on = kind === 'CROSS' ? '' : ' ON v.Producto = p.Producto'
  return [
    'SELECT v.IdVenta, v.Producto AS ProductoVenta, p.Producto AS ProductoCatalogo, p.Marca',
    'FROM Ventas v',
    `${kind} JOIN Productos p${on}`,
  ].join('\n')
}

export const JOIN_TEXT: Record<JoinKind, { keeps: string; why: string }> = {
  INNER: {
    keeps: 'Solo las filas que encuentran pareja en las dos tablas.',
    why: 'La venta 10 (Sal) no tiene producto en el catálogo y Café no tiene ventas: ninguna tiene pareja, así que las dos se descartan.',
  },
  LEFT: {
    keeps: 'Todas las filas de Ventas, con o sin pareja en Productos.',
    why: 'La venta 10 (Sal) se conserva y recibe NULL en las columnas de Productos. Café no tiene ventas y está en el lado derecho, así que se descarta.',
  },
  RIGHT: {
    keeps: 'Todas las filas de Productos, con o sin pareja en Ventas.',
    why: 'Café se conserva y recibe NULL en las columnas de Ventas. La venta 10 (Sal) está en el lado izquierdo y no tiene pareja, así que se descarta.',
  },
  FULL: {
    keeps: 'Todas las filas de ambas tablas, con o sin pareja.',
    why: 'Se conservan la venta 10 (Sal), con NULL en las columnas de Productos, y Café, con NULL en las columnas de Ventas.',
  },
  CROSS: {
    keeps: 'Todas las combinaciones posibles: cada venta con cada producto.',
    why: 'No hay condición ON, así que no existen parejas ni filas sin pareja: 10 ventas por 6 productos dan 60 filas, incluidas la venta 10 y Café.',
  },
}

/** Tablas de entrada de un JOIN con sus filas marcadas (con pareja o sin pareja). */
export function joinInputs(trace: Trace): TableSnapshot[] {
  const probe = trace.steps.find((s) => s.phase === 'join' && s.tables.length >= 2)
  return (probe ?? trace.steps[0]).tables
}

function columnValues(table: TableSnapshot, name: string): Value[] {
  const i = table.columns.findIndex((c) => c.name === name)
  return i < 0 ? [] : table.rows.map((r) => r.cells[i])
}

/** Indica si la venta sin producto y el producto sin ventas sobreviven en el resultado. */
export function joinSurvivors(result: TableSnapshot): { orphanSale: boolean; unsoldProduct: boolean } {
  return {
    orphanSale: columnValues(result, 'IdVenta').includes(10),
    unsoldProduct: columnValues(result, 'ProductoCatalogo').includes('Cafe'),
  }
}

// ---------- Leccion 2: orden logico de ejecucion ----------

export type StageId = 'from' | 'where' | 'groupBy' | 'having' | 'select' | 'orderBy' | 'limit'

export interface Stage {
  id: StageId
  label: string
  /** Fases del motor que se muestran en esta etapa. */
  phases: TraceStep['phase'][]
}

export const STAGES: Stage[] = [
  { id: 'from', label: 'FROM', phases: ['from'] },
  { id: 'where', label: 'WHERE', phases: ['where'] },
  { id: 'groupBy', label: 'GROUP BY', phases: ['groupBy', 'aggregate'] },
  { id: 'having', label: 'HAVING', phases: ['having'] },
  { id: 'select', label: 'SELECT', phases: ['select'] },
  { id: 'orderBy', label: 'ORDER BY', phases: ['orderBy'] },
  { id: 'limit', label: 'LIMIT', phases: ['limit'] },
]

export const ORDER_QUERY = [
  'SELECT Categoria, SUM(Cantidad * Precio) AS Total',
  'FROM Ventas',
  'WHERE Cantidad > 1',
  'GROUP BY Categoria',
  'HAVING SUM(Cantidad * Precio) > 20',
  'ORDER BY Total DESC',
  'LIMIT 1',
].join('\n')

export type AliasPlace = 'orderBy' | 'where'

/** Alias Importe usado en ORDER BY (valido) o en WHERE (invalido). */
export function aliasQuery(place: AliasPlace): string {
  const where = place === 'where' ? '\nWHERE Importe > 20' : ''
  const order = place === 'orderBy' ? '\nORDER BY Importe DESC' : ''
  return `SELECT IdVenta, Producto, Cantidad * Precio AS Importe\nFROM Ventas${where}${order}`
}

/** Pasos de la consulta principal agrupados por etapa; las etapas ausentes quedan vacias. */
export function stageSteps(trace: Trace): Record<StageId, TraceStep[]> {
  const out = {} as Record<StageId, TraceStep[]>
  for (const stage of STAGES) {
    out[stage.id] = trace.steps.filter(
      (s) => s.depth === 0 && s.kind === 'table-result' && s.detail === 'major' && stage.phases.includes(s.phase),
    )
  }
  return out
}

/** Etapas que la consulta realmente ejecuta, en orden logico. */
export function activeStages(trace: Trace): Stage[] {
  const steps = stageSteps(trace)
  return STAGES.filter((s) => steps[s.id].length > 0)
}

// ---------- Leccion 3: NULL y agregados ----------

export type AggKind = 'count-star' | 'count-col' | 'count-distinct' | 'sum' | 'avg'

export const AGG_KINDS: { id: AggKind; label: string; expr: string }[] = [
  { id: 'count-star', label: 'COUNT(*)', expr: 'COUNT(*)' },
  { id: 'count-col', label: 'COUNT(columna)', expr: 'COUNT(CantEntregada)' },
  { id: 'count-distinct', label: 'COUNT(DISTINCT columna)', expr: 'COUNT(DISTINCT CantEntregada)' },
  { id: 'sum', label: 'SUM', expr: 'SUM(CantEntregada)' },
  { id: 'avg', label: 'AVG', expr: 'AVG(CantEntregada)' },
]

export const AGG_TEXT: Record<AggKind, string> = {
  'count-star': 'Cuenta filas, sin mirar su contenido: las filas con NULL también cuentan.',
  'count-col': 'Cuenta solo las filas donde la columna no es NULL.',
  'count-distinct': 'Cuenta los valores distintos que no son NULL: los repetidos y los NULL no suman.',
  sum: 'Suma los valores que no son NULL. Los NULL se ignoran, no se tratan como cero.',
  avg: 'Promedia solo los valores que no son NULL: divide entre las filas con valor, no entre todas.',
}

/** Las ventas sin fecha de entrega (3 y 7) producen NULL en CantEntregada. */
const ENTREGAS_CTE = [
  'WITH entregas AS (',
  '  SELECT IdVenta, Producto,',
  '    CASE WHEN FechaEntrega IS NULL THEN NULL ELSE Cantidad END AS CantEntregada',
  '  FROM Ventas',
  ')',
].join('\n')

export const ENTREGAS_QUERY = `${ENTREGAS_CTE}\nSELECT IdVenta, Producto, CantEntregada\nFROM entregas`

export function aggregateQuery(kind: AggKind): string {
  const expr = AGG_KINDS.find((k) => k.id === kind)?.expr ?? 'COUNT(*)'
  return `${ENTREGAS_CTE}\nSELECT ${expr} AS Resultado\nFROM entregas`
}

export type NullTest = 'equals' | 'is'

export const NULL_TESTS: { id: NullTest; label: string; predicate: string }[] = [
  { id: 'equals', label: '= NULL', predicate: 'CantEntregada = NULL' },
  { id: 'is', label: 'IS NULL', predicate: 'CantEntregada IS NULL' },
]

export function nullFilterQuery(test: NullTest): string {
  const predicate = NULL_TESTS.find((t) => t.id === test)?.predicate ?? NULL_TESTS[0].predicate
  return `${ENTREGAS_CTE}\nSELECT IdVenta, CantEntregada\nFROM entregas\nWHERE ${predicate}`
}

export const NULL_TEXT: Record<NullTest, string> = {
  equals:
    'Comparar con = NULL no da VERDADERO ni FALSO sino DESCONOCIDO, y WHERE solo deja pasar las filas VERDADERAS: no queda ninguna, ni siquiera las que sí tienen NULL.',
  is: 'IS NULL es la única forma de preguntar por NULL: da VERDADERO para las filas con NULL y FALSO para el resto.',
}

/** Todas las consultas validas que pueden generar las lecciones (excluye el alias en WHERE). */
export function allValidLessonQueries(): string[] {
  return [
    ...JOIN_KINDS.map(joinQuery),
    ORDER_QUERY,
    aliasQuery('orderBy'),
    ENTREGAS_QUERY,
    ...AGG_KINDS.map((k) => aggregateQuery(k.id)),
    ...NULL_TESTS.map((t) => nullFilterQuery(t.id)),
  ]
}

/** Marca cada fila de la tabla de origen como contada (kept) o ignorada (removed) por el agregado. */
export function markCounted(source: TableSnapshot, kind: AggKind): TableSnapshot {
  const col = source.columns.findIndex((c) => c.name === 'CantEntregada')
  const seen = new Set<Value>()
  return {
    ...source,
    rows: source.rows.map((row) => {
      const v = row.cells[col]
      let counted = true
      if (kind !== 'count-star') {
        if (v === null) counted = false
        else if (kind === 'count-distinct') {
          counted = !seen.has(v)
          seen.add(v)
        }
      }
      const note = counted ? 'cuenta' : v === null ? 'NULL: se ignora' : 'repetido: se ignora'
      return { ...row, status: counted ? 'kept' : 'removed', note }
    }),
  }
}

/** Tabla que deja el JOIN (todas las columnas de ambos lados, con el relleno NULL marcado). */
export function joinResult(trace: Trace): TableSnapshot {
  const step = trace.steps.find((s) => s.phase === 'join' && s.detail === 'major' && s.tables.length === 1)
  return step ? step.tables[0] : trace.result.table
}
