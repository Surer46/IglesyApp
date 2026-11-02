import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Checkbox } from '@/components/ui/controles';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Columna<T> {
  /** Identificador; también es el campo que se envía en ?orden=clave:asc */
  clave: string;
  encabezado: string;
  /** Contenido de la celda */
  celda: (fila: T) => ReactNode;
  /** Si es true, el encabezado permite ordenar por esta columna */
  ordenable?: boolean;
  /** Oculta la columna en la vista de tarjeta (móvil) */
  ocultarEnTarjeta?: boolean;
  className?: string;
}

export type Orden = `${string}:${'asc' | 'desc'}`;

interface DataTableProps<T> {
  columnas: Columna<T>[];
  datos: T[];
  /** Id estable de cada fila */
  obtenerId: (fila: T) => string;
  /** Orden actual, p. ej. "apellidos:asc" */
  orden?: Orden;
  alOrdenar?: (orden: Orden) => void;
  /** Activa la selección con checkboxes */
  seleccionados?: string[];
  alSeleccionar?: (ids: string[]) => void;
  /** Acciones por fila (botones o menú) en la última columna */
  acciones?: (fila: T) => ReactNode;
  /**
   * Clic en la fila (p. ej. abrir el detalle). No se dispara desde enlaces, botones ni controles,
   * así que incluye un enlace en alguna celda para quien navega con teclado.
   */
  alClicFila?: (fila: T) => void;
  /** Etiqueta accesible de la tabla */
  etiqueta: string;
}

const CONTROLES = 'a, button, input, select, textarea, label, [role="checkbox"]';

/**
 * Tabla de datos tipada: orden por columna, selección opcional y vista de tarjeta en móvil (< 768 px).
 * Los estados cargando / vacío / error los maneja la página con SkeletonTabla, EmptyState y ErrorState.
 */
export function DataTable<T>({
  columnas,
  datos,
  obtenerId,
  orden,
  alOrdenar,
  seleccionados,
  alSeleccionar,
  acciones,
  alClicFila,
  etiqueta,
}: DataTableProps<T>) {
  const [campoOrden, direccion] = (orden?.split(':') ?? []) as [
    string | undefined,
    'asc' | 'desc' | undefined,
  ];
  const conSeleccion = Boolean(seleccionados && alSeleccionar);
  const todos =
    conSeleccion && datos.length > 0 && datos.every((f) => seleccionados!.includes(obtenerId(f)));

  function alternarFila(id: string) {
    if (!seleccionados || !alSeleccionar) return;
    alSeleccionar(
      seleccionados.includes(id) ? seleccionados.filter((s) => s !== id) : [...seleccionados, id],
    );
  }

  function alternarTodos() {
    alSeleccionar?.(todos ? [] : datos.map(obtenerId));
  }

  function clicEnFila(evento: MouseEvent<HTMLElement>, fila: T) {
    const objetivo = evento.target as Element;
    // React propaga los clics de portales (menús, diálogos): solo cuentan los de la propia fila
    if (!evento.currentTarget.contains(objetivo) || objetivo.closest(CONTROLES)) return;
    alClicFila?.(fila);
  }

  function ordenarPor(clave: string) {
    const nueva = campoOrden === clave && direccion === 'asc' ? 'desc' : 'asc';
    alOrdenar?.(`${clave}:${nueva}`);
  }

  return (
    <>
      {/* Escritorio */}
      <div className="hidden md:block">
        <Table aria-label={etiqueta}>
          <TableHeader>
            <TableRow>
              {conSeleccion && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={todos}
                    onCheckedChange={alternarTodos}
                    aria-label="Seleccionar todos"
                  />
                </TableHead>
              )}
              {columnas.map((col) => {
                const activa = campoOrden === col.clave;
                const ariaSort = activa
                  ? direccion === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined;
                return (
                  <TableHead key={col.clave} className={col.className} aria-sort={ariaSort}>
                    {col.ordenable && alOrdenar ? (
                      <button
                        type="button"
                        onClick={() => ordenarPor(col.clave)}
                        className="inline-flex items-center gap-1 uppercase hover:text-texto"
                      >
                        {col.encabezado}
                        {activa ? (
                          direccion === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3.5" aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.encabezado
                    )}
                  </TableHead>
                );
              })}
              {acciones && (
                <TableHead className="w-px text-right">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.map((fila) => {
              const id = obtenerId(fila);
              const marcado = seleccionados?.includes(id) ?? false;
              return (
                <TableRow
                  key={id}
                  data-state={marcado ? 'selected' : undefined}
                  onClick={alClicFila && ((e) => clicEnFila(e, fila))}
                  className={cn(alClicFila && 'cursor-pointer')}
                >
                  {conSeleccion && (
                    <TableCell>
                      <Checkbox
                        checked={marcado}
                        onCheckedChange={() => alternarFila(id)}
                        aria-label="Seleccionar fila"
                      />
                    </TableCell>
                  )}
                  {columnas.map((col) => (
                    <TableCell key={col.clave} className={col.className}>
                      {col.celda(fila)}
                    </TableCell>
                  ))}
                  {acciones && <TableCell className="text-right">{acciones(fila)}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Móvil: tarjetas */}
      <ul className="flex flex-col divide-y md:hidden" aria-label={etiqueta}>
        {datos.map((fila) => {
          const id = obtenerId(fila);
          return (
            <li
              key={id}
              onClick={alClicFila && ((e) => clicEnFila(e, fila))}
              className={cn(
                'flex gap-3 p-4',
                seleccionados?.includes(id) && 'bg-superficie-suave',
                alClicFila && 'cursor-pointer',
              )}
            >
              {conSeleccion && (
                <Checkbox
                  checked={seleccionados?.includes(id)}
                  onCheckedChange={() => alternarFila(id)}
                  aria-label="Seleccionar fila"
                  className="mt-0.5"
                />
              )}
              <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {columnas
                  .filter((c) => !c.ocultarEnTarjeta)
                  .map((col) => (
                    <div key={col.clave} className="contents">
                      <dt className="text-xs text-texto-suave">{col.encabezado}</dt>
                      <dd className="min-w-0 break-words">{col.celda(fila)}</dd>
                    </div>
                  ))}
              </dl>
              {acciones && <div className="shrink-0">{acciones(fila)}</div>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
