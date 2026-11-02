import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Paginacion } from '@/components/comunes/Paginacion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListaEventos } from '@/features/eventos/components/ListaEventos';
import { useEventos } from '@/features/eventos/hooks';
import { usePuedeGestionar } from '@/features/eventos/permisos';
import type { Ministerio } from '@/types/ministerios';

const MAX_PROXIMOS = 20;
const POR_PAGINA = 10;

/** Pestaña Actividades: próximos eventos y pasados del ministerio, con la lista de F3 (F2-11). */
export function ActividadesMinisterio({ ministerio }: { ministerio: Ministerio }) {
  // Instante fijo: si cambiara en cada render, también cambiaría la consulta
  const [ahora] = useState(() => new Date().toISOString());
  const [page, setPage] = useState(1);
  const puedeCrear = usePuedeGestionar('eventos:crear', 'eventos:crear-propio')(ministerio.id);

  const proximos = useEventos({
    ministerioId: ministerio.id,
    desde: ahora,
    orden: 'fechaInicio:asc',
    limit: MAX_PROXIMOS,
  });
  const pasados = useEventos({
    ministerioId: ministerio.id,
    hasta: ahora,
    orden: 'fechaInicio:desc',
    limit: POR_PAGINA,
    page,
  });

  const listaProximos = [...(proximos.data?.data ?? [])].sort((a, b) =>
    a.fechaInicio.localeCompare(b.fechaInicio),
  );
  // Un evento en curso coincide con ambas consultas: se muestra solo en próximos
  const idsProximos = new Set(listaProximos.map((e) => e.id));
  const listaPasados = pasados.data?.data.filter((e) => !idsProximos.has(e.id));

  return (
    <div className="flex flex-col gap-4">
      {puedeCrear && ministerio.activo && (
        <div className="flex justify-end">
          <Button asChild>
            <Link to={`/eventos/nuevo?ministerioId=${ministerio.id}`}>
              <Plus aria-hidden /> Nuevo evento
            </Link>
          </Button>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Próximos eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <ListaEventos
            etiqueta="Próximos eventos"
            eventos={listaProximos}
            cargando={proximos.isPending}
            error={proximos.error}
            alReintentar={() => proximos.refetch()}
            vacio="No hay eventos programados."
            conEstado
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Eventos pasados</CardTitle>
        </CardHeader>
        <CardContent>
          <ListaEventos
            etiqueta="Eventos pasados"
            eventos={listaPasados}
            cargando={pasados.isPending}
            error={pasados.error}
            alReintentar={() => pasados.refetch()}
            vacio="Todavía no hay eventos pasados."
            conEstado
          />
        </CardContent>
        {pasados.data && <Paginacion meta={pasados.data.meta} alCambiarPagina={setPage} />}
      </Card>
    </div>
  );
}
