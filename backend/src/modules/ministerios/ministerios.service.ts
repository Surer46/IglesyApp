/**
 * Service de ministerios (B2). Funciones para otros módulos (B2-11):
 * - `miembrosDe(ministerioId)` → integrantes activos (asistencia esperada, B3; reporte por ministerio, B4).
 * - `ministeriosCoordinadosPor(usuarioId)` → ids de sus ministerios (permisos "-propio", B3).
 * - `contarActivos()` → número de ministerios activos (dashboard, B4).
 * - `participacionPorMinisterio()` → `[{ ministerioId, ministerio, total }]` (dashboard y RF-09.3, B4).
 */
import { type RolUsuario, tienePermiso } from '../../config/permisos';
import { Prisma } from '../../generated/prisma/client';
import { AppError, type DetalleError } from '../../lib/appError';
import { crearMeta, ordenar, paginar } from '../../lib/paginacion';
import { prisma } from '../../lib/prisma';
import { esCoordinadorDe } from '../../middlewares/auth';
import { condicionSinAcentos, idsQueCoinciden } from '../miembros/miembros.service';
import * as usuariosService from '../usuarios/usuarios.service';
import type {
  CrearMinisterio,
  EditarMinisterio,
  QueryIntegrantes,
  QueryMinisterios,
} from './ministerios.schemas';

const NO_EXISTE = 'El ministerio no existe.';
const NOMBRE_DUPLICADO = 'Ya existe un ministerio con ese nombre.';
const ROLES_COORDINADOR: RolUsuario[] = ['COORDINADOR', 'PASTOR'];

interface Solicitante {
  id: string;
  rol: RolUsuario;
}

const SELECT_MINISTERIO = {
  id: true,
  nombre: true,
  descripcion: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
  coordinadores: {
    select: { usuario: { select: { id: true, nombre: true } } },
    orderBy: { usuario: { nombre: 'asc' } },
  },
  // Integrantes = vínculos activos (al desactivar un miembro sus vínculos se cierran)
  _count: { select: { miembros: { where: { activo: true } } } },
} as const satisfies Prisma.MinisterioSelect;

type MinisterioBd = Prisma.MinisterioGetPayload<{ select: typeof SELECT_MINISTERIO }>;

function formatear({ coordinadores, _count, ...m }: MinisterioBd) {
  return {
    ...m,
    totalIntegrantes: _count.miembros,
    coordinadores: coordinadores.map((c) => c.usuario),
  };
}

async function obtenerOFallar(id: string) {
  const ministerio = await prisma.ministerio.findUnique({
    where: { id },
    select: SELECT_MINISTERIO,
  });
  if (!ministerio) throw AppError.noEncontrado(NO_EXISTE);
  return ministerio;
}

/** El nombre es único sin distinguir mayúsculas → 409 en el campo `nombre`. */
async function verificarNombreLibre(nombre: string, exceptoId?: string) {
  const otro = await prisma.ministerio.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(exceptoId && { NOT: { id: exceptoId } }),
    },
    select: { id: true },
  });
  if (otro)
    throw AppError.conflicto(NOMBRE_DUPLICADO, [{ campo: 'nombre', mensaje: NOMBRE_DUPLICADO }]);
}

/** ADMIN/PASTOR siempre; COORDINADOR solo en los ministerios que coordina → si no, 403. */
async function verificarPuedeGestionarIntegrantes(solicitante: Solicitante, ministerioId: string) {
  if (tienePermiso(solicitante.rol, 'ministerios:editar')) return;
  if (
    tienePermiso(solicitante.rol, 'ministerios:editar-propio') &&
    (await esCoordinadorDe(solicitante.id, ministerioId))
  ) {
    return;
  }
  throw AppError.prohibido(
    'Solo puedes gestionar los integrantes de los ministerios que coordinas.',
  );
}

// ───────── CRUD (B2-07) ─────────

