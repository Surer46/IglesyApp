/**
 * Service de asistencia (B3). Funciones para otros módulos:
 * - `porcentajeMiembro(miembroId, meses)` → resumen de un miembro (detalle de miembro, B2-04).
 * - `resumenPorPeriodo(periodo, desde, hasta, ministerioIds?)` → serie semanal/mensual (dashboard y reportes, B4).
 * - `porEvento(eventoId)` → detalle de un evento (reporte RF-09.2, B4).
 * - `contarRegistradas(desde, hasta)` → asistencias presentes en el rango (dashboard RF-08.3, B4).
 * - `participacionPorMinisterio(desde, hasta)` → asistencia por ministerio (reporte RF-09.3, B4).
 */
import { type Permiso, tienePermiso } from '../../config/permisos';
import { Prisma } from '../../generated/prisma/client';
import { AppError, type DetalleError } from '../../lib/appError';
import { crearMeta, paginar } from '../../lib/paginacion';
import { prisma } from '../../lib/prisma';
import * as configuracionService from '../configuracion/configuracion.service';
import { fechaEnZona, finDiaEnZona, inicioDiaEnZona } from '../eventos/eventos.fechas';
import * as eventosService from '../eventos/eventos.service';
import type { Solicitante } from '../eventos/eventos.service';
import * as miembrosService from '../miembros/miembros.service';
import * as ministeriosService from '../ministerios/ministerios.service';
import {
  MAX_DIAS_RESUMEN,
  type Periodo,
  type QueryHistorial,
  type QueryResumen,
  type RegistroAsistencia,
} from './asistencia.schemas';

const DIA_MS = 86_400_000;
/** Se permite pasar lista hasta 1 día antes del inicio del evento (B3-08). */
const MAX_ANTICIPACION_MS = DIA_MS;

interface MiembroFila {
  id: string;
  nombre: string;
  apellidos: string;
}

function porNombre(a: MiembroFila, b: MiembroFila) {
  return a.apellidos.localeCompare(b.apellidos, 'es') || a.nombre.localeCompare(b.nombre, 'es');
}

function redondear1(valor: number) {
  return Math.round(valor * 10) / 10;
}

/**
 * Ministerios a los que se limita la consulta: `null` = sin límite (permiso completo);
 * para el COORDINADOR, los que coordina.
 */
async function alcance(solicitante: Solicitante): Promise<string[] | null> {
  if (tienePermiso(solicitante.rol, 'asistencia:leer')) return null;
  return ministeriosService.ministeriosCoordinadosPor(solicitante.id);
}

// ───────── Pase de lista (B3-07, B3-08) ─────────

/**
 * Lista del evento: integrantes activos de su ministerio (o todos los miembros activos si no tiene),
 * más quienes ya tienen registro aunque hoy estén inactivos o fuera del ministerio.
 */
async function armarLista(eventoId: string, ministerioId: string | null, q?: string) {
  const [esperados, registros] = await Promise.all([
    ministerioId ? ministeriosService.miembrosDe(ministerioId) : miembrosService.obtenerActivos(),
    prisma.asistencia.findMany({
      where: { eventoId },
      select: { presente: true, miembro: { select: { id: true, nombre: true, apellidos: true } } },
    }),
  ]);
  const presentePor = new Map(registros.map((r) => [r.miembro.id, r.presente]));
  const miembros = new Map<string, MiembroFila>(esperados.map((m) => [m.id, m]));
  for (const { miembro } of registros)
    if (!miembros.has(miembro.id)) miembros.set(miembro.id, miembro);

  const filas = [...miembros.values()]
    .sort(porNombre)
    .map((miembro) => ({ miembro, presente: presentePor.get(miembro.id) ?? null }));
  const totales = {
    presentes: filas.filter((f) => f.presente === true).length,
    ausentes: filas.filter((f) => f.presente === false).length,
    sinRegistrar: filas.filter((f) => f.presente === null).length,
    total: filas.length,
  };
  const coinciden = q ? new Set(await miembrosService.idsQueCoinciden(q)) : null;
  return {
    registros: coinciden ? filas.filter((f) => coinciden.has(f.miembro.id)) : filas,
    totales,
  };
}

