import { http, HttpResponse } from 'msw';
import type { Anuncio, Cartelera, GuardarAnuncio } from '@/types/anuncios';
import type { DetalleError } from '@/types/comunes';
import type { AnuncioMock } from '../datos/b3';
import { db } from '../db';
import { ahora, autenticar, errorApi, paginarMock, ruta } from '../utils';
import { marcarRealizados } from './eventos';

// Simulación de backend/src/modules/anuncios y public (B3)

const noExiste = () => errorApi(404, 'NOT_FOUND', 'El anuncio no existe.');

function esVigente(a: AnuncioMock, ya = Date.now()) {
  return (
    Date.parse(a.fechaPublicacion) <= ya &&
    (a.fechaExpiracion === null || Date.parse(a.fechaExpiracion) > ya)
  );
}

/** IMPORTANTE primero y luego los más recientes */
function ordenar(a: AnuncioMock, b: AnuncioMock) {
  if (a.prioridad !== b.prioridad) return a.prioridad === 'IMPORTANTE' ? -1 : 1;
  return b.fechaPublicacion.localeCompare(a.fechaPublicacion);
}

function formatear({ eventoId, autorId, ...a }: AnuncioMock): Anuncio {
  const autor = db.usuarios.find((u) => u.id === autorId);
  const e = eventoId ? db.eventos.find((x) => x.id === eventoId) : undefined;
  return {
    ...a,
    autor: { id: autorId, nombre: autor?.nombre ?? '—' },
    evento: e ? { id: e.id, titulo: e.titulo, fechaInicio: e.fechaInicio, estado: e.estado } : null,
  };
}

