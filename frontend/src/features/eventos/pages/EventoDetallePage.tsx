import { ArrowLeft, Ban, ClipboardCheck, MapPin, Pencil, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/comunes/ConfirmDialog';
import { ErrorState, SkeletonTabla } from '@/components/comunes/Estados';
import { PageHeader } from '@/components/comunes/PageHeader';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ETIQUETAS_CATEGORIA_EVENTO,
  ETIQUETAS_TIPO_EVENTO,
  formatearFechaHora,
  formatearFechaLarga,
} from '@/lib/formato';
import { esErrorApi } from '@/lib/api';
import { notificar } from '@/lib/notificar';
import type { ErrorApi } from '@/types/comunes';
import type { EventoDetalle } from '@/types/eventos';
import { BadgeEstadoEvento } from '../components/categorias';
import { ESTILO_CATEGORIA } from '../estilos';
import { ResponsablesDialog } from '../components/ResponsablesDialog';
import { useCancelarEvento, useEvento } from '../hooks';
import { usePuedeGestionar } from '../permisos';

const MIN_MOTIVO = 5;

/** Error con el formato de la API para que ConfirmDialog muestre el mensaje del campo. */
function errorMotivo(message: string): ErrorApi {
  return { status: 400, code: 'VALIDATION_ERROR', message };
}

/** /eventos/:id: datos, responsables, resumen de asistencia y acciones según permisos y estado (F3-03). */
export function EventoDetallePage() {
  const { id } = useParams();
  const consulta = useEvento(id);

  if (consulta.isPending) {
    return (
      <>
        <PageHeader titulo="Evento" />
        <Card>
          <SkeletonTabla filas={4} columnas={2} />
        </Card>
      </>
    );
  }
  if (consulta.isError) {
    return (
      <>
        <PageHeader titulo="Evento" />
        <Card>
          <ErrorState error={consulta.error} alReintentar={() => consulta.refetch()} />
        </Card>
      </>
    );
  }
  return <DetalleEvento evento={consulta.data} />;
}