const PERMISOS_ASISTENCIA = {
  leer: ['asistencia:leer', 'asistencia:leer-propio'],
  crear: ['asistencia:crear', 'asistencia:crear-propio'],
} as const satisfies Record<string, readonly [Permiso, Permiso]>;

async function eventoConPermiso(
  eventoId: string,
  solicitante: Solicitante,
  accion: keyof typeof PERMISOS_ASISTENCIA,
) {
  const evento = await eventosService.obtenerParaAsistencia(eventoId);
  const [completo, propio] = PERMISOS_ASISTENCIA[accion];
  await eventosService.verificarGestionaEvento(
    solicitante,
    evento.ministerioId,
    completo,
    propio,
    'Solo puedes gestionar la asistencia de eventos de los ministerios que coordinas.',
  );
  return evento;
}

export async function listaDeEvento(eventoId: string, solicitante: Solicitante, q?: string) {
  const { ministerioId, ...evento } = await eventoConPermiso(eventoId, solicitante, 'leer');
  return { evento, ...(await armarLista(eventoId, ministerioId, q)) };
}

/**
 * Upsert masivo en una transacción (una sola sentencia INSERT … ON CONFLICT): reenviar el mismo
 * pase de lista actualiza las filas existentes en lugar de duplicarlas (@@unique eventoId+miembroId).
 */
export async function registrar(
  eventoId: string,
  registros: RegistroAsistencia[],
  solicitante: Solicitante,
) {
  const evento = await eventoConPermiso(eventoId, solicitante, 'crear');
  if (evento.estado === 'CANCELADO') {
    throw AppError.reglaNegocio('No se puede registrar asistencia en un evento cancelado.');
  }
  const ahora = new Date();
  if (evento.fechaInicio.getTime() - ahora.getTime() > MAX_ANTICIPACION_MS) {
    throw AppError.reglaNegocio(
      'Solo se puede pasar lista desde un día antes del inicio del evento.',
    );
  }

  const miembroIds = registros.map((r) => r.miembroId);
  // COORDINADOR (solo "-propio"): únicamente integrantes activos del ministerio del evento
  const integrantes =
    !tienePermiso(solicitante.rol, 'asistencia:crear') && evento.ministerioId
      ? new Set((await ministeriosService.miembrosDe(evento.ministerioId)).map((m) => m.id))
      : null;
  await prisma.$transaction(async (tx) => {
    // Secuenciales: una transacción usa una sola conexión.
    // Se lee `miembros` (de B2) con `tx` y no con su service a propósito: la validación debe ver
    // el mismo estado que el INSERT de abajo, dentro de la misma transacción (A1-B3-02).
    const miembros = await tx.miembro.findMany({
      where: { id: { in: miembroIds } },
      select: { id: true, nombre: true, apellidos: true, activo: true },
    });
    const existentes = await tx.asistencia.findMany({
      where: { eventoId, miembroId: { in: miembroIds } },
      select: { miembroId: true },
    });
    const porId = new Map(miembros.map((m) => [m.id, m]));
    const yaRegistrados = new Set(existentes.map((e) => e.miembroId));
    // Un miembro inactivo solo puede conservar/corregir un registro hecho cuando estaba activo
    const invalidos: DetalleError[] = miembroIds.flatMap((id) => {
      const m = porId.get(id);
      if (!m) return [{ campo: 'registros', mensaje: `El miembro ${id} no existe.` }];
      if (!m.activo && !yaRegistrados.has(id)) {
        return [{ campo: 'registros', mensaje: `${m.nombre} ${m.apellidos} está inactivo.` }];
      }
      if (integrantes && !integrantes.has(id) && !yaRegistrados.has(id)) {
        return [
          {
            campo: 'registros',
            mensaje: `${m.nombre} ${m.apellidos} no pertenece al ministerio del evento.`,
          },
        ];
      }
      return [];
    });
    if (invalidos.length > 0) {
      throw new AppError(
        'BUSINESS_RULE',
        `No se puede registrar la asistencia: ${invalidos.map((d) => d.mensaje).join(' ')}`,
        422,
        invalidos,
      );
    }
    await tx.$executeRaw`
      INSERT INTO asistencias
        (id, "eventoId", "miembroId", presente, "registradoPorId", "registradoEn", "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, ${eventoId}, r.miembro, r.presente, ${solicitante.id},
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      FROM unnest(${miembroIds}::text[], ${registros.map((r) => r.presente)}::boolean[])
        AS r(miembro, presente)
      ON CONFLICT ("eventoId", "miembroId") DO UPDATE SET
        presente = EXCLUDED.presente,
        "registradoPorId" = EXCLUDED."registradoPorId",
        "registradoEn" = EXCLUDED."registradoEn",
        "updatedAt" = EXCLUDED."updatedAt"`;
  });
  await eventosService.marcarRealizadoSiPaso(eventoId, ahora);
  return listaDeEvento(eventoId, solicitante);
}

