import { z } from 'zod';
import { esquemaPaginacion } from '../../lib/paginacion';

export const PERIODOS = ['semanal', 'mensual'] as const;
export type Periodo = (typeof PERIODOS)[number];

/** Máximo de registros por pase de lista (RNF-02: hasta 5 000 miembros). */
export const MAX_REGISTROS = 5000;
/** Rango máximo del resumen (≈ 2 años). */
export const MAX_DIAS_RESUMEN = 731;

const fecha = z.iso.date('Fecha no válida (formato yyyy-MM-dd).');
const uuid = (mensaje: string) => z.uuid(mensaje);

export const esquemaIdEvento = z.object({ id: uuid('Identificador no válido.') });

export const esquemaListaEvento = z.object({ q: z.string().trim().min(1).optional() });

export const esquemaRegistrarAsistencia = z.strictObject({
  registros: z
    .array(
      z.strictObject({
        miembroId: uuid('Identificador de miembro no válido.'),
        presente: z.boolean({ error: 'Indica si estuvo presente.' }),
      }),
    )
    .min(1, 'Envía al menos un registro.')
    .max(MAX_REGISTROS, `Máximo ${MAX_REGISTROS} registros por pase de lista.`)
    .refine(
      (rs) => new Set(rs.map((r) => r.miembroId)).size === rs.length,
      'Un miembro aparece más de una vez.',
    ),
});

function rangoValido(q: { desde?: string; hasta?: string }) {
  return !q.desde || !q.hasta || q.hasta >= q.desde;
}
const MENSAJE_RANGO = { message: '"hasta" debe ser igual o posterior a "desde".', path: ['hasta'] };

export const esquemaHistorial = esquemaPaginacion
  .extend({
    miembroId: uuid('Identificador de miembro no válido.').optional(),
    eventoId: uuid('Identificador de evento no válido.').optional(),
    desde: fecha.optional(),
    hasta: fecha.optional(),
  })
  .refine(rangoValido, MENSAJE_RANGO);

export const esquemaResumen = z
  .object({
    periodo: z.enum(PERIODOS, { error: 'El periodo debe ser semanal o mensual.' }),
    desde: fecha.optional(),
    hasta: fecha.optional(),
    ministerioId: uuid('Identificador de ministerio no válido.').optional(),
  })
  .refine(rangoValido, MENSAJE_RANGO)
  .refine(
    (q) =>
      !q.desde ||
      !q.hasta ||
      (Date.parse(q.hasta) - Date.parse(q.desde)) / 86_400_000 <= MAX_DIAS_RESUMEN,
    { message: 'El rango no puede pasar de 2 años.', path: ['hasta'] },
  );

export type QueryHistorial = z.infer<typeof esquemaHistorial>;
export type QueryResumen = z.infer<typeof esquemaResumen>;
export type RegistroAsistencia = z.infer<typeof esquemaRegistrarAsistencia>['registros'][number];
