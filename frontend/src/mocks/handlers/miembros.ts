import { http, HttpResponse } from 'msw';
import { tienePermiso } from '@/lib/permisos';
import type { CambiarEstadoMiembro, CrearMiembro, Miembro } from '@/types/miembros';
import { db } from '../db';
import { ahora, autenticar, errorApi, paginarMock, ruta } from '../utils';

/** Minúsculas y sin acentos, como la búsqueda del backend */
export function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** ¿"nombre apellidos" contiene todas las palabras de q? */
export function coincide(m: { nombre: string; apellidos: string }, q: string | null) {
  if (!q) return true;
  const texto = normalizar(`${m.nombre} ${m.apellidos}`);
  return normalizar(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => texto.includes(p));
}

function ministeriosActivosDe(miembroId: string) {
  return db.vinculos
    .filter((v) => v.miembroId === miembroId && v.activo)
    .map((v) => db.ministerios.find((m) => m.id === v.ministerioId)!)
    .map(({ id, nombre }) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const noExiste = () => errorApi(404, 'NOT_FOUND', 'El miembro no existe.');

const MESES_RESUMEN = 3;

/** Como asistenciaService.porcentajeMiembro: eventos no cancelados de los últimos meses. */
function resumenAsistencia(miembroId: string) {
  const desde = new Date();
  desde.setUTCMonth(desde.getUTCMonth() - MESES_RESUMEN);
  const registros = db.asistencias
    .filter((a) => a.miembroId === miembroId)
    .map((a) => ({ a, e: db.eventos.find((x) => x.id === a.eventoId)! }));
  const enPeriodo = registros.filter(
    ({ e }) => e.estado !== 'CANCELADO' && Date.parse(e.fechaInicio) >= desde.getTime(),
  );
  const presentes = enPeriodo.filter(({ a }) => a.presente).length;
  const ultima = registros
    .filter(({ a }) => a.presente)
    .sort((x, y) => y.e.fechaInicio.localeCompare(x.e.fechaInicio))[0]?.e;
  return {
    meses: MESES_RESUMEN,
    presentes,
    total: enPeriodo.length,
    porcentaje:
      enPeriodo.length > 0 ? Math.round((presentes / enPeriodo.length) * 1000) / 10 : null,
    ultimaAsistencia: ultima
      ? { id: ultima.id, titulo: ultima.titulo, fechaInicio: ultima.fechaInicio }
      : null,
  };
}

function limpiar<T extends Partial<CrearMiembro>>(cuerpo: T): T {
  const resultado = { ...cuerpo };
  for (const clave of Object.keys(resultado) as (keyof T)[]) {
    if (resultado[clave] === '') resultado[clave] = null as T[keyof T];
  }
  if (typeof resultado.telefono === 'string') {
    resultado.telefono = resultado.telefono.replace(/[\s-]/g, '');
  }
  if (typeof resultado.email === 'string') resultado.email = resultado.email.toLowerCase();
  return resultado;
}

export const miembrosHandlers = [
  http.get(ruta('/miembros'), ({ request }) => {
    const usuario = autenticar(request, 'miembros:leer');
    if (usuario instanceof Response) return usuario;
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const estado = url.searchParams.get('estado') ?? 'activo';
    const ministerioId = url.searchParams.get('ministerioId');
    const lista = db.miembros
      .filter((m) => estado === 'todos' || m.activo === (estado === 'activo'))
      .filter((m) => coincide(m, q))
      .filter(
        (m) =>
          !ministerioId ||
          db.vinculos.some(
            (v) => v.miembroId === m.id && v.ministerioId === ministerioId && v.activo,
          ),
      )
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos) || a.nombre.localeCompare(b.nombre))
      .map((m) => {
        const ministerios = ministeriosActivosDe(m.id);
        return { ...m, ministerios, totalMinisterios: ministerios.length };
      });
    return paginarMock(lista, url);
  }),

  http.get(ruta('/miembros/:id'), ({ request, params }) => {
    const usuario = autenticar(request, 'miembros:leer');
    if (usuario instanceof Response) return usuario;
    const miembro = db.miembros.find((m) => m.id === params.id);
    if (!miembro) return noExiste();
    const ministerios = db.vinculos
      .filter((v) => v.miembroId === miembro.id)
      .map((v) => {
        const { id, nombre } = db.ministerios.find((m) => m.id === v.ministerioId)!;
        return {
          id,
          nombre,
          fechaUnion: v.fechaUnion,
          fechaSalida: v.fechaSalida,
          activo: v.activo,
        };
      })
      .sort((a, b) => Number(b.activo) - Number(a.activo));
    return HttpResponse.json({
      data: {
        ...miembro,
        ministerios,
        ...(tienePermiso(usuario.rol, 'asistencia:leer') && {
          resumenAsistencia: resumenAsistencia(miembro.id),
        }),
      },
    });
  }),

  http.post(ruta('/miembros'), async ({ request }) => {
    const usuario = autenticar(request, 'miembros:crear');
    if (usuario instanceof Response) return usuario;
    const cuerpo = limpiar((await request.json()) as CrearMiembro);
    const duplicado = db.miembros.find(
      (m) =>
        normalizar(`${m.nombre}|${m.apellidos}`) ===
        normalizar(`${cuerpo.nombre.trim()}|${cuerpo.apellidos.trim()}`),
    );
    const nuevo: Miembro = {
      id: crypto.randomUUID(),
      nombre: cuerpo.nombre.trim(),
      apellidos: cuerpo.apellidos.trim(),
      fechaIngreso: cuerpo.fechaIngreso,
      telefono: cuerpo.telefono ?? null,
      email: cuerpo.email ?? null,
      fechaNacimiento: cuerpo.fechaNacimiento ?? null,
      direccion: cuerpo.direccion ?? null,
      notas: cuerpo.notas ?? null,
      activo: true,
      fechaBaja: null,
      motivoBaja: null,
      createdAt: ahora(),
      updatedAt: ahora(),
    };
    db.miembros.push(nuevo);
    return HttpResponse.json(
      duplicado
        ? { data: nuevo, meta: { posibleDuplicado: true, duplicadoId: duplicado.id } }
        : { data: nuevo },
      { status: 201 },
    );
  }),

  http.patch(ruta('/miembros/:id'), async ({ request, params }) => {
    const usuario = autenticar(request, 'miembros:editar');
    if (usuario instanceof Response) return usuario;
    const miembro = db.miembros.find((m) => m.id === params.id);
    if (!miembro) return noExiste();
    const cuerpo = limpiar((await request.json()) as Partial<CrearMiembro>);
    Object.assign(miembro, cuerpo, { updatedAt: ahora() });
    return HttpResponse.json({ data: miembro });
  }),

  http.patch(ruta('/miembros/:id/estado'), async ({ request, params }) => {
    const usuario = autenticar(request, 'miembros:eliminar');
    if (usuario instanceof Response) return usuario;
    const miembro = db.miembros.find((m) => m.id === params.id);
    if (!miembro) return noExiste();
    const { activo, motivo } = (await request.json()) as CambiarEstadoMiembro;
    if (miembro.activo === activo) {
      return errorApi(
        422,
        'BUSINESS_RULE',
        activo ? 'El miembro ya está activo.' : 'El miembro ya está inactivo.',
      );
    }
    if (activo) {
      Object.assign(miembro, { activo, fechaBaja: null, motivoBaja: null });
    } else {
      Object.assign(miembro, {
        activo,
        fechaBaja: ahora().slice(0, 10),
        motivoBaja: motivo ?? null,
      });
      for (const v of db.vinculos.filter((v) => v.miembroId === miembro.id && v.activo)) {
        Object.assign(v, { activo: false, fechaSalida: ahora() });
      }
    }
    miembro.updatedAt = ahora();
    return HttpResponse.json({ data: miembro });
  }),
];