// ───────── Historial (B3-09) ─────────

/** Medianoche UTC de una fecha (solo para aritmética de calendario, no para filtrar instantes). */
const inicioDia = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);

export async function historial(query: QueryHistorial, solicitante: Solicitante) {
  const { page, limit, skip, take } = paginar(query);
  const ministerios = await alcance(solicitante);
  // desde/hasta son días completos en la zona horaria de la iglesia (no en UTC)
  const zona = query.desde || query.hasta ? (await configuracionService.obtener()).zonaHoraria : '';
  const where: Prisma.AsistenciaWhereInput = {
    ...(query.miembroId && { miembroId: query.miembroId }),
    ...(query.eventoId && { eventoId: query.eventoId }),
    evento: {
      ...(ministerios && { ministerioId: { in: ministerios } }),
      ...((query.desde || query.hasta) && {
        fechaInicio: {
          ...(query.desde && { gte: inicioDiaEnZona(query.desde, zona) }),
          ...(query.hasta && { lt: finDiaEnZona(query.hasta, zona) }),
        },
      }),
    },
  };
  // Sin $transaction: Prisma resuelve las relaciones en paralelo y una transacción usa una sola conexión
  const [filas, total] = await Promise.all([
    prisma.asistencia.findMany({
      where,
      skip,
      take,
      orderBy: [{ evento: { fechaInicio: 'desc' } }, { miembro: { apellidos: 'asc' } }],
      select: {
        id: true,
        presente: true,
        registradoEn: true,
        miembro: { select: { id: true, nombre: true, apellidos: true } },
        evento: {
          select: {
            id: true,
            titulo: true,
            categoria: true,
            fechaInicio: true,
            estado: true,
            ministerio: { select: { id: true, nombre: true } },
          },
        },
        registradoPor: { select: { id: true, nombre: true } },
      },
    }),
    prisma.asistencia.count({ where }),
  ]);
  return { datos: filas, meta: crearMeta(total, page, limit) };
}

/** % de asistencia de un miembro en los últimos `meses` (eventos no cancelados) y su última asistencia. */
export async function porcentajeMiembro(miembroId: string, meses = 3) {
  const desde = new Date();
  desde.setUTCMonth(desde.getUTCMonth() - meses);
  const where: Prisma.AsistenciaWhereInput = {
    miembroId,
    evento: { estado: { not: 'CANCELADO' }, fechaInicio: { gte: desde } },
  };
  const [total, presentes, ultima] = await Promise.all([
    prisma.asistencia.count({ where }),
    prisma.asistencia.count({ where: { ...where, presente: true } }),
    prisma.asistencia.findFirst({
      where: { miembroId, presente: true, evento: { estado: { not: 'CANCELADO' } } },
      orderBy: { evento: { fechaInicio: 'desc' } },
      select: { evento: { select: { id: true, titulo: true, fechaInicio: true } } },
    }),
  ]);
  return {
    meses,
    presentes,
    total,
    porcentaje: total > 0 ? redondear1((presentes / total) * 100) : null,
    ultimaAsistencia: ultima?.evento ?? null,
  };
}

