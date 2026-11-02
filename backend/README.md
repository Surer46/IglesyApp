# Backend — AppIglesia

API Express 5 + Prisma + PostgreSQL. Contrato en [specs.md §7](../specs.md); reglas en [AGENTS.md §3](../AGENTS.md).

## Arranque

```bash
docker compose up -d                     # desde la raíz
cp backend/.env.example backend/.env     # una sola vez
pnpm install
pnpm --filter backend db:deploy          # aplica migraciones
pnpm --filter backend db:seed            # configuración + un usuario por rol
pnpm --filter backend dev                # http://localhost:3000/api/v1
```

- Usuarios del seed: `admin@iglesia.local`, `pastor@…`, `secretario@…`, `tesorero@…`, `coordinador@…` con la contraseña `SEED_PASSWORD` de `.env`.
- Swagger: <http://localhost:3000/api/docs> · Correos (recuperación, invitaciones): <http://localhost:8025>.
- Pruebas: `pnpm --filter backend test` (usan `postgres-test` en el puerto 5433 y la vacían antes de cada prueba).

## Datos de prueba de miembros y ministerios (B2-12)

`db:seed` también ejecuta `prisma/seed-b2.ts`:

- **60 miembros** (6 inactivos, con fecha y motivo de baja) con nombres, teléfonos, correos y direcciones realistas.
- **6 ministerios**: Música, Jóvenes, Niños, Enseñanza, Servicio y Damas.
- **Vínculos**: cada miembro activo pertenece a 0–2 ministerios.
- **Coordinadores**: `coordinador@iglesia.local` coordina Jóvenes y Música; `pastor@iglesia.local`, Enseñanza.

Es **reproducible e idempotente**: usa un generador pseudoaleatorio con semilla fija (sin dependencias nuevas) y los ids de los miembros se derivan de esa semilla, así que volver a correrlo actualiza los mismos registros en lugar de duplicarlos.

B3/B4: para agregar eventos, asistencias o donaciones encima, importen las funciones exportadas:

```ts
import { seedMiembros, seedMinisterios } from './seed-b2';
const miembroIds = await seedMiembros(); // ids en orden; los 6 últimos son inactivos
const ministerios = await seedMinisterios(); // Map nombre → id
```

## Servicios de B2 para otros módulos

| Función | Uso |
|---|---|
| `miembrosService.contarActivos()` | Dashboard (B4) |
| `miembrosService.obtenerActivos({ ministerioId?, ids? })` | Asistencia esperada, responsables (B3) |
| `miembrosService.existeActivo(id)` | Validar responsables, asistencia, donaciones (B3, B4) |
| `miembrosService.altasPorMes(desde, hasta)` | Gráfica `altasMiembrosPorMes` (B4) |
| `miembrosService.listadoParaReporte({ estado })` | Reporte general de miembros (B4) |
| `miembrosService.hoyIglesia()` | Fecha de hoy (`yyyy-MM-dd`) en la zona horaria configurada de la iglesia |
| `ministeriosService.miembrosDe(ministerioId)` | Asistencia esperada, reporte por ministerio (B3, B4) |
| `ministeriosService.ministeriosCoordinadosPor(usuarioId)` | Permisos "-propio" del coordinador (B3) |
| `ministeriosService.contarActivos()` | Dashboard `totalMinisterios` (B4) |
| `ministeriosService.participacionPorMinisterio()` | Gráfica `miembrosPorMinisterio` y RF-09.3 (B4) |

## Servicios de B3 para otros módulos

| Función | Uso |
|---|---|
| `eventosService.proximos(limit)` | Dashboard `eventosProximos` (B4), cartelera |
| `eventosService.contarPorRango(desde, hasta)` | Eventos no cancelados en un rango (B4) |
| `asistenciaService.resumenPorPeriodo(periodo, desde, hasta, ministerioIds?)` | Gráfica `asistenciaSemanal` y reportes (B4); agrupa en la zona horaria de la configuración |
| `asistenciaService.contarRegistradas(desde, hasta)` | Dashboard `asistenciasRegistradas` (presentes en eventos no cancelados, B4) |
| `asistenciaService.porEvento(eventoId)` | Reporte de asistencia por evento RF-09.2 (B4) |
| `asistenciaService.participacionPorMinisterio(desde, hasta)` | Reporte de participación por ministerio RF-09.3 (B4) |
| `asistenciaService.porcentajeMiembro(miembroId, meses)` | Resumen de asistencia en el detalle de miembro (B2-04) |
| `anunciosService.vigentes({ soloImportantes, limit })` | Dashboard `anunciosImportantes` (B4), cartelera |

Los eventos `PROGRAMADO` cuya fecha ya pasó se marcan `REALIZADO` al consultarlos (`eventosService.marcarRealizados()`), sin tareas programadas.

