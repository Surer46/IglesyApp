# Auditoría 1 · F3 — Calendario, asistencia, anuncios, cartelera (Genaro)

> Lee solo este archivo y los que cita. Contexto general: [../../README.md](../../README.md).

## Resultado

- Las vistas tienen estados cargando, vacío y error, y `ConfirmDialog` en cancelar evento y eliminar anuncio.
- `ListaEventos`, `TarjetaAnuncio compacta` y `useAnunciosVigentes` funcionan en el dashboard de F4 **sin modificarse**. Se vio a 360 px y en modo oscuro.

## Observaciones

| ID | Sev. | Dónde | Observación | Acción sugerida | Estado |
|---|---|---|---|---|---|
| A1-F3-01 | Info | `features/asistencia/components/ResumenAsistencia.tsx` | Hoy enlaza a `/reportes?tipo=asistencia&desde=&hasta=`, que funciona. F4-11 ofrece además `BotonExportar` (menú PDF / Excel directo). | Opcional: `<BotonExportar tipo="asistencia" filtros={{ desde, hasta, periodo }} />`. | [x] El resumen usa `<BotonExportar tipo="asistencia" filtros={{ periodo, desde, hasta }} />` de F4. |
| A1-F3-02 | Media | `docs/frontend/F3-…/tasks-03-anuncios.md:27` | Falta correr Lighthouse en `/cartelera` (criterio: accesibilidad ≥ 90). | Correr Lighthouse en Chrome y anotar el puntaje. | [ ] Pendiente: correr Lighthouse en Chrome sobre `/cartelera` (requiere Chrome; no se pudo en este entorno). |
| A1-F3-03 | Info | `tasks-03-anuncios.md:20` | «F4 lo integra sin modificarlo»: se cumple en el trabajo de F4 (`DashboardPage.tsx`, sin cambios en `features/anuncios`). | Marcar cuando se fusione el PR de F4. | [x] Marcado en `tasks-03-anuncios.md` (F4 ya está en `main`). |

## Pendientes de tus tasks

Ver `A1-F3-02` y `A1-F3-03`.