// ───────── Resumen semanal / mensual (B3-10) ─────────

const pad = (n: number) => String(n).padStart(2, '0');

/** Semana ISO 8601 ("2026-W43") de una fecha a medianoche UTC. */
export function semanaIso(fecha: Date) {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // jueves de esa semana
  const anio = d.getUTCFullYear();
  const semana = Math.floor((d.getTime() - Date.UTC(anio, 0, 1)) / DIA_MS / 7) + 1;
  return `${anio}-W${pad(semana)}`;
}

/** Etiquetas de todos los periodos entre dos fechas "yyyy-MM-dd" (serie continua). */
export function periodosEntre(periodo: Periodo, desde: string, hasta: string) {
  const etiquetas: string[] = [];
  if (periodo === 'mensual') {
    const cursor = new Date(`${desde.slice(0, 7)}-01T00:00:00.000Z`);
    while (cursor.toISOString().slice(0, 7) <= hasta.slice(0, 7)) {
      etiquetas.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return etiquetas;
  }
  const cursor = inicioDia(desde);
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7)); // lunes
  while (cursor <= inicioDia(hasta)) {
    etiquetas.push(semanaIso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return etiquetas;
}

function restarDias(fecha: string, dias: number) {
  return new Date(inicioDia(fecha).getTime() - dias * DIA_MS).toISOString().slice(0, 10);
}

/** Primer día del mes que está `meses` antes del de `fecha`. */
function inicioMes(fecha: string, meses: number) {
  const d = new Date(`${fecha.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrupa por semana ISO o mes en la zona horaria de la configuración (un evento a las 23:30 del
 * domingo cuenta en ese domingo aunque en UTC ya sea lunes). Excluye eventos cancelados.
 */
export async function resumenPorPeriodo(
  periodo: Periodo,
  desde: string,
  hasta: string,
  ministerioIds?: string[] | null,
) {
  const { zonaHoraria } = await configuracionService.obtener();
  const local = Prisma.sql`((e."fechaInicio" AT TIME ZONE 'UTC') AT TIME ZONE ${zonaHoraria})`;
  const etiqueta =
    periodo === 'semanal'
      ? Prisma.sql`to_char(${local}, 'IYYY-"W"IW')`
      : Prisma.sql`to_char(${local}, 'YYYY-MM')`;
  const filtroMinisterio = ministerioIds
    ? Prisma.sql`AND e."ministerioId" = ANY(${ministerioIds}::text[])`
    : Prisma.empty;
  const filas = await prisma.$queryRaw<
    { periodo: string; eventos: bigint; presentes: bigint; ausentes: bigint }[]
  >`
    SELECT ${etiqueta} AS periodo,
           COUNT(DISTINCT e.id) AS eventos,
           COUNT(*) FILTER (WHERE a.presente) AS presentes,
           COUNT(*) FILTER (WHERE NOT a.presente) AS ausentes
    FROM asistencias a
    JOIN eventos e ON e.id = a."eventoId"
    WHERE e.estado <> 'CANCELADO'
      AND ${local} >= ${desde}::date
      AND ${local} < (${hasta}::date + 1)
      ${filtroMinisterio}
    GROUP BY 1`;
  const porPeriodo = new Map(filas.map((f) => [f.periodo, f]));
  return periodosEntre(periodo, desde, hasta).map((p) => {
    const f = porPeriodo.get(p);
    const eventos = Number(f?.eventos ?? 0);
    const presentes = Number(f?.presentes ?? 0);
    return {
      periodo: p,
      eventos,
      presentes,
      ausentes: Number(f?.ausentes ?? 0),
      promedioPorEvento: eventos > 0 ? redondear1(presentes / eventos) : 0,
    };
  });
}

/** Endpoint: rango por defecto 12 semanas o 6 meses hasta hoy; el COORDINADOR solo ve sus ministerios. */
export async function resumen(query: QueryResumen, solicitante: Solicitante) {
  const ministerios = await alcance(solicitante);
  if (query.ministerioId && ministerios && !ministerios.includes(query.ministerioId)) {
    throw AppError.prohibido(
      'Solo puedes consultar la asistencia de los ministerios que coordinas.',
    );
  }
  const { zonaHoraria } = await configuracionService.obtener();
  const hasta = query.hasta ?? fechaEnZona(new Date(), zonaHoraria);
  const desde =
    query.desde ?? (query.periodo === 'semanal' ? restarDias(hasta, 7 * 11) : inicioMes(hasta, 5));
  // El esquema solo valida el rango si vienen ambas fechas; aquí ya están completas
  if (hasta < desde) {
    throw AppError.validacion('Los datos enviados no son válidos.', [
      { campo: 'hasta', mensaje: '"hasta" debe ser igual o posterior a "desde".' },
    ]);
  }
  if ((Date.parse(hasta) - Date.parse(desde)) / DIA_MS > MAX_DIAS_RESUMEN) {
    throw AppError.validacion('Los datos enviados no son válidos.', [
      { campo: 'desde', mensaje: 'El rango no puede pasar de 2 años.' },
    ]);
  }
  const filtro = query.ministerioId ? [query.ministerioId] : ministerios;
  return resumenPorPeriodo(query.periodo, desde, hasta, filtro);
}

// ───────── Funciones para reportes y dashboard (B3-11) ─────────

/** Detalle de asistencia de un evento (registros guardados) para el reporte por evento. */
export async function porEvento(eventoId: string) {
  const evento = await eventosService.obtener(eventoId);
  const registros = await prisma.asistencia.findMany({
    where: { eventoId },
    select: {
      presente: true,
      registradoEn: true,
      miembro: { select: { id: true, nombre: true, apellidos: true } },
    },
  });
  registros.sort((a, b) => porNombre(a.miembro, b.miembro));
  const presentes = registros.filter((r) => r.presente).length;
  return {
    evento,
    registros,
    presentes,
    ausentes: registros.length - presentes,
    porcentaje: registros.length > 0 ? redondear1((presentes / registros.length) * 100) : null,
  };
}

/** Asistencias (presentes) de eventos no cancelados que empiezan en [desde, hasta). */
export function contarRegistradas(desde: Date, hasta: Date) {
  return prisma.asistencia.count({
    where: {
      presente: true,
      evento: { estado: { not: 'CANCELADO' }, fechaInicio: { gte: desde, lt: hasta } },
    },
  });
}

/** Por ministerio activo: integrantes, eventos con asistencia, presentes, ausentes y % de asistencia. */
export async function participacionPorMinisterio(desde: Date, hasta: Date) {
  const [integrantes, filas] = await Promise.all([
    ministeriosService.participacionPorMinisterio(),
    prisma.$queryRaw<
      { ministerioId: string; eventos: bigint; presentes: bigint; ausentes: bigint }[]
    >`
      SELECT e."ministerioId" AS "ministerioId",
             COUNT(DISTINCT e.id) AS eventos,
             COUNT(*) FILTER (WHERE a.presente) AS presentes,
             COUNT(*) FILTER (WHERE NOT a.presente) AS ausentes
      FROM asistencias a
      JOIN eventos e ON e.id = a."eventoId"
      WHERE e.estado <> 'CANCELADO' AND e."ministerioId" IS NOT NULL
        AND e."fechaInicio" >= ${desde} AND e."fechaInicio" < ${hasta}
      GROUP BY e."ministerioId"`,
  ]);
  const porMinisterio = new Map(filas.map((f) => [f.ministerioId, f]));
  return integrantes.map(({ ministerioId, ministerio, total }) => {
    const f = porMinisterio.get(ministerioId);
    const presentes = Number(f?.presentes ?? 0);
    const ausentes = Number(f?.ausentes ?? 0);
    return {
      ministerioId,
      ministerio,
      integrantes: total,
      eventos: Number(f?.eventos ?? 0),
      presentes,
      ausentes,
      porcentaje:
        presentes + ausentes > 0 ? redondear1((presentes / (presentes + ausentes)) * 100) : null,
    };
  });
}
