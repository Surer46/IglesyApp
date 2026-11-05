import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { loginComo } from '../../test/helpers';
import * as miembrosService from './miembros.service';

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
});

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

function crearMiembro(
  datos: Partial<{ nombre: string; apellidos: string; activo: boolean; fechaIngreso: string }> = {},
) {
  return prisma.miembro.create({
    data: {
      nombre: datos.nombre ?? 'Ana',
      apellidos: datos.apellidos ?? 'Pérez Canul',
      fechaIngreso: new Date(`${datos.fechaIngreso ?? '2025-01-15'}T00:00:00.000Z`),
      activo: datos.activo ?? true,
    },
  });
}

function crearMinisterio(nombre: string) {
  return prisma.ministerio.create({ data: { nombre } });
}

describe('POST /miembros (B2-01)', () => {
  it('registra con teléfono normalizado y fechas como yyyy-MM-dd', async () => {
    const res = await api().post('/miembros', {
      nombre: ' José ',
      apellidos: 'Chan May',
      fechaIngreso: '2024-03-10',
      telefono: '+52 999-123 4567',
      email: 'Jose@Correo.MX',
      fechaNacimiento: '1990-05-01',
    });
    expect(res.status).toBe(201);
    expect(res.body.meta).toBeUndefined();
    expect(res.body.data).toMatchObject({
      nombre: 'José',
      telefono: '+529991234567',
      email: 'jose@correo.mx',
      fechaIngreso: '2024-03-10',
      fechaNacimiento: '1990-05-01',
      activo: true,
      fechaBaja: null,
    });
  });

  it('advierte (sin error) si ya existe alguien con el mismo nombre', async () => {
    const existente = await crearMiembro({ nombre: 'José', apellidos: 'Chan' });
    const res = await api().post('/miembros', {
      nombre: 'jose',
      apellidos: 'CHAN',
      fechaIngreso: '2024-03-10',
    });
    expect(res.status).toBe(201);
    expect(res.body.meta).toEqual({ posibleDuplicado: true, duplicadoId: existente.id });
  });

  it('validación: email, teléfono, fecha futura y campos desconocidos → 400', async () => {
    const res = await api().post('/miembros', {
      nombre: 'Ana',
      apellidos: 'Pérez',
      fechaIngreso: '2024-01-01',
      telefono: '123',
      email: 'no-es-correo',
    });
    expect(res.status).toBe(400);
    const campos = res.body.error.details.map((d: { campo: string }) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(['telefono', 'email']));

    // "Futura" se compara con hoy en la zona horaria de la iglesia
    const futura = await api().post('/miembros', {
      nombre: 'Ana',
      apellidos: 'Pérez',
      fechaIngreso: '2999-01-01',
      fechaNacimiento: '2999-02-02',
    });
    expect(futura.status).toBe(400);
    expect(futura.body.error.details.map((d: { campo: string }) => d.campo)).toEqual([
      'fechaIngreso',
      'fechaNacimiento',
    ]);
    const hoy = await api().post('/miembros', {
      nombre: 'Ana',
      apellidos: 'Pérez',
      fechaIngreso: await miembrosService.hoyIglesia(),
    });
    expect(hoy.status).toBe(201);

    const extra = await api().post('/miembros', {
      nombre: 'Ana',
      apellidos: 'Pérez',
      fechaIngreso: '2024-01-01',
      activo: false,
    });
    expect(extra.status).toBe(400);
  });

  it('permisos: TESORERO → 403; sin sesión → 401', async () => {
    const tesorero = await loginComo('TESORERO');
    const cuerpo = { nombre: 'Ana', apellidos: 'Pérez', fechaIngreso: '2024-01-01' };
    expect((await api().post('/miembros', cuerpo, tesorero.auth)).status).toBe(403);
    expect((await request(app).post('/api/v1/miembros').send(cuerpo)).status).toBe(401);
  });
});