Seed: `db:seed` también ejecuta `prisma/seed-b3.ts` (8 cultos y 4 reuniones de jóvenes pasados con asistencia, 3 eventos próximos, 1 cancelado y 4 anuncios: vigentes, programado y expirado), idempotente.

Fechas sin hora (`?desde=2026-10-31&hasta=2026-10-31` en `/eventos` y `/asistencias`) cuentan como días completos en la zona horaria de la configuración (`eventos/eventos.fechas.ts`: `inicioDiaEnZona`, `finDiaEnZona`, `fechaEnZona`).

## Crear un módulo nuevo

1. Copia `src/modules/_plantilla/` a `src/modules/<modulo>/` y renombra los archivos: `<modulo>.routes.ts`, `.controller.ts`, `.service.ts`, `.schemas.ts`, `.test.ts`.
2. **schemas**: Zod para `body`, `query` y `params`. `z.strictObject` en creación/edición; listados extienden `esquemaPaginacion`.
3. **service**: toda la lógica y Prisma con `select` explícito. Errores con `AppError.validacion | noEncontrado | conflicto | reglaNegocio`. Si necesitas datos de otro módulo, llama a su service.
4. **controller**: lee `req`, llama al service y responde con `ok()` / `okLista()`. Nada de Prisma ni lógica.
5. **routes**: cada ruta con `autenticar, autorizar('<modulo>:<accion>'), validar({...}), controller`. Para las variantes del coordinador usa `autorizarAlguno('eventos:crear', 'eventos:crear-propio')` y verifica `esCoordinadorDe(usuarioId, ministerioId)` en el service.
6. Registra el router en `src/routes.ts` → `crearModulos()`. La prueba `rutasProtegidas.test.ts` revisará que todas sus rutas estén protegidas.
7. Documenta las rutas en `openapi.yaml`.
8. **test**: por endpoint, un caso feliz, uno de validación (400) y uno de permisos (401/403). `loginComo('TESORERO')` devuelve la cabecera `Authorization`.

## Utilidades compartidas (B1)

| Archivo | Qué ofrece |
|---|---|
| `lib/appError.ts` | `AppError` con los códigos del contrato |
| `lib/respuesta.ts` | `ok(data)`, `okLista(data, meta)` |
| `lib/paginacion.ts` | `esquemaPaginacion`, `paginar()`, `crearMeta()`, `ordenar()` |
| `lib/prisma.ts` | cliente Prisma único |
| `lib/mailer.ts` | `enviarCorreo()`, `plantillaEnlace()` (en pruebas se guardan en `correosEnviados`) |
| `middlewares/auth.ts` | `autenticar`, `autorizar(...)`, `autorizarAlguno(...)`, `esCoordinadorDe()`, `usuarioDe(req)` |
| `middlewares/validar.ts` | `validar({ body, query, params })` |
| `config/permisos.ts` | matriz de `specs.md §3`, `tienePermiso(rol, permiso)` |
| `test/helpers.ts` | `crearUsuario(rol)`, `loginComo(rol)` |

## Checklist de seguridad (AGENTS.md §3) — B1-18

| Regla | Dónde |
|---|---|
| Access token en header; refresh en cookie `httpOnly; Secure (prod); SameSite=Strict; Path=/api/v1/auth` | `modules/auth/auth.controller.ts` |
| Refresh rota en cada uso, se guarda hasheado, reutilizar uno revocado cierra todas las sesiones, logout revoca | `auth.service.ts` (`refrescar`, `logout`) |
| Reset: 32 bytes aleatorios, hasheado, 1 h, un solo uso; `forgot-password` responde 204 siempre | `auth.service.ts`, `lib/seguridad.ts` |
| Contraseña mínima 8 con letra y número; bcrypt costo 12 | `lib/seguridad.ts` |
| Login: mismo mensaje para correo inexistente, contraseña mala o usuario inactivo; tiempo constante; 5 intentos/min | `auth.service.ts`, `auth.routes.ts` |
| Usuario desactivado no entra y se revocan sus sesiones; el token deja de servir al instante | `usuarios.service.ts`, `middlewares/auth.ts` |
| Un ADMIN no se desactiva a sí mismo ni se queda el sistema sin ADMIN activo | `usuarios.service.ts` |
| Subidas: MIME + firma real del archivo, ≤ 2 MB, nombre UUID, SVG con código activo rechazado | `configuracion.service.ts` |
| Nunca se devuelve `passwordHash` ni tokens; logs con `redact` de contraseñas, tokens y cookies | `usuarios.select.ts`, `lib/logger.ts` |
| Autorización en cada ruta | `rutasProtegidas.test.ts` |
| CORS limitado a `FRONTEND_URL`, helmet, errores 500 sin stack en producción | `app.ts`, `middlewares/errores.ts` |
