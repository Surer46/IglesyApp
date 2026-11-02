import { Eye, MoreHorizontal, Pencil, Plus, UserCheck, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BadgeEstado } from '@/components/comunes/BadgeEstado';
import { SelectEnum } from '@/components/comunes/CamposFormulario';
import { type Columna, DataTable, type Orden } from '@/components/comunes/DataTable';
import { EmptyState, ErrorState, SkeletonTabla } from '@/components/comunes/Estados';
import { CampoBusqueda, FiltrosBar } from '@/components/comunes/Filtros';
import { PageHeader } from '@/components/comunes/PageHeader';
import { Paginacion } from '@/components/comunes/Paginacion';
import { Puede } from '@/components/comunes/Puede';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMinisterios } from '@/features/ministerios/hooks';
import { useFiltrosURL } from '@/hooks/useFiltrosURL';
import { usePermiso } from '@/hooks/usePermiso';
import { formatearFecha } from '@/lib/formato';
import type { EstadoMiembroFiltro, MiembroLista } from '@/types/miembros';
import { DialogoEstadoMiembro } from '../components/DialogoEstadoMiembro';
import { useMiembros } from '../hooks';

const OPCIONES_ESTADO: { valor: EstadoMiembroFiltro; etiqueta: string }[] = [
  { valor: 'activo', etiqueta: 'Activos' },
  { valor: 'inactivo', etiqueta: 'Inactivos' },
  { valor: 'todos', etiqueta: 'Todos' },
];

const COLUMNAS: Columna<MiembroLista>[] = [
  {
    clave: 'apellidos',
    encabezado: 'Nombre',
    ordenable: true,
    celda: (m) => (
      <Link to={`/miembros/${m.id}`} className="font-medium text-primario hover:underline">
        {m.nombre} {m.apellidos}
      </Link>
    ),
  },
  { clave: 'telefono', encabezado: 'Teléfono', celda: (m) => m.telefono ?? '—' },
  {
    clave: 'email',
    encabezado: 'Correo',
    celda: (m) => m.email ?? '—',
    ocultarEnTarjeta: true,
  },
  {
    clave: 'fechaIngreso',
    encabezado: 'Ingreso',
    ordenable: true,
    celda: (m) => formatearFecha(m.fechaIngreso),
  },
  {
    clave: 'ministerios',
    encabezado: 'Ministerios',
    celda: (m) => (m.ministerios.length > 0 ? m.ministerios.map((x) => x.nombre).join(', ') : '—'),
    ocultarEnTarjeta: true,
  },
  { clave: 'activo', encabezado: 'Estado', celda: (m) => <BadgeEstado activo={m.activo} /> },
];

/** /miembros — listado con búsqueda, filtros en la URL y paginación (F2-01). */
export function MiembrosPage() {
  const navegar = useNavigate();
  const puedeEditar = usePermiso('miembros:editar');
  const puedeDesactivar = usePermiso('miembros:eliminar');
  const [filtros, setFiltros] = useFiltrosURL({
    q: '',
    estado: 'activo',
    ministerioId: '',
    orden: 'apellidos:asc',
    page: 1,
  });
  const consulta = useMiembros({
    q: filtros.q || undefined,
    estado: filtros.estado as EstadoMiembroFiltro,
    ministerioId: filtros.ministerioId || undefined,
    orden: filtros.orden as Orden,
    page: filtros.page,
  });
  const ministerios = useMinisterios();
  const opcionesMinisterio = [
    { valor: 'todos', etiqueta: 'Todos los ministerios' },
    ...(ministerios.data?.data ?? []).map((m) => ({ valor: m.id, etiqueta: m.nombre })),
  ];
  const [porCambiar, setPorCambiar] = useState<MiembroLista | null>(null);

  const hayFiltros = Boolean(filtros.q || filtros.ministerioId || filtros.estado !== 'activo');
  const nuevo = (
    <Button asChild>
      <Link to="/miembros/nuevo">
        <Plus aria-hidden /> Nuevo miembro
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        titulo="Miembros"
        descripcion="Personas de la congregación."
        acciones={<Puede permiso="miembros:crear">{nuevo}</Puede>}
      />

      <FiltrosBar>
        <CampoBusqueda
          valor={filtros.q}
          alCambiar={(q) => setFiltros({ q })}
          placeholder="Buscar por nombre"
        />
        <SelectEnum
          opciones={OPCIONES_ESTADO}
          valor={filtros.estado as EstadoMiembroFiltro}
          alCambiar={(estado) => setFiltros({ estado })}
          className="sm:w-36"
          aria-label="Filtrar por estado"
        />
        <SelectEnum
          opciones={opcionesMinisterio}
          valor={filtros.ministerioId || 'todos'}
          alCambiar={(id) => setFiltros({ ministerioId: id === 'todos' ? '' : id })}
          className="sm:w-52"
          aria-label="Filtrar por ministerio"
        />
      </FiltrosBar>

      <Card>
        {consulta.isPending ? (
          <SkeletonTabla columnas={6} />
        ) : consulta.isError ? (
          <ErrorState error={consulta.error} alReintentar={() => consulta.refetch()} />
        ) : consulta.data.data.length === 0 ? (
          <EmptyState
            icono={Users}
            titulo={hayFiltros ? 'No hay miembros con estos filtros' : 'Aún no hay miembros'}
            descripcion={
              hayFiltros
                ? 'Prueba con otra búsqueda o cambia los filtros.'
                : 'Registra a las personas de la congregación para empezar.'
            }
            accion={<Puede permiso="miembros:crear">{nuevo}</Puede>}
          />
        ) : (
          <>
            <DataTable
              etiqueta="Miembros"
              columnas={COLUMNAS}
              datos={consulta.data.data}
              obtenerId={(m) => m.id}
              alClicFila={(m) => navegar(`/miembros/${m.id}`)}
              orden={filtros.orden as Orden}
              alOrdenar={(orden) => setFiltros({ orden })}
              acciones={(m) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variante="fantasma"
                      tamano="icono"
                      aria-label={`Acciones de ${m.nombre} ${m.apellidos}`}
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => navegar(`/miembros/${m.id}`)}>
                      <Eye aria-hidden /> Ver perfil
                    </DropdownMenuItem>
                    {puedeEditar && (
                      <DropdownMenuItem onSelect={() => navegar(`/miembros/${m.id}/editar`)}>
                        <Pencil aria-hidden /> Editar
                      </DropdownMenuItem>
                    )}
                    {puedeDesactivar &&
                      (m.activo ? (
                        <DropdownMenuItem peligro onSelect={() => setPorCambiar(m)}>
                          <UserX aria-hidden /> Desactivar
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setPorCambiar(m)}>
                          <UserCheck aria-hidden /> Reactivar
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            />
            <Paginacion
              meta={consulta.data.meta}
              alCambiarPagina={(page) => setFiltros({ page })}
            />
          </>
        )}
      </Card>

      <DialogoEstadoMiembro miembro={porCambiar} alCerrar={() => setPorCambiar(null)} />
    </>
  );
}
