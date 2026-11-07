import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { loginComo } from '../../test/helpers';
import * as eventosService from './eventos.service';

let app: ReturnType<typeof crearApp>;
let admin: Awaited<ReturnType<typeof loginComo>>;
beforeEach(async () => {
  eventosService.reiniciarMarcaRealizados();
  app = crearApp();
  admin = await loginComo('ADMIN');
});

const api = () => ({
  get: (url: string, auth = admin.auth) =>
    request(app).get(`/api/v1${url}`).set('Authorization', auth),
  post: (url: string, body?: object, auth = admin.auth) =>
    request(app).post(`/api/v1${url}`).set('Authorization', auth).send(body),
  patch: (url: string, body: object, auth = admin.auth) =>
    request(app).patch(`/api/v1${url}`).set('Authorization', auth).send(body),
  put: (url: string, body: object, auth = admin.auth) =>
    request(app).put(`/api/v1${url}`).set('Authorization', auth).send(body),
});

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const DIA = 86_400_000;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA);

const datosEvento = (extra: object = {}) => ({
  titulo: 'Culto dominical',
  tipo: 'RELIGIOSO',
  categoria: 'CULTO',
  fechaInicio: enDias(3).toISOString(),
  lugar: 'Templo principal',
  ...extra,
});

function crearMinisterio(nombre = 'Jóvenes', activo = true) {
  return prisma.ministerio.create({ data: { nombre, activo } });
}

function crearMiembro(nombre = 'Ana', activo = true) {
  return prisma.miembro.create({
    data: { nombre, apellidos: 'Pérez', fechaIngreso: new Date('2025-01-01'), activo },
  });
}

/** Evento directo en BD (para preparar escenarios). */
function crearEventoBd(
  datos: Partial<{
    titulo: string;
    fechaInicio: Date;
    fechaFin: Date | null;
    estado: 'PROGRAMADO' | 'CANCELADO' | 'REALIZADO';
    ministerioId: string | null;
  }> = {},
) {
  return prisma.evento.create({
    data: {
      titulo: datos.titulo ?? 'Evento',
      tipo: 'RELIGIOSO',
      categoria: 'CULTO',
      lugar: 'Templo',
      fechaInicio: datos.fechaInicio ?? enDias(3),
      fechaFin: datos.fechaFin ?? null,
      estado: datos.estado ?? 'PROGRAMADO',
      ministerioId: datos.ministerioId ?? null,
      creadoPorId: admin.usuario.id,
    },
  });
}

async function coordinadorDe(ministerioId: string) {
  const sesion = await loginComo('COORDINADOR');
  await prisma.ministerioCoordinador.create({
    data: { ministerioId, usuarioId: sesion.usuario.id },
  });
  return sesion;
}