function validar(datos: Partial<GuardarAnuncio>, actual?: AnuncioMock): Response | null {
  const errores: DetalleError[] = [];
  if (datos.titulo !== undefined && (!datos.titulo.trim() || datos.titulo.length > 120)) {
    errores.push({ campo: 'titulo', mensaje: 'El título es obligatorio (máximo 120).' });
  }
  if (datos.contenido !== undefined && (!datos.contenido.trim() || datos.contenido.length > 5000)) {
    errores.push({ campo: 'contenido', mensaje: 'El contenido es obligatorio (máximo 5 000).' });
  }
  const publicacion = datos.fechaPublicacion ?? actual?.fechaPublicacion ?? ahora();
  const expiracion =
    datos.fechaExpiracion === undefined ? actual?.fechaExpiracion : datos.fechaExpiracion;
  if (expiracion && Date.parse(expiracion) <= Date.parse(publicacion)) {
    errores.push({
      campo: 'fechaExpiracion',
      mensaje: 'La expiración debe ser posterior a la publicación.',
    });
  }
  if (errores.length > 0) {
    return errorApi(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', errores);
  }
  if (datos.eventoId && datos.eventoId !== actual?.eventoId) {
    const e = db.eventos.find((x) => x.id === datos.eventoId);
    if (!e) return errorApi(422, 'BUSINESS_RULE', 'El evento vinculado no existe.');
    if (e.estado === 'CANCELADO') {
      return errorApi(422, 'BUSINESS_RULE', 'No se puede vincular un evento cancelado.');
    }
  }
  return null;
}

export const anunciosHandlers = [
  http.get(ruta('/anuncios'), ({ request }) => {
    const usuario = autenticar(request, 'anuncios:leer');
    if (usuario instanceof Response) return usuario;
    const url = new URL(request.url);
    const vigentes = url.searchParams.get('vigentes');
    const prioridad = url.searchParams.get('prioridad');
    const estado = url.searchParams.get('estado');
    const ya = Date.now();
    const enEstado = (a: AnuncioMock) =>
      !estado ||
      (estado === 'vigentes'
        ? esVigente(a, ya)
        : estado === 'programados'
          ? Date.parse(a.fechaPublicacion) > ya
          : Date.parse(a.fechaPublicacion) <= ya && !esVigente(a, ya));
    const q = url.searchParams.get('q')?.toLowerCase();
    const lista = db.anuncios
      .filter((a) => vigentes === null || String(esVigente(a)) === vigentes)
      .filter((a) => !prioridad || a.prioridad === prioridad)
      .filter(enEstado)
      .filter((a) => !q || a.titulo.toLowerCase().includes(q))
      .sort(ordenar)
      .map(formatear);
    return paginarMock(lista, url);
  }),

  http.get(ruta('/anuncios/:id'), ({ request, params }) => {
    const usuario = autenticar(request, 'anuncios:leer');
    if (usuario instanceof Response) return usuario;
    const a = db.anuncios.find((x) => x.id === params.id);
    return a ? HttpResponse.json({ data: formatear(a) }) : noExiste();
  }),

  http.post(ruta('/anuncios'), async ({ request }) => {
    const usuario = autenticar(request, 'anuncios:crear');
    if (usuario instanceof Response) return usuario;
    const datos = (await request.json()) as GuardarAnuncio;
    const error = validar(datos);
    if (error) return error;
    const nuevo: AnuncioMock = {
      id: `an-${crypto.randomUUID()}`,
      titulo: datos.titulo.trim(),
      contenido: datos.contenido.trim(),
      prioridad: datos.prioridad ?? 'NORMAL',
      fechaPublicacion: datos.fechaPublicacion ?? ahora(),
      fechaExpiracion: datos.fechaExpiracion ?? null,
      eventoId: datos.eventoId ?? null,
      autorId: usuario.id,
      createdAt: ahora(),
      updatedAt: ahora(),
    };
    db.anuncios.push(nuevo);
    return HttpResponse.json({ data: formatear(nuevo) }, { status: 201 });
  }),

  http.patch(ruta('/anuncios/:id'), async ({ request, params }) => {
    const usuario = autenticar(request, 'anuncios:editar');
    if (usuario instanceof Response) return usuario;
    const a = db.anuncios.find((x) => x.id === params.id);
    if (!a) return noExiste();
    const datos = (await request.json()) as Partial<GuardarAnuncio>;
    const error = validar(datos, a);
    if (error) return error;
    Object.assign(a, datos, { updatedAt: ahora() });
    return HttpResponse.json({ data: formatear(a) });
  }),

  http.delete(ruta('/anuncios/:id'), ({ request, params }) => {
    const usuario = autenticar(request, 'anuncios:eliminar');
    if (usuario instanceof Response) return usuario;
    if (!db.anuncios.some((x) => x.id === params.id)) return noExiste();
    db.anuncios = db.anuncios.filter((x) => x.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  // Cartelera pública: sin autenticación y solo datos públicos
  http.get(ruta('/public/cartelera'), () => {
    marcarRealizados();
    const { nombre, logoUrl, direccion, ciudad, telefono, email, sitioWeb } = db.configuracion;
    const data: Cartelera = {
      iglesia: { nombre, logoUrl, direccion, ciudad, telefono, email, sitioWeb },
      horarios: db.horarios.filter((h) => h.activo).map(({ activo: _a, ...h }) => h),
      anuncios: db.anuncios
        .filter((a) => esVigente(a))
        .sort(ordenar)
        .slice(0, 10)
        .map(({ id, titulo, contenido, prioridad, fechaPublicacion, fechaExpiracion }) => ({
          id,
          titulo,
          contenido,
          prioridad,
          fechaPublicacion,
          fechaExpiracion,
        })),
      eventosProximos: db.eventos
        .filter((e) => e.estado === 'PROGRAMADO' && Date.parse(e.fechaInicio) >= Date.now())
        .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
        .slice(0, 10)
        .map(({ id, titulo, descripcion, tipo, categoria, fechaInicio, fechaFin, lugar }) => ({
          id,
          titulo,
          descripcion,
          tipo,
          categoria,
          fechaInicio,
          fechaFin,
          lugar,
        })),
    };
    return HttpResponse.json({ data });
  }),
];
