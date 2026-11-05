import { ArrowLeft, Pencil, Power, UserCog, UserMinus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BadgeEstado } from '@/components/comunes/BadgeEstado';
import { ConfirmDialog } from '@/components/comunes/ConfirmDialog';
import { type Columna, DataTable } from '@/components/comunes/DataTable';
import { EmptyState, ErrorState, SkeletonTabla } from '@/components/comunes/Estados';
import { CampoBusqueda, FiltrosBar } from '@/components/comunes/Filtros';
import { PageHeader } from '@/components/comunes/PageHeader';
import { Paginacion } from '@/components/comunes/Paginacion';
import { Puede } from '@/components/comunes/Puede';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/controles';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BotonExportar } from '@/features/reportes/components/BotonExportar';
import { usePermiso } from '@/hooks/usePermiso';
import { formatearFecha } from '@/lib/formato';
import { notificar } from '@/lib/notificar';
import type { Integrante, Ministerio } from '@/types/ministerios';
import { ActividadesMinisterio } from '../components/ActividadesMinisterio';
import { AgregarIntegrantesDialog } from '../components/AgregarIntegrantesDialog';
import { CoordinadoresDialog } from '../components/CoordinadoresDialog';
import { MinisterioFormDialog } from '../components/MinisterioFormDialog';
import {
  useCambiarEstadoMinisterio,
  useDesvincularMiembro,
  useIntegrantes,
  useMinisterio,
  usePuedeGestionarIntegrantes,
} from '../hooks';

const COLUMNAS: Columna<Integrante>[] = [
  {
    clave: 'nombre',
    encabezado: 'Nombre',
    celda: (i) => (
      <Link to={`/miembros/${i.id}`} className="font-medium text-primario hover:underline">
        {i.nombre} {i.apellidos}
      </Link>
    ),
  },
  { clave: 'telefono', encabezado: 'Teléfono', celda: (i) => i.telefono ?? '—' },
  { clave: 'fechaUnion', encabezado: 'Se unió', celda: (i) => formatearFecha(i.fechaUnion) },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (i) =>
      i.activo ? (
        <BadgeEstado activo />
      ) : (
        <BadgeEstado etiqueta={`Salió el ${formatearFecha(i.fechaSalida)}`} variante="neutro" />
      ),
  },
];

/** Pestaña de integrantes: búsqueda, históricos, agregar y quitar (F2-10). */
function Integrantes({ ministerio }: { ministerio: Ministerio }) {
  const puedeGestionar = usePuedeGestionarIntegrantes()(ministerio);
  const [q, setQ] = useState('');
  const [historicos, setHistoricos] = useState(false);
  const [page, setPage] = useState(1);
  const consulta = useIntegrantes(ministerio.id, {
    q: q || undefined,
    incluirHistoricos: historicos || undefined,
    page,
  });
  const desvincular = useDesvincularMiembro();
  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [porQuitar, setPorQuitar] = useState<Integrante | null>(null);

  const agregar = puedeGestionar && ministerio.activo && (
    <Button onClick={() => setAgregarAbierto(true)}>
      <UserPlus aria-hidden /> Agregar integrantes
    </Button>
  );

  return (
    <>
      <FiltrosBar className="sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <CampoBusqueda
            valor={q}
            alCambiar={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Buscar integrante"
          />
          <div className="flex items-center gap-2">
            <Switch
              id="ver-historicos"
              checked={historicos}
              onCheckedChange={(v) => {
                setHistoricos(v);
                setPage(1);
              }}
            />
            <Label htmlFor="ver-historicos">Ver históricos</Label>
          </div>
        </div>
        {agregar}
      </FiltrosBar>

      <Card>
        {consulta.isPending ? (
          <SkeletonTabla columnas={4} />
        ) : consulta.isError ? (
          <ErrorState error={consulta.error} alReintentar={() => consulta.refetch()} />
        ) : consulta.data.data.length === 0 ? (
          <EmptyState
            icono={Users}
            titulo={
              q
                ? 'Ningún integrante coincide con la búsqueda'
                : 'Este ministerio aún no tiene integrantes'
            }
            accion={!q && agregar}
          />
        ) : (
          <>
            <DataTable
              etiqueta="Integrantes"
              columnas={COLUMNAS}
              datos={consulta.data.data}
              obtenerId={(i) => i.id}
              acciones={
                puedeGestionar
                  ? (i) =>
                      i.activo && (
                        <Button
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => setPorQuitar(i)}
                          aria-label={`Quitar a ${i.nombre} ${i.apellidos}`}
                        >
                          <UserMinus aria-hidden /> Quitar
                        </Button>
                      )
                  : undefined
              }
            />
            <Paginacion meta={consulta.data.meta} alCambiarPagina={setPage} />
          </>
        )}
      </Card>

      {puedeGestionar && agregarAbierto && (
        <AgregarIntegrantesDialog
          abierto={agregarAbierto}
          alCambiarAbierto={setAgregarAbierto}
          ministerio={ministerio}
        />
      )}
      <ConfirmDialog
        abierto={porQuitar !== null}
        alCambiarAbierto={(abierto) => !abierto && setPorQuitar(null)}
        titulo="Quitar integrante"
        descripcion={`${porQuitar?.nombre} ${porQuitar?.apellidos} saldrá de ${ministerio.nombre}. Su participación quedará en el historial.`}
        textoConfirmar="Quitar"
        peligro
        alConfirmar={async () => {
          await desvincular.mutateAsync({ id: ministerio.id, miembroId: porQuitar!.id });
          notificar.exito('Integrante quitado');
        }}
      />
    </>
  );
}

