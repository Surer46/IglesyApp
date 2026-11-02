# F2 · Tareas 01 — Miembros

### F2-01 · Listado de miembros
- **RF:** RF-02.2, RF-02.5, RF-02.6 · **Fase:** 1 · **Tamaño:** M · **Depende de:** F1-06, B2-03 (o MSW)
- `/miembros`: `PageHeader` con "Nuevo miembro" (si `miembros:crear`), `CampoBusqueda` por nombre, filtro *Activos / Inactivos / Todos*, filtro por ministerio; `DataTable` (nombre completo, teléfono, correo, fecha de ingreso, ministerios, estado) con paginación. Filtros en la URL.
- **Criterios de aceptación**
  - [x] Estados cargando / vacío / error.
  - [x] En móvil se muestra como tarjetas.
  - [x] Clic en fila abre el perfil.

### F2-02 · Formulario de alta y edición
- **RF:** RF-02.1, RF-02.3, RF-02.4 · **Fase:** 1 · **Tamaño:** M · **Depende de:** F1-07, B2-01, B2-04
- `/miembros/nuevo` y `/miembros/:id/editar`: nombre, apellidos, teléfono, correo, fecha de ingreso (default hoy), fecha de nacimiento, dirección, notas. Validación Zod espejo del backend. Si la respuesta trae `meta.posibleDuplicado`, mostrar aviso con enlace al posible duplicado.
- **Criterios de aceptación**
  - [x] Salir con cambios sin guardar pide confirmación.
  - [x] Tras guardar → toast y redirección al perfil.

### F2-03 · Desactivar / reactivar
- **RF:** RF-02.7 · **Fase:** 1 · **Tamaño:** S · **Depende de:** F1-07, B2-05
- Acción en perfil y en menú de fila: `ConfirmDialog` con motivo opcional que explica que se conservará el historial. Reactivar desde el filtro *Inactivos*.
- **Criterios de aceptación**
  - [x] No existe ninguna opción "Eliminar".
  - [x] Badge de estado actualizado sin recargar.

### F2-04 · Perfil del miembro
- **RF:** RF-02.3, RF-03.4 · **Fase:** 2 · **Tamaño:** M · **Depende de:** F2-02, B2-04
- `/miembros/:id`: tarjeta de datos, ministerios a los que pertenece (con fecha de unión), pestaña *Asistencia* (historial vía F3 `useAsistencias({ miembroId })` + % últimos 3 meses), pestaña *Aportaciones* visible solo con `donaciones:leer` (lista resumida vía F4).
- **Criterios de aceptación**
  - [x] SECRETARIO no ve la pestaña *Aportaciones*.

### F2-05 · Vincular a ministerios desde el perfil
- **RF:** RF-05.3 · **Fase:** 2 · **Tamaño:** S · **Depende de:** F2-04, B2-09
- Botón "Agregar a ministerio" (select de ministerios activos) y "Quitar" por ministerio, según permisos (incluye COORDINADOR propio).
- **Criterios de aceptación**
  - [x] COORDINADOR solo ve como opción sus ministerios.

### F2-06 · Componente `SelectorMiembros`
- **RF:** RF-03.3, RF-04.3, RF-06.6 · **Fase:** 1 · **Tamaño:** M · **Depende de:** F1-06
- Combobox con búsqueda asíncrona (debounce), modo `simple` / `multiple` (chips), prop `ministerioId?`, `incluirInactivos?`, `excluirIds?`. Accesible (Radix Popover + listbox).
- **Criterios de aceptación**
  - [x] Ejemplo en `/_dev/ui` y prueba de selección múltiple.
  - [x] Avisado a F3 y F4 con ejemplo de uso en el PR.