/** Ids de ministerios cuyo nombre coincide con `q` sin acentos ("musica" encuentra "Música"). */
async function idsPorNombre(q: string) {
  const condicion = condicionSinAcentos(Prisma.sql`nombre`, q);
  if (!condicion) return [];
  const filas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ministerios WHERE ${condicion}`;
  return filas.map((f) => f.id);
}

export async function listar(query: QueryMinisterios) {
  const { page, limit, skip, take } = paginar(query);
  const where: Prisma.MinisterioWhereInput = {
    ...(query.q && { id: { in: await idsPorNombre(query.q) } }),
    ...(query.activo !== undefined && { activo: query.activo }),
  };
  const orderBy = ordenar(query.orden, ['nombre', 'createdAt'], { nombre: 'asc' });
  const [filas, total] = await Promise.all([
    prisma.ministerio.findMany({ where, orderBy, skip, take, select: SELECT_MINISTERIO }),
    prisma.ministerio.count({ where }),
  ]);
  return { datos: filas.map(formatear), meta: crearMeta(total, page, limit) };
}

export async function obtener(id: string) {
  return formatear(await obtenerOFallar(id));
}

export async function crear(datos: CrearMinisterio) {
  await verificarNombreLibre(datos.nombre);
  const ministerio = await prisma.ministerio.create({ data: datos, select: SELECT_MINISTERIO });
  return formatear(ministerio);
}

export async function editar(id: string, datos: EditarMinisterio) {
  await obtenerOFallar(id);
  if (datos.nombre) await verificarNombreLibre(datos.nombre, id);
  const ministerio = await prisma.ministerio.update({
    where: { id },
    data: datos,
    select: SELECT_MINISTERIO,
  });
  return formatear(ministerio);
}

/** Desactivar conserva integrantes y coordinadores para poder reactivarlo tal cual. */
export async function cambiarEstado(id: string, activo: boolean) {
  await obtenerOFallar(id);
  const ministerio = await prisma.ministerio.update({
    where: { id },
    data: { activo },
    select: SELECT_MINISTERIO,
  });
  return formatear(ministerio);
}

// ───────── Coordinadores (B2-08) ─────────

/** Usuario por id o null si no existe: esos datos son de B1 y se piden a su service. */
function usuarioONulo(id: string) {
  return usuariosService.obtener(id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  });
}

/** Reemplaza la lista. Solo usuarios activos con rol COORDINADOR o PASTOR (si no, 422 indicando cuál). */
export async function asignarCoordinadores(id: string, usuarioIds: string[]) {
  await obtenerOFallar(id);
  const usuarios = await Promise.all(usuarioIds.map(usuarioONulo));
  const invalidos: DetalleError[] = usuarioIds.flatMap((usuarioId, i) => {
    const u = usuarios[i];
    if (!u) return [{ campo: 'usuarioIds', mensaje: `El usuario ${usuarioId} no existe.` }];
    if (!u.activo) return [{ campo: 'usuarioIds', mensaje: `${u.nombre} está desactivado.` }];
    if (!ROLES_COORDINADOR.includes(u.rol)) {
      return [
        { campo: 'usuarioIds', mensaje: `${u.nombre} no tiene rol de coordinador o pastor.` },
      ];
    }
    return [];
  });
  if (invalidos.length > 0) {
    throw new AppError(
      'BUSINESS_RULE',
      `No se pueden asignar como coordinadores: ${invalidos.map((d) => d.mensaje).join(' ')}`,
      422,
      invalidos,
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.ministerioCoordinador.deleteMany({ where: { ministerioId: id } });
    await tx.ministerioCoordinador.createMany({
      data: usuarioIds.map((usuarioId) => ({ ministerioId: id, usuarioId })),
    });
  });
  return obtener(id);
}

// ───────── Integrantes (B2-09, B2-10) ─────────

/**
 * Vincula miembros activos (reactiva vínculos previos). ADMIN, PASTOR y el COORDINADOR del ministerio.
 * Todo en una transacción: si algún miembro no es válido no se vincula ninguno.
 */
export async function vincularMiembros(id: string, miembroIds: string[], solicitante: Solicitante) {
  const ministerio = await obtenerOFallar(id);
  await verificarPuedeGestionarIntegrantes(solicitante, id);
  if (!ministerio.activo) {
    throw AppError.reglaNegocio('No se pueden agregar integrantes a un ministerio inactivo.');
  }
  await prisma.$transaction(async (tx) => {
    const miembros = await tx.miembro.findMany({
      where: { id: { in: miembroIds } },
      select: { id: true, nombre: true, apellidos: true, activo: true },
    });
    const porId = new Map(miembros.map((m) => [m.id, m]));
    const faltantes = miembroIds.filter((m) => !porId.has(m));
    if (faltantes.length > 0) {
      throw AppError.noEncontrado(`No existen los miembros: ${faltantes.join(', ')}.`);
    }
    const inactivos = miembros.filter((m) => !m.activo);
    if (inactivos.length > 0) {
      const nombres = inactivos.map((m) => `${m.nombre} ${m.apellidos}`).join(', ');
      throw AppError.reglaNegocio(`Los miembros inactivos no se pueden vincular: ${nombres}.`);
    }
    // Número fijo de consultas sin importar cuántos miembros se vinculen (revisión del PR #3)
    const ahora = new Date();
    const previos = await tx.miembroMinisterio.findMany({
      where: { ministerioId: id, miembroId: { in: miembroIds } },
      select: { miembroId: true },
    });
    const conVinculo = new Set(previos.map((v) => v.miembroId));
    await tx.miembroMinisterio.createMany({
      data: miembroIds
        .filter((miembroId) => !conVinculo.has(miembroId))
        .map((miembroId) => ({ miembroId, ministerioId: id, fechaUnion: ahora })),
      skipDuplicates: true,
    });
    // Reactivar un vínculo cerrado empieza una nueva participación; uno activo no cambia
    await tx.miembroMinisterio.updateMany({
      where: { ministerioId: id, miembroId: { in: miembroIds }, activo: false },
      data: { activo: true, fechaUnion: ahora, fechaSalida: null },
    });
  });
  return obtener(id);
}

/** Desvincula (soft): el vínculo queda como histórico con su fecha de salida. */
export async function desvincularMiembro(id: string, miembroId: string, solicitante: Solicitante) {
  await obtenerOFallar(id);
  await verificarPuedeGestionarIntegrantes(solicitante, id);
  const { count } = await prisma.miembroMinisterio.updateMany({
    where: { ministerioId: id, miembroId, activo: true },
    data: { activo: false, fechaSalida: new Date() },
  });
  if (count === 0) throw AppError.noEncontrado('El miembro no pertenece a este ministerio.');
}

export async function listarIntegrantes(id: string, query: QueryIntegrantes) {
  await obtenerOFallar(id);
  const { page, limit, skip, take } = paginar(query);
  const where: Prisma.MiembroMinisterioWhereInput = {
    ministerioId: id,
    ...(!query.incluirHistoricos && { activo: true }),
    // La búsqueda se limita a los miembros de este ministerio (no a toda la congregación)
    ...(query.q && { miembroId: { in: await idsQueCoinciden(query.q, { ministerioId: id }) } }),
  };
  const [filas, total] = await Promise.all([
    prisma.miembroMinisterio.findMany({
      where,
      skip,
      take,
      orderBy: [
        { activo: 'desc' },
        { miembro: { apellidos: 'asc' } },
        { miembro: { nombre: 'asc' } },
      ],
      select: {
        fechaUnion: true,
        fechaSalida: true,
        activo: true,
        miembro: {
          select: {
            id: true,
            nombre: true,
            apellidos: true,
            telefono: true,
            email: true,
            activo: true,
          },
        },
      },
    }),
    prisma.miembroMinisterio.count({ where }),
  ]);
  // `activo` es el del vínculo; `miembroActivo`, el del miembro
  const datos = filas.map(({ miembro: { activo: miembroActivo, ...miembro }, ...vinculo }) => ({
    ...miembro,
    miembroActivo,
    ...vinculo,
  }));
  return { datos, meta: crearMeta(total, page, limit) };
}

// ───────── Funciones para otros módulos (B2-11) ─────────

/** Integrantes activos (vínculo y miembro activos) de un ministerio, sin paginar. */
export async function miembrosDe(ministerioId: string) {
  const vinculos = await prisma.miembroMinisterio.findMany({
    where: { ministerioId, activo: true, miembro: { activo: true } },
    select: { miembro: { select: { id: true, nombre: true, apellidos: true } } },
    orderBy: [{ miembro: { apellidos: 'asc' } }, { miembro: { nombre: 'asc' } }],
  });
  return vinculos.map((v) => v.miembro);
}

export async function ministeriosCoordinadosPor(usuarioId: string) {
  const filas = await prisma.ministerioCoordinador.findMany({
    where: { usuarioId },
    select: { ministerioId: true },
  });
  return filas.map((f) => f.ministerioId);
}

export function contarActivos() {
  return prisma.ministerio.count({ where: { activo: true } });
}

/** Integrantes activos por ministerio activo, de mayor a menor. */
export async function participacionPorMinisterio() {
  const ministerios = await prisma.ministerio.findMany({
    where: { activo: true },
    select: {
      id: true,
      nombre: true,
      _count: { select: { miembros: { where: { activo: true, miembro: { activo: true } } } } },
    },
    orderBy: { nombre: 'asc' },
  });
  return ministerios
    .map((m) => ({ ministerioId: m.id, ministerio: m.nombre, total: m._count.miembros }))
    .sort((a, b) => b.total - a.total);
}
