import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SelectEnum } from '@/components/comunes/CamposFormulario';
import { EmptyState, ErrorState, SkeletonTabla } from '@/components/comunes/Estados';
import { DateRangePicker, FiltrosBar } from '@/components/comunes/Filtros';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMinisteriosCoordinados } from '@/features/eventos/permisos';
import { useMinisterios } from '@/features/ministerios/hooks';
import { BotonExportar } from '@/features/reportes/components/BotonExportar';
import { usePermiso } from '@/hooks/usePermiso';
import type { PeriodoResumen, QueryResumenAsistencia } from '@/types/asistencia';
import { useResumenAsistencia } from '../hooks';

const TODOS = 'todos';

export interface FiltrosResumen {
  periodo: string;
  desde: string;
  hasta: string;
  ministerioId: string;
}

interface ResumenAsistenciaProps {
  filtros: FiltrosResumen;
  alCambiar: (cambios: Partial<FiltrosResumen>) => void;
}

/** "2026-W43" → "Sem 43 (2026)"; "2026-10" → "oct 2026" */
function etiquetaPeriodo(periodo: string) {
  const semana = /^(\d{4})-W(\d{2})$/.exec(periodo);
  if (semana) return `Sem ${Number(semana[2])} (${semana[1]})`;
  return new Date(`${periodo}-01T00:00:00`).toLocaleDateString('es-MX', {
    month: 'short',
    year: 'numeric',
  });
}

/** Gráfica de presentes vs. ausentes + tabla accesible equivalente (F3-09). */
export function ResumenAsistencia({ filtros, alCambiar }: ResumenAsistenciaProps) {
  const periodo = (filtros.periodo === 'mensual' ? 'mensual' : 'semanal') as PeriodoResumen;
  const query: QueryResumenAsistencia = {
    periodo,
    ...(filtros.desde && { desde: filtros.desde }),
    ...(filtros.hasta && { hasta: filtros.hasta }),
    ...(filtros.ministerioId && { ministerioId: filtros.ministerioId }),
  };
  const consulta = useResumenAsistencia(query);
  const verTodos = usePermiso('asistencia:leer');
  const coordinados = useMinisteriosCoordinados();
  const { data: ministerios } = useMinisterios();
  const opcionesMinisterio = [
    { valor: TODOS, etiqueta: verTodos ? 'Todos los ministerios' : 'Mis ministerios' },
    ...(ministerios?.data ?? [])
      .filter((m) => verTodos || coordinados.includes(m.id))
      .map((m) => ({ valor: m.id, etiqueta: m.nombre })),
  ];
  const datos = (consulta.data ?? []).map((f) => ({ ...f, etiqueta: etiquetaPeriodo(f.periodo) }));
  const sinDatos = datos.every((f) => f.eventos === 0);

  return (
    <>
      <FiltrosBar>
        <div role="group" aria-label="Periodo" className="flex gap-1">
          {(['semanal', 'mensual'] as const).map((p) => (
            <Button
              key={p}
              variante={periodo === p ? 'primario' : 'contorno'}
              aria-pressed={periodo === p}
              className="min-h-11"
              onClick={() => alCambiar({ periodo: p })}
            >
              {p === 'semanal' ? 'Semanal' : 'Mensual'}
            </Button>
          ))}
        </div>
        <DateRangePicker
          valor={{ desde: filtros.desde || undefined, hasta: filtros.hasta || undefined }}
          alCambiar={(r) => alCambiar({ desde: r.desde ?? '', hasta: r.hasta ?? '' })}
        />
        <SelectEnum
          aria-label="Ministerio"
          className="sm:w-52"
          opciones={opcionesMinisterio}
          valor={filtros.ministerioId || TODOS}
          alCambiar={(v) => alCambiar({ ministerioId: v === TODOS ? '' : v })}
        />
        {/* Reporte de asistencia de F4 (PDF / Excel) con los mismos filtros; se oculta sin permiso */}
        <BotonExportar
          tipo="asistencia"
          className="sm:ml-auto"
          filtros={{
            periodo,
            ...(filtros.desde && { desde: filtros.desde }),
            ...(filtros.hasta && { hasta: filtros.hasta }),
          }}
        />
      </FiltrosBar>

      <Card>
        {consulta.isPending ? (
          <SkeletonTabla filas={5} columnas={4} />
        ) : consulta.isError ? (
          <ErrorState error={consulta.error} alReintentar={() => consulta.refetch()} />
        ) : sinDatos ? (
          <EmptyState icono={BarChart3} titulo="No hay asistencia registrada en este periodo" />
        ) : (
          <CardContent className="flex flex-col gap-6 p-4">
            <figure aria-labelledby="titulo-grafica">
              <figcaption id="titulo-grafica" className="mb-2 font-medium">
                Presentes y ausentes por {periodo === 'semanal' ? 'semana' : 'mes'}
              </figcaption>
              {/* La gráfica es decorativa para lectores de pantalla: la tabla de abajo tiene los mismos datos */}
              <div className="h-72" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={datos}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--borde)" />
                    <XAxis dataKey="etiqueta" tick={{ fill: 'var(--texto-suave)', fontSize: 12 }} />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'var(--texto-suave)', fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--superficie)',
                        border: '1px solid var(--borde)',
                        color: 'var(--texto)',
                      }}
                    />
                    <Legend />
                    <Bar dataKey="presentes" name="Presentes" fill="var(--exito)" />
                    <Bar dataKey="ausentes" name="Ausentes" fill="var(--peligro)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>
            <div className="overflow-x-auto">
              <Table aria-label="Resumen de asistencia">
                <TableHeader>
                  <TableRow>
                    <TableHead>Periodo</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Presentes</TableHead>
                    <TableHead className="text-right">Ausentes</TableHead>
                    <TableHead className="text-right">Promedio por evento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datos.map((f) => (
                    <TableRow key={f.periodo}>
                      <TableCell>{f.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.eventos}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.presentes}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.ausentes}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.promedioPorEvento}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </>
  );
}
