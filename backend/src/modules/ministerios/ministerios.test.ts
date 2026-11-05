import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { crearUsuario, loginComo } from '../../test/helpers';
import * as ministeriosService from './ministerios.service';

let app: ReturnType<typeof crearApp>;
let admin: Awaited<ReturnType<typeof loginComo>>;
beforeEach(async () => {
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
  delete: (url: string, auth = admin.auth) =>
    request(app).delete(`/api/v1${url}`).set('Authorization', auth),
});

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

function crearMinisterio(nombre = 'Jóvenes', activo = true) {
  return prisma.ministerio.create({ data: { nombre, activo } });
}

function crearMiembro(nombre = 'Ana', activo = true) {
  return prisma.miembro.create({
    data: { nombre, apellidos: 'Pérez', fechaIngreso: new Date('2025-01-01'), activo },
  });
}

/** COORDINADOR con sesión que coordina el ministerio indicado. */
async function coordinadorDe(ministerioId: string) {
  const sesion = await loginComo('COORDINADOR');
  await prisma.ministerioCoordinador.create({
    data: { ministerioId, usuarioId: sesion.usuario.id },
  });
  return sesion;
}

describe('CRUD /ministerios (B2-07)', () => {
  it('crea, lista con totalIntegrantes y coordinadores, edita y desactiva', async () => {
    const creado = await api().post('/ministerios', {
      nombre: ' Música ',
      descripcion: 'Alabanza',
    });
    expect(creado.status).toBe(201);
    expect(creado.body.data).toMatchObject({
      nombre: 'Música',
      activo: true,
      totalIntegrantes: 0,
      coordinadores: [],
    });
    const id = creado.body.data.id as string;

    const ana = await crearMiembro();
    await prisma.miembroMinisterio.create({ data: { miembroId: ana.id, ministerioId: id } });
    const coord = await crearUsuario('COORDINADOR', { nombre: 'Rosa Pech' });
    await prisma.ministerioCoordinador.create({ data: { ministerioId: id, usuarioId: coord.id } });

    const lista = await api().get('/ministerios?q=mus');
    expect(lista.body.meta.total).toBe(1);
    expect(lista.body.data[0]).toMatchObject({
      totalIntegrantes: 1,
      coordinadores: [{ id: coord.id, nombre: 'Rosa Pech' }],
    });

    const editado = await api().patch(`/ministerios/${id}`, { descripcion: '' });
    expect(editado.body.data.descripcion).toBeNull();

    const baja = await api().patch(`/ministerios/${id}/estado`, { activo: false });
    expect(baja.body.data.activo).toBe(false);
    expect((await api().get('/ministerios?activo=true')).body.data).toHaveLength(0);
    expect((await api().get('/ministerios?activo=false')).body.data).toHaveLength(1);
  });

  it('nombre duplicado (sin distinguir mayúsculas) → 409 en el campo', async () => {
    const existente = await crearMinisterio('Niños');
    const res = await api().post('/ministerios', { nombre: 'NIÑOS' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([
      { campo: 'nombre', mensaje: 'Ya existe un ministerio con ese nombre.' },
    ]);
    const otro = await crearMinisterio('Damas');
    expect((await api().patch(`/ministerios/${otro.id}`, { nombre: 'niños' })).status).toBe(409);
    // Renombrarse a sí mismo con otras mayúsculas sí se permite
    expect((await api().patch(`/ministerios/${existente.id}`, { nombre: 'niños' })).status).toBe(
      200,
    );
  });

  it('validación → 400; inexistente → 404', async () => {
    expect((await api().post('/ministerios', { nombre: '' })).status).toBe(400);
    expect((await api().post('/ministerios', { nombre: 'X', activo: true })).status).toBe(400);
    expect((await api().get('/ministerios?activo=quizas')).status).toBe(400);
    expect((await api().get(`/ministerios/${ID_INEXISTENTE}`)).status).toBe(404);
  });

  it('solo ADMIN y PASTOR crean/editan/desactivan; todos leen; sin sesión → 401', async () => {
    const ministerio = await crearMinisterio();
    const pastor = await loginComo('PASTOR');
    expect((await api().post('/ministerios', { nombre: 'Servicio' }, pastor.auth)).status).toBe(
      201,
    );
    for (const rol of ['SECRETARIO', 'TESORERO', 'COORDINADOR'] as const) {
      const { auth } = await loginComo(rol);
      expect((await api().get('/ministerios', auth)).status).toBe(200);
      expect((await api().post('/ministerios', { nombre: `M ${rol}` }, auth)).status).toBe(403);
      expect(
        (await api().patch(`/ministerios/${ministerio.id}`, { nombre: 'X' }, auth)).status,
      ).toBe(403);
      expect(
        (await api().patch(`/ministerios/${ministerio.id}/estado`, { activo: false }, auth)).status,
      ).toBe(403);
    }
    expect((await request(app).get('/api/v1/ministerios')).status).toBe(401);
  });
});

describe('PUT /ministerios/:id/coordinadores (B2-08)', () => {
  it('reemplaza la lista; lista vacía permitida; ids repetidos se ignoran', async () => {
    const ministerio = await crearMinisterio();
    const coord = await crearUsuario('COORDINADOR');
    const pastor = await crearUsuario('PASTOR');

    const res = await api().put(`/ministerios/${ministerio.id}/coordinadores`, {
      usuarioIds: [coord.id, pastor.id, coord.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.coordinadores).toHaveLength(2);

    const solo = await api().put(`/ministerios/${ministerio.id}/coordinadores`, {
      usuarioIds: [pastor.id],
    });
    expect(solo.body.data.coordinadores).toEqual([{ id: pastor.id, nombre: pastor.nombre }]);

    const vacia = await api().put(`/ministerios/${ministerio.id}/coordinadores`, {
      usuarioIds: [],
    });
    expect(vacia.body.data.coordinadores).toEqual([]);
  });

  it('usuario con otro rol o inactivo → 422 indicando cuál', async () => {
    const ministerio = await crearMinisterio();
    const tesorero = await crearUsuario('TESORERO', { nombre: 'Jorge Canul' });
    const inactivo = await crearUsuario('COORDINADOR', { nombre: 'Luis Baja', activo: false });
    const res = await api().put(`/ministerios/${ministerio.id}/coordinadores`, {
      usuarioIds: [tesorero.id, inactivo.id],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Jorge Canul');
    expect(res.body.error.message).toContain('Luis Baja');
    expect(await prisma.ministerioCoordinador.count()).toBe(0);
  });

  it('usuario inexistente → 422 indicando cuál; no cambia la lista', async () => {
    const ministerio = await crearMinisterio();
    const coord = await crearUsuario('COORDINADOR');
    await api().put(`/ministerios/${ministerio.id}/coordinadores`, { usuarioIds: [coord.id] });
    const res = await api().put(`/ministerios/${ministerio.id}/coordinadores`, {
      usuarioIds: [ID_INEXISTENTE],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain(ID_INEXISTENTE);
    expect(await prisma.ministerioCoordinador.count()).toBe(1);
  });

  it('validación → 400; COORDINADOR → 403', async () => {
    const ministerio = await crearMinisterio();
    expect(
      (await api().put(`/ministerios/${ministerio.id}/coordinadores`, { usuarioIds: ['x'] }))
        .status,
    ).toBe(400);
    const coord = await coordinadorDe(ministerio.id);
    expect(
      (
        await api().put(
          `/ministerios/${ministerio.id}/coordinadores`,
          { usuarioIds: [] },
          coord.auth,
        )
      ).status,
    ).toBe(403);
  });
});

describe('integrantes (B2-09, B2-10)', () => {
  it('vincula muchos miembros de una vez (consultas fijas) mezclando nuevos y reactivados', async () => {
    const ministerio = await crearMinisterio();
    const miembros = await Promise.all(
      Array.from({ length: 60 }, (_, i) => crearMiembro(`Miembro${i}`)),
    );
    const [primero, segundo] = miembros as [(typeof miembros)[0], (typeof miembros)[0]];
    // Uno ya activo y otro con vínculo cerrado
    await prisma.miembroMinisterio.create({
      data: { miembroId: primero.id, ministerioId: ministerio.id },
    });
    await prisma.miembroMinisterio.create({
      data: {
        miembroId: segundo.id,
        ministerioId: ministerio.id,
        activo: false,
        fechaSalida: new Date('2025-01-01'),
      },
    });

    const res = await api().post(`/ministerios/${ministerio.id}/miembros`, {
      miembroIds: miembros.map((m) => m.id),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.totalIntegrantes).toBe(60);
    expect(await prisma.miembroMinisterio.count()).toBe(60);
    const reactivado = await prisma.miembroMinisterio.findUniqueOrThrow({
      where: { miembroId_ministerioId: { miembroId: segundo.id, ministerioId: ministerio.id } },
    });
    expect(reactivado).toMatchObject({ activo: true, fechaSalida: null });
  });

  it('la búsqueda de integrantes solo considera a los de ese ministerio', async () => {
    const jovenes = await crearMinisterio('Jóvenes');
    const musica = await crearMinisterio('Música');
    const jose = await crearMiembro('José');
    const josue = await crearMiembro('Josué');
    await prisma.miembroMinisterio.create({
      data: { miembroId: jose.id, ministerioId: jovenes.id },
    });
    await prisma.miembroMinisterio.create({
      data: { miembroId: josue.id, ministerioId: musica.id },
    });
    const res = await api().get(`/ministerios/${jovenes.id}/miembros?q=jos`);
    expect(res.body.data.map((m: { id: string }) => m.id)).toEqual([jose.id]);
  });

  it('vincula varios (repetidos ignorados), desvincula (soft) y reactiva', async () => {
    const ministerio = await crearMinisterio();
    const ana = await crearMiembro('Ana');
    const beto = await crearMiembro('Beto');

    const res = await api().post(`/ministerios/${ministerio.id}/miembros`, {
      miembroIds: [ana.id, beto.id, ana.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.totalIntegrantes).toBe(2);

    const quitar = await api().delete(`/ministerios/${ministerio.id}/miembros/${ana.id}`);
    expect(quitar.status).toBe(204);
    const activos = await api().get(`/ministerios/${ministerio.id}/miembros`);
    expect(activos.body.data.map((m: { nombre: string }) => m.nombre)).toEqual(['Beto']);

    const historicos = await api().get(
      `/ministerios/${ministerio.id}/miembros?incluirHistoricos=true`,
    );
    expect(historicos.body.meta.total).toBe(2);
    const salida = historicos.body.data.find((m: { id: string }) => m.id === ana.id);
    expect(salida).toMatchObject({ activo: false, miembroActivo: true });
    expect(salida.fechaSalida).not.toBeNull();

    // Volver a vincular reactiva el vínculo previo
    await api().post(`/ministerios/${ministerio.id}/miembros`, { miembroIds: [ana.id] });
    const vinculo = await prisma.miembroMinisterio.findUniqueOrThrow({
      where: { miembroId_ministerioId: { miembroId: ana.id, ministerioId: ministerio.id } },
    });
    expect(vinculo).toMatchObject({ activo: true, fechaSalida: null });
    expect(await prisma.miembroMinisterio.count()).toBe(2);
  });

  it('búsqueda sin acentos en integrantes', async () => {
    const ministerio = await crearMinisterio();
    const jose = await crearMiembro('José');
    const ana = await crearMiembro('Ana');
    await api().post(`/ministerios/${ministerio.id}/miembros`, { miembroIds: [jose.id, ana.id] });
    const res = await api().get(`/ministerios/${ministerio.id}/miembros?q=jose`);
    expect(res.body.data.map((m: { id: string }) => m.id)).toEqual([jose.id]);
  });

  it('miembro inactivo → 422 y no se vincula ninguno (transacción)', async () => {
    const ministerio = await crearMinisterio();
    const ana = await crearMiembro('Ana');
    const baja = await crearMiembro('Pedro', false);
    const res = await api().post(`/ministerios/${ministerio.id}/miembros`, {
      miembroIds: [ana.id, baja.id],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Pedro');
    expect(await prisma.miembroMinisterio.count()).toBe(0);
  });

  it('ministerio inactivo → 422; miembro inexistente → 404; lista vacía → 400', async () => {
    const inactivo = await crearMinisterio('Viejo', false);
    const ana = await crearMiembro();
    expect(
      (await api().post(`/ministerios/${inactivo.id}/miembros`, { miembroIds: [ana.id] })).status,
    ).toBe(422);
    const ministerio = await crearMinisterio();
    expect(
      (await api().post(`/ministerios/${ministerio.id}/miembros`, { miembroIds: [ID_INEXISTENTE] }))
        .status,
    ).toBe(404);
    expect(
      (await api().post(`/ministerios/${ministerio.id}/miembros`, { miembroIds: [] })).status,
    ).toBe(400);
    expect((await api().delete(`/ministerios/${ministerio.id}/miembros/${ana.id}`)).status).toBe(
      404,
    );
  });

  it('COORDINADOR del ministerio gestiona; de otro ministerio → 403; SECRETARIO → 403', async () => {
    const propio = await crearMinisterio('Jóvenes');
    const ajeno = await crearMinisterio('Música');
    const ana = await crearMiembro();
    const coord = await coordinadorDe(propio.id);

    expect(
      (await api().post(`/ministerios/${propio.id}/miembros`, { miembroIds: [ana.id] }, coord.auth))
        .status,
    ).toBe(200);
    expect(
      (await api().delete(`/ministerios/${propio.id}/miembros/${ana.id}`, coord.auth)).status,
    ).toBe(204);
    expect(
      (await api().post(`/ministerios/${ajeno.id}/miembros`, { miembroIds: [ana.id] }, coord.auth))
        .status,
    ).toBe(403);

    const secretario = await loginComo('SECRETARIO');
    expect(
      (
        await api().post(
          `/ministerios/${propio.id}/miembros`,
          { miembroIds: [ana.id] },
          secretario.auth,
        )
      ).status,
    ).toBe(403);
    expect((await request(app).get(`/api/v1/ministerios/${propio.id}/miembros`)).status).toBe(401);
  });
});

describe('funciones para otros módulos (B2-11)', () => {
  it('miembrosDe, ministeriosCoordinadosPor, contarActivos y participacionPorMinisterio', async () => {
    const jovenes = await crearMinisterio('Jóvenes');
    const musica = await crearMinisterio('Música');
    await crearMinisterio('Inactivo', false);
    const ana = await crearMiembro('Ana');
    const beto = await crearMiembro('Beto');
    for (const [miembroId, ministerioId] of [
      [ana.id, jovenes.id],
      [beto.id, jovenes.id],
      [ana.id, musica.id],
    ] as const) {
      await prisma.miembroMinisterio.create({ data: { miembroId, ministerioId } });
    }
    await prisma.miembro.update({ where: { id: beto.id }, data: { activo: false } });
    const coord = await coordinadorDe(musica.id);

    expect(await ministeriosService.miembrosDe(jovenes.id)).toEqual([
      { id: ana.id, nombre: 'Ana', apellidos: 'Pérez' },
    ]);
    expect(await ministeriosService.ministeriosCoordinadosPor(coord.usuario.id)).toEqual([
      musica.id,
    ]);
    expect(await ministeriosService.contarActivos()).toBe(2);
    expect(await ministeriosService.participacionPorMinisterio()).toEqual([
      { ministerioId: jovenes.id, ministerio: 'Jóvenes', total: 1 },
      { ministerioId: musica.id, ministerio: 'Música', total: 1 },
    ]);
  });
});
