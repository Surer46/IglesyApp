# F2 · Tareas 02 — Ministerios

### F2-07 · Listado de ministerios
- **RF:** RF-05.1, RF-05.4 · **Fase:** 2 · **Tamaño:** S · **Depende de:** F1-06, B2-07
- `/ministerios`: tarjetas (nombre, descripción, nº de integrantes, coordinadores, estado) con búsqueda y filtro activos/inactivos. "Nuevo ministerio" si `ministerios:crear`.
- **Criterios de aceptación**
  - [x] Estados cargando / vacío / error.

### F2-08 · Formulario de ministerio
- **RF:** RF-05.1 · **Fase:** 2 · **Tamaño:** S · **Depende de:** F2-07
- Modal crear/editar (nombre, descripción). Desactivar/reactivar con `ConfirmDialog`.
- **Criterios de aceptación**
  - [x] 409 por nombre duplicado se muestra en el campo.

### F2-09 · Asignar coordinadores
- **RF:** RF-05.2 · **Fase:** 2 · **Tamaño:** S · **Depende de:** F2-10, B2-08
- En el detalle: selector múltiple de **usuarios** activos con rol COORDINADOR o PASTOR, alimentado por `GET /usuarios/opciones?rol=COORDINADOR,PASTOR` (B1-13, accesible a ADMIN y PASTOR).
- **Criterios de aceptación**
  - [x] Solo ADMIN y PASTOR ven el botón "Editar coordinadores".

### F2-10 · Detalle del ministerio e integrantes
- **RF:** RF-05.3, RF-05.4 · **Fase:** 2 · **Tamaño:** M · **Depende de:** F2-06, B2-09, B2-10
- `/ministerios/:id`: encabezado con datos y coordinadores; pestaña *Integrantes* (tabla con búsqueda, fecha de unión, quitar) y botón "Agregar integrantes" con `SelectorMiembros` múltiple (`excluirIds` = actuales); interruptor "Ver históricos".
- **Criterios de aceptación**
  - [x] COORDINADOR del ministerio puede agregar/quitar; de otro ministerio no ve los botones.

### F2-11 · Actividades programadas del ministerio
- **RF:** RF-05.4 · **Fase:** 3 · **Tamaño:** S · **Depende de:** F2-10, F3 (`useEventos`)
- Pestaña *Actividades*: próximos eventos y eventos pasados del ministerio (`GET /eventos?ministerioId=`), con enlace al detalle del evento y botón "Nuevo evento" precargando `ministerioId`.
- **Criterios de aceptación**
  - [x] Reutiliza componentes de lista de eventos de F3 (sin duplicar).
