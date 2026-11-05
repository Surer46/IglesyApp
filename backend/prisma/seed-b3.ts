// Seed de eventos, asistencia y anuncios (B3) para la demo del hito de la semana 8.
// Idempotente: ids derivados de una clave fija (upsert), así que volver a correrlo actualiza en
// lugar de duplicar. Las fechas son relativas al día en que se corre, en la zona horaria de la iglesia.
import { createHash } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { fechaEnZona, inicioDiaEnZona } from '../src/modules/eventos/eventos.fechas';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const SEMANAS_CULTOS = 8;
const SEMANAS_JOVENES = 4;

/** UUID v4 con formato válido derivado de una clave (estable entre corridas). */
function uuidDe(clave: string) {
  const h = createHash('sha256').update(`seed-b3:${clave}`).digest('hex').split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('').slice(0, 32);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Número pseudoaleatorio estable en [0, 1) para decidir asistencias. */
function azar(clave: string) {
  return parseInt(createHash('sha256').update(clave).digest('hex').slice(0, 8), 16) / 0x100000000;
}

interface Contexto {
  zona: string;
  hoy: string;
  creadoPorId: string;
}

/** Instante de "hoy + dias" a la hora local indicada (zona de la iglesia). */
function enDia({ zona, hoy }: Contexto, dias: number, hora: number) {
  const fecha = new Date(Date.parse(`${hoy}T00:00:00.000Z`) + dias * DIA_MS).toISOString();
  return new Date(inicioDiaEnZona(fecha.slice(0, 10), zona).getTime() + hora * HORA_MS);
}

interface EventoSeed {
  clave: string;
  titulo: string;
  tipo: 'RELIGIOSO' | 'ADMINISTRATIVO';
  categoria: 'CULTO' | 'REUNION' | 'ACTIVIDAD' | 'OTRO';
  fechaInicio: Date;
  horas: number;
  lugar: string;
  descripcion?: string;
  ministerioId?: string;
  cancelado?: string;
}

async function guardarEvento(ctx: Contexto, e: EventoSeed) {
  const id = uuidDe(`evento:${e.clave}`);
  const fechaFin = new Date(e.fechaInicio.getTime() + e.horas * HORA_MS);
  const estado = e.cancelado ? 'CANCELADO' : fechaFin < new Date() ? 'REALIZADO' : 'PROGRAMADO';
  const datos = {
    titulo: e.titulo,
    tipo: e.tipo,
    categoria: e.categoria,
    fechaInicio: e.fechaInicio,
    fechaFin,
    lugar: e.lugar,
    descripcion: e.descripcion ?? null,
    ministerioId: e.ministerioId ?? null,
    estado,
    motivoCancelacion: e.cancelado ?? null,
  } as const;
  await prisma.evento.upsert({
    where: { id },
    create: { id, ...datos, creadoPorId: ctx.creadoPorId },
    update: datos,
  });
  return id;
}

/** Pase de lista con ~70 % de presentes (estable entre corridas). */
async function pasarLista(ctx: Contexto, eventoId: string, miembroIds: string[]) {
  for (const miembroId of miembroIds) {
    const presente = azar(`${eventoId}:${miembroId}`) < 0.7;
    await prisma.asistencia.upsert({
      where: { eventoId_miembroId: { eventoId, miembroId } },
      create: { eventoId, miembroId, presente, registradoPorId: ctx.creadoPorId },
      update: { presente },
    });
  }
}

async function asignarResponsables(eventoId: string, miembroIds: string[]) {
  await prisma.eventoResponsable.createMany({
    data: miembroIds.map((miembroId) => ({ eventoId, miembroId })),
    skipDuplicates: true,
  });
}

/**
 * Eventos (cultos y reuniones pasados con asistencia, próximos y uno cancelado) y anuncios
 * (vigentes, programado y expirado). Requiere el seed de B1 (usuarios) y de B2 (miembros y ministerios).
 */
export async function seedB3({ ministerios }: { ministerios: Map<string, string> }) {
  const config = await prisma.configuracionIglesia.findUniqueOrThrow({ where: { id: 1 } });
  const secretaria = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'secretario@iglesia.local' },
  });
  const ctx: Contexto = {
    zona: config.zonaHoraria,
    hoy: fechaEnZona(new Date(), config.zonaHoraria),
    creadoPorId: secretaria.id,
  };
  const activos = (
    await prisma.miembro.findMany({
      where: { activo: true },
      select: { id: true },
      orderBy: [{ apellidos: 'asc' }, { nombre: 'asc' }],
    })
  ).map((m) => m.id);
  const jovenesId = ministerios.get('Jóvenes')!;
  const musicaId = ministerios.get('Música')!;
  const integrantesJovenes = (
    await prisma.miembroMinisterio.findMany({
      where: { ministerioId: jovenesId, activo: true, miembro: { activo: true } },
      select: { miembroId: true },
    })
  ).map((v) => v.miembroId);

  // Domingo más reciente (0 = domingo) en la zona de la iglesia
  const diaSemanaHoy = new Date(`${ctx.hoy}T12:00:00.000Z`).getUTCDay();
  const ultimoDomingo = -diaSemanaHoy;

  let eventos = 0;
  let asistencias = 0;

  // Cultos dominicales pasados con pase de lista
  for (let s = 1; s <= SEMANAS_CULTOS; s++) {
    const id = await guardarEvento(ctx, {
      clave: `culto-${s}`,
      titulo: 'Culto dominical',
      tipo: 'RELIGIOSO',
      categoria: 'CULTO',
      fechaInicio: enDia(ctx, ultimoDomingo - 7 * (s - 1), 10),
      horas: 2,
      lugar: 'Templo principal',
    });
    await pasarLista(ctx, id, activos);
    eventos++;
    asistencias += activos.length;
    if (s === 1) await asignarResponsables(id, activos.slice(0, 2));
  }

  // Reuniones de jóvenes (viernes) pasadas con pase de lista de sus integrantes
  for (let s = 1; s <= SEMANAS_JOVENES; s++) {
    const id = await guardarEvento(ctx, {
      clave: `jovenes-${s}`,
      titulo: 'Reunión de jóvenes',
      tipo: 'RELIGIOSO',
      categoria: 'REUNION',
      fechaInicio: enDia(ctx, ultimoDomingo - 2 - 7 * (s - 1), 18),
      horas: 2,
      lugar: 'Salón de usos múltiples',
      ministerioId: jovenesId,
    });
    await pasarLista(ctx, id, integrantesJovenes);
    eventos++;
    asistencias += integrantesJovenes.length;
  }

  // Próximos (y uno cancelado)
  const proximoCulto = await guardarEvento(ctx, {
    clave: 'culto-proximo',
    titulo: 'Culto dominical',
    tipo: 'RELIGIOSO',
    categoria: 'CULTO',
    fechaInicio: enDia(ctx, ultimoDomingo + 7, 10),
    horas: 2,
    lugar: 'Templo principal',
    descripcion: 'Predicación y santa cena.',
  });
  await asignarResponsables(proximoCulto, activos.slice(2, 4));
  const ensayo = await guardarEvento(ctx, {
    clave: 'ensayo-musica',
    titulo: 'Ensayo de alabanza',
    tipo: 'RELIGIOSO',
    categoria: 'ACTIVIDAD',
    fechaInicio: enDia(ctx, 3, 19),
    horas: 2,
    lugar: 'Templo principal',
    ministerioId: musicaId,
  });
  await guardarEvento(ctx, {
    clave: 'junta',
    titulo: 'Junta administrativa',
    tipo: 'ADMINISTRATIVO',
    categoria: 'REUNION',
    fechaInicio: enDia(ctx, 10, 20),
    horas: 1,
    lugar: 'Oficina pastoral',
  });
  await guardarEvento(ctx, {
    clave: 'convivencia',
    titulo: 'Convivencia de jóvenes',
    tipo: 'RELIGIOSO',
    categoria: 'ACTIVIDAD',
    fechaInicio: enDia(ctx, 5, 17),
    horas: 3,
    lugar: 'Parque de la colonia',
    ministerioId: jovenesId,
    cancelado: 'Pronóstico de lluvia intensa',
  });
  eventos += 4;

  // Anuncios: dos vigentes (uno importante), uno programado y uno expirado
  const pastor = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'pastor@iglesia.local' },
  });
  const anuncios = [
    {
      clave: 'ayuno',
      titulo: 'Semana de ayuno y oración',
      contenido:
        'Te invitamos a unirte **toda la semana**.\n\n- Lunes a viernes\n- 6:00 am en el templo',
      prioridad: 'IMPORTANTE' as const,
      fechaPublicacion: enDia(ctx, -2, 9),
      fechaExpiracion: enDia(ctx, 6, 23),
      eventoId: null,
      autorId: pastor.id,
    },
    {
      clave: 'ensayo',
      titulo: 'Ensayo abierto de alabanza',
      contenido: 'Si tocas algún instrumento, ven al ensayo del ministerio de Música.',
      prioridad: 'NORMAL' as const,
      fechaPublicacion: enDia(ctx, -1, 9),
      fechaExpiracion: null,
      eventoId: ensayo,
      autorId: ctx.creadoPorId,
    },
    {
      clave: 'campamento',
      titulo: 'Inscripciones al campamento',
      contenido: 'Las inscripciones abren pronto en la oficina.',
      prioridad: 'NORMAL' as const,
      fechaPublicacion: enDia(ctx, 4, 9),
      fechaExpiracion: null,
      eventoId: null,
      autorId: ctx.creadoPorId,
    },
    {
      clave: 'viveres',
      titulo: 'Colecta de víveres',
      contenido: 'Gracias a todos por participar.',
      prioridad: 'NORMAL' as const,
      fechaPublicacion: enDia(ctx, -20, 9),
      fechaExpiracion: enDia(ctx, -10, 9),
      eventoId: null,
      autorId: ctx.creadoPorId,
    },
  ];
  for (const { clave, ...datos } of anuncios) {
    const id = uuidDe(`anuncio:${clave}`);
    await prisma.anuncio.upsert({ where: { id }, create: { id, ...datos }, update: datos });
  }

  return { eventos, asistencias, anuncios: anuncios.length };
}