describe('POST /eventos (B3-01)', () => {
  it('crea el evento con el usuario actual como creador', async () => {
    const jovenes = await crearMinisterio();
    const res = await api().post('/eventos', datosEvento({ ministerioId: jovenes.id }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      titulo: 'Culto dominical',
      estado: 'PROGRAMADO',
      ministerio: { id: jovenes.id, nombre: 'Jóvenes' },
      creadoPor: { id: admin.usuario.id },
      totalResponsables: 0,
      responsables: [],
      resumenAsistencia: null,
    });
  });

  it('fechaFin < fechaInicio → 400', async () => {
    const res = await api().post(
      '/eventos',
      datosEvento({ fechaInicio: enDias(3).toISOString(), fechaFin: enDias(2).toISOString() }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo: 'fechaFin' })]),
    );
  });

  it('valida campos obligatorios, enums y rechaza campos desconocidos → 400', async () => {
    expect((await api().post('/eventos', { titulo: '' })).status).toBe(400);
    expect((await api().post('/eventos', datosEvento({ tipo: 'OTRO' }))).status).toBe(400);
    expect((await api().post('/eventos', datosEvento({ estado: 'CANCELADO' }))).status).toBe(400);
  });

  it('COORDINADOR sin ministerioId o de otro ministerio → 403; del suyo → 201', async () => {
    const suyo = await crearMinisterio('Música');
    const otro = await crearMinisterio('Niños');
    const coord = await coordinadorDe(suyo.id);
    expect((await api().post('/eventos', datosEvento(), coord.auth)).status).toBe(403);
    expect(
      (await api().post('/eventos', datosEvento({ ministerioId: otro.id }), coord.auth)).status,
    ).toBe(403);
    expect(
      (await api().post('/eventos', datosEvento({ ministerioId: suyo.id }), coord.auth)).status,
    ).toBe(201);
  });

  it('ministerio inactivo → 422; inexistente → 422', async () => {
    const inactivo = await crearMinisterio('Damas', false);
    const res = await api().post('/eventos', datosEvento({ ministerioId: inactivo.id }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE');
    expect(
      (await api().post('/eventos', datosEvento({ ministerioId: ID_INEXISTENTE }))).status,
    ).toBe(422);
  });

  it('TESORERO → 403; sin sesión → 401', async () => {
    const tesorero = await loginComo('TESORERO');
    expect((await api().post('/eventos', datosEvento(), tesorero.auth)).status).toBe(403);
    expect((await request(app).post('/api/v1/eventos').send(datosEvento())).status).toBe(401);
  });
});

