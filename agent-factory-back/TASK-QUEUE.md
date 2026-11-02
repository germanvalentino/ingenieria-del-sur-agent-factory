# Cola de ejecucion de desarrollo

## Invariantes y amenazas

- Un backend propietario por base de datos, mediante advisory lock de sesion
  `(179363, 1)`, adquirido antes de migraciones, recuperacion y despacho.
  Un segundo backend falla al arrancar; perder la conexion propietaria termina
  el backend. No es un despliegue de multiples replicas activas.
- `MAX_CONCURRENT_TASKS` es un entero positivo, por defecto `2`. Se configura
  en el entorno del proceso y se aplica al reiniciar, sin leer archivos de
  configuracion desde la cola. Valores invalidos impiden arrancar.
- El limite controla las solicitudes de desarrollo de `POST /api/tasks/:id/run`,
  incluyendo su fallback. QA, correccion, fallback de QA y aprobacion humana
  conservan sus rutas y reservas actuales; no participan de esta cola.
- Una solicitud persistente por tarea, ordenada por fecha y UUID. Dos clicks
  conservan la fecha original. Las tareas creadas pero nunca ejecutadas no
  se arrancan implicitamente. No se crean agentes ni worktrees mientras esperan.
- La reserva atomica `queued -> running` sigue ocurriendo antes de Git. Cada
  tarea conserva su proyecto y sus rutas de worktree, sin nuevas rutas globales.
- El cierre compara la fecha completa de la solicitud, sin perder microsegundos
  al convertirla a Date, para no consumir un reintento mas nuevo. El paso a
  review/failed libera la solicitud en la misma actualizacion de estado.
- Las fallas de persistencia mantienen solicitudes recuperables y se vuelven
  a consultar por polling. Los errores de validacion se conservan como tareas
  fallidas. No se modifica el estado de una tarea si fallo antes de reservarla.

## Etapas y compatibilidad

1. Migracion aditiva 018 e indice parcial, aplicada por el mecanismo existente.
2. Despacho serializado con reservas locales antes de invocar el runner original.
3. Dashboard y frontend: `run` devuelve HTTP 202 con la tarea y
   `execution_requested_at`. La respuesta ya no espera el resultado del agente.
   El frontend consulta dashboard mientras hay pendientes o ejecuciones activas.
4. Pruebas de concurrencia, fallos, recuperacion y contrato HTTP; regresiones
   existentes, lint, sintaxis y build.

`GET /api/dashboard` agrega `executionQueue: { active, pending, limit }`.
`metrics.runningTasks` y `metrics.queuedTasks` cuentan toda la tabla, aunque
la lista de tarjetas siga limitada a 50. Pendientes incluye solo solicitudes
aceptadas para ejecutar. El frontend permite desplegarse con un backend anterior
al omitir el denominador cuando no existe executionQueue.

## Recuperacion y rollback

Las solicitudes que aun esperan sobreviven al reinicio y arrancan automaticamente.
Se mantiene la recuperacion existente de ejecuciones interrumpidas: quedan fallidas
para reintento humano. No se relanzan automaticamente procesos que podrian haber
quedado huerfanos. Antes de reiniciar tras una caida abrupta, el operador debe
comprobar que no quedaron CLIs anteriores vivos; el bloqueo SQL protege backends,
no procesos externos que sobrevivan a su padre.

Para revertir: detener admision, dejar terminar las ejecuciones y vaciar la cola;
detener el backend; revertir codigo y ejecutar
`database/018-task-queue.rollback.sql` en la base correspondiente. El rollback
elimina solo la columna e indice agregados. No ejecutar mientras haya solicitudes
pendientes que deban conservarse. No se aplicaron migraciones a bases reales
durante el desarrollo.

## Evidencia y limites de validacion

- Pruebas con limites 1, 2 y 3, veinte tareas, clicks duplicados, FIFO,
  fallas de agentes/validacion, caida de DB, reinicio y reintento inmediato.
- Contrato HTTP real Express (DB simulada): 202 idempotente, 409, fechas,
  metricas globales mayores a 50 y ausencia de reserva de agente al encolar.
- La suite frontend verifica el contador con limite sin romper el indicador
  de actividad ni su texto accesible.
- Sintaxis Node, suites completas backend/frontend, lint y build frontend.
- PostgreSQL real y migracion/rollback quedan pendientes de una base de pruebas:
  este entorno no tiene herramientas PostgreSQL ni Docker disponibles.
