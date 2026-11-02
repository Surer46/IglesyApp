import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { loginComo } from '../../test/helpers';
import * as anunciosService from './anuncios.service';

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
  delete: (url: string, auth = admin.auth) =>
    request(app).delete(`/api/v1${url}`).set('Authorization', auth),
});

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const DIA = 86_400_000;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA);

function crearEvento(estado: 'PROGRAMADO' | 'CANCELADO' = 'PROGRAMADO') {
  return prisma.evento.create({
    data: {
      titulo: 'Concierto',
      tipo: 'RELIGIOSO',
      categoria: 'ACTIVIDAD',
      lugar: 'Templo',
      fechaInicio: enDias(5),
      estado,
      creadoPorId: admin.usuario.id,
    },
  });
}

function crearAnuncio(datos: {
  titulo: string;
  fechaPublicacion?: Date;
  fechaExpiracion?: Date | null;
  prioridad?: 'NORMAL' | 'IMPORTANTE';
}) {
  return prisma.anuncio.create({
    data: {
      titulo: datos.titulo,
      contenido: 'Texto',
      prioridad: datos.prioridad ?? 'NORMAL',
      fechaPublicacion: datos.fechaPublicacion ?? enDias(-1),
      fechaExpiracion: datos.fechaExpiracion ?? null,
      autorId: admin.usuario.id,
    },
  });
}

describe('POST /anuncios (B3-12)', () => {
  it('publica con autor actual, prioridad NORMAL y fecha de publicación ahora por defecto', async () => {
    const evento = await crearEvento();
    const antes = Date.now();
    const res = await api().post('/anuncios', {
      titulo: ' Ensayo general ',
      contenido: '**Todos** invitados',
      eventoId: evento.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      titulo: 'Ensayo general',
      prioridad: 'NORMAL',
      fechaExpiracion: null,
      autor: { id: admin.usuario.id },
      evento: { id: evento.id, titulo: 'Concierto' },
    });
    expect(Date.parse(res.body.data.fechaPublicacion)).toBeGreaterThanOrEqual(antes - 1000);
  });

  it('fechaExpiracion <= fechaPublicacion → 400', async () => {
    const fecha = enDias(1).toISOString();
    const res = await api().post('/anuncios', {
      titulo: 'Aviso',
      contenido: 'Texto',
      fechaPublicacion: fecha,
      fechaExpiracion: fecha,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].campo).toBe('fechaExpiracion');
  });

  it('valida longitudes y campos desconocidos → 400', async () => {
    expect(
      (await api().post('/anuncios', { titulo: 'x'.repeat(121), contenido: 'a' })).status,
    ).toBe(400);
    expect(
      (await api().post('/anuncios', { titulo: 'a', contenido: 'x'.repeat(5001) })).status,
    ).toBe(400);
    expect(
      (await api().post('/anuncios', { titulo: 'a', contenido: 'b', autorId: 'x' })).status,
    ).toBe(400);
  });

  it('eventoId inexistente o cancelado → 422', async () => {
    const cancelado = await crearEvento('CANCELADO');
    const base = { titulo: 'Aviso', contenido: 'Texto' };
    const r1 = await api().post('/anuncios', { ...base, eventoId: ID_INEXISTENTE });
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('BUSINESS_RULE');
    expect((await api().post('/anuncios', { ...base, eventoId: cancelado.id })).status).toBe(422);
  });

  it('TESORERO y COORDINADOR → 403; sin sesión → 401', async () => {
    const base = { titulo: 'Aviso', contenido: 'Texto' };
    for (const rol of ['TESORERO', 'COORDINADOR'] as const) {
      const sesion = await loginComo(rol);
      expect((await api().post('/anuncios', base, sesion.auth)).status).toBe(403);
    }
    expect((await request(app).post('/api/v1/anuncios').send(base)).status).toBe(401);
  });
});