describe('GET /miembros (B2-02, B2-03)', () => {
  it('lista paginada, solo activos por defecto, ordenada por apellidos, con ministerios', async () => {
    const ana = await crearMiembro({ nombre: 'Ana', apellidos: 'Zapata' });
    await crearMiembro({ nombre: 'Luis', apellidos: 'Aké' });
    await crearMiembro({ nombre: 'Pedro', apellidos: 'Baja', activo: false });
    const musica = await crearMinisterio('Música');
    await prisma.miembroMinisterio.create({ data: { miembroId: ana.id, ministerioId: musica.id } });

    const res = await api().get('/miembros');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(res.body.data.map((m: { apellidos: string }) => m.apellidos)).toEqual(['Aké', 'Zapata']);
    expect(res.body.data[1]).toMatchObject({
      totalMinisterios: 1,
      ministerios: [{ id: musica.id, nombre: 'Música' }],
    });
  });

  it('"jose" encuentra "José" y combina q + estado + ministerioId', async () => {
    const jose = await crearMiembro({ nombre: 'José', apellidos: 'Núñez' });
    const joseInactivo = await crearMiembro({
      nombre: 'Josefina',
      apellidos: 'Pech',
      activo: false,
    });
    await crearMiembro({ nombre: 'María', apellidos: 'Pool' });
    const jovenes = await crearMinisterio('Jóvenes');
    for (const m of [jose, joseInactivo]) {
      await prisma.miembroMinisterio.create({
        data: { miembroId: m.id, ministerioId: jovenes.id },
      });
    }

    const nombres = async (url: string) =>
      (await api().get(url)).body.data.map((m: { nombre: string }) => m.nombre);
    expect(await nombres('/miembros?q=jose')).toEqual(['José']);
    expect(await nombres('/miembros?q=NUNEZ jo')).toEqual(['José']);
    expect(await nombres('/miembros?q=jose&estado=todos')).toEqual(['José', 'Josefina']);
    expect(await nombres(`/miembros?q=jos&estado=inactivo&ministerioId=${jovenes.id}`)).toEqual([
      'Josefina',
    ]);
    expect(await nombres(`/miembros?ministerioId=${jovenes.id}`)).toEqual(['José']);
  });

  it('validación: estado o ministerioId inválidos → 400', async () => {
    expect((await api().get('/miembros?estado=borrado')).status).toBe(400);
    expect((await api().get('/miembros?ministerioId=abc')).status).toBe(400);
  });

  it('TESORERO y COORDINADOR pueden leer; sin token → 401', async () => {
    for (const rol of ['TESORERO', 'COORDINADOR'] as const) {
      const { auth } = await loginComo(rol);
      expect((await api().get('/miembros', auth)).status).toBe(200);
    }
    expect((await request(app).get('/api/v1/miembros')).status).toBe(401);
  });
});

describe('GET /miembros/:id y PATCH /miembros/:id (B2-04)', () => {
  it('detalle con ministerios y edición', async () => {
    const miembro = await crearMiembro();
    const ninos = await crearMinisterio('Niños');
    await prisma.miembroMinisterio.create({
      data: { miembroId: miembro.id, ministerioId: ninos.id },
    });

    const detalle = await api().get(`/miembros/${miembro.id}`);
    expect(detalle.status).toBe(200);
    expect(detalle.body.data.ministerios).toEqual([
      expect.objectContaining({ id: ninos.id, nombre: 'Niños', activo: true, fechaSalida: null }),
    ]);

    const res = await api().patch(`/miembros/${miembro.id}`, {
      telefono: '999 111 2222',
      notas: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ telefono: '9991112222', notas: null, nombre: 'Ana' });
  });

  it('id inexistente → 404; activo no se puede cambiar aquí → 400', async () => {
    expect((await api().get(`/miembros/${ID_INEXISTENTE}`)).status).toBe(404);
    expect((await api().patch(`/miembros/${ID_INEXISTENTE}`, { nombre: 'X' })).status).toBe(404);
    const miembro = await crearMiembro();
    expect((await api().patch(`/miembros/${miembro.id}`, { activo: false })).status).toBe(400);
    expect((await api().patch(`/miembros/${miembro.id}`, {})).status).toBe(400);
  });

  it('permisos: COORDINADOR no edita → 403', async () => {
    const miembro = await crearMiembro();
    const { auth } = await loginComo('COORDINADOR');
    expect((await api().patch(`/miembros/${miembro.id}`, { nombre: 'X' }, auth)).status).toBe(403);
  });
});

