/**
 * Service de eventos (B3). Funciones para otros módulos:
 * - `proximos(limit)` → eventos programados desde ahora (dashboard B4, cartelera B3-15).
 * - `contarPorRango(desde, hasta)` → eventos no cancelados en el rango (dashboard B4).
 * - `obtenerParaAsistencia(id)` → datos mínimos del evento para el pase de lista (asistencia B3).
 * - `verificarGestionaEvento(solicitante, ministerioId, ...)` → regla "-propio" del COORDINADOR.
 */
import { type Permiso, type RolUsuario, tienePermiso } from '../../config/permisos';
import { Prisma } from '../../generated/prisma/client';
import { AppError, type DetalleError } from '../../lib/appError';
import { crearMeta, ordenar, paginar } from '../../lib/paginacion';
import { prisma } from '../../lib/prisma';
import { esCoordinadorDe } from '../../middlewares/auth';
import * as miembrosService from '../miembros/miembros.service';
import * as ministeriosService from '../ministerios/ministerios.service';
import { esFechaSola, finDiaEnZona, inicioDiaEnZona, zonaIglesia } from './eventos.fechas';
import {
  type CrearEvento,
  type EditarEvento,
  MAX_EVENTOS_RANGO,
  type QueryEventos,
} from './eventos.schemas';

const NO_EXISTE = 'El evento no existe.';

export interface Solicitante {
  id: string;
  rol: RolUsuario;
}

const SELECT_EVENTO = {
  id: true,
  titulo: true,
  descripcion: true,
  tipo: true,
  categoria: true,
  fechaInicio: true,
  fechaFin: true,
  lugar: true,
  estado: true,
  motivoCancelacion: true,
  createdAt: true,
  updatedAt: true,
  ministerio: { select: { id: true, nombre: true } },
  _count: { select: { responsables: true } },
} as const satisfies Prisma.EventoSelect;

const SELECT_DETALLE = {
  ...SELECT_EVENTO,
  creadoPor: { select: { id: true, nombre: true } },
  responsables: {
    select: { miembro: { select: { id: true, nombre: true, apellidos: true, activo: true } } },
    orderBy: [{ miembro: { apellidos: 'asc' } }, { miembro: { nombre: 'asc' } }],
  },
} as const satisfies Prisma.EventoSelect;

type EventoBd = Prisma.EventoGetPayload<{ select: typeof SELECT_EVENTO }>;

function formatear({ _count, ...e }: EventoBd) {
  return { ...e, totalResponsables: _count.responsables };
}

// ───────── Reglas comunes ─────────

/**
 * ADMIN/PASTOR/SECRETARIO (permiso completo) siempre; COORDINADOR (variante "-propio") solo si el
 * ministerio existe y lo coordina. Sin ministerio o de otro ministerio → 403.
 */
export async function verificarGestionaEvento(
  solicitante: Solicitante,
  ministerioId: string | null | undefined,
  completo: Permiso,
  propio: Permiso,
  mensaje = 'Solo puedes gestionar eventos de los ministerios que coordinas.',
) {
  if (tienePermiso(solicitante.rol, completo)) return;
  if (
    tienePermiso(solicitante.rol, propio) &&
    ministerioId &&
    (await esCoordinadorDe(solicitante.id, ministerioId))
  ) {
    return;
  }
  throw AppError.prohibido(mensaje);
}

/** El ministerio debe existir y estar activo → si no, 422. */
async function verificarMinisterio(ministerioId: string | null | undefined) {
  if (!ministerioId) return;
  // Datos de B2 por su service (AGENTS.md §3); su 404 aquí es una regla de negocio (422)
  const ministerio = await ministeriosService.obtener(ministerioId).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      throw AppError.reglaNegocio('El ministerio no existe.');
    }
    throw error;
  });
  if (!ministerio.activo) {
    throw AppError.reglaNegocio('No se pueden programar eventos de un ministerio inactivo.');
  }
}

