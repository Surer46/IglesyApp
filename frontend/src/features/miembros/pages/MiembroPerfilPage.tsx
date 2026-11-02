import { ArrowLeft, HandCoins, Pencil, UserCheck, UserX } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { BadgeEstado } from '@/components/comunes/BadgeEstado';
import { EmptyState, ErrorState, SkeletonTabla } from '@/components/comunes/Estados';
import { PageHeader } from '@/components/comunes/PageHeader';
import { Puede } from '@/components/comunes/Puede';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermiso } from '@/hooks/usePermiso';
import { formatearFecha } from '@/lib/formato';
import { AsistenciaDelMiembro } from '../components/AsistenciaDelMiembro';
import { DialogoEstadoMiembro } from '../components/DialogoEstadoMiembro';
import { MinisteriosDelMiembro } from '../components/MinisteriosDelMiembro';
import { useMiembro } from '../hooks';
import type { EstadoPerfilMiembro } from './MiembroFormPage';

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-texto-suave">{etiqueta}</dt>
      <dd className="min-w-0 break-words">{children || '—'}</dd>
    </div>
  );
}

/** /miembros/:id — perfil con datos, ministerios, asistencia y aportaciones (F2-04). */
export function MiembroPerfilPage() {
  const { id } = useParams();
  const { state } = useLocation() as { state: EstadoPerfilMiembro | null };
  const consulta = useMiembro(id);
  const verAsistencia = usePermiso('asistencia:leer', 'asistencia:leer-propio');
  const verAportaciones = usePermiso('donaciones:leer');
  const [cambiarEstado, setCambiarEstado] = useState(false);

  if (consulta.isPending) {
    return (
      <Card>
        <SkeletonTabla filas={6} columnas={2} />
      </Card>
    );
  }
  if (consulta.isError) {
    return (
      <Card>
        <ErrorState error={consulta.error} alReintentar={() => consulta.refetch()} />
      </Card>
    );
  }

  const miembro = consulta.data;
  const nombre = `${miembro.nombre} ${miembro.apellidos}`;

  return (
    <>
      <PageHeader
        titulo={nombre}
        descripcion={<BadgeEstado activo={miembro.activo} />}
        acciones={
          <>
            <Button variante="contorno" asChild>
              <Link to="/miembros">
                <ArrowLeft aria-hidden /> Miembros
              </Link>
            </Button>
            <Puede permiso="miembros:editar">
              <Button variante="contorno" asChild>
                <Link to={`/miembros/${miembro.id}/editar`}>
                  <Pencil aria-hidden /> Editar
                </Link>
              </Button>
            </Puede>
            <Puede permiso="miembros:eliminar">
              <Button
                variante={miembro.activo ? 'peligro' : 'primario'}
                onClick={() => setCambiarEstado(true)}
              >
                {miembro.activo ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
                {miembro.activo ? 'Desactivar' : 'Reactivar'}
              </Button>
            </Puede>
          </>
        }
      />

      {state?.duplicadoId && state.duplicadoId !== miembro.id && (
        <Alert variante="info" className="mb-4">
          Ya existía un miembro con el mismo nombre.{' '}
          <Link to={`/miembros/${state.duplicadoId}`} className="font-medium underline">
            Ver el posible duplicado
          </Link>
        </Alert>
      )}

      <Tabs defaultValue="datos">
        <TabsList>
          <TabsTrigger value="datos">Datos</TabsTrigger>
          {verAsistencia && <TabsTrigger value="asistencia">Asistencia</TabsTrigger>}
          {verAportaciones && <TabsTrigger value="aportaciones">Aportaciones</TabsTrigger>}
        </TabsList>

        <TabsContent value="datos" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Datos personales</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <Dato etiqueta="Teléfono">{miembro.telefono}</Dato>
                <Dato etiqueta="Correo">{miembro.email}</Dato>
                <Dato etiqueta="Fecha de ingreso">{formatearFecha(miembro.fechaIngreso)}</Dato>
                <Dato etiqueta="Nacimiento">
                  {miembro.fechaNacimiento && formatearFecha(miembro.fechaNacimiento)}
                </Dato>
                <Dato etiqueta="Dirección">{miembro.direccion}</Dato>
                <Dato etiqueta="Notas">{miembro.notas}</Dato>
                {!miembro.activo && (
                  <>
                    <Dato etiqueta="Fecha de baja">{formatearFecha(miembro.fechaBaja)}</Dato>
                    <Dato etiqueta="Motivo de baja">{miembro.motivoBaja}</Dato>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
          <MinisteriosDelMiembro miembro={miembro} />
        </TabsContent>

        {/* Solo con permiso de asistencia: el TESORERO no la ve (specs.md §3) */}
        {verAsistencia && (
          <TabsContent value="asistencia">
            <AsistenciaDelMiembro miembro={miembro} />
          </TabsContent>
        )}

        {/* Solo con donaciones:leer. Se conecta con la lista resumida de F4 */}
        {verAportaciones && (
          <TabsContent value="aportaciones">
            <Card>
              <EmptyState
                icono={HandCoins}
                titulo="Aportaciones"
                descripcion="Aquí se mostrarán las aportaciones del miembro cuando el módulo de donaciones esté disponible."
              />
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <DialogoEstadoMiembro
        miembro={cambiarEstado ? miembro : null}
        alCerrar={() => setCambiarEstado(false)}
      />
    </>
  );
}
