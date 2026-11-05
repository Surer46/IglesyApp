# B1 · Tareas 01 — Infraestructura

### B1-01 · Monorepo y Docker
- **Fase:** 0 · **Tamaño:** M · **Depende de:** —
- Crear monorepo pnpm (`backend/`, `frontend/`), `.gitignore`, `.editorconfig`, Prettier y ESLint compartidos. `docker-compose.yml` con `postgres` (5432), `postgres-test` (5433) y `mailpit` (1025/8025).
- **Criterios de aceptación**
  - [x] `docker compose up -d` levanta los tres servicios.
  - [x] `pnpm install` en la raíz instala ambos paquetes.
  - [x] Scripts raíz: `dev`, `test`, `lint`, `typecheck`.

### B1-02 · Servidor Express base
- **Fase:** 0 · **Tamaño:** S · **Depende de:** B1-01
- `app.ts` (helmet, cors con `FRONTEND_URL` y `credentials`, JSON, cookie-parser, pino-http) y `server.ts`. `config/env.ts` valida variables con Zod y falla al arrancar si falta alguna.
- **Criterios de aceptación**
  - [x] `GET /api/v1/health` → `{ data: { status: "ok" } }`.
  - [x] `pnpm --filter backend dev` recarga en caliente (tsx watch).
  - [x] Arranque falla con mensaje claro si falta `DATABASE_URL`.

### B1-03 · Schema Prisma completo y migración inicial
- **Fase:** 0 · **Tamaño:** L · **Depende de:** B1-01
- Traducir `specs.md §6` a `schema.prisma` con enums, relaciones, índices y `@@map` a snake_case. Migración `init`. `lib/prisma.ts` con cliente singleton.
- **Criterios de aceptación**
  - [x] `prisma migrate dev` crea todas las tablas sin errores.
  - [x] Revisado por B2, B3 y B4 (cada uno aprueba sus modelos en el PR). *(B2 lo revisó en el PR #3 sin cambios; B3 usa sus modelos sin cambios en el PR #6; B4 lo revisó en la Auditoría 1 y pidió `Donacion.anuladaPorId`, A1-B4-01, pendiente de su PR)*
  - [x] `prisma studio` muestra todos los modelos. *(verificado 2026-11-04: aparecen las 14 tablas del schema)*

### B1-04 · Seed mínimo
- **Fase:** 0 · **Tamaño:** S · **Depende de:** B1-03
- `prisma/seed.ts` crea `ConfiguracionIglesia` (id 1) y un usuario por rol (contraseñas desde variables `SEED_*` en `.env.example`). B2 extiende el seed con datos de dominio (B2-12).
- **Criterios de aceptación**
  - [x] `pnpm --filter backend db:seed` es idempotente (usa `upsert`).

### B1-05 · Middlewares comunes y formato de respuesta
- **Fase:** 0 · **Tamaño:** M · **Depende de:** B1-02
- `AppError(code, message, status, details?)`, `errores.ts` (traduce `ZodError`, errores Prisma P2002→409 y P2025→404), `validar({ body, query, params })`, helpers `ok()`, `okLista()`, `paginar(query)`.
- **Criterios de aceptación**
  - [x] Respuestas y errores exactamente como `specs.md §7.1`.
  - [x] Errores 500 no filtran stack en producción.
  - [x] Pruebas unitarias de `errores.ts` y `paginar`.

### B1-06 · Plantilla de módulo y entorno de pruebas
- **Fase:** 0 · **Tamaño:** S · **Depende de:** B1-05
- `modules/_plantilla/` con routes/controller/service/schemas/test de ejemplo. Configuración Vitest que usa `DATABASE_URL_TEST`, aplica migraciones y limpia tablas entre suites. Helper `loginComo(rol)` que devuelve un token para pruebas.
- **Criterios de aceptación**
  - [x] `pnpm --filter backend test` corre la prueba de ejemplo en verde.
  - [x] Guía corta en `backend/README.md` de cómo crear un módulo.

### B1-07 · CI y documentación OpenAPI
- **Fase:** 1 · **Tamaño:** M · **Depende de:** B1-06
- GitHub Actions: install, lint, typecheck, tests (con servicio Postgres). Swagger UI en `/api/docs` alimentado por `backend/openapi.yaml` (cada dueño agrega sus rutas).
- **Criterios de aceptación**
  - [x] Un PR con error de lint falla en CI. *(verificado 2026-11-04 con el PR de prueba #14: falló en el paso Lint; se cerró sin fusionar)*
  - [x] `/api/docs` muestra health y auth.
