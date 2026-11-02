import { z } from 'zod';
import { esquemaPaginacion } from '../../lib/paginacion';

export const PRIORIDADES = ['NORMAL', 'IMPORTANTE'] as const;
/** vigentes = publicados y sin expirar · programados = publicación futura · expirados = ya vencidos */
export const ESTADOS_ANUNCIO = ['vigentes', 'programados', 'expirados'] as const;

const fechaHora = z.iso
  .datetime({ offset: true, message: 'Fecha y hora no válidas (ISO 8601).' })
  .transform((v) => new Date(v));

// Opcionales: cadena vacía o null se guardan como null
const opcional = <T extends z.ZodType>(esquema: T) =>
  z.preprocess((v) => (v === '' ? null : v), esquema.nullable().optional());

const camposAnuncio = {
  titulo: z.string().trim().min(1, 'Escribe el título.').max(120, 'Máximo 120 caracteres.'),
  contenido: z
    .string()
    .trim()
    .min(1, 'Escribe el contenido.')
    .max(5000, 'Máximo 5 000 caracteres.'),
  prioridad: z.enum(PRIORIDADES, { error: 'Prioridad no válida.' }),
  fechaPublicacion: fechaHora,
  fechaExpiracion: opcional(fechaHora),
  eventoId: opcional(z.uuid('Identificador de evento no válido.')),
};

const MENSAJE_EXPIRACION = 'La expiración debe ser posterior a la publicación.';

function expiraDespues(d: { fechaPublicacion?: Date; fechaExpiracion?: Date | null }) {
  return !d.fechaPublicacion || !d.fechaExpiracion || d.fechaExpiracion > d.fechaPublicacion;
}

export const esquemaIdAnuncio = z.object({ id: z.uuid('Identificador no válido.') });

export const esquemaCrearAnuncio = z
  .strictObject({
    ...camposAnuncio,
    prioridad: camposAnuncio.prioridad.default('NORMAL'),
    // Por defecto se publica ahora; puede programarse a futuro
    fechaPublicacion: camposAnuncio.fechaPublicacion.optional(),
  })
  .transform((d) => ({ ...d, fechaPublicacion: d.fechaPublicacion ?? new Date() }))
  .refine(expiraDespues, { message: MENSAJE_EXPIRACION, path: ['fechaExpiracion'] });

export const esquemaEditarAnuncio = z
  .strictObject({
    ...camposAnuncio,
    titulo: camposAnuncio.titulo.optional(),
    contenido: camposAnuncio.contenido.optional(),
    prioridad: camposAnuncio.prioridad.optional(),
    fechaPublicacion: camposAnuncio.fechaPublicacion.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'No hay cambios para guardar.')
  .refine(expiraDespues, { message: MENSAJE_EXPIRACION, path: ['fechaExpiracion'] });

export const esquemaListarAnuncios = esquemaPaginacion.extend({
  vigentes: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  prioridad: z.enum(PRIORIDADES).optional(),
  estado: z.enum(ESTADOS_ANUNCIO, { error: 'Estado no válido.' }).optional(),
});

export type QueryAnuncios = z.infer<typeof esquemaListarAnuncios>;
export type CrearAnuncio = z.infer<typeof esquemaCrearAnuncio>;
export type EditarAnuncio = z.infer<typeof esquemaEditarAnuncio>;