/**
 * B3-06: los eventos PROGRAMADO cuya fecha (fin, o inicio si no tiene fin) ya pasó se marcan
 * REALIZADO. Se ejecuta al consultar (sin tareas programadas ni dependencias nuevas).
 */
const INTERVALO_MARCA_MS = 60_000;
let ultimaMarca = 0;

/** Pruebas: permite volver a marcar sin esperar el intervalo. */
export function reiniciarMarcaRealizados() {
  ultimaMarca = 0;
}

/**
 * A lo más una vez por minuto por proceso (auditoría A1-B3-03): las lecturas no escriben en cada
 * petición. Un evento puede tardar hasta un minuto en verse REALIZADO; `proximos()` ya filtra por fecha.
 */
export async function marcarRealizados(ahora = new Date()) {
  if (ahora.getTime() - ultimaMarca < INTERVALO_MARCA_MS) return 0;
  ultimaMarca = ahora.getTime();
  const { count } = await prisma.evento.updateMany({
    where: {
      estado: 'PROGRAMADO',
      OR: [{ fechaFin: { lt: ahora } }, { fechaFin: null, fechaInicio: { lt: ahora } }],
    },
    data: { estado: 'REALIZADO' },
  });
  return count;
}

async function estadoOFallar(id: string) {
  const evento = await prisma.evento.findUnique({
    where: { id },
    select: { id: true, estado: true, ministerioId: true, fechaInicio: true, fechaFin: true },
  });
  if (!evento) throw AppError.noEncontrado(NO_EXISTE);
  return evento;
}

function noCancelado(estado: string, mensaje = 'Un evento cancelado no se puede editar.') {
  if (estado === 'CANCELADO') throw AppError.reglaNegocio(mensaje);
}

// ───────── Consultas (B3-02, B3-03, B3-06) ─────────

/** Eventos que se cruzan con [desde, hasta]: empiezan antes de `hasta` y terminan después de `desde`. */
function whereRango(desde?: Date, hasta?: Date): Prisma.EventoWhereInput {
  const condiciones: Prisma.EventoWhereInput[] = [];
  if (hasta) condiciones.push({ fechaInicio: { lte: hasta } });
  if (desde) {
    condiciones.push({
      OR: [{ fechaFin: { gte: desde } }, { fechaFin: null, fechaInicio: { gte: desde } }],
    });
  }
  return condiciones.length > 0 ? { AND: condiciones } : {};
}

/** "yyyy-MM-dd" o ISO → instante; una fecha sola usa el día de la zona horaria de la iglesia. */
async function aInstantes(desde?: string, hasta?: string) {
  const zona =
    (desde && esFechaSola(desde)) || (hasta && esFechaSola(hasta)) ? await zonaIglesia() : '';
  return {
    desde: desde
      ? esFechaSola(desde)
        ? inicioDiaEnZona(desde, zona)
        : new Date(desde)
      : undefined,
    // Fin del día incluido: el instante justo antes de que empiece el siguiente
    hasta: hasta
      ? esFechaSola(hasta)
        ? new Date(finDiaEnZona(hasta, zona).getTime() - 1)
        : new Date(hasta)
      : undefined,
  };
}

