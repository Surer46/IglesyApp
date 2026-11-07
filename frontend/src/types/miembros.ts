import type { QueryLista } from './comunes';

export type EstadoMiembroFiltro = 'activo' | 'inactivo' | 'todos';

/** Ministerio resumido (id + nombre) */
export interface MinisterioResumen {
  id: string;
  nombre: string;
}

export interface Miembro {
  id: string;
  nombre: string;
  apellidos: string;
  telefono: string | null;
  email: string | null;
  /** "yyyy-MM-dd" */
  fechaIngreso: string;
  /** "yyyy-MM-dd" */
  fechaNacimiento: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  /** "yyyy-MM-dd" */
  fechaBaja: string | null;
  motivoBaja: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fila de GET /miembros: incluye sus ministerios activos */
export interface MiembroLista extends Miembro {
  ministerios: MinisterioResumen[];
  totalMinisterios: number;
}

/** Vínculo con un ministerio en el detalle del miembro (actual o histórico) */
export interface MinisterioDeMiembro extends MinisterioResumen {
  fechaUnion: string;
  fechaSalida: string | null;
  /** Vínculo vigente (false = ya salió del ministerio) */
  activo: boolean;
}

/** Asistencia de los últimos meses (solo llega con el permiso `asistencia:leer`) */
export interface ResumenAsistenciaMiembro {
  meses: number;
  presentes: number;
  total: number;
  /** null = sin registros en el periodo */
  porcentaje: number | null;
  ultimaAsistencia: { id: string; titulo: string; fechaInicio: string } | null;
}

/** GET /miembros/:id */
export interface MiembroDetalle extends Miembro {
  ministerios: MinisterioDeMiembro[];
  /** Se omite si el rol no tiene `asistencia:leer` */
  resumenAsistencia?: ResumenAsistenciaMiembro;
}

export interface QueryMiembros extends QueryLista {
  estado?: EstadoMiembroFiltro;
  ministerioId?: string;
}

export interface CrearMiembro {
  nombre: string;
  apellidos: string;
  fechaIngreso: string;
  telefono?: string | null;
  email?: string | null;
  fechaNacimiento?: string | null;
  direccion?: string | null;
  notas?: string | null;
}

export type EditarMiembro = Partial<CrearMiembro>;

/** meta de POST /miembros cuando existe otro con el mismo nombre (advertencia) */
export interface MetaPosibleDuplicado {
  posibleDuplicado: true;
  duplicadoId: string;
}

export interface CambiarEstadoMiembro {
  activo: boolean;
  motivo?: string;
}
