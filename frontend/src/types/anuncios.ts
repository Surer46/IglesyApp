import type { QueryLista } from './comunes';
import type { CategoriaEvento, EstadoEvento, TipoEvento } from './eventos';
import type { HorarioReunion } from './configuracion';

// Espejo de backend/src/modules/anuncios y public (specs.md §7.2, B3)

export type PrioridadAnuncio = 'NORMAL' | 'IMPORTANTE';
export type EstadoAnuncio = 'vigentes' | 'programados' | 'expirados';

export interface Anuncio {
  id: string;
  titulo: string;
  /** Texto plano o markdown simple */
  contenido: string;
  prioridad: PrioridadAnuncio;
  fechaPublicacion: string;
  fechaExpiracion: string | null;
  autor: { id: string; nombre: string };
  evento: { id: string; titulo: string; fechaInicio: string; estado: EstadoEvento } | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueryAnuncios extends QueryLista {
  /** true = publicados y no expirados; false = programados o expirados */
  vigentes?: boolean;
  /** Pestañas del listado: vigentes, programados (publicación futura) o expirados */
  estado?: EstadoAnuncio;
  prioridad?: PrioridadAnuncio;
}

export interface GuardarAnuncio {
  titulo: string;
  contenido: string;
  prioridad: PrioridadAnuncio;
  fechaPublicacion?: string;
  fechaExpiracion?: string | null;
  eventoId?: string | null;
}

/** GET /public/cartelera: solo datos públicos */
export interface Cartelera {
  iglesia: {
    nombre: string;
    logoUrl: string | null;
    direccion: string | null;
    ciudad: string | null;
    telefono: string | null;
    email: string | null;
    sitioWeb: string | null;
  };
  horarios: Omit<HorarioReunion, 'activo'>[];
  anuncios: Pick<
    Anuncio,
    'id' | 'titulo' | 'contenido' | 'prioridad' | 'fechaPublicacion' | 'fechaExpiracion'
  >[];
  eventosProximos: {
    id: string;
    titulo: string;
    descripcion: string | null;
    tipo: TipoEvento;
    categoria: CategoriaEvento;
    fechaInicio: string;
    fechaFin: string | null;
    lugar: string;
  }[];
}