describe('resumen de asistencia en GET /miembros/:id (B2-04)', () => {
  async function miembroConAsistencia() {
    const miembro = await crearMiembro();
    const evento = (titulo: string) =>
      prisma.evento.create({
        data: {
          titulo,
          tipo: 'RELIGIOSO',
          categoria: 'CULTO',
          lugar: 'Templo',
          fechaInicio: new Date(Date.now() - 86_400_000),
          creadoPorId: admin.usuario.id,
        },
      });
    const [uno, dos] = [await evento('Culto A'), await evento('Culto B')];
    await prisma.asistencia.createMany({
      data: [
        {
          eventoId: uno.id,
          miembroId: miembro.id,
          presente: true,
          registradoPorId: admin.usuario.id,
        },
        {
          eventoId: dos.id,
          miembroId: miembro.id,
          presente: false,
          registradoPorId: admin.usuario.id,
        },
      ],
    });
    return miembro;
  }

  it('con asistencia:leer incluye el % de 3 meses y el último evento asistido', async () => {
    const miembro = await miembroConAsistencia();
    const { auth } = await loginComo('SECRETARIO');
    const res = await api().get(`/miembros/${miembro.id}`, auth);
    expect(res.body.data.resumenAsistencia).toMatchObject({
      meses: 3,
      presentes: 1,
      total: 2,
      porcentaje: 50,
      ultimaAsistencia: { titulo: 'Culto A' },
    });
  });

  it('sin asistencia:leer el campo se omite (TESORERO y COORDINADOR)', async () => {
    const miembro = await miembroConAsistencia();
    for (const rol of ['TESORERO', 'COORDINADOR'] as const) {
      const { auth } = await loginComo(rol);
      const res = await api().get(`/miembros/${miembro.id}`, auth);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('resumenAsistencia');
    }
  });

  it('una llamada interna sin rol devuelve el detalle sin el resumen', async () => {
    const miembro = await miembroConAsistencia();
    const detalle = await miembrosService.obtener(miembro.id);
    expect(detalle.id).toBe(miembro.id);
    expect(detalle).not.toHaveProperty('resumenAsistencia');
  });

  it('sin registros el porcentaje es null', async () => {
    const miembro = await crearMiembro();
    const res = await api().get(`/miembros/${miembro.id}`);
    expect(res.body.data.resumenAsistencia).toMatchObject({
      total: 0,
      porcentaje: null,
      ultimaAsistencia: null,
    });
  });
});

describe('paginación de la búsqueda en SQL (revisión del PR #3)', () => {
  it('pagina y ordena los resultados de la búsqueda sin traer todos los ids', async () => {
    for (let i = 1; i <= 25; i++) {
      await crearMiembro({ nombre: `Ána${String(i).padStart(2, '0')}`, apellidos: 'Pérez' });
    }
    await crearMiembro({ nombre: 'Luis', apellidos: 'Pérez' });

    const tercera = await api().get('/miembros?q=ana&limit=10&page=3&orden=nombre:asc');
    expect(tercera.body.meta).toEqual({ page: 3, limit: 10, total: 25, totalPages: 3 });
    expect(tercera.body.data.map((m: { nombre: string }) => m.nombre)).toEqual([
      'Ána21',
      'Ána22',
      'Ána23',
      'Ána24',
      'Ána25',
    ]);

    const desc = await api().get('/miembros?q=ana&limit=2&orden=nombre:desc');
    expect(desc.body.data.map((m: { nombre: string }) => m.nombre)).toEqual(['Ána25', 'Ána24']);
    expect((await api().get('/miembros?q=zzz')).body.meta.total).toBe(0);
  });
});

describe('fecha en la zona horaria de la iglesia (revisión del PR #3)', () => {
  it('a las 19:30 de México (01:30 UTC del día siguiente) sigue siendo el mismo día', () => {
    const instante = new Date('2026-11-02T01:30:00.000Z');
    expect(miembrosService.fechaEnZona(instante, 'America/Mexico_City')).toBe('2026-11-01');
    expect(miembrosService.fechaEnZona(instante, 'UTC')).toBe('2026-11-02');
  });

  it('la fecha de baja usa la zona horaria configurada', async () => {
    await prisma.configuracionIglesia.upsert({
      where: { id: 1 },
      create: { id: 1, nombre: 'Iglesia', zonaHoraria: 'Pacific/Kiritimati' },
      update: { zonaHoraria: 'Pacific/Kiritimati' },
    });
    const miembro = await crearMiembro();
    const res = await api().patch(`/miembros/${miembro.id}/estado`, { activo: false });
    expect(res.body.data.fechaBaja).toBe(
      miembrosService.fechaEnZona(new Date(), 'Pacific/Kiritimati'),
    );
  });
});

