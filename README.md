# SQLTeacher

Herramienta web para aprender SQL viendo lo que cada consulta hace por detrás. Se escribe una sentencia `SELECT` y se reproduce, paso a paso como un video, cómo se transforman las tablas siguiendo el orden lógico de ejecución: qué filas entran por `FROM`, cómo se unen con `JOIN`, cuáles pasan el `WHERE`, cómo se agrupan, qué se conserva en `HAVING` y qué columnas produce el `SELECT`.

Nada se califica: lo que se escribe se ejecuta de verdad sobre un modelo de ejemplo en memoria.

## Qué incluye

- **Reproductor**: editor con autocompletado, menú de cláusulas y funciones con explicación, panel de tablas y relaciones del modelo de ejemplo, y un reproductor de pasos que muestra en cada momento las tablas intermedias, las filas que se conservan, se descartan o se unen y el resultado final.
- **Conceptos**: vista con tres lecciones interactivas: tipos de JOIN, orden lógico de ejecución y NULL y agregados.
- **Motor SQL propio** que corre en el navegador, sin backend, sin base de datos y sin IA. Lo forman un analizador léxico (`src/engine`), un parser y un evaluador que genera la traza.
- **40 ejemplos** listos para cargar, ordenados de lo simple a lo avanzado, sobre `SELECT`/`WHERE`, JOIN, agrupación, orden lógico, subconsultas, conjuntos, CTE y funciones de ventana.

## Modelo de ejemplo

| Tabla | Filas | Contenido |
|---|---|---|
| `Ventas` | 10 | Ventas con producto, categoría, ciudad, cantidad, precio y fechas (`FechaVenta`, `FechaEntrega`) |
| `Devoluciones` | 5 | Devoluciones por producto, fecha y motivo |
| `Productos` | 6 | Catálogo con marca y proveedor |
| `Calendario` | 6 | Fechas con su mes y nombre del mes |

Datos a propósito para practicar:

- Las ventas 3 y 7 no tienen fecha de entrega (`NULL`).
- La venta 10 es de `Sal`, un producto que no está en `Productos`.
- `Café` está en `Productos` pero no tiene ventas, y su proveedor es `NULL`.
- La devolución 5 no tiene motivo (`NULL`).

Las relaciones entre tablas aparecen documentadas en el panel, pero no se aplican solas: en SQL los cruces se escriben siempre con `JOIN ... ON`.

## Sintaxis y funciones soportadas

**Cláusulas**: `SELECT [DISTINCT]`, `FROM` (tabla, alias, CTE o subconsulta en el FROM), `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY` (con `ASC`/`DESC`, `NULLS FIRST`/`NULLS LAST` y posiciones), `LIMIT ... OFFSET`, `WITH` (CTE no recursivas) y `CASE WHEN`.

**JOIN**: `INNER JOIN`, `LEFT [OUTER] JOIN`, `RIGHT [OUTER] JOIN`, `FULL [OUTER] JOIN` y `CROSS JOIN`.

**Conjuntos**: `UNION [ALL]`, `INTERSECT` y `EXCEPT`.

**Condiciones y operadores**:

| Grupo | Elementos |
|---|---|
| Lógicos | `AND`, `OR`, `NOT` (lógica de tres valores) |
| Comparación | `=`, `<>`, `!=`, `<`, `<=`, `>`, `>=` |
| Predicados | `IN` (lista o subconsulta), `BETWEEN`, `LIKE` (`%` y `_`), `IS [NOT] NULL`, `EXISTS` |
| Aritmética | `+`, `-`, `*`, `/`, `%`, `\|\|` (concatenación) |

**Subconsultas**: escalares (en `WHERE`, `SELECT` o comparaciones), correlacionadas, `IN (SELECT ...)`, `EXISTS` y tablas derivadas.

**Agregados**: `COUNT` (incluido `COUNT(DISTINCT ...)`), `SUM`, `AVG`, `MIN`, `MAX`.

**Funciones de texto**: `UPPER`, `LOWER`, `LENGTH`, `TRIM`, `LTRIM`, `RTRIM`, `SUBSTRING` (y `SUBSTR`), `CONCAT`, `REPLACE`.

**Funciones numéricas**: `ROUND`, `ABS`, `FLOOR`, `CEIL`.

**NULL y conversión**: `COALESCE`, `NULLIF`, `CAST(... AS tipo)` y `::`, con los tipos `integer`, `numeric`, `text`, `date` y `boolean`.

**Fechas**: `EXTRACT(YEAR | MONTH | DAY | QUARTER FROM ...)`.

**Funciones de ventana**: `OVER ([PARTITION BY ...] [ORDER BY ...])` con `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `LAG` y `LEAD`, y agregados como `SUM(...) OVER`.

## Simplificaciones

Es una herramienta didáctica, no un motor SQL completo:

- Solo se ejecutan sentencias `SELECT`. No hay `INSERT`, `UPDATE`, `DELETE` ni DDL.
- No se admiten `JOIN ... USING` ni `NATURAL JOIN`.
- No se admiten `WITH RECURSIVE`, ni lista de columnas en las CTE (`WITH nombre(col1, col2) AS ...`).
- En `OVER` no se admiten marcos `ROWS` ni `RANGE`.
- La división es siempre decimal; no hay división entera.
- Las fechas son texto ISO `AAAA-MM-DD`. Se pueden usar con `CAST`, `EXTRACT` y literales `DATE`, pero no hay aritmética de fechas.
- No hay `LATERAL`.
- Las trazas se limitan a 2000 pasos; una consulta que genere más se rechaza con un mensaje.
- En subconsultas correlacionadas solo la primera evaluación se muestra en detalle; las siguientes se calculan sin traza completa.

## Desarrollo

```bash
npm install
npm run dev       # servidor de desarrollo
npm test          # pruebas (vitest)
npm run lint      # linter (oxlint)
npm run build     # compilación de producción en dist/
npm run preview   # sirve la compilación de dist/
```

Hecho con Vite, React 19 y TypeScript.
