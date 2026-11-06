# B2 · Tareas 02 — Ministerios y seed

### B2-07 · CRUD de ministerios
- **RF:** RF-05.1 · **Fase:** 1 · **Tamaño:** S · **Depende de:** B1-11
- `GET /ministerios?q&activo`, `POST`, `GET /:id`, `PATCH /:id`, `PATCH /:id/estado`. Nombre único (sin distinguir mayúsculas). Listado incluye `totalIntegrantes` y `coordinadores` (id, nombre).
- **Criterios de aceptación**
  - [x] Nombre duplicado → 409.
  - [x] Solo ADMIN y PASTOR crean/editan/desactivan.

### B2-08 · Asignar coordinadores
- **RF:** RF-05.2 · **Fase:** 2 · **Tamaño:** S · **Depende de:** B2-07
- `PUT /ministerios/:id/coordinadores { usuarioIds[] }` reemplaza la lista. Solo usuarios activos con rol `COORDINADOR` o `PASTOR`.
- **Criterios de aceptación**
  - [x] Usuario con otro rol o inactivo → 422 indicando cuál.
  - [x] Lista vacía permitida.

### B2-09 · Vincular y desvincular miembros
- **RF:** RF-05.3 · **Fase:** 2 · **Tamaño:** M · **Depende de:** B2-07, B2-05
- `POST /ministerios/:id/miembros { miembroIds[] }` (reactiva vínculos previos si existen), `DELETE /ministerios/:id/miembros/:miembroId` (soft: `activo=false`, `fechaSalida`). Permitido a ADMIN, PASTOR y COORDINADOR **del ministerio**.
- **Criterios de aceptación**
  - [x] COORDINADOR de otro ministerio → 403.
  - [x] Miembro inactivo → 422.
  - [x] Vincular varios en una sola transacción; ids repetidos se ignoran.

### B2-10 · Consultar integrantes
- **RF:** RF-05.4 · **Fase:** 2 · **Tamaño:** S · **Depende de:** B2-09
- `GET /ministerios/:id/miembros?q&incluirHistoricos` paginado, con `fechaUnion` y `fechaSalida`.
- **Criterios de aceptación**
  - [x] Por defecto solo vínculos activos.

### B2-11 · Funciones de servicio para otros módulos
- **Fase:** 2 · **Tamaño:** S · **Depende de:** B2-10
- Exportar `miembrosDe(ministerioId)`, `ministeriosCoordinadosPor(usuarioId)`, `contarActivos()`, `participacionPorMinisterio()` (para dashboard y reporte RF-09.3, junto con datos de asistencia de B3).
- **Criterios de aceptación**
  - [x] Pruebas unitarias; B3 y B4 confirman uso. *(B4 confirmó: usa `contarActivos`, `participacionPorMinisterio`, `miembrosDe` y `ministeriosCoordinadosPor`. B3 confirmó en el PR #15)*

### B2-12 · Seed de datos realistas
- **Fase:** 2 · **Tamaño:** M · **Depende de:** B1-04, B2-09
- Extender `seed.ts` con @faker-js/faker (locale `es_MX`): ~60 miembros (10 % inactivos), ministerios Música, Jóvenes, Niños, Enseñanza, Servicio, Damas; vínculos y coordinadores. Exponer funciones `seedMiembros()` para que B3/B4 agreguen eventos, asistencias y donaciones encima.
- **Criterios de aceptación**
  - [x] Seed idempotente y reproducible (semilla fija de faker).
  - [x] Documentado en `backend/README.md`.