function DetalleEvento({ evento }: { evento: EventoDetalle }) {
  const cancelar = useCancelarEvento();
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const [editarResponsables, setEditarResponsables] = useState(false);
  const ministerioId = evento.ministerio?.id;
  const puedeEditar = usePuedeGestionar('eventos:editar', 'eventos:editar-propio')(ministerioId);
  const puedeCancelar = usePuedeGestionar(
    'eventos:eliminar',
    'eventos:eliminar-propio',
  )(ministerioId);
  const puedeAsistencia = usePuedeGestionar(
    'asistencia:leer',
    'asistencia:leer-propio',
  )(ministerioId);
  const cancelado = evento.estado === 'CANCELADO';
  const { icono: Icono } = ESTILO_CATEGORIA[evento.categoria];

  return (
    <>
      <PageHeader
        titulo={evento.titulo}
        descripcion={
          <span className="flex flex-wrap items-center gap-2">
            <BadgeEstadoEvento estado={evento.estado} />
            <span className="inline-flex items-center gap-1">
              <Icono className="size-4" aria-hidden />
              {ETIQUETAS_CATEGORIA_EVENTO[evento.categoria]} · {ETIQUETAS_TIPO_EVENTO[evento.tipo]}
            </span>
          </span>
        }
        acciones={
          <>
            <Button variante="contorno" asChild>
              <Link to="/eventos">
                <ArrowLeft aria-hidden /> Calendario
              </Link>
            </Button>
            {/* Un evento cancelado no se edita ni se le pasa lista */}
            {!cancelado && puedeAsistencia && (
              <Button asChild>
                <Link to={`/eventos/${evento.id}/asistencia`}>
                  <ClipboardCheck aria-hidden /> Pasar lista
                </Link>
              </Button>
            )}
            {!cancelado && puedeEditar && (
              <Button variante="contorno" asChild>
                <Link to={`/eventos/${evento.id}/editar`}>
                  <Pencil aria-hidden /> Editar
                </Link>
              </Button>
            )}
            {!cancelado && puedeCancelar && (
              <Button variante="peligro" onClick={() => setConfirmarCancelar(true)}>
                <Ban aria-hidden /> Cancelar evento
              </Button>
            )}
          </>
        }
      />

      {cancelado && (
        <Alert variante="peligro" className="mb-4">
          <strong>Evento cancelado.</strong> Motivo: {evento.motivoCancelacion ?? 'sin motivo'}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Datos del evento</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
              <dt className="text-texto-suave">Fecha</dt>
              <dd className="first-letter:uppercase">{formatearFechaLarga(evento.fechaInicio)}</dd>
              <dt className="text-texto-suave">Horario</dt>
              <dd>
                {formatearFechaHora(evento.fechaInicio)}
                {evento.fechaFin && ` – ${formatearFechaHora(evento.fechaFin)}`}
              </dd>
              <dt className="text-texto-suave">Lugar</dt>
              <dd className="flex items-center gap-1">
                <MapPin className="size-4" aria-hidden /> {evento.lugar}
              </dd>
              <dt className="text-texto-suave">Ministerio</dt>
              <dd>
                {evento.ministerio ? (
                  <Link
                    className="text-primario hover:underline"
                    to={`/ministerios/${evento.ministerio.id}`}
                  >
                    {evento.ministerio.nombre}
                  </Link>
                ) : (
                  'General'
                )}
              </dd>
              <dt className="text-texto-suave">Descripción</dt>
              <dd className="whitespace-pre-line">{evento.descripcion ?? '—'}</dd>
              <dt className="text-texto-suave">Creado por</dt>
              <dd>{evento.creadoPor.nombre}</dd>
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Responsables</CardTitle>
              {!cancelado && puedeEditar && (
                <Button variante="contorno" tamano="sm" onClick={() => setEditarResponsables(true)}>
                  <UsersRound aria-hidden /> Editar
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {evento.responsables.length === 0 ? (
                <p className="text-texto-suave">Sin responsables asignados.</p>
              ) : (
                <ul aria-label="Responsables" className="flex flex-col gap-1">
                  {evento.responsables.map((r) => (
                    <li key={r.id}>
                      <Link className="hover:underline" to={`/miembros/${r.id}`}>
                        {r.nombre} {r.apellidos}
                      </Link>
                      {!r.activo && <span className="text-texto-suave"> (inactivo)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Asistencia</CardTitle>
            </CardHeader>
            <CardContent>
              {evento.resumenAsistencia ? (
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-xs text-texto-suave">Presentes</dt>
                    <dd className="text-xl font-semibold text-exito">
                      {evento.resumenAsistencia.presentes}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-texto-suave">Ausentes</dt>
                    <dd className="text-xl font-semibold text-peligro">
                      {evento.resumenAsistencia.ausentes}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-texto-suave">Registrados</dt>
                    <dd className="text-xl font-semibold">{evento.resumenAsistencia.total}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-texto-suave">Aún no se ha pasado lista.</p>
              )}
              {puedeAsistencia && evento.resumenAsistencia && (
                <Button variante="enlace" className="mt-2 px-0" asChild>
                  <Link to={`/asistencia?tab=historial&eventoId=${evento.id}`}>Ver historial</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        abierto={confirmarCancelar}
        alCambiarAbierto={setConfirmarCancelar}
        titulo="Cancelar evento"
        descripcion="El evento quedará como cancelado (no se borra) y no se podrá pasar lista. La asistencia ya registrada se conserva."
        textoConfirmar="Cancelar evento"
        peligro
        motivo="obligatorio"
        alConfirmar={async (motivo) => {
          // ConfirmDialog muestra el `message`: se valida aquí con el mismo límite que el backend
          if ((motivo ?? '').length < MIN_MOTIVO) {
            throw errorMotivo(`El motivo debe tener al menos ${MIN_MOTIVO} caracteres.`);
          }
          try {
            await cancelar.mutateAsync({ id: evento.id, motivo: motivo ?? '' });
          } catch (error) {
            const detalle = esErrorApi(error) ? error.details?.[0]?.mensaje : undefined;
            throw detalle ? errorMotivo(detalle) : error;
          }
          notificar.exito('Evento cancelado');
        }}
      />
      <ResponsablesDialog
        evento={evento}
        abierto={editarResponsables}
        alCambiarAbierto={setEditarResponsables}
      />
    </>
  );
}