describe('GET /eventos (B3-02)', () => {
  it('con desde/hasta devuelve el rango sin paginar, incluye los que empiezan antes y terminan dentro', async () => {
    const desde = new Date('2026-03-01T00:00:00.000Z');
    const hasta = new Date('2026-03-31T23:59:59.000Z');
    const cruza = await crearEventoBd({
      titulo: 'Retiro',
      fechaInicio: new Date('2026-02-27T15:00:00.000Z'),
      fechaFin: new Date('2026-03-02T12:00:00.000Z'),
    });
    await crearEventoBd({ titulo: 'Dentro', fechaInicio: new Date('2026-03-15T18:00:00.000Z') });
    await crearEventoBd({ titulo: 'Antes', fechaInicio: new Date('2026-02-10T18:00:00.000Z') });
    await crearEventoBd({ titulo: 'Después', fechaInicio: new Date('2026-04-05T18:00:00.000Z') });

    const res = await api().get(
      `/eventos?desde=${desde.toISOString()}&hasta=${hasta.toISOString()}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Retiro', 'Dentro']);
    expect(res.body.data[0]).toMatchObject({
      id: cruza.id,
      ministerio: null,
      totalResponsables: 0,
    });
  });

  it('cada evento incluye ministerio { id, nombre } y totalResponsables', async () => {
    const musica = await crearMinisterio('Música');
    const evento = await crearEventoBd({ ministerioId: musica.id });
    const ana = await crearMiembro();
    await prisma.eventoResponsable.create({ data: { eventoId: evento.id, miembroId: ana.id } });
    const res = await api().get(`/eventos?ministerioId=${musica.id}`);
    expect(res.body.data[0]).toMatchObject({
      ministerio: { id: musica.id, nombre: 'Música' },
      totalResponsables: 1,
    });
    expect(res.body.meta.total).toBe(1);
  });

  it('fechas sin hora usan el día de la zona horaria de la iglesia (no UTC)', async () => {
    // America/Mexico_City (UTC-6): 2026-04-01T02:00Z = 31 de marzo 20:00 local
    await crearEventoBd({
      titulo: 'Noche del 31',
      fechaInicio: new Date('2026-04-01T02:00:00.000Z'),
    });
    // 2026-03-31T05:00Z = 30 de marzo 23:00 local
    await crearEventoBd({
      titulo: 'Noche del 30',
      fechaInicio: new Date('2026-03-31T05:00:00.000Z'),
    });
    const res = await api().get('/eventos?desde=2026-03-31&hasta=2026-03-31');
    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Noche del 31']);
  });

  it('busca por título sin acentos ni mayúsculas', async () => {
    await crearEventoBd({ titulo: 'Reunión de oración' });
    await crearEventoBd({ titulo: 'Culto' });
    const res = await api().get('/eventos?q=REUNION');
    expect(res.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Reunión de oración']);
  });

  it('rango > 93 días → 400', async () => {
    const res = await api().get('/eventos?desde=2026-01-01&hasta=2026-06-01');
    expect(res.status).toBe(400);
  });

  it('sin rango: paginado y por fechaInicio desc; filtra por estado y categoría', async () => {
    await crearEventoBd({ titulo: 'Primero', fechaInicio: enDias(1) });
    await crearEventoBd({ titulo: 'Segundo', fechaInicio: enDias(5) });
    await crearEventoBd({ titulo: 'Cancelado', fechaInicio: enDias(2), estado: 'CANCELADO' });
    const res = await api().get('/eventos?limit=2');
    expect(res.body.meta).toMatchObject({ total: 3, limit: 2, totalPages: 2 });
    expect(res.body.data[0].titulo).toBe('Segundo');
    const cancelados = await api().get('/eventos?estado=CANCELADO&categoria=CULTO');
    expect(cancelados.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Cancelado']);
  });

  it('todos los roles leen (TESORERO) y sin sesión → 401', async () => {
    const tesorero = await loginComo('TESORERO');
    expect((await api().get('/eventos', tesorero.auth)).status).toBe(200);
    expect((await request(app).get('/api/v1/eventos')).status).toBe(401);
  });
});

describe('GET/PATCH /eventos/:id (B3-03)', () => {
  it('detalle con responsables, ministerio, creador y resumenAsistencia', async () => {
    const evento = await crearEventoBd({ fechaInicio: enDias(-1) });
    const ana = await crearMiembro('Ana');
    const luis = await crearMiembro('Luis');
    await prisma.eventoResponsable.create({ data: { eventoId: evento.id, miembroId: ana.id } });
    await prisma.asistencia.createMany({
      data: [
        {
          eventoId: evento.id,
          miembroId: ana.id,
          presente: true,
          registradoPorId: admin.usuario.id,
        },
        {
          eventoId: evento.id,
          miembroId: luis.id,
          presente: false,
          registradoPorId: admin.usuario.id,
        },
      ],
    });
    const res = await api().get(`/eventos/${evento.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      creadoPor: { id: admin.usuario.id },
      responsables: [{ id: ana.id, nombre: 'Ana' }],
      resumenAsistencia: { presentes: 1, ausentes: 1, total: 2 },
    });
  });

  it('edita y valida fin ≥ inicio contra lo guardado', async () => {
    const evento = await crearEventoBd({ fechaInicio: enDias(5) });
    const ok = await api().patch(`/eventos/${evento.id}`, { titulo: 'Vigilia', descripcion: '' });
    expect(ok.body.data).toMatchObject({ titulo: 'Vigilia', descripcion: null });
    const mal = await api().patch(`/eventos/${evento.id}`, { fechaFin: enDias(4).toISOString() });
    expect(mal.status).toBe(400);
    expect((await api().patch(`/eventos/${evento.id}`, {})).status).toBe(400);
  });

  it('un evento REALIZADO reprogramado a fecha futura vuelve a PROGRAMADO y a próximos', async () => {
    const evento = await crearEventoBd({ titulo: 'Fecha equivocada', fechaInicio: enDias(-2) });
    expect((await api().get(`/eventos/${evento.id}`)).body.data.estado).toBe('REALIZADO');
    const res = await api().patch(`/eventos/${evento.id}`, {
      fechaInicio: enDias(4).toISOString(),
    });
    expect(res.body.data.estado).toBe('PROGRAMADO');
    const proximos = await api().get('/eventos/proximos');
    expect(proximos.body.data.map((e: { id: string }) => e.id)).toContain(evento.id);
  });

  it('no se edita un evento CANCELADO → 422', async () => {
    const evento = await crearEventoBd({ estado: 'CANCELADO' });
    const res = await api().patch(`/eventos/${evento.id}`, { titulo: 'Otro' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE');
  });

  it('COORDINADOR solo edita eventos de su ministerio (ni los mueve a otro)', async () => {
    const suyo = await crearMinisterio('Música');
    const otro = await crearMinisterio('Niños');
    const coord = await coordinadorDe(suyo.id);
    const propio = await crearEventoBd({ ministerioId: suyo.id });
    const ajeno = await crearEventoBd({ ministerioId: otro.id });
    expect(
      (await api().patch(`/eventos/${propio.id}`, { lugar: 'Salón' }, coord.auth)).status,
    ).toBe(200);
    expect((await api().patch(`/eventos/${ajeno.id}`, { lugar: 'Salón' }, coord.auth)).status).toBe(
      403,
    );
    expect(
      (await api().patch(`/eventos/${propio.id}`, { ministerioId: otro.id }, coord.auth)).status,
    ).toBe(403);
  });

  it('inexistente → 404; id no válido → 400', async () => {
    expect((await api().get(`/eventos/${ID_INEXISTENTE}`)).status).toBe(404);
    expect((await api().get('/eventos/abc')).status).toBe(400);
  });
});

describe('PATCH /eventos/:id/cancelar (B3-04)', () => {
  it('cancela con motivo y conserva la asistencia registrada', async () => {
    const evento = await crearEventoBd({ fechaInicio: enDias(-1) });
    const ana = await crearMiembro();
    await prisma.asistencia.create({
      data: {
        eventoId: evento.id,
        miembroId: ana.id,
        presente: true,
        registradoPorId: admin.usuario.id,
      },
    });
    const res = await api().patch(`/eventos/${evento.id}/cancelar`, { motivo: 'Lluvia intensa' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      estado: 'CANCELADO',
      motivoCancelacion: 'Lluvia intensa',
    });
    expect(await prisma.asistencia.count({ where: { eventoId: evento.id } })).toBe(1);
  });

  it('evento ya cancelado → 422; motivo corto → 400', async () => {
    const evento = await crearEventoBd({ estado: 'CANCELADO' });
    expect(
      (await api().patch(`/eventos/${evento.id}/cancelar`, { motivo: 'Otra vez' })).status,
    ).toBe(422);
    const otro = await crearEventoBd();
    expect((await api().patch(`/eventos/${otro.id}/cancelar`, { motivo: 'no' })).status).toBe(400);
  });

  it('TESORERO → 403', async () => {
    const tesorero = await loginComo('TESORERO');
    const evento = await crearEventoBd();
    expect(
      (await api().patch(`/eventos/${evento.id}/cancelar`, { motivo: 'Sin local' }, tesorero.auth))
        .status,
    ).toBe(403);
  });
});

describe('PUT /eventos/:id/responsables (B3-05)', () => {
  it('reemplaza la lista de responsables', async () => {
    const evento = await crearEventoBd();
    const ana = await crearMiembro('Ana');
    const luis = await crearMiembro('Luis');
    await api().put(`/eventos/${evento.id}/responsables`, { miembroIds: [ana.id] });
    const res = await api().put(`/eventos/${evento.id}/responsables`, {
      miembroIds: [luis.id, luis.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.responsables.map((r: { id: string }) => r.id)).toEqual([luis.id]);
    expect(res.body.data.totalResponsables).toBe(1);
  });

  it('miembro inactivo o inexistente → 422 indicando cuál', async () => {
    const evento = await crearEventoBd();
    const inactivo = await crearMiembro('Pedro', false);
    const res = await api().put(`/eventos/${evento.id}/responsables`, {
      miembroIds: [inactivo.id, ID_INEXISTENTE],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Pedro Pérez está inactivo');
    expect(res.body.error.details).toHaveLength(2);
    expect(res.body.error.details[1].mensaje).toContain(ID_INEXISTENTE);
  });

  it('más de 10 → 400; SECRETARIO puede; TESORERO → 403', async () => {
    const evento = await crearEventoBd();
    const ids = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${10 + i}`);
    expect(
      (await api().put(`/eventos/${evento.id}/responsables`, { miembroIds: ids })).status,
    ).toBe(400);
    const secretario = await loginComo('SECRETARIO');
    expect(
      (await api().put(`/eventos/${evento.id}/responsables`, { miembroIds: [] }, secretario.auth))
        .status,
    ).toBe(200);
    const tesorero = await loginComo('TESORERO');
    expect(
      (await api().put(`/eventos/${evento.id}/responsables`, { miembroIds: [] }, tesorero.auth))
        .status,
    ).toBe(403);
  });
});

describe('próximos eventos y estado REALIZADO (B3-06)', () => {
  it('GET /eventos/proximos devuelve programados desde ahora, del más cercano', async () => {
    await crearEventoBd({ titulo: 'Lejano', fechaInicio: enDias(10) });
    await crearEventoBd({ titulo: 'Cercano', fechaInicio: enDias(1) });
    await crearEventoBd({ titulo: 'Cancelado', fechaInicio: enDias(2), estado: 'CANCELADO' });
    await crearEventoBd({ titulo: 'Pasado', fechaInicio: enDias(-2) });
    const res = await api().get('/eventos/proximos?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Cercano', 'Lejano']);
    expect((await api().get('/eventos/proximos?limit=50')).status).toBe(400);
  });

  it('marca REALIZADO los programados cuya fecha ya pasó (y no toca cancelados ni futuros)', async () => {
    const pasado = await crearEventoBd({ fechaInicio: enDias(-3) });
    const conFin = await crearEventoBd({ fechaInicio: enDias(-3), fechaFin: enDias(1) });
    const cancelado = await crearEventoBd({ fechaInicio: enDias(-3), estado: 'CANCELADO' });
    const futuro = await crearEventoBd({ fechaInicio: enDias(2) });
    expect(await eventosService.marcarRealizados()).toBe(1);
    const estados = await prisma.evento.findMany({ select: { id: true, estado: true } });
    const estadoDe = (id: string) => estados.find((e) => e.id === id)?.estado;
    expect(estadoDe(pasado.id)).toBe('REALIZADO');
    expect(estadoDe(conFin.id)).toBe('PROGRAMADO');
    expect(estadoDe(cancelado.id)).toBe('CANCELADO');
    expect(estadoDe(futuro.id)).toBe('PROGRAMADO');
  });

  it('marcarRealizados escribe a lo más una vez por minuto (A1-B3-03)', async () => {
    const ahora = new Date();
    await crearEventoBd({ fechaInicio: enDias(-3) });
    expect(await eventosService.marcarRealizados(ahora)).toBe(1);
    await crearEventoBd({ fechaInicio: enDias(-2) });
    expect(await eventosService.marcarRealizados(new Date(ahora.getTime() + 30_000))).toBe(0);
    expect(await eventosService.marcarRealizados(new Date(ahora.getTime() + 61_000))).toBe(1);
  });

  it('al consultar el detalle de un evento pasado ya aparece REALIZADO', async () => {
    const evento = await crearEventoBd({ fechaInicio: enDias(-1) });
    expect((await api().get(`/eventos/${evento.id}`)).body.data.estado).toBe('REALIZADO');
  });

  it('contarPorRango excluye cancelados', async () => {
    await crearEventoBd({ fechaInicio: enDias(1) });
    await crearEventoBd({ fechaInicio: enDias(2), estado: 'CANCELADO' });
    expect(await eventosService.contarPorRango(enDias(0), enDias(7))).toBe(1);
  });
});
