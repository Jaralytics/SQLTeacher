// Contrato compartido entre el motor SQL (src/engine) y la interfaz (src/ui).
// El motor ejecuta una consulta y devuelve una traza: una lista ordenada de pasos,
// cada uno con una foto completa de lo que se debe mostrar en pantalla. Los pasos
// siguen el orden LOGICO de procesamiento de SQL, no el orden en que se escribe.

/** Valor escalar de SQL. null representa NULL. */
export type Value = number | string | boolean | null

/** Las fechas ('date') se guardan como texto ISO `AAAA-MM-DD`. */
export type ColumnType = 'number' | 'string' | 'boolean' | 'date'

export interface Column {
  name: string
  type: ColumnType
}

export interface Table {
  name: string
  columns: Column[]
  rows: Value[][]
}

/**
 * Clave foranea documentada en el modelo (from = lado muchos, to = lado uno).
 * No se aplica sola: en SQL los cruces siempre se escriben con JOIN ... ON.
 */
export interface Relationship {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

export interface DataModel {
  tables: Table[]
  relationships: Relationship[]
}

/** Rango [start, end) de caracteres dentro del texto de la consulta. */
export interface SourceSpan {
  start: number
  end: number
}

export type RowStatus =
  | 'normal'
  /** Fila que se esta evaluando en este paso (fila actual de una subconsulta correlacionada). */
  | 'active'
  /** Fila que paso la condicion o que se conserva. */
  | 'kept'
  /** Fila descartada; se sigue mostrando, atenuada, hasta que el motor la quite. */
  | 'removed'
  /** Fila nueva respecto al paso anterior. */
  | 'added'
  /** Fila que encontro pareja en el otro lado de un JOIN (o en una operacion de conjuntos). */
  | 'matched'
  /** Fila sin pareja: en un JOIN externo se rellena con NULL, en uno interno se descarta. */
  | 'unmatched'

export type TableRole = 'source' | 'working' | 'result'

export interface SnapshotColumn {
  name: string
  /** Tipo de dato, para dar formato (las fechas llegan como texto ISO). */
  type?: ColumnType
  /** Columna involucrada en la operacion del paso actual. */
  highlight?: boolean
  /** Columna calculada por la consulta (expresion, agregado, funcion de ventana). */
  isNew?: boolean
  /** Alias o nombre de la tabla de la que viene la columna, si se conoce. */
  source?: string
}

export interface SnapshotRow {
  /** Identidad estable de la fila entre pasos, para poder animar. */
  key: string
  cells: Value[]
  status: RowStatus
  /** Texto corto junto a la fila, p. ej. `5 > 3 -> VERDADERO`. */
  note?: string
  /** Numero de grupo (desde 0) al que pertenece la fila: GROUP BY, PARTITION BY. */
  group?: number
  /** Posiciones de celdas que son NULL solo por el relleno de un JOIN externo. */
  padded?: number[]
}

export interface TableSnapshot {
  /** Identidad estable de la tabla entre pasos, para poder animar. */
  id: string
  title: string
  role: TableRole
  columns: SnapshotColumn[]
  rows: SnapshotRow[]
}

/** Fase del procesamiento logico de una consulta. */
export type Phase =
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'aggregate'
  | 'having'
  | 'select'
  | 'window'
  | 'distinct'
  | 'setOp'
  | 'orderBy'
  | 'limit'
  | 'subquery'
  | 'cte'
  | 'result'

export type StepKind =
  | 'start'
  /** Se entra a una fase, subconsulta, CTE o tabla derivada. */
  | 'enter'
  /** Una sola fila se evalua en detalle. */
  | 'iterate-row'
  /** Una fase produce una tabla intermedia. */
  | 'table-result'
  /** Una subconsulta escalar entrega un valor. */
  | 'scalar-result'
  | 'result'

export interface TraceStep {
  kind: StepKind
  /** Fase logica a la que pertenece el paso. */
  phase: Phase
  /** 'minor' = pasos de detalle que el reproductor puede omitir. */
  detail: 'major' | 'minor'
  title: string
  /** Explicacion en espanol. Admite `codigo` entre backticks. */
  explanation: string
  /** Parte de la consulta que se esta procesando. */
  span: SourceSpan | null
  /** Tablas a mostrar en el escenario, en orden. */
  tables: TableSnapshot[]
  /** Nivel de anidamiento: 0 consulta principal, 1 subconsulta/CTE/tabla derivada, etc. */
  depth: number
  /** Etiqueta del contexto cuando depth > 0, p. ej. `Subconsulta` o `CTE ventas_altas`. */
  scope?: string
  /** Valor devuelto por una subconsulta escalar o EXISTS en este paso. */
  scalar?: { label: string; value: Value }
}

export type TraceResult = { kind: 'table'; table: TableSnapshot }

export interface Trace {
  /** Texto de la consulta ejecutada. */
  formula: string
  steps: TraceStep[]
  result: TraceResult
}

export interface SqlError {
  message: string
  span: SourceSpan | null
}

export type RunResult = { ok: true; trace: Trace } | { ok: false; error: SqlError }

export interface Example {
  id: string
  title: string
  /** Clausula o concepto principal, para agrupar en el menu. */
  topic: string
  description: string
  /** Texto de la consulta SQL. */
  formula: string
}
