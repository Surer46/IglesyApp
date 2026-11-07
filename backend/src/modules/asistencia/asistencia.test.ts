import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { loginComo } from '../../test/helpers';
import * as asistenciaService from './asistencia.service';
import * as eventosService from '../eventos/eventos.service';

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
  put: (url: string, body: object, auth = admin.auth) =>
    request(app).put(`/api/v1${url}`).set('Authorization', auth).send(body),
});

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const DIA = 86_400_000;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA);

function crearMinisterio(nombre = 'Jóvenes') {
  return prisma.ministerio.create({ data: { nombre } });
}

function crearMiembro(nombre: string, apellidos = 'Pérez', activo = true) {
  return prisma.miembro.create({
    data: { nombre, apellidos, fechaIngreso: new Date('2025-01-01'), activo },
  });
}

function crearEvento(
  datos: Partial<{
    titulo: string;
    fechaInicio: Date;
    estado: 'PROGRAMADO' | 'CANCELADO' | 'REALIZADO';
    ministerioId: string | null;
  }> = {},
) {
  return prisma.evento.create({
    data: {
      titulo: datos.titulo ?? 'Culto',
      tipo: 'RELIGIOSO',
      categoria: 'CULTO',
      lugar: 'Templo',
      fechaInicio: datos.fechaInicio ?? enDias(-1),
      estado: datos.estado ?? 'PROGRAMADO',
      ministerioId: datos.ministerioId ?? null,
      creadoPorId: admin.usuario.id,
    },
  });
}

function registrar(eventoId: string, miembroId: string, presente: boolean) {
  return prisma.asistencia.create({
    data: { eventoId, miembroId, presente, registradoPorId: admin.usuario.id },
  });
}

async function coordinadorDe(ministerioId: string) {
  const sesion = await loginComo('COORDINADOR');
  await prisma.ministerioCoordinador.create({
    data: { ministerioId, usuarioId: sesion.usuario.id },
  });
  return sesion;
}

describe('GET /eventos/:id/asistencia (B3-07)', () => {
  it('sin ministerio: todos los miembros activos con presente null y totales', async () => {
    const ana = await crearMiembro('Ana', 'Zapata');
    const beto = await crearMiembro('Beto', 'Álvarez');
    await crearMiembro('Inactivo', 'Pérez', false);
    const evento = await crearEvento();
    await registrar(evento.id, ana.id, true);

    const res = await api().get(`/eventos/${evento.id}/asistencia`);
    expect(res.status).toBe(200);
    expect(res.body.data.evento).toMatchObject({ id: evento.id, ministerio: null });
    expect(res.body.data.registros).toEqual([
      { miembro: { id: beto.id, nombre: 'Beto', apellidos: 'Álvarez' }, presente: null },
      { miembro: { id: ana.id, nombre: 'Ana', apellidos: 'Zapata' }, presente: true },
    ]);
    expect(res.body.data.totales).toEqual({ presentes: 1, ausentes: 0, sinRegistrar: 1, total: 2 });
  });

  it('con ministerio: sus integrantes activos; quien se registró y luego quedó inactivo sigue apareciendo', async () => {
    const jovenes = await crearMinisterio();
    const ana = await crearMiembro('Ana');
    const luis = await crearMiembro('Luis');
    await crearMiembro('Fuera');
    await prisma.miembroMinisterio.createMany({
      data: [
        { miembroId: ana.id, ministerioId: jovenes.id },
        { miembroId: luis.id, ministerioId: jovenes.id },
      ],
    });
    const evento = await crearEvento({ ministerioId: jovenes.id });
    await registrar(evento.id, luis.id, false);
    await prisma.miembro.update({ where: { id: luis.id }, data: { activo: false } });

    const res = await api().get(`/eventos/${evento.id}/asistencia`);
    const ids = res.body.data.registros.map((r: { miembro: { id: string } }) => r.miembro.id);
    expect(ids).toEqual([ana.id, luis.id]);
    expect(res.body.data.totales).toMatchObject({ ausentes: 1, sinRegistrar: 1, total: 2 });
  });

  it('?q filtra por nombre sin acentos (los totales son de toda la lista)', async () => {
    await crearMiembro('José');
    await crearMiembro('María');
    const evento = await crearEvento();
    const res = await api().get(`/eventos/${evento.id}/asistencia?q=jose`);
    expect(res.body.data.registros).toHaveLength(1);
    expect(res.body.data.totales.total).toBe(2);
  });

  it('TESORERO → 403; COORDINADOR de otro ministerio → 403; inexistente → 404', async () => {
    const evento = await crearEvento();
    const tesorero = await loginComo('TESORERO');
    expect((await api().get(`/eventos/${evento.id}/asistencia`, tesorero.auth)).status).toBe(403);
    const otro = await crearMinisterio('Niños');
    const coord = await coordinadorDe(otro.id);
    expect((await api().get(`/eventos/${evento.id}/asistencia`, coord.auth)).status).toBe(403);
    expect((await api().get(`/eventos/${ID_INEXISTENTE}/asistencia`)).status).toBe(404);
  });
});

