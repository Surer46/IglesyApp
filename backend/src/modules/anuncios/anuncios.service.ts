/**
 * Service de anuncios (B3). Funciones para otros módulos (B3-14):
 * - `vigentes({ soloImportantes, limit })` → anuncios publicados y no expirados, IMPORTANTE primero
 *   (dashboard B4, cartelera B3-15).
 */
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../lib/appError';
import { crearMeta, paginar } from '../../lib/paginacion';
import { prisma } from '../../lib/prisma';
import { condicionSinAcentos } from '../miembros/miembros.service';
import type { CrearAnuncio, EditarAnuncio, QueryAnuncios } from './anuncios.schemas';

const NO_EXISTE = 'El anuncio no existe.';

const SELECT_ANUNCIO = {
  id: true,
  titulo: true,
  contenido: true,
  prioridad: true,
  fechaPublicacion: true,
  fechaExpiracion: true,
  createdAt: true,
  updatedAt: true,
  autor: { select: { id: true, nombre: true } },
  evento: { select: { id: true, titulo: true, fechaInicio: true, estado: true } },
} as const satisfies Prisma.AnuncioSelect;

/** IMPORTANTE primero (orden del enum) y luego los más recientes. */
const ORDEN: Prisma.AnuncioOrderByWithRelationInput[] = [
  { prioridad: 'desc' },
  { fechaPublicacion: 'desc' },
];

/** Vigente = ya publicado y sin expirar. */
function whereVigente(ahora: Date): Prisma.AnuncioWhereInput {
  return {
    fechaPublicacion: { lte: ahora },
    OR: [{ fechaExpiracion: null }, { fechaExpiracion: { gt: ahora } }],
  };
}

function whereNoVigente(ahora: Date): Prisma.AnuncioWhereInput {
  return { OR: [{ fechaPublicacion: { gt: ahora } }, { fechaExpiracion: { lte: ahora } }] };
}

const WHERE_ESTADO = {
  vigentes: whereVigente,
  programados: (ahora: Date): Prisma.AnuncioWhereInput => ({ fechaPublicacion: { gt: ahora } }),
  expirados: (ahora: Date): Prisma.AnuncioWhereInput => ({
    fechaPublicacion: { lte: ahora },
    fechaExpiracion: { lte: ahora },
  }),
} satisfies Record<NonNullable<QueryAnuncios['estado']>, (ahora: Date) => Prisma.AnuncioWhereInput>;

/** Ids de anuncios cuyo título coincide con `q` sin acentos ni mayúsculas. */
async function idsPorTitulo(q: string) {
  const condicion = condicionSinAcentos(Prisma.sql`titulo`, q);
  if (!condicion) return [];
  const filas = await prisma.$queryRaw<
    { id: string }[]
  >`SELECT id FROM anuncios WHERE ${condicion}`;
  return filas.map((f) => f.id);
}

/** El evento vinculado debe existir y no estar cancelado → si no, 422. */
async function verificarEvento(eventoId: string | null | undefined) {
  if (!eventoId) return;
  const evento = await prisma.evento.findUnique({
    where: { id: eventoId },
    select: { estado: true },
  });
  if (!evento) throw AppError.reglaNegocio('El evento vinculado no existe.');
  if (evento.estado === 'CANCELADO') {
    throw AppError.reglaNegocio('No se puede vincular un evento cancelado.');
  }
}

async function obtenerOFallar(id: string) {
  const anuncio = await prisma.anuncio.findUnique({ where: { id }, select: SELECT_ANUNCIO });
  if (!anuncio) throw AppError.noEncontrado(NO_EXISTE);
  return anuncio;
}

export async function listar(query: QueryAnuncios) {
  const { page, limit, skip, take } = paginar(query);
  const ahora = new Date();
  const filtros: Prisma.AnuncioWhereInput[] = [];
  if (query.vigentes === true) filtros.push(whereVigente(ahora));
  if (query.vigentes === false) filtros.push(whereNoVigente(ahora));
  if (query.estado) filtros.push(WHERE_ESTADO[query.estado](ahora));
  if (query.prioridad) filtros.push({ prioridad: query.prioridad });
  if (query.q) filtros.push({ id: { in: await idsPorTitulo(query.q) } });
  const where: Prisma.AnuncioWhereInput = { AND: filtros };
  const [filas, total] = await prisma.$transaction([
    prisma.anuncio.findMany({ where, orderBy: ORDEN, skip, take, select: SELECT_ANUNCIO }),
    prisma.anuncio.count({ where }),
  ]);
  return { datos: filas, meta: crearMeta(total, page, limit) };
}

export function obtener(id: string) {
  return obtenerOFallar(id);
}

export async function crear(datos: CrearAnuncio, autorId: string) {
  await verificarEvento(datos.eventoId);
  return prisma.anuncio.create({ data: { ...datos, autorId }, select: SELECT_ANUNCIO });
}

export async function editar(id: string, datos: EditarAnuncio) {
  const actual = await obtenerOFallar(id);
  if (datos.eventoId !== undefined && datos.eventoId !== actual.evento?.id) {
    await verificarEvento(datos.eventoId);
  }
  const publicacion = datos.fechaPublicacion ?? actual.fechaPublicacion;
  const expiracion =
    datos.fechaExpiracion === undefined ? actual.fechaExpiracion : datos.fechaExpiracion;
  if (expiracion && expiracion <= publicacion) {
    const mensaje = 'La expiración debe ser posterior a la publicación.';
    throw AppError.validacion('Los datos enviados no son válidos.', [
      { campo: 'fechaExpiracion', mensaje },
    ]);
  }
  return prisma.anuncio.update({ where: { id }, data: datos, select: SELECT_ANUNCIO });
}

/** Los anuncios sí se borran físicamente (AGENTS.md §1). */
export async function eliminar(id: string) {
  await obtenerOFallar(id);
  await prisma.anuncio.delete({ where: { id } });
}

/** Anuncios vigentes ahora, IMPORTANTE primero. */
export function vigentes({ soloImportantes = false, limit = 10 } = {}) {
  return prisma.anuncio.findMany({
    where: {
      ...whereVigente(new Date()),
      ...(soloImportantes && { prioridad: 'IMPORTANTE' }),
    },
    orderBy: ORDEN,
    take: limit,
    select: SELECT_ANUNCIO,
  });
}