/** Ids de eventos cuyo título coincide con `q` sin acentos ni mayúsculas ("reunion" → "Reunión"). */
async function idsPorTitulo(q: string) {
  const condicion = miembrosService.condicionSinAcentos(Prisma.sql`titulo`, q);
  if (!condicion) return [];
  const filas = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM eventos WHERE ${condicion}`;
  return filas.map((f) => f.id);
}

export async function listar(query: QueryEventos) {
  await marcarRealizados();
  const rango = await aInstantes(query.desde, query.hasta);
  const where: Prisma.EventoWhereInput = {
    ...whereRango(rango.desde, rango.hasta),
    ...(query.tipo && { tipo: query.tipo }),
    ...(query.categoria && { categoria: query.categoria }),
    ...(query.estado && { estado: query.estado }),
    ...(query.ministerioId && { ministerioId: query.ministerioId }),
    ...(query.q && { id: { in: await idsPorTitulo(query.q) } }),
  };

  // Calendario: con desde y hasta se devuelve todo el rango sin paginar (máx. 500)
  if (query.desde && query.hasta) {
    const filas = await prisma.evento.findMany({
      where,
      orderBy: { fechaInicio: 'asc' },
      take: MAX_EVENTOS_RANGO,
      select: SELECT_EVENTO,
    });
    return {
      datos: filas.map(formatear),
      meta: crearMeta(filas.length, 1, MAX_EVENTOS_RANGO),
    };
  }

  const { page, limit, skip, take } = paginar(query);
  const orderBy = ordenar(query.orden, ['fechaInicio', 'titulo', 'createdAt'], {
    fechaInicio: 'desc',
  });
  // Lecturas en paralelo (A1-B1-01): $transaction([...]) usa una sola conexión y pg avisa
  const [filas, total] = await Promise.all([
    prisma.evento.findMany({ where, orderBy, skip, take, select: SELECT_EVENTO }),
    prisma.evento.count({ where }),
  ]);
  return { datos: filas.map(formatear), meta: crearMeta(total, page, limit) };
}

export async function obtener(id: string) {
  await marcarRealizados();
  const evento = await prisma.evento.findUnique({ where: { id }, select: SELECT_DETALLE });
  if (!evento) throw AppError.noEncontrado(NO_EXISTE);
  const conteo = await prisma.asistencia.groupBy({
    by: ['presente'],
    where: { eventoId: id },
    _count: { _all: true },
  });
  const presentes = conteo.find((c) => c.presente)?._count._all ?? 0;
  const ausentes = conteo.find((c) => !c.presente)?._count._all ?? 0;
  const { responsables, creadoPor, ...resto } = evento;
  return {
    ...formatear(resto),
    creadoPor,
    responsables: responsables.map((r) => r.miembro),
    resumenAsistencia:
      presentes + ausentes > 0 ? { presentes, ausentes, total: presentes + ausentes } : null,
  };
}

/** Próximos eventos programados (desde ahora), del más cercano al más lejano. */
export async function proximos(limit = 5) {
  await marcarRealizados();
  const filas = await prisma.evento.findMany({
    where: { estado: 'PROGRAMADO', fechaInicio: { gte: new Date() } },
    orderBy: { fechaInicio: 'asc' },
    take: limit,
    select: SELECT_EVENTO,
  });
  return filas.map(formatear);
}

/** Número de eventos no cancelados que se cruzan con el rango. */
export function contarPorRango(desde: Date, hasta: Date) {
  return prisma.evento.count({
    where: { ...whereRango(desde, hasta), estado: { not: 'CANCELADO' } },
  });
}

/** Datos mínimos del evento para asistencia (B3-07, B3-08). */
export async function obtenerParaAsistencia(id: string) {
  await marcarRealizados();
  const evento = await prisma.evento.findUnique({
    where: { id },
    select: {
      id: true,
      titulo: true,
      fechaInicio: true,
      fechaFin: true,
      estado: true,
      ministerioId: true,
      ministerio: { select: { id: true, nombre: true } },
    },
  });
  if (!evento) throw AppError.noEncontrado(NO_EXISTE);
  return evento;
}

/** Al registrar asistencia de un evento que ya empezó, queda REALIZADO (B3-06). */
export async function marcarRealizadoSiPaso(id: string, ahora = new Date()) {
  await prisma.evento.updateMany({
    where: { id, estado: 'PROGRAMADO', fechaInicio: { lte: ahora } },
    data: { estado: 'REALIZADO' },
  });
}

// ───────── Escritura (B3-01, B3-03, B3-04, B3-05) ─────────

export async function crear(datos: CrearEvento, solicitante: Solicitante) {
  await verificarGestionaEvento(
    solicitante,
    datos.ministerioId,
    'eventos:crear',
    'eventos:crear-propio',
    'Como coordinador solo puedes crear eventos de un ministerio que coordinas.',
  );
  await verificarMinisterio(datos.ministerioId);
  const evento = await prisma.evento.create({
    data: { ...datos, creadoPorId: solicitante.id },
    select: { id: true },
  });
  return obtener(evento.id);
}

export async function editar(id: string, datos: EditarEvento, solicitante: Solicitante) {
  const actual = await estadoOFallar(id);
  await verificarGestionaEvento(
    solicitante,
    actual.ministerioId,
    'eventos:editar',
    'eventos:editar-propio',
  );
  noCancelado(actual.estado);
  if (datos.ministerioId !== undefined && datos.ministerioId !== actual.ministerioId) {
    // El coordinador tampoco puede mover el evento a un ministerio que no coordina (ni dejarlo sin ministerio)
    await verificarGestionaEvento(
      solicitante,
      datos.ministerioId,
      'eventos:editar',
      'eventos:editar-propio',
    );
    await verificarMinisterio(datos.ministerioId);
  }
  const inicio = datos.fechaInicio ?? actual.fechaInicio;
  const fin = datos.fechaFin === undefined ? actual.fechaFin : datos.fechaFin;
  if (fin && fin < inicio) {
    const mensaje = 'La fecha de fin debe ser igual o posterior a la de inicio.';
    throw AppError.validacion('Los datos enviados no son válidos.', [
      { campo: 'fechaFin', mensaje },
    ]);
  }
  // Si un evento REALIZADO se reprograma a una fecha futura, vuelve a PROGRAMADO (y a próximos/cartelera)
  const reprogramado = actual.estado === 'REALIZADO' && (fin ?? inicio) > new Date();
  await prisma.evento.update({
    where: { id },
    data: { ...datos, ...(reprogramado && { estado: 'PROGRAMADO' }) },
  });
  return obtener(id);
}

/** Cancelar ≠ borrar: cambia el estado y guarda el motivo; la asistencia registrada se conserva. */
export async function cancelar(id: string, motivo: string, solicitante: Solicitante) {
  const actual = await estadoOFallar(id);
  await verificarGestionaEvento(
    solicitante,
    actual.ministerioId,
    'eventos:eliminar',
    'eventos:eliminar-propio',
  );
  noCancelado(actual.estado, 'El evento ya está cancelado.');
  await prisma.evento.update({
    where: { id },
    data: { estado: 'CANCELADO', motivoCancelacion: motivo },
  });
  return obtener(id);
}

/** Reemplaza la lista de responsables. Solo miembros activos (si no, 422 indicando cuál). */
export async function asignarResponsables(
  id: string,
  miembroIds: string[],
  solicitante: Solicitante,
) {
  const actual = await estadoOFallar(id);
  await verificarGestionaEvento(
    solicitante,
    actual.ministerioId,
    'eventos:editar',
    'eventos:editar-propio',
  );
  noCancelado(actual.estado);
  // Datos de B2 por sus services (AGENTS.md §3). Solo se consultan uno a uno los no activos (máx. 10)
  const activos = new Set(
    (await miembrosService.obtenerActivos({ ids: miembroIds })).map((m) => m.id),
  );
  const invalidos: DetalleError[] = [];
  for (const miembroId of miembroIds.filter((m) => !activos.has(m))) {
    const m = await miembrosService.obtener(miembroId).catch((error: unknown) => {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
      throw error;
    });
    invalidos.push({
      campo: 'miembroIds',
      mensaje: m
        ? `${m.nombre} ${m.apellidos} está inactivo.`
        : `El miembro ${miembroId} no existe.`,
    });
  }
  if (invalidos.length > 0) {
    throw new AppError(
      'BUSINESS_RULE',
      `No se pueden asignar como responsables: ${invalidos.map((d) => d.mensaje).join(' ')}`,
      422,
      invalidos,
    );
  }
  await prisma.$transaction([
    prisma.eventoResponsable.deleteMany({ where: { eventoId: id } }),
    prisma.eventoResponsable.createMany({
      data: miembroIds.map((miembroId) => ({ eventoId: id, miembroId })),
    }),
  ]);
  return obtener(id);
}
