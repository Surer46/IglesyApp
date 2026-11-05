# Auditoría 1 · B3 — Eventos, asistencia, anuncios, público (Genaro)

> Lee solo este archivo y los que cita. Contexto general: [../../README.md](../../README.md).

## Resultado

Se cumplen las reglas críticas:
- **Asistencia en evento cancelado:** responde 422.
- **Miembros inactivos:** no se registran, salvo para corregir un registro previo.
- **Fechas:** `fechaFin ≥ fechaInicio`.
- **Cancelar ≠ borrar:** cancelar guarda `motivoCancelacion`.
- **Coordinador:** las variantes `-propio` se verifican con `esCoordinadorDe`.
- **Escrituras masivas:** van en `$transaction`.
- **Anuncios:** se borran físicamente, como manda el contrato.
- **Cartelera:** es pública y tiene límite de peticiones.

## Observaciones

| ID | Sev. | Dónde | Observación | Acción sugerida | Estado |
|---|---|---|---|---|---|
| A1-B3-01 | Media | `modules/asistencia/asistencia.service.ts:130-134` | Hay una regla de negocio que no está en el contrato: «Solo se puede pasar lista desde un día antes del inicio del evento» (422). Regla de oro 1: el contrato manda. | Agregarla a `specs.md` §6 «Reglas de integridad», en el mismo PR, y avisar a F3 y B4, o quitarla. | [x] Se mantiene la regla y se agregó a `specs.md` §6 «Reglas de integridad» (junto con la del COORDINADOR y que una asistencia no se borra). Aviso a F3/B4 en el PR. |
| A1-B3-02 | Baja | `eventos.service.ts:88` (`prisma.ministerio`), `:343` (`prisma.miembro`); `asistencia.service.ts:139` (`tx.miembro`) | Se leen tablas de B2 directamente. `AGENTS.md` §3 pide usar el service del dueño, y `ministeriosService` / `miembrosService.obtenerActivos({ ids })` ya existen. El caso de `asistencia:139` es aceptable porque necesita la misma transacción. | Cambiar `eventos.service.ts:88` y `:343` por los services de B2. Comentar en `:139` por qué se usa `tx`. | [x] `eventos.service`: ministerio con `ministeriosService.obtener` y responsables con `miembrosService.obtenerActivos` / `obtener`. `asistencia.service`: comentado por qué se usa `tx.miembro`. |
| A1-B3-03 | Baja | `eventosService.marcarRealizados()` (`eventos.service.ts:103`) | Cada `GET` de eventos, cartelera y dashboard hace un `updateMany`: escribe en cada lectura. Con muchos usuarios a la vez son escrituras innecesarias. | Limitarlo a una vez por minuto (marca de tiempo en memoria) o calcular `REALIZADO` al leer. | [x] `marcarRealizados()` escribe a lo más una vez por minuto por proceso (marca de tiempo en memoria); prueba nueva en `eventos.test.ts`. |

## Pendientes de tus tasks

Ninguno sin marcar en B3. Confirma a B2 que usas sus servicios (B2-11).