describe('PUT /eventos/:id/asistencia (B3-08)', () => {
  it('registra el pase de lista y marca el evento REALIZADO si ya empezó', async () => {
    const ana = await crearMiembro('Ana');
    const luis = await crearMiembro('Luis');
    const evento = await crearEvento({ fechaInicio: new Date(Date.now() - 60_000) });
    await prisma.evento.update({ where: { id: evento.id }, data: { estado: 'PROGRAMADO' } });
    const res = await api().put(`/eventos/${evento.id}/asistencia`, {
      registros: [
        { miembroId: ana.id, presente: true },
        { miembroId: luis.id, presente: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.totales).toMatchObject({ presentes: 1, ausentes: 1, sinRegistrar: 0 });
    const guardado = await prisma.asistencia.findFirst({ where: { miembroId: ana.id } });
    expect(guardado?.registradoPorId).toBe(admin.usuario.id);
    expect((await prisma.evento.findUnique({ where: { id: evento.id } }))?.estado).toBe(
      'REALIZADO',
    );
  });

  it('reenviar el mismo pase de lista no duplica filas (actualiza)', async () => {
    const ana = await crearMiembro('Ana');
    const evento = await crearEvento();
    const url = `/eventos/${evento.id}/asistencia`;
    await api().put(url, { registros: [{ miembroId: ana.id, presente: true }] });
    await api().put(url, { registros: [{ miembroId: ana.id, presente: true }] });
    const res = await api().put(url, { registros: [{ miembroId: ana.id, presente: false }] });
    expect(res.status).toBe(200);
    const filas = await prisma.asistencia.findMany({ where: { eventoId: evento.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.presente).toBe(false);
  });

  it('evento CANCELADO → 422 BUSINESS_RULE', async () => {
    const ana = await crearMiembro('Ana');
    const evento = await crearEvento({ estado: 'CANCELADO' });
    const res = await api().put(`/eventos/${evento.id}/asistencia`, {
      registros: [{ miembroId: ana.id, presente: true }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE');
  });

  it('evento a más de 1 día en el futuro → 422; dentro de las próximas 24 h se permite', async () => {
    const ana = await crearMiembro('Ana');
    const lejano = await crearEvento({ fechaInicio: enDias(3) });
    const cercano = await crearEvento({ fechaInicio: new Date(Date.now() + 3 * 3_600_000) });
    const registros = [{ miembroId: ana.id, presente: true }];
    expect((await api().put(`/eventos/${lejano.id}/asistencia`, { registros })).status).toBe(422);
    expect((await api().put(`/eventos/${cercano.id}/asistencia`, { registros })).status).toBe(200);
  });

  it('miembro inexistente o inactivo sin registro previo → 422 y no guarda nada', async () => {
    const ana = await crearMiembro('Ana');
    const inactivo = await crearMiembro('Pedro', 'López', false);
    const evento = await crearEvento();
    const res = await api().put(`/eventos/${evento.id}/asistencia`, {
      registros: [
        { miembroId: ana.id, presente: true },
        { miembroId: inactivo.id, presente: true },
        { miembroId: ID_INEXISTENTE, presente: false },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveLength(2);
    expect(await prisma.asistencia.count()).toBe(0);
  });

  it('valida el cuerpo → 400 (vacío, repetidos, presente no booleano)', async () => {
    const ana = await crearMiembro('Ana');
    const evento = await crearEvento();
    const url = `/eventos/${evento.id}/asistencia`;
    expect((await api().put(url, { registros: [] })).status).toBe(400);
    expect(
      (
        await api().put(url, {
          registros: [
            { miembroId: ana.id, presente: true },
            { miembroId: ana.id, presente: false },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (await api().put(url, { registros: [{ miembroId: ana.id, presente: 'si' }] })).status,
    ).toBe(400);
  });

  it('COORDINADOR solo en eventos de su ministerio; TESORERO → 403', async () => {
    const suyo = await crearMinisterio('Música');
    const otro = await crearMinisterio('Niños');
    const coord = await coordinadorDe(suyo.id);
    const ana = await crearMiembro('Ana');
    await prisma.miembroMinisterio.create({ data: { miembroId: ana.id, ministerioId: suyo.id } });
    const registros = [{ miembroId: ana.id, presente: true }];
    const propio = await crearEvento({ ministerioId: suyo.id });
    const ajeno = await crearEvento({ ministerioId: otro.id });
    const sinMinisterio = await crearEvento();
    expect(
      (await api().put(`/eventos/${propio.id}/asistencia`, { registros }, coord.auth)).status,
    ).toBe(200);
    expect(
      (await api().put(`/eventos/${ajeno.id}/asistencia`, { registros }, coord.auth)).status,
    ).toBe(403);
    expect(
      (await api().put(`/eventos/${sinMinisterio.id}/asistencia`, { registros }, coord.auth))
        .status,
    ).toBe(403);
    const tesorero = await loginComo('TESORERO');
    expect(
      (await api().put(`/eventos/${propio.id}/asistencia`, { registros }, tesorero.auth)).status,
    ).toBe(403);
  });

  it('COORDINADOR no registra a miembros que no son de su ministerio → 422', async () => {
    const suyo = await crearMinisterio('Música');
    const coord = await coordinadorDe(suyo.id);
    const integrante = await crearMiembro('Ana');
    const ajeno = await crearMiembro('Luis', 'Ajeno');
    await prisma.miembroMinisterio.create({
      data: { miembroId: integrante.id, ministerioId: suyo.id },
    });
    const evento = await crearEvento({ ministerioId: suyo.id });
    const url = `/eventos/${evento.id}/asistencia`;
    const res = await api().put(
      url,
      {
        registros: [
          { miembroId: integrante.id, presente: true },
          { miembroId: ajeno.id, presente: true },
        ],
      },
      coord.auth,
    );
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].mensaje).toContain('Luis Ajeno no pertenece');
    expect(await prisma.asistencia.count()).toBe(0);
    // ADMIN sí puede registrar a un miembro de fuera (p. ej. un visitante de otro ministerio)
    expect(
      (await api().put(url, { registros: [{ miembroId: ajeno.id, presente: true }] })).status,
    ).toBe(200);
  });

  it('acepta hasta 5 000 registros (RNF-02)', async () => {
    const ana = await crearMiembro('Ana');
    const evento = await crearEvento();
    const demasiados = Array.from({ length: 5001 }, () => ({ miembroId: ana.id, presente: true }));
    const res = await api().put(`/eventos/${evento.id}/asistencia`, { registros: demasiados });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('5000');
  });

  it('300 registros en menos de 1 s', async () => {
    await prisma.miembro.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        nombre: `Miembro${i}`,
        apellidos: 'Prueba',
        fechaIngreso: new Date('2025-01-01'),
      })),
    });
    const miembros = await prisma.miembro.findMany({ select: { id: true } });
    const evento = await crearEvento();
    const registros = miembros.map((m, i) => ({ miembroId: m.id, presente: i % 3 !== 0 }));
    const inicio = performance.now();
    const res = await api().put(`/eventos/${evento.id}/asistencia`, { registros });
    const duracion = performance.now() - inicio;
    expect(res.status).toBe(200);
    expect(res.body.data.totales).toMatchObject({ presentes: 200, ausentes: 100, total: 300 });
    expect(duracion).toBeLessThan(1000);
  });
});

describe('GET /asistencias (B3-09)', () => {
  it('filtro por miembro devuelve presentes y ausentes ordenados por fecha desc, con datos del evento', async () => {
    const ana = await crearMiembro('Ana');
    const viejo = await crearEvento({ titulo: 'Viejo', fechaInicio: enDias(-20) });
    const reciente = await crearEvento({ titulo: 'Reciente', fechaInicio: enDias(-2) });
    const medio = await crearEvento({ titulo: 'Medio', fechaInicio: enDias(-10) });
    await registrar(viejo.id, ana.id, true);
    await registrar(reciente.id, ana.id, false);
    await registrar(medio.id, ana.id, true);

    const res = await api().get(`/asistencias?miembroId=${ana.id}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.data.map((a: { evento: { titulo: string } }) => a.evento.titulo)).toEqual([
      'Reciente',
      'Medio',
      'Viejo',
    ]);
    expect(res.body.data.map((a: { presente: boolean }) => a.presente)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('filtra por evento y rango de fechas', async () => {
    const ana = await crearMiembro('Ana');
    const evento = await crearEvento({ fechaInicio: new Date('2026-05-10T18:00:00.000Z') });
    const otro = await crearEvento({ fechaInicio: new Date('2026-06-10T18:00:00.000Z') });
    await registrar(evento.id, ana.id, true);
    await registrar(otro.id, ana.id, true);
    expect((await api().get(`/asistencias?eventoId=${evento.id}`)).body.meta.total).toBe(1);
    expect(
      (await api().get('/asistencias?desde=2026-05-01&hasta=2026-05-31')).body.meta.total,
    ).toBe(1);
    expect((await api().get('/asistencias?desde=2026-06-01&hasta=2026-05-01')).status).toBe(400);
  });

  it('desde/hasta son días completos en la zona horaria de la iglesia', async () => {
    const ana = await crearMiembro('Ana');
    // 2026-05-01T03:00Z = 30 de abril 21:00 en America/Mexico_City
    const evento = await crearEvento({ fechaInicio: new Date('2026-05-01T03:00:00.000Z') });
    await registrar(evento.id, ana.id, true);
    expect(
      (await api().get('/asistencias?desde=2026-04-30&hasta=2026-04-30')).body.meta.total,
    ).toBe(1);
    expect(
      (await api().get('/asistencias?desde=2026-05-01&hasta=2026-05-01')).body.meta.total,
    ).toBe(0);
  });

  it('COORDINADOR solo ve eventos de sus ministerios; TESORERO → 403; sin sesión → 401', async () => {
    const suyo = await crearMinisterio('Música');
    const coord = await coordinadorDe(suyo.id);
    const ana = await crearMiembro('Ana');
    await registrar((await crearEvento({ ministerioId: suyo.id })).id, ana.id, true);
    await registrar((await crearEvento()).id, ana.id, true);
    expect((await api().get('/asistencias', coord.auth)).body.meta.total).toBe(1);
    const tesorero = await loginComo('TESORERO');
    expect((await api().get('/asistencias', tesorero.auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/asistencias')).status).toBe(401);
  });

  it('porcentajeMiembro calcula el % de los últimos meses y la última asistencia', async () => {
    const ana = await crearMiembro('Ana');
    const e1 = await crearEvento({ titulo: 'Uno', fechaInicio: enDias(-30) });
    const e2 = await crearEvento({ titulo: 'Dos', fechaInicio: enDias(-10) });
    const e3 = await crearEvento({ titulo: 'Tres', fechaInicio: enDias(-5) });
    const viejo = await crearEvento({ fechaInicio: enDias(-200) });
    await registrar(e1.id, ana.id, true);
    await registrar(e2.id, ana.id, true);
    await registrar(e3.id, ana.id, false);
    await registrar(viejo.id, ana.id, false);
    const resultado = await asistenciaService.porcentajeMiembro(ana.id, 3);
    expect(resultado).toMatchObject({ presentes: 2, total: 3, porcentaje: 66.7 });
    expect(resultado.ultimaAsistencia?.titulo).toBe('Dos');
  });

  it('la última asistencia ignora eventos cancelados', async () => {
    const ana = await crearMiembro('Ana');
    const valido = await crearEvento({ titulo: 'Válido', fechaInicio: enDias(-20) });
    const cancelado = await crearEvento({
      titulo: 'Cancelado',
      fechaInicio: enDias(-2),
      estado: 'CANCELADO',
    });
    await registrar(valido.id, ana.id, true);
    await registrar(cancelado.id, ana.id, true);
    const resultado = await asistenciaService.porcentajeMiembro(ana.id, 3);
    expect(resultado.ultimaAsistencia?.titulo).toBe('Válido');
  });
});

describe('GET /asistencias/resumen (B3-10)', () => {
  it('serie semanal continua (periodos sin datos con ceros) y promedio por evento', async () => {
    const ana = await crearMiembro('Ana');
    const luis = await crearMiembro('Luis');
    const e1 = await crearEvento({ fechaInicio: new Date('2026-09-29T00:30:00.000Z') }); // lun 28 local
    const e2 = await crearEvento({ fechaInicio: new Date('2026-10-01T01:00:00.000Z') }); // mié 30 local
    await registrar(e1.id, ana.id, true);
    await registrar(e1.id, luis.id, true);
    await registrar(e2.id, ana.id, true);
    await registrar(e2.id, luis.id, false);

    const res = await api().get(
      '/asistencias/resumen?periodo=semanal&desde=2026-09-28&hasta=2026-10-18',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { periodo: '2026-W40', eventos: 2, presentes: 3, ausentes: 1, promedioPorEvento: 1.5 },
      { periodo: '2026-W41', eventos: 0, presentes: 0, ausentes: 0, promedioPorEvento: 0 },
      { periodo: '2026-W42', eventos: 0, presentes: 0, ausentes: 0, promedioPorEvento: 0 },
    ]);
  });

  it('eventos cerca de medianoche se agrupan con la zona horaria de la iglesia', async () => {
    const ana = await crearMiembro('Ana');
    // 2026-10-05 05:30 UTC = domingo 4 de octubre 23:30 en America/Mexico_City (semana 40)
    const domingo = await crearEvento({ fechaInicio: new Date('2026-10-05T05:30:00.000Z') });
    // 2026-11-01 05:30 UTC = 31 de octubre 23:30 local (mes 2026-10)
    const finDeMes = await crearEvento({ fechaInicio: new Date('2026-11-01T05:30:00.000Z') });
    await registrar(domingo.id, ana.id, true);
    await registrar(finDeMes.id, ana.id, true);

    const semanal = await api().get(
      '/asistencias/resumen?periodo=semanal&desde=2026-09-28&hasta=2026-10-11',
    );
    expect(
      semanal.body.data.map((p: { periodo: string; presentes: number }) => [
        p.periodo,
        p.presentes,
      ]),
    ).toEqual([
      ['2026-W40', 1],
      ['2026-W41', 0],
    ]);
    const mensual = await api().get(
      '/asistencias/resumen?periodo=mensual&desde=2026-10-01&hasta=2026-11-30',
    );
    expect(
      mensual.body.data.map((p: { periodo: string; presentes: number }) => [
        p.periodo,
        p.presentes,
      ]),
    ).toEqual([
      ['2026-10', 2],
      ['2026-11', 0],
    ]);
  });

  it('excluye eventos cancelados; filtra por ministerio', async () => {
    const jovenes = await crearMinisterio();
    const ana = await crearMiembro('Ana');
    const cancelado = await crearEvento({
      fechaInicio: new Date('2026-10-07T18:00:00.000Z'),
      estado: 'CANCELADO',
    });
    const deJovenes = await crearEvento({
      fechaInicio: new Date('2026-10-08T18:00:00.000Z'),
      ministerioId: jovenes.id,
    });
    const general = await crearEvento({ fechaInicio: new Date('2026-10-09T18:00:00.000Z') });
    await registrar(cancelado.id, ana.id, true);
    await registrar(deJovenes.id, ana.id, true);
    await registrar(general.id, ana.id, true);
    const todos = await api().get(
      '/asistencias/resumen?periodo=mensual&desde=2026-10-01&hasta=2026-10-31',
    );
    expect(todos.body.data[0]).toMatchObject({ eventos: 2, presentes: 2 });
    const filtrado = await api().get(
      `/asistencias/resumen?periodo=mensual&desde=2026-10-01&hasta=2026-10-31&ministerioId=${jovenes.id}`,
    );
    expect(filtrado.body.data[0]).toMatchObject({ eventos: 1, presentes: 1 });
  });

  it('sin rango usa uno por defecto; periodo inválido o rango > 2 años → 400', async () => {
    const semanal = await api().get('/asistencias/resumen?periodo=semanal');
    expect(semanal.status).toBe(200);
    expect(semanal.body.data).toHaveLength(12);
    expect((await api().get('/asistencias/resumen?periodo=diario')).status).toBe(400);
    // Con desde y sin hasta (hasta = hoy) también se aplica el tope de 2 años
    const sinHasta = await api().get('/asistencias/resumen?periodo=semanal&desde=1900-01-01');
    expect(sinHasta.status).toBe(400);
    expect(sinHasta.body.error.details[0].campo).toBe('desde');
    expect(
      (await api().get('/asistencias/resumen?periodo=mensual&hasta=2020-01-01&desde=2021-01-01'))
        .status,
    ).toBe(400);
    expect(
      (await api().get('/asistencias/resumen?periodo=mensual&desde=2020-01-01&hasta=2026-01-01'))
        .status,
    ).toBe(400);
  });

  it('COORDINADOR: otro ministerio → 403; TESORERO → 403', async () => {
    const suyo = await crearMinisterio('Música');
    const otro = await crearMinisterio('Niños');
    const coord = await coordinadorDe(suyo.id);
    expect(
      (await api().get(`/asistencias/resumen?periodo=mensual&ministerioId=${otro.id}`, coord.auth))
        .status,
    ).toBe(403);
    expect((await api().get('/asistencias/resumen?periodo=mensual', coord.auth)).status).toBe(200);
    const tesorero = await loginComo('TESORERO');
    expect((await api().get('/asistencias/resumen?periodo=mensual', tesorero.auth)).status).toBe(
      403,
    );
  });

  it('semanaIso respeta el cambio de año ISO', () => {
    expect(asistenciaService.semanaIso(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-W01');
    expect(asistenciaService.semanaIso(new Date('2027-01-01T00:00:00.000Z'))).toBe('2026-W53');
    expect(asistenciaService.semanaIso(new Date('2025-12-29T00:00:00.000Z'))).toBe('2026-W01');
  });
});

describe('funciones para reportes y dashboard (B3-11)', () => {
  it('porEvento, contarRegistradas y participacionPorMinisterio', async () => {
    const jovenes = await crearMinisterio();
    const ana = await crearMiembro('Ana');
    const luis = await crearMiembro('Luis');
    await prisma.miembroMinisterio.createMany({
      data: [
        { miembroId: ana.id, ministerioId: jovenes.id },
        { miembroId: luis.id, ministerioId: jovenes.id },
      ],
    });
    const evento = await crearEvento({ fechaInicio: enDias(-2), ministerioId: jovenes.id });
    await registrar(evento.id, ana.id, true);
    await registrar(evento.id, luis.id, false);

    const detalle = await asistenciaService.porEvento(evento.id);
    expect(detalle).toMatchObject({ presentes: 1, ausentes: 1, porcentaje: 50 });
    expect(detalle.registros).toHaveLength(2);

    expect(await asistenciaService.contarRegistradas(enDias(-7), enDias(1))).toBe(1);

    const participacion = await asistenciaService.participacionPorMinisterio(
      enDias(-30),
      enDias(1),
    );
    expect(participacion).toEqual([
      {
        ministerioId: jovenes.id,
        ministerio: 'Jóvenes',
        integrantes: 2,
        eventos: 1,
        presentes: 1,
        ausentes: 1,
        porcentaje: 50,
      },
    ]);
  });
});
