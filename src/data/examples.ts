import type { Example } from '../engine/types'

// Ordenados de lo simple a lo avanzado. Todos se ejecutan sobre sampleModel.
export const examples: Example[] = [
  // ---------- SELECT y WHERE ----------
  {
    id: 'select-columnas',
    title: 'Elegir columnas',
    topic: 'SELECT',
    description: 'SELECT elige qué columnas se muestran; FROM indica la tabla de la que salen las filas.',
    formula: 'SELECT Producto, Cantidad\nFROM Ventas',
  },
  {
    id: 'select-expresion',
    title: 'Columna calculada con alias',
    topic: 'SELECT',
    description: 'En SELECT se pueden calcular expresiones y ponerles nombre con AS.',
    formula: 'SELECT IdVenta, Producto, Cantidad * Precio AS Total\nFROM Ventas',
  },
  {
    id: 'where-comparacion',
    title: 'Filtrar filas con WHERE',
    topic: 'WHERE',
    description: 'WHERE evalúa la condición fila por fila y solo deja pasar las que dan VERDADERO.',
    formula: "SELECT IdVenta, Producto, Ciudad, Cantidad\nFROM Ventas\nWHERE Cantidad >= 5 AND Ciudad = 'Bogota'",
  },
  {
    id: 'where-in-like-between',
    title: 'IN, LIKE y BETWEEN',
    topic: 'WHERE',
    description: 'IN compara con una lista, LIKE busca patrones (% y _) y BETWEEN incluye los dos extremos.',
    formula:
      "SELECT IdVenta, Producto, Ciudad, Cantidad\nFROM Ventas\nWHERE Ciudad IN ('Cali', 'Medellin')\n  AND Producto LIKE 'A%'\n  AND Cantidad BETWEEN 2 AND 5",
  },
  {
    id: 'null-is-null',
    title: 'Buscar NULL con IS NULL',
    topic: 'NULL',
    description: 'Dos ventas aún no tienen fecha de entrega. Para encontrarlas se usa IS NULL, nunca = NULL.',
    formula: 'SELECT IdVenta, Producto, FechaEntrega\nFROM Ventas\nWHERE FechaEntrega IS NULL',
  },
  {
    id: 'null-comparacion',
    title: 'Una comparación con NULL no es verdadera',
    topic: 'NULL',
    description:
      'FechaEntrega <> fecha da NULL (desconocido) en las filas sin entrega, y WHERE descarta todo lo que no sea VERDADERO: esas filas desaparecen aunque "sean distintas".',
    formula: "SELECT IdVenta, Producto, FechaEntrega\nFROM Ventas\nWHERE FechaEntrega <> '2026-01-20'",
  },
  {
    id: 'null-coalesce',
    title: 'COALESCE para reemplazar NULL',
    topic: 'NULL',
    description: 'COALESCE devuelve el primer valor que no es NULL; sirve para dar un valor por defecto.',
    formula:
      "SELECT IdVenta, FechaEntrega, COALESCE(FechaEntrega, FechaVenta) AS FechaFinal\nFROM Ventas\nWHERE Producto = 'Aceite'",
  },
  {
    id: 'distinct',
    title: 'DISTINCT',
    topic: 'DISTINCT',
    description: 'DISTINCT elimina las filas repetidas del resultado, comparando todas las columnas del SELECT.',
    formula: 'SELECT DISTINCT Categoria, Ciudad\nFROM Ventas',
  },
  {
    id: 'order-by',
    title: 'Ordenar con ORDER BY',
    topic: 'ORDER BY',
    description: 'ORDER BY ordena al final; admite varias columnas, ASC/DESC y un alias del SELECT.',
    formula: 'SELECT IdVenta, Producto, Cantidad * Precio AS Total\nFROM Ventas\nORDER BY Total DESC, Producto',
  },
  {
    id: 'limit-offset',
    title: 'LIMIT y OFFSET',
    topic: 'LIMIT',
    description: 'LIMIT recorta el número de filas y OFFSET se salta las primeras. Se aplican después de ordenar.',
    formula: 'SELECT IdVenta, Producto, Precio\nFROM Ventas\nORDER BY Precio DESC, IdVenta\nLIMIT 3 OFFSET 1',
  },
  {
    id: 'case-when',
    title: 'CASE WHEN',
    topic: 'CASE',
    description: 'CASE elige un valor según condiciones, como un if/else dentro de la consulta.',
    formula:
      "SELECT IdVenta, Cantidad,\n  CASE WHEN Cantidad >= 5 THEN 'Grande'\n       WHEN Cantidad >= 3 THEN 'Mediana'\n       ELSE 'Pequeña' END AS Tamano\nFROM Ventas",
  },
  {
    id: 'funciones-escalares',
    title: 'Funciones de texto y fecha',
    topic: 'Funciones',
    description: 'Las funciones escalares transforman un valor por cada fila: UPPER, LENGTH, ||, EXTRACT, CAST...',
    formula:
      "SELECT UPPER(Producto) AS Nombre,\n  LENGTH(Producto) AS Letras,\n  Producto || ' - ' || Ciudad AS Etiqueta,\n  EXTRACT(MONTH FROM FechaVenta) AS Mes\nFROM Ventas\nWHERE IdVenta <= 4",
  },

  // ---------- JOIN ----------
  {
    id: 'inner-join',
    title: 'INNER JOIN',
    topic: 'INNER JOIN',
    description:
      'INNER JOIN conserva solo las filas con pareja en ambas tablas. La venta de Sal no tiene producto y Café no tiene ventas: ninguna aparece.',
    formula:
      'SELECT v.IdVenta, v.Producto, p.Marca, v.Cantidad\nFROM Ventas v\nINNER JOIN Productos p ON v.Producto = p.Producto',
  },
  {
    id: 'left-join',
    title: 'LEFT JOIN',
    topic: 'LEFT JOIN',
    description:
      'LEFT JOIN conserva todas las filas de la izquierda. Café no tiene ventas, así que sus columnas de Ventas salen en NULL.',
    formula:
      'SELECT p.Producto, p.Marca, v.IdVenta, v.Cantidad\nFROM Productos p\nLEFT JOIN Ventas v ON p.Producto = v.Producto',
  },
  {
    id: 'right-join',
    title: 'RIGHT JOIN',
    topic: 'RIGHT JOIN',
    description:
      'RIGHT JOIN es el espejo del LEFT JOIN: conserva todas las filas de la derecha (Productos) y descarta la venta de Sal, que no tiene pareja.',
    formula:
      'SELECT v.IdVenta, p.Producto, p.Marca\nFROM Ventas v\nRIGHT JOIN Productos p ON v.Producto = p.Producto',
  },
  {
    id: 'full-join',
    title: 'FULL JOIN',
    topic: 'FULL JOIN',
    description:
      'FULL JOIN conserva las filas sin pareja de los dos lados: Café (solo en Productos) y la venta de Sal (solo en Ventas).',
    formula:
      'SELECT v.IdVenta, v.Producto AS ProductoVenta, p.Producto AS ProductoCatalogo\nFROM Ventas v\nFULL JOIN Productos p ON v.Producto = p.Producto',
  },
  {
    id: 'anti-join',
    title: 'Filas sin pareja (anti-join)',
    topic: 'LEFT JOIN',
    description:
      'LEFT JOIN seguido de WHERE ... IS NULL encuentra las filas de la izquierda que no tienen pareja: productos que nunca se vendieron.',
    formula:
      'SELECT p.Producto, p.Marca\nFROM Productos p\nLEFT JOIN Ventas v ON p.Producto = v.Producto\nWHERE v.IdVenta IS NULL',
  },
  {
    id: 'cross-join',
    title: 'CROSS JOIN',
    topic: 'CROSS JOIN',
    description:
      'CROSS JOIN combina cada fila de una tabla con cada fila de la otra (producto cartesiano). Aquí 3 ciudades por 3 categorías dan 9 filas.',
    formula:
      'SELECT c.Ciudad, k.Categoria\nFROM (SELECT DISTINCT Ciudad FROM Ventas) c\nCROSS JOIN (SELECT DISTINCT Categoria FROM Ventas) k',
  },
  {
    id: 'join-tres-tablas',
    title: 'JOIN de tres tablas',
    topic: 'JOIN',
    description: 'Los JOIN se encadenan: cada uno une el resultado anterior con una tabla nueva.',
    formula:
      'SELECT v.IdVenta, p.Marca, c.NombreMes, v.Cantidad\nFROM Ventas v\nJOIN Productos p ON v.Producto = p.Producto\nJOIN Calendario c ON v.FechaVenta = c.Fecha\nWHERE c.Mes = 2',
  },

  // ---------- agrupar ----------
  {
    id: 'group-by',
    title: 'GROUP BY con agregados',
    topic: 'GROUP BY',
    description: 'GROUP BY reúne las filas con el mismo valor y los agregados (COUNT, SUM...) se calculan una vez por grupo.',
    formula:
      'SELECT Ciudad, COUNT(*) AS NumVentas, SUM(Cantidad * Precio) AS Total\nFROM Ventas\nGROUP BY Ciudad',
  },
  {
    id: 'group-by-varias',
    title: 'GROUP BY por varias columnas',
    topic: 'GROUP BY',
    description: 'Con varias columnas, cada combinación distinta de valores forma un grupo.',
    formula:
      'SELECT Categoria, Ciudad, SUM(Cantidad) AS Unidades\nFROM Ventas\nGROUP BY Categoria, Ciudad\nORDER BY Categoria, Ciudad',
  },
  {
    id: 'having',
    title: 'HAVING filtra grupos',
    topic: 'HAVING',
    description: 'HAVING se evalúa después de agrupar, así que puede usar agregados; WHERE no puede.',
    formula: 'SELECT Producto, SUM(Cantidad) AS Unidades\nFROM Ventas\nGROUP BY Producto\nHAVING SUM(Cantidad) >= 6',
  },
  {
    id: 'where-y-having',
    title: 'WHERE antes, HAVING después',
    topic: 'HAVING',
    description:
      'WHERE filtra filas antes de agrupar; HAVING filtra grupos después. Aquí primero se descartan ventas pequeñas y luego los productos con una sola venta.',
    formula:
      'SELECT Producto, COUNT(*) AS NumVentas, AVG(Precio) AS PrecioMedio\nFROM Ventas\nWHERE Cantidad >= 3\nGROUP BY Producto\nHAVING COUNT(*) > 1',
  },
  {
    id: 'count-variantes',
    title: 'COUNT(*), COUNT(x) y COUNT(DISTINCT x)',
    topic: 'NULL',
    description:
      'COUNT(*) cuenta filas; COUNT(columna) ignora los NULL; COUNT(DISTINCT columna) cuenta valores distintos.',
    formula:
      'SELECT COUNT(*) AS Filas,\n  COUNT(FechaEntrega) AS ConEntrega,\n  COUNT(DISTINCT Ciudad) AS Ciudades,\n  MIN(Precio) AS PrecioMin,\n  MAX(Precio) AS PrecioMax\nFROM Ventas',
  },

  // ---------- orden lógico ----------
  {
    id: 'orden-logico-alias',
    title: 'Un alias no existe todavía en WHERE',
    topic: 'Orden lógico',
    description:
      'WHERE se evalúa antes que SELECT, por eso no puede usar el alias Total: hay que repetir la expresión. ORDER BY, en cambio, se evalúa después y sí lo reconoce.',
    formula:
      'SELECT IdVenta, Cantidad * Precio AS Total\nFROM Ventas\nWHERE Cantidad * Precio > 20\nORDER BY Total DESC',
  },

  // ---------- subconsultas ----------
  {
    id: 'subconsulta-escalar',
    title: 'Subconsulta escalar',
    topic: 'Subconsultas',
    description: 'Una subconsulta que devuelve un solo valor se puede usar como cualquier otro valor de la condición.',
    formula: 'SELECT IdVenta, Producto, Precio\nFROM Ventas\nWHERE Precio > (SELECT AVG(Precio) FROM Ventas)',
  },
  {
    id: 'subconsulta-in',
    title: 'IN con subconsulta',
    topic: 'Subconsultas',
    description: 'IN (SELECT ...) conserva las filas cuyo valor aparece en el resultado de la subconsulta.',
    formula:
      'SELECT IdVenta, Producto, Cantidad\nFROM Ventas\nWHERE Producto IN (SELECT Producto FROM Devoluciones)',
  },
  {
    id: 'not-in-null',
    title: 'NOT IN y NULL: una trampa',
    topic: 'NULL',
    description:
      'Si la lista de NOT IN contiene un NULL, la comparación nunca es VERDADERA y no sale ninguna fila. Cambia la subconsulta para ver el efecto.',
    formula:
      'SELECT IdVenta, Producto, FechaEntrega\nFROM Ventas\nWHERE FechaEntrega NOT IN (\n  SELECT FechaEntrega FROM Ventas WHERE IdVenta IN (1, 3)\n)',
  },
  {
    id: 'exists-correlacionada',
    title: 'EXISTS con subconsulta correlacionada',
    topic: 'EXISTS',
    description:
      'La subconsulta usa una columna de la consulta externa (p.Producto), así que se evalúa una vez por cada fila. EXISTS solo pregunta si devuelve alguna fila.',
    formula:
      'SELECT p.Producto, p.Marca\nFROM Productos p\nWHERE EXISTS (\n  SELECT 1 FROM Ventas v WHERE v.Producto = p.Producto\n)',
  },
  {
    id: 'correlacionada-escalar',
    title: 'Subconsulta correlacionada escalar',
    topic: 'Subconsultas',
    description:
      'Cada venta se compara con el precio medio de su propio producto: la subconsulta cambia según la fila externa.',
    formula:
      'SELECT v.IdVenta, v.Producto, v.Precio\nFROM Ventas v\nWHERE v.Precio > (\n  SELECT AVG(v2.Precio) FROM Ventas v2 WHERE v2.Producto = v.Producto\n)',
  },
  {
    id: 'subconsulta-select',
    title: 'Subconsulta en la lista del SELECT',
    topic: 'Subconsultas',
    description: 'Una subconsulta escalar también puede ser una columna: aquí cuenta las devoluciones de cada producto.',
    formula:
      'SELECT p.Producto,\n  (SELECT COUNT(*) FROM Devoluciones d WHERE d.Producto = p.Producto) AS Devoluciones\nFROM Productos p',
  },

  // ---------- conjuntos y CTE ----------
  {
    id: 'union',
    title: 'UNION',
    topic: 'UNION',
    description: 'UNION apila los resultados de dos consultas y elimina las filas repetidas.',
    formula: 'SELECT Producto FROM Ventas\nUNION\nSELECT Producto FROM Devoluciones',
  },
  {
    id: 'union-all',
    title: 'UNION ALL',
    topic: 'UNION',
    description: 'UNION ALL apila sin quitar duplicados: es más simple y conserva todas las filas.',
    formula: "SELECT Producto, 'Venta' AS Origen FROM Ventas\nWHERE Cantidad >= 5\nUNION ALL\nSELECT Producto, 'Devolucion' FROM Devoluciones",
  },
  {
    id: 'intersect',
    title: 'INTERSECT',
    topic: 'INTERSECT',
    description: 'INTERSECT deja solo las filas que aparecen en las dos consultas.',
    formula: 'SELECT Producto FROM Ventas\nINTERSECT\nSELECT Producto FROM Devoluciones',
  },
  {
    id: 'except',
    title: 'EXCEPT',
    topic: 'EXCEPT',
    description: 'EXCEPT deja las filas de la primera consulta que no aparecen en la segunda.',
    formula: 'SELECT Producto FROM Productos\nEXCEPT\nSELECT Producto FROM Ventas',
  },
  {
    id: 'cte',
    title: 'CTE con WITH',
    topic: 'CTE',
    description: 'WITH da nombre a una consulta intermedia para usarla después en FROM, como una tabla temporal.',
    formula:
      'WITH totales AS (\n  SELECT Producto, SUM(Cantidad * Precio) AS Total\n  FROM Ventas\n  GROUP BY Producto\n)\nSELECT t.Producto, t.Total, p.Marca\nFROM totales t\nJOIN Productos p ON p.Producto = t.Producto\nWHERE t.Total > 40\nORDER BY t.Total DESC',
  },

  // ---------- funciones de ventana ----------
  {
    id: 'ventana-row-number',
    title: 'ROW_NUMBER por partición',
    topic: 'Funciones de ventana',
    description:
      'Una función de ventana calcula un valor por fila sin colapsar filas. PARTITION BY reinicia el cálculo en cada ciudad.',
    formula:
      'SELECT IdVenta, Ciudad, Precio,\n  ROW_NUMBER() OVER (PARTITION BY Ciudad ORDER BY Precio DESC, IdVenta) AS Posicion\nFROM Ventas',
  },
  {
    id: 'ventana-rank',
    title: 'RANK y DENSE_RANK con empates',
    topic: 'Funciones de ventana',
    description: 'Con empates, RANK deja huecos en la numeración y DENSE_RANK no.',
    formula:
      'SELECT IdVenta, Precio,\n  RANK() OVER (ORDER BY Precio DESC) AS Rango,\n  DENSE_RANK() OVER (ORDER BY Precio DESC) AS RangoDenso\nFROM Ventas',
  },
  {
    id: 'ventana-acumulado',
    title: 'Total acumulado con SUM OVER',
    topic: 'Funciones de ventana',
    description: 'SUM(...) OVER (ORDER BY ...) suma desde la primera fila hasta la actual: un acumulado.',
    formula:
      'SELECT IdVenta, FechaVenta, Cantidad,\n  SUM(Cantidad) OVER (ORDER BY FechaVenta, IdVenta) AS Acumulado\nFROM Ventas',
  },
  {
    id: 'ventana-lag',
    title: 'LAG: comparar con la fila anterior',
    topic: 'Funciones de ventana',
    description: 'LAG trae el valor de la fila anterior dentro de la partición; en la primera fila no hay anterior y da NULL.',
    formula:
      'SELECT IdVenta, Producto, Precio,\n  LAG(Precio) OVER (PARTITION BY Producto ORDER BY IdVenta) AS PrecioAnterior\nFROM Ventas\nWHERE Producto IN (\'Aceite\', \'Arroz\')',
  },
]