describe('PATCH /miembros/:id/estado (B2-05)', () => {
  it('desactiva (cierra vínculos, conserva historial) y reactiva', async () => {
    const miembro = await crearMiembro();
    const servicio = await crearMinisterio('Servicio');
    await prisma.miembroMinisterio.create({
      data: { miembroId: miembro.id, ministerioId: servicio.id },
    });

    const baja = await api().patch(`/miembros/${miembro.id}/estado`, {
      activo: false,
      motivo: 'Se mudó de ciudad',
    });
    expect(baja.status).toBe(200);
    expect(baja.body.data).toMatchObject({ activo: false, motivoBaja: 'Se mudó de ciudad' });
    expect(baja.body.data.fechaBaja).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const vinculo = await prisma.miembroMinisterio.findFirstOrThrow();
    expect(vinculo.activo).toBe(false);
    expect(vinculo.fechaSalida).not.toBeNull();
    // El registro sigue existiendo (soft delete)
    expect(await prisma.miembro.count()).toBe(1);

    const alta = await api().patch(`/miembros/${miembro.id}/estado`, { activo: true });
    expect(alta.body.data).toMatchObject({ activo: true, fechaBaja: null, motivoBaja: null });
    // Los vínculos no se restauran solos
    expect((await prisma.miembroMinisterio.findFirstOrThrow()).activo).toBe(false);
  });

  it('no existe DELETE /miembros/:id', async () => {
    const miembro = await crearMiembro();
    const res = await request(app)
      .delete(`/api/v1/miembros/${miembro.id}`)
      .set('Authorization', admin.auth);
    expect(res.status).toBe(404);
  });

  it('validación → 400; mismo estado → 422; TESORERO → 403', async () => {
    const miembro = await crearMiembro();
    expect((await api().patch(`/miembros/${miembro.id}/estado`, { activo: 'no' })).status).toBe(
      400,
    );
    expect((await api().patch(`/miembros/${miembro.id}/estado`, { activo: true })).status).toBe(
      422,
    );
    const { auth } = await loginComo('TESORERO');
    expect(
      (await api().patch(`/miembros/${miembro.id}/estado`, { activo: false }, auth)).status,
    ).toBe(403);
  });
});

describe('funciones para otros módulos (B2-06)', () => {
  it('contarActivos, obtenerActivos y existeActivo', async () => {
    const activo = await crearMiembro({ nombre: 'Ana' });
    const inactivo = await crearMiembro({ nombre: 'Beto', activo: false });
    const damas = await crearMinisterio('Damas');
    await prisma.miembroMinisterio.create({
      data: { miembroId: activo.id, ministerioId: damas.id },
    });

    expect(await miembrosService.contarActivos()).toBe(1);
    expect(await miembrosService.obtenerActivos({ ministerioId: damas.id })).toEqual([
      { id: activo.id, nombre: 'Ana', apellidos: 'Pérez Canul' },
    ]);
    expect(await miembrosService.obtenerActivos({ ids: [inactivo.id] })).toEqual([]);
    expect(await miembrosService.existeActivo(activo.id)).toBe(true);
    expect(await miembrosService.existeActivo(inactivo.id)).toBe(false);
    expect(await miembrosService.existeActivo(ID_INEXISTENTE)).toBe(false);
  });

  it('altasPorMes incluye meses sin altas', async () => {
    await crearMiembro({ fechaIngreso: '2026-01-05' });
    await crearMiembro({ fechaIngreso: '2026-01-20' });
    await crearMiembro({ fechaIngreso: '2026-03-31' });
    await crearMiembro({ fechaIngreso: '2026-04-01' });
    expect(await miembrosService.altasPorMes('2026-01-01', '2026-03-31')).toEqual([
      { mes: '2026-01', total: 2 },
      { mes: '2026-02', total: 0 },
      { mes: '2026-03', total: 1 },
    ]);
  });

  it('listadoParaReporte filtra por estado y trae ministerios', async () => {
    const ana = await crearMiembro({ nombre: 'Ana' });
    await crearMiembro({ nombre: 'Beto', activo: false });
    const ensenanza = await crearMinisterio('Enseñanza');
    await prisma.miembroMinisterio.create({
      data: { miembroId: ana.id, ministerioId: ensenanza.id },
    });

    const activos = await miembrosService.listadoParaReporte();
    expect(activos).toHaveLength(1);
    expect(activos[0]).toMatchObject({ nombre: 'Ana', ministerios: ['Enseñanza'] });
    expect(await miembrosService.listadoParaReporte({ estado: 'todos' })).toHaveLength(2);
  });
});
