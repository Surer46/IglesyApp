import { CalendarCheck, Check, Percent, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { type Columna, DataTable } from '@/components/comunes/DataTable';
import { EmptyState, ErrorState, SkeletonTabla, StatCard } from '@/components/comunes/Estados';
import { Paginacion } from '@/components/comunes/Paginacion';
import { Badge, Card } from '@/components/ui/card';
import { useAsistencias } from '@/features/asistencia/hooks';
import { formatearFechaHora } from '@/lib/formato';
import type { AsistenciaHistorial } from '@/types/asistencia';
import type { MiembroDetalle } from '@/types/miembros';

const COLUMNAS: Columna<AsistenciaHistorial>[] = [
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    celda: (a) => formatearFechaHora(a.evento.fechaInicio),
  },
  {
    clave: 'evento',
    encabezado: 'Evento',
    celda: (a) => (
      <Link className="text-primario hover:underline" to={`/eventos/${a.evento.id}`}>
        {a.evento.titulo}
      </Link>
    ),
  },
  {
    clave: 'ministerio',
    encabezado: 'Ministerio',
    celda: (a) => a.evento.ministerio?.nombre ?? 'General',
    ocultarEnTarjeta: true,
  },
  {
    clave: 'presente',
    encabezado: 'Asistencia',
    celda: (a) =>
      a.presente ? (
        <Badge variante="exito">
          <Check aria-hidden /> Presente
        </Badge>
      ) : (
        <Badge variante="peligro">
          <X aria-hidden /> Ausente
        </Badge>
      ),
  },
];

/**
 * Historial y % de asistencia del miembro (F2-04). El backend limita el historial del COORDINADOR
 * a sus ministerios y omite `resumenAsistencia` si el rol no tiene `asistencia:leer`.
 */
export function AsistenciaDelMiembro({ miembro }: { miembro: MiembroDetalle }) {
  const [page, setPage] = useState(1);
  const consulta = useAsistencias({ miembroId: miembro.id, page });
  const resumen = miembro.resumenAsistencia;

  return (
    <div className="flex flex-col gap-4">
      {resumen && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            titulo={`Asistencia de los últimos ${resumen.meses} meses`}
            valor={resumen.porcentaje === null ? 'Sin registros' : `${resumen.porcentaje} %`}
            descripcion={`${resumen.presentes} de ${resumen.total} eventos`}
            icono={Percent}
          />
          <StatCard
            titulo="Último evento asistido"
            valor={resumen.ultimaAsistencia?.titulo ?? 'Ninguno'}
            descripcion={
              resumen.ultimaAsistencia
                ? formatearFechaHora(resumen.ultimaAsistencia.fechaInicio)
                : undefined
            }
            icono={CalendarCheck}
          />
        </div>
      )}
      <Card>
        {consulta.isPending ? (
          <SkeletonTabla filas={4} columnas={4} />
        ) : consulta.isError ? (
          <ErrorState error={consulta.error} alReintentar={() => consulta.refetch()} />
        ) : consulta.data.data.length === 0 ? (
          <EmptyState icono={CalendarCheck} titulo="Sin asistencia registrada" />
        ) : (
          <>
            <DataTable
              etiqueta="Historial de asistencia"
              columnas={COLUMNAS}
              datos={consulta.data.data}
              obtenerId={(a) => a.id}
            />
            <Paginacion meta={consulta.data.meta} alCambiarPagina={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
