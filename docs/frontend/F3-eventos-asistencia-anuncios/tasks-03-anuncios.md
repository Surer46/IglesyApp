# F3 · Tareas 03 — Anuncios y cartelera pública

### F3-10 · Listado de anuncios
- **RF:** RF-07.1, RF-07.3 · **Fase:** 2 · **Tamaño:** S · **Depende de:** F1-06, B3-13
- `/anuncios`: pestañas *Vigentes*, *Programados*, *Expirados*; `TarjetaAnuncio` con título, extracto, prioridad (badge "Importante" con color de acento), fecha de publicación, autor y evento vinculado.
- **Criterios de aceptación**
  - [x] Los IMPORTANTE aparecen primero.

### F3-11 · Crear, editar y eliminar anuncio
- **RF:** RF-07.1, RF-07.2, RF-07.3 · **Fase:** 2 · **Tamaño:** M · **Depende de:** F3-10, B3-12
- Formulario: título, contenido (textarea con vista previa markdown simple), prioridad, fecha/hora de publicación (default ahora), expiración opcional, evento vinculado (select de próximos eventos). Eliminar con `ConfirmDialog`.
- **Criterios de aceptación**
  - [x] El contenido se renderiza sanitizado (sin HTML arbitrario).
  - [x] Roles sin permiso no ven botones de edición.

### F3-12 · Componente para dashboard
- **RF:** RF-07.4 · **Fase:** 3 · **Tamaño:** S · **Depende de:** F3-10
- Exportar `TarjetaAnuncio` en variante compacta y `useAnunciosVigentes({ soloImportantes })` para F4.
- **Criterios de aceptación**
  - [x] F4 lo integra sin modificarlo. *(integrado en `DashboardPage.tsx` de F4, sin cambios en `features/anuncios`; confirmado en la auditoría 1, A1-F3-03)*

### F3-13 · Cartelera pública
- **RF:** RF-07.4 · **Fase:** 3 · **Tamaño:** M · **Depende de:** B3-15
- Ruta pública `/cartelera` (sin layout administrativo): encabezado con logo y nombre, horarios de reunión, anuncios vigentes, próximos eventos, datos de contacto. Diseño optimizado para celular y para mostrarse en pantalla/TV (modo `?pantalla=1` con letra grande y auto-refresco cada 5 min).
- **Criterios de aceptación**
  - [x] Accesible sin sesión; enlace "Acceso del personal" a `/login`.
  - [ ] Lighthouse accesibilidad ≥ 90. *(no verificado: falta correr Lighthouse en Chrome)*