/** /ministerios/:id — encabezado, coordinadores, integrantes y actividades (F2-09…F2-11). */
export function MinisterioDetallePage() {
  const { id } = useParams();
  const consulta = useMinisterio(id);
  const cambiarEstado = useCambiarEstadoMinisterio();
  const reportesCompletos = usePermiso('reportes:generales');
  const coordinaOGestiona = usePuedeGestionarIntegrantes();
  const [editarAbierto, setEditarAbierto] = useState(false);
  const [coordinadoresAbierto, setCoordinadoresAbierto] = useState(false);
  const [estadoAbierto, setEstadoAbierto] = useState(false);

  if (consulta.isPending) {
    return (
      <Card>
        <SkeletonTabla filas={4} columnas={3} />
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

  const ministerio = consulta.data;

  return (
    <>
      <PageHeader
        titulo={ministerio.nombre}
        descripcion={<BadgeEstado activo={ministerio.activo} />}
        acciones={
          <>
            <Button variante="contorno" asChild>
              <Link to="/ministerios">
                <ArrowLeft aria-hidden /> Ministerios
              </Link>
            </Button>
            {/* COORDINADOR: el backend solo le permite el reporte de sus ministerios */}
            {(reportesCompletos || coordinaOGestiona(ministerio)) && (
              <BotonExportar tipo="ministerios" filtros={{ ministerioId: ministerio.id }} />
            )}
            <Puede permiso="ministerios:editar">
              <Button variante="contorno" onClick={() => setEditarAbierto(true)}>
                <Pencil aria-hidden /> Editar
              </Button>
            </Puede>
            <Puede permiso="ministerios:eliminar">
              <Button
                variante={ministerio.activo ? 'peligro' : 'primario'}
                onClick={() => setEstadoAbierto(true)}
              >
                <Power aria-hidden /> {ministerio.activo ? 'Desactivar' : 'Reactivar'}
              </Button>
            </Puede>
          </>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-texto-suave">{ministerio.descripcion ?? 'Sin descripción.'}</p>
            <p className="mt-2 text-sm">
              <span className="font-medium">Coordinación: </span>
              {ministerio.coordinadores.length > 0
                ? ministerio.coordinadores.map((c) => c.nombre).join(', ')
                : 'sin asignar'}
            </p>
            <p className="text-sm text-texto-suave">
              {ministerio.totalIntegrantes}{' '}
              {ministerio.totalIntegrantes === 1 ? 'integrante' : 'integrantes'}
            </p>
          </div>
          {/* Solo ADMIN y PASTOR asignan coordinadores */}
          <Puede permiso="ministerios:editar">
            <Button variante="contorno" onClick={() => setCoordinadoresAbierto(true)}>
              <UserCog aria-hidden /> Editar coordinadores
            </Button>
          </Puede>
        </CardContent>
      </Card>

      <Tabs defaultValue="integrantes">
        <TabsList>
          <TabsTrigger value="integrantes">Integrantes</TabsTrigger>
          <TabsTrigger value="actividades">Actividades</TabsTrigger>
        </TabsList>
        <TabsContent value="integrantes">
          <Integrantes ministerio={ministerio} />
        </TabsContent>
        <TabsContent value="actividades">
          <ActividadesMinisterio ministerio={ministerio} />
        </TabsContent>
      </Tabs>

      <MinisterioFormDialog
        abierto={editarAbierto}
        alCambiarAbierto={setEditarAbierto}
        ministerio={ministerio}
      />
      {/* Se monta al abrir; solo ADMIN y PASTOR lo abren (consulta /usuarios/opciones) */}
      {coordinadoresAbierto && (
        <CoordinadoresDialog
          abierto={coordinadoresAbierto}
          alCambiarAbierto={setCoordinadoresAbierto}
          ministerio={ministerio}
        />
      )}
      <ConfirmDialog
        abierto={estadoAbierto}
        alCambiarAbierto={setEstadoAbierto}
        titulo={ministerio.activo ? 'Desactivar ministerio' : 'Reactivar ministerio'}
        descripcion={
          ministerio.activo
            ? 'El ministerio dejará de aparecer entre los activos. Se conservan sus integrantes, coordinadores e historial.'
            : 'El ministerio volverá a estar activo con sus integrantes y coordinadores.'
        }
        textoConfirmar={ministerio.activo ? 'Desactivar' : 'Reactivar'}
        peligro={ministerio.activo}
        alConfirmar={async () => {
          await cambiarEstado.mutateAsync({ id: ministerio.id, activo: !ministerio.activo });
          notificar.exito(ministerio.activo ? 'Ministerio desactivado' : 'Ministerio reactivado');
        }}
      />
    </>
  );
}
