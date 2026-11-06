# Auditoría 1 · B2 — Miembros, ministerios, seed (Nataly)

> Lee solo este archivo y los que cita. Contexto general: [../../README.md](../../README.md).

## Resultado

Lo revisado cumple el contrato:
- **Soft delete de miembros:** guarda `fechaBaja` y `motivoBaja`, y los limpia al reactivar.
- **Filtros:** `estado=activo|inactivo|todos`.
- **Integrantes:** se gestionan con `autorizarAlguno('ministerios:editar', 'ministerios:editar-propio')` + `esCoordinadorDe` en el service.
- **Coordinadores:** el reemplazo valida rol y estado.
- **Seed:** es reproducible.
- **Servicios para otros módulos:** los de `backend/README.md` existen y los usan B3 y B4.

## Observaciones

| ID | Sev. | Dónde | Observación | Acción sugerida | Estado |
|---|---|---|---|---|---|
| A1-B2-01 | Baja | `modules/ministerios/ministerios.service.ts:154` | `asignarCoordinadores` lee `prisma.usuario` directo. Esa tabla es de B1, y `AGENTS.md` §3 pide llamar al service del dueño. | Pedir a B1 una función en `usuarios.service` (por ejemplo `obtenerParaCoordinar(ids)`, con `select` de id, nombre, rol y activo) y usarla aquí. | [x] Usa `usuariosService.obtener` (ya existía), sin tocar B1. Si B1 agrega una función por lotes, se cambia en `usuarioONulo`. |
| A1-B2-02 | Baja | Patrón `prisma.$transaction([findMany, count])` en `ministerios.service.ts:110`, `:256` | Genera el `DeprecationWarning` de `pg`. Ver `A1-B1-01`. | Aplicar el mismo cambio que defina B1. | [x] Lecturas con `Promise.all`; `asignarCoordinadores` con transacción interactiva. |

## Pendientes de tus tasks

- **B2-11:** «B3 y B4 confirman uso». B4 ya confirmó. B3 también usa tus servicios: `asistencia.service.ts` importa `miembrosService` y `ministeriosService`. Pide a Genaro que lo confirme y marca la casilla.