describe('GET/PATCH/DELETE /anuncios (B3-13)', () => {
  it('vigentes=true: publicados y no expirados, IMPORTANTE primero; los programados no aparecen', async () => {
    await crearAnuncio({ titulo: 'Normal reciente', fechaPublicacion: enDias(-1) });
    await crearAnuncio({
      titulo: 'Importante viejo',
      fechaPublicacion: enDias(-5),
      prioridad: 'IMPORTANTE',
    });
    await crearAnuncio({ titulo: 'Programado', fechaPublicacion: enDias(2) });
    await crearAnuncio({
      titulo: 'Expirado',
      fechaPublicacion: enDias(-9),
      fechaExpiracion: enDias(-1),
    });

    const vigentes = await api().get('/anuncios?vigentes=true');
    expect(vigentes.status).toBe(200);
    expect(vigentes.body.data.map((a: { titulo: string }) => a.titulo)).toEqual([
      'Importante viejo',
      'Normal reciente',
    ]);
    const noVigentes = await api().get('/anuncios?vigentes=false');
    expect(noVigentes.body.data.map((a: { titulo: string }) => a.titulo).sort()).toEqual([
      'Expirado',
      'Programado',
    ]);
    const importantes = await api().get('/anuncios?prioridad=IMPORTANTE');
    expect(importantes.body.meta.total).toBe(1);
    expect((await api().get('/anuncios')).body.meta.total).toBe(4);
  });

  it('estado=vigentes|programados|expirados separa y pagina cada pestaña', async () => {
    await crearAnuncio({ titulo: 'Vigente' });
    await crearAnuncio({ titulo: 'Programado 1', fechaPublicacion: enDias(2) });
    await crearAnuncio({ titulo: 'Programado 2', fechaPublicacion: enDias(3) });
    await crearAnuncio({
      titulo: 'Expirado',
      fechaPublicacion: enDias(-9),
      fechaExpiracion: enDias(-1),
    });
    const titulos = async (url: string) =>
      (await api().get(url)).body.data.map((a: { titulo: string }) => a.titulo).sort();
    expect(await titulos('/anuncios?estado=vigentes')).toEqual(['Vigente']);
    expect(await titulos('/anuncios?estado=programados')).toEqual(['Programado 1', 'Programado 2']);
    expect(await titulos('/anuncios?estado=expirados')).toEqual(['Expirado']);
    const pagina = await api().get('/anuncios?estado=programados&limit=1&page=2');
    expect(pagina.body.meta).toMatchObject({ total: 2, page: 2, totalPages: 2 });
    expect((await api().get('/anuncios?estado=otro')).status).toBe(400);
  });

  it('busca por título sin acentos', async () => {
    await crearAnuncio({ titulo: 'Reunión de padres' });
    await crearAnuncio({ titulo: 'Bautizos' });
    const res = await api().get('/anuncios?q=reunion');
    expect(res.body.data.map((a: { titulo: string }) => a.titulo)).toEqual(['Reunión de padres']);
  });

  it('lectura para todos los roles; escritura solo ADMIN, PASTOR y SECRETARIO', async () => {
    const anuncio = await crearAnuncio({ titulo: 'Aviso' });
    for (const rol of ['TESORERO', 'COORDINADOR'] as const) {
      const sesion = await loginComo(rol);
      expect((await api().get('/anuncios', sesion.auth)).status).toBe(200);
      expect((await api().get(`/anuncios/${anuncio.id}`, sesion.auth)).status).toBe(200);
      expect(
        (await api().patch(`/anuncios/${anuncio.id}`, { titulo: 'X' }, sesion.auth)).status,
      ).toBe(403);
      expect((await api().delete(`/anuncios/${anuncio.id}`, sesion.auth)).status).toBe(403);
    }
    for (const rol of ['PASTOR', 'SECRETARIO'] as const) {
      const sesion = await loginComo(rol);
      expect(
        (await api().patch(`/anuncios/${anuncio.id}`, { titulo: rol }, sesion.auth)).status,
      ).toBe(200);
    }
  });

  it('edita validando la expiración contra lo guardado y elimina físicamente', async () => {
    const anuncio = await crearAnuncio({ titulo: 'Aviso', fechaPublicacion: enDias(-1) });
    const ok = await api().patch(`/anuncios/${anuncio.id}`, { prioridad: 'IMPORTANTE' });
    expect(ok.body.data.prioridad).toBe('IMPORTANTE');
    const mal = await api().patch(`/anuncios/${anuncio.id}`, {
      fechaExpiracion: enDias(-2).toISOString(),
    });
    expect(mal.status).toBe(400);
    expect((await api().patch(`/anuncios/${anuncio.id}`, {})).status).toBe(400);

    expect((await api().delete(`/anuncios/${anuncio.id}`)).status).toBe(204);
    expect(await prisma.anuncio.count()).toBe(0);
    expect((await api().get(`/anuncios/${anuncio.id}`)).status).toBe(404);
  });
});

describe('anunciosService.vigentes (B3-14)', () => {
  it('solo vigentes (no expirados ni programados), IMPORTANTE primero, con límite y filtro', async () => {
    await crearAnuncio({ titulo: 'Vigente normal' });
    await crearAnuncio({ titulo: 'Vigente importante', prioridad: 'IMPORTANTE' });
    await crearAnuncio({ titulo: 'Sin expirar aún', fechaExpiracion: enDias(1) });
    await crearAnuncio({
      titulo: 'Expirado',
      fechaPublicacion: enDias(-5),
      fechaExpiracion: enDias(-1),
    });
    await crearAnuncio({
      titulo: 'Programado',
      fechaPublicacion: enDias(1),
      prioridad: 'IMPORTANTE',
    });

    const todos = await anunciosService.vigentes();
    expect(todos.map((a) => a.titulo)).toHaveLength(3);
    expect(todos[0]?.titulo).toBe('Vigente importante');
    expect(todos.map((a) => a.titulo)).not.toContain('Expirado');
    expect(todos.map((a) => a.titulo)).not.toContain('Programado');

    const importantes = await anunciosService.vigentes({ soloImportantes: true });
    expect(importantes.map((a) => a.titulo)).toEqual(['Vigente importante']);
    expect(await anunciosService.vigentes({ limit: 1 })).toHaveLength(1);
  });
});
