import type { DataModel } from '../engine/types'

export const sampleModel: DataModel = {
  tables: [
    {
      name: 'Ventas',
      columns: [
        { name: 'IdVenta', type: 'number' },
        { name: 'Producto', type: 'string' },
        { name: 'Categoria', type: 'string' },
        { name: 'Ciudad', type: 'string' },
        { name: 'Cantidad', type: 'number' },
        { name: 'Precio', type: 'number' },
        { name: 'FechaVenta', type: 'date' },
        { name: 'FechaEntrega', type: 'date' },
      ],
      // Ventas 3 y 7 aun no tienen fecha de entrega (NULL); la venta 10 es de 'Sal',
      // un producto que no existe en Productos.
      rows: [
        [1, 'Aceite', 'Despensa', 'Bogota', 5, 12, '2026-01-10', '2026-01-20'],
        [2, 'Arroz', 'Despensa', 'Medellin', 3, 4, '2026-01-10', '2026-02-05'],
        [3, 'Aceite', 'Despensa', 'Cali', 2, 12, '2026-01-20', null],
        [4, 'Leche', 'Lacteos', 'Bogota', 5, 3, '2026-01-20', '2026-01-20'],
        [5, 'Queso', 'Lacteos', 'Medellin', 1, 9, '2026-02-05', '2026-02-15'],
        [6, 'Aceite', 'Despensa', 'Medellin', 5, 13, '2026-02-05', '2026-03-01'],
        [7, 'Jabon', 'Aseo', 'Bogota', 4, 2, '2026-02-15', null],
        [8, 'Arroz', 'Despensa', 'Bogota', 5, 4, '2026-02-15', '2026-02-15'],
        [9, 'Leche', 'Lacteos', 'Cali', 2, 3, '2026-03-01', '2026-03-12'],
        [10, 'Sal', 'Despensa', 'Cali', 6, 2, '2026-03-12', '2026-03-12'],
      ],
    },
    {
      name: 'Devoluciones',
      columns: [
        { name: 'IdDevolucion', type: 'number' },
        { name: 'Producto', type: 'string' },
        { name: 'Fecha', type: 'date' },
        { name: 'Cantidad', type: 'number' },
        { name: 'Motivo', type: 'string' },
      ],
      rows: [
        [1, 'Aceite', '2026-01-20', 1, 'Dañado'],
        [2, 'Leche', '2026-02-05', 2, 'Vencido'],
        [3, 'Jabon', '2026-02-15', 1, 'Dañado'],
        [4, 'Aceite', '2026-03-01', 2, 'Error de pedido'],
        [5, 'Arroz', '2026-03-12', 1, null],
      ],
    },
    {
      name: 'Productos',
      columns: [
        { name: 'Producto', type: 'string' },
        { name: 'Marca', type: 'string' },
        { name: 'Proveedor', type: 'string' },
      ],
      rows: [
        ['Aceite', 'Oliva Real', 'Andina'],
        ['Arroz', 'Grano Fino', 'Andina'],
        ['Leche', 'La Pradera', 'Lacteos del Valle'],
        ['Queso', 'La Pradera', 'Lacteos del Valle'],
        ['Jabon', 'Limpio', 'Quimicos Norte'],
        // Cafe no tiene ventas y no tiene proveedor registrado (NULL).
        ['Cafe', 'Monte Alto', null],
      ],
    },
    {
      name: 'Calendario',
      columns: [
        { name: 'Fecha', type: 'date' },
        { name: 'Mes', type: 'number' },
        { name: 'NombreMes', type: 'string' },
      ],
      rows: [
        ['2026-01-10', 1, 'Enero'],
        ['2026-01-20', 1, 'Enero'],
        ['2026-02-05', 2, 'Febrero'],
        ['2026-02-15', 2, 'Febrero'],
        ['2026-03-01', 3, 'Marzo'],
        ['2026-03-12', 3, 'Marzo'],
      ],
    },
  ],
  relationships: [
    { fromTable: 'Ventas', fromColumn: 'Producto', toTable: 'Productos', toColumn: 'Producto' },
    { fromTable: 'Ventas', fromColumn: 'FechaVenta', toTable: 'Calendario', toColumn: 'Fecha' },
    { fromTable: 'Ventas', fromColumn: 'FechaEntrega', toTable: 'Calendario', toColumn: 'Fecha' },
    { fromTable: 'Devoluciones', fromColumn: 'Producto', toTable: 'Productos', toColumn: 'Producto' },
    { fromTable: 'Devoluciones', fromColumn: 'Fecha', toTable: 'Calendario', toColumn: 'Fecha' },
  ],
}
