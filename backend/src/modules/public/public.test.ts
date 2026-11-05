import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { crearUsuario } from '../../test/helpers';
import * as eventosService from '../eventos/eventos.service';

let app: ReturnType<typeof crearApp>;
beforeEach(() => {
  eventosService.reiniciarMarcaRealizados();
  app = crearApp();
});

const DIA = 86_400_000;
const enDias = (dias: number) => new Date(Date.now() + dias * DIA);

async function prepararDatos() {
  const autor = await crearUsuario('SECRETARIO', { nombre: 'Secretaria Privada' });
  await prisma.configuracionIglesia.create({
    data: { id: 1, nombre: 'Iglesia Central', telefono: '9991234567', ciudad: 'Mérida' },
  });
  await prisma.horarioReunion.createMany({
    data: [
      { nombre: 'Culto dominical', diaSemana: 0, horaInicio: '10:00', lugar: 'Templo' },
      { nombre: 'Horario retirado', diaSemana: 3, horaInicio: '19:00', activo: false },
    ],
  });
  const miembro = await prisma.miembro.create({
    data: { nombre: 'Responsable', apellidos: 'Oculto', fechaIngreso: new Date('2025-01-01') },
  });
  const evento = await prisma.evento.create({
    data: {
      titulo: 'Concierto de alabanza',
      tipo: 'RELIGIOSO',
      categoria: 'ACTIVIDAD',
      lugar: 'Templo',
      fechaInicio: enDias(3),
      creadoPorId: autor.id,
    },
  });
  await prisma.eventoResponsable.create({ data: { eventoId: evento.id, miembroId: miembro.id } });
  await prisma.evento.create({
    data: {
      titulo: 'Cancelado',
      tipo: 'RELIGIOSO',
      categoria: 'CULTO',
      lugar: 'Templo',
      fechaInicio: enDias(2),
      estado: 'CANCELADO',
      creadoPorId: autor.id,
    },
  });
  await prisma.anuncio.createMany({
    data: [
      { titulo: 'Vigente', contenido: 'Hola', fechaPublicacion: enDias(-1), autorId: autor.id },
      { titulo: 'Programado', contenido: 'Pronto', fechaPublicacion: enDias(1), autorId: autor.id },
    ],
  });
}

describe('GET /public/cartelera (B3-15)', () => {
  it('sin sesión devuelve iglesia, horarios activos, anuncios vigentes y próximos eventos', async () => {
    await prepararDatos();
    const res = await request(app).get('/api/v1/public/cartelera');
    expect(res.status).toBe(200);
    const { iglesia, horarios, anuncios, eventosProximos } = res.body.data;
    expect(iglesia).toMatchObject({ nombre: 'Iglesia Central', telefono: '9991234567' });
    expect(horarios.map((h: { nombre: string }) => h.nombre)).toEqual(['Culto dominical']);
    expect(anuncios.map((a: { titulo: string }) => a.titulo)).toEqual(['Vigente']);
    expect(eventosProximos.map((e: { titulo: string }) => e.titulo)).toEqual([
      'Concierto de alabanza',
    ]);
  });

  it('no expone datos de miembros, usuarios ni responsables', async () => {
    await prepararDatos();
    const res = await request(app).get('/api/v1/public/cartelera');
    const texto = JSON.stringify(res.body);
    for (const prohibido of [
      'Secretaria Privada',
      'Responsable',
      'Oculto',
      'autor',
      'creadoPor',
      'responsables',
      'totalResponsables',
      'email":"secretario',
      'motivoCancelacion',
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    expect(Object.keys(res.body.data.eventosProximos[0]).sort()).toEqual([
      'categoria',
      'descripcion',
      'fechaFin',
      'fechaInicio',
      'id',
      'lugar',
      'tipo',
      'titulo',
    ]);
    expect(Object.keys(res.body.data.anuncios[0]).sort()).toEqual([
      'contenido',
      'fechaExpiracion',
      'fechaPublicacion',
      'id',
      'prioridad',
      'titulo',
    ]);
  });

  it('usa una cache de 60 s', async () => {
    await prepararDatos();
    const primera = await request(app).get('/api/v1/public/cartelera');
    await prisma.anuncio.deleteMany();
    const segunda = await request(app).get('/api/v1/public/cartelera');
    expect(segunda.body).toEqual(primera.body);
  });

  it('rate limit de 60 por minuto → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await request(app).get('/api/v1/public/cartelera')).status).toBe(200);
    }
    const res = await request(app).get('/api/v1/public/cartelera');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
