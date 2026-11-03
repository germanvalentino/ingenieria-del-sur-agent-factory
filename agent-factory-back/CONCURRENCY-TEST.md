# Funcionamiento y pruebas de concurrencia

## Alcance e invariantes

Esta guía describe el backend existente. Este cambio agrega solamente documentación:
no requiere modificar código, configuración ni bases de datos. Complementa
[TASK-QUEUE.md](TASK-QUEUE.md).

- Un único backend controla las ejecuciones por base de datos. Antes de migrar,
  recuperar tareas o despachar, obtiene el advisory lock de sesión `(179363, 1)`.
  Un segundo propietario no arranca; el callback predeterminado termina el proceso
  si la conexión propietaria emite un error. No admite múltiples réplicas activas.
- `MAX_CONCURRENT_TASKS` debe ser un entero positivo seguro; su valor predeterminado
  es `2`. El límite se establece al iniciar el proceso.
- El límite comprende desarrollo solicitado mediante `POST /api/tasks/:id/run`,
  incluido su fallback. QA, correcciones y aprobación tienen controles separados;
  el límite no representa todos los procesos externos del sistema.
- Solo se despachan tareas `queued` con `execution_requested_at` no nulo.
  Crear una tarea no solicita implícitamente su ejecución.
- Cada tarea conserva una única solicitud persistida. Repetir la solicitud mientras
  sigue `queued` conserva la fecha mediante `COALESCE`; el orden es fecha e ID.
  El orden FIFO corresponde al despacho, no al orden de finalización.
- La reserva SQL `queued -> running` ocurre antes de preparar el worktree.
  Los identificadores activos se reservan localmente antes de invocar el runner;
  los despachos se serializan mediante `draining`.
- El cierre compara la fecha original como texto de PostgreSQL convertido a
  `timestamptz`, evitando truncar microsegundos y consumir una solicitud más nueva.

## Flujo y fronteras

1. **Arranque:** `server.js` adquiere el propietario, llama a `initializeBackend()`
   (esquema, recuperación, reconciliación) y luego inicia la cola y el servidor.
2. **Admisión:** `enqueue()` ejecuta un `UPDATE` parametrizado condicionado a
   `status = 'queued'`. Solo después de persistir devuelve la tarea. No prepara Git.
3. **Despacho:** `drain()` reconcilia solicitudes terminales y ejecuciones sin worker
   local; toma la siguiente solicitud ordenada y ocupa un lugar en `active`.
4. **Ejecución:** el runner valida tarea, proveedor, rutas y agente. Un `UPDATE`
   condicionado reserva la tarea; si pierde la carrera, no prepara el worktree.
5. **Cierre:** el runner limpia la solicitud al pasar a `review` o `failed`.
   `execute()` también limpia la solicitud coincidente y convierte en `failed`
   una tarea que siguió `queued` por un rechazo de validación. Libera `active`
   en `finally` y despierta el siguiente despacho tras completar la persistencia.

La cola no mantiene una transacción SQL abierta durante Git o la llamada al agente.
Sus fronteras son actualizaciones atómicas y reconciliación posterior; no hay un
rollback transaccional de los efectos externos. La recuperación de arranque sí
usa `BEGIN`/`COMMIT` para tareas, agentes y ejecuciones, con `ROLLBACK` ante error
y liberación del cliente en `finally`.

## Contratos HTTP y compatibilidad

| Operación | Respuesta y significado |
| --- | --- |
| `POST /api/tasks/:id/run` aceptado | `202`, objeto tarea con `execution_requested_at`; no espera al agente ni garantiza éxito final. |
| Mismo POST repetido mientras sigue en cola | `202`, conserva la solicitud original. Si ya cambió de estado puede devolver `409`. |
| Tarea inexistente o fuera de `queued` | `409`, `{ "status": "error", "message": "La tarea no existe o no esta en cola" }`. |
| Error al encolar | `500`, `{ "status": "error", "message": error.message }`; el mensaje no tiene el contrato sanitizado de health. |
| `GET /api/health/queue` | `200`, por ejemplo `{ "active": 2, "pending": 70, "limit": 3 }`. Solo consulta. |
| Error al consultar health de cola | `500`, `{ "status": "error", "message": "No se pudo consultar la cola de ejecucion" }`. |
| `GET /api/dashboard` | Agrega `executionQueue` con `active`, `pending`, `limit`; los conteos son globales aunque las tarjetas estén limitadas a 50. |

Los conteos de desarrollo incluyen únicamente tareas con solicitud no nula y estado
`running` o `queued`, respectivamente. Excluyen tareas sin solicitud, incluidas las
correcciones automáticas de QA en ese caso. Son una lectura puntual de persistencia,
no el tamaño del conjunto local `active`. Los consumidores de `run` deben tratar
`202` como aceptación y consultar el estado posterior. Health se monta sin middleware
de autenticación propio: la protección externa debe cubrir también `/api/health/queue`.

## Amenazas, fallos y recuperación

| Escenario | Protección o comportamiento esperado |
| --- | --- |
| Doble clic y despachos simultáneos | Solicitud única, `draining`, reserva local y reserva SQL antes de Git. |
| Validación rechazada antes de reservar | Tarea solicitada pasa a `failed`, libera capacidad; no se modifica otra ejecución. |
| Falla del agente | Se registra el fallo y se permite continuar con la siguiente tarea. |
| DB inaccesible al admitir | No se confirma `202` sin persistencia; se propaga el error. |
| DB inaccesible al finalizar | Se libera el lugar local y queda información persistida para reconciliar en un despacho posterior. |
| Runner rechaza sin cambiar `queued` | Conserva la solicitud y reintenta mediante polling, sin bucle inmediato de reintentos. |
| Cierre tardío de un intento anterior | La comparación de `request_key` evita borrar o fallar un reintento nuevo. |
| Reinicio | Solicitudes pendientes sobreviven; desarrollo interrumpido queda fallido para reintento humano. |
| CLI huérfano tras caída abrupta | El lock protege backends, no procesos hijos sobrevivientes; comprobarlos antes de reiniciar. |

El polling se realiza cada segundo. `stop()` detiene nuevos despachos, pero no
cancela ni espera workers ya iniciados; no equivale a un drenaje completo.

## Pruebas reproducibles existentes

Ejecutar desde `agent-factory-back`, con dependencias instaladas y límite por defecto
`2` para la suite HTTP que espera ese valor. Las suites indicadas usan DB simulada
y servidores HTTP locales efímeros; no requieren iniciar `src/server.js`.
No usar el servidor normal como prueba: su arranque aplica migraciones y recuperación.

```powershell
node --check src/services/task-queue.service.js
node --check src/routes/tasks.routes.js
node --check src/routes/dashboard.routes.js
node --check src/routes/health.routes.js
node --test src/services/__tests__/task-queue.test.js src/services/__tests__/task-queue-api.test.js src/services/__tests__/task-execution-routes.test.js src/services/__tests__/health-routes.test.js src/services/__tests__/startup.test.js src/services/__tests__/schema-migration.test.js
```

| Criterio | Archivo en `src/services/__tests__/` y comprobaciones |
| --- | --- |
| Éxito y concurrencia acotada | `task-queue.test.js`: límites 1, 2 y 3; 20 tareas, solicitudes duplicadas y 20 despachos simultáneos; pico igual al límite, FIFO, cada tarea inicia una vez, conserva proyecto y ruta. |
| Fallos y continuidad | `task-queue.test.js`: validación rechazada, DB caída, rechazo inesperado, reinicio y recuperación sin duplicados. |
| Regresión de reintentos | `task-queue.test.js`: un cierre anterior no consume ni falla una solicitud más reciente. |
| Propietario exclusivo | `task-queue.test.js`: segundo propietario rechazado, cliente liberado y callback invocado al perder conexión (simulados). |
| HTTP y aislamiento de admisión | `task-queue-api.test.js`: `202` repetido, fecha persistida, `409`, métricas mayores a 50, exclusión de QA y ausencia de reserva al encolar; error previo a reserva sin escrituras. |
| Estado y errores de health | `health-routes.test.js`: JSON `200`, estado vacío, `500` sin detalles privados, recuperación y compatibilidad de health base. |
| Fallo de rutas | `task-execution-routes.test.js`: `500`, diagnóstico seguro y liberación de reserva de QA incluso ante error de liberación. |
| Arranque e idempotencia simulada | `startup.test.js`, `schema-migration.test.js`: orden de inicialización, corte ante error de migración y ejecución repetida contra DB simulada. No prueban PostgreSQL real. |

No se agregan ni alteran tests ejecutables porque el alcance permite solamente
documentación. La matriz vincula éxito, fallo y regresión con las pruebas existentes.

## Comprobaciones de integración pendientes

Estas comprobaciones requieren una base descartable y autorización independiente;
no forman parte de la ejecución de esta tarea. Nunca realizarlas en producción.

1. Aplicar `database/018-task-queue.sql` dos veces: verificar una columna
   `execution_requested_at TIMESTAMPTZ`, un índice parcial y conservación de datos.
   Los guards `IF NOT EXISTS` se verificaron por lectura, no contra PostgreSQL.
2. Con dos sesiones, verificar que solo una adquiere el lock `(179363, 1)` y que
   cerrar la sesión propietaria permite adquirirlo nuevamente. Validar también
   el comportamiento del backend ante pérdida de esa conexión.
3. Solicitar 20 tareas descartables con límites 1, 2 y 3 por separado; enviar
   solicitudes duplicadas concurrentes. Registrar IDs, fechas, inicio, fin y pico
   de workers; exigir pico menor o igual al límite y ninguna ejecución duplicada.
4. Interrumpir DB y luego restaurarla; comprobar solicitudes no confirmadas,
   solicitudes persistidas recuperables y continuidad sin duplicar ejecuciones.
   Reiniciar con pendientes y comprobar recuperación de tareas interrumpidas.
5. Inyectar un fallo dentro de la recuperación transaccional: comprobar rollback
   conjunto de tareas, agentes y ejecuciones y liberación del cliente. Esta
   frontera se verificó por lectura; las suites listadas no prueban su rollback real.
6. Con cola drenada y backend detenido, probar rollback SQL y nueva aplicación
   de 018. El rollback elimina columna e índice y pierde solicitudes almacenadas.

## Evidencia de esta ejecución

Validación realizada el 2026-11-02 (zona America/Buenos_Aires), Node `v22.15.0`:

- Estado Git inicial sin cambios reportados. Se utilizó `safe.directory` solo como
  opción del comando para superar la diferencia de propietario, sin cambiar config.
- Los cuatro comandos `node --check` anteriores finalizaron correctamente.
- La invocación conjunta de seis archivos de tests terminó con código `1`:
  cuatro pruebas de `schema-migration.test.js` aprobaron; cinco archivos no pudieron
  cargar por `ERR_MODULE_NOT_FOUND` (`express` o `pg`). Las pruebas de concurrencia
  y respuestas HTTP quedaron bloqueadas, no aprobadas.
- Se intentó instalar dependencias con `npm.cmd ci --offline --ignore-scripts
  --no-audit --no-fund`, usando caché temporal: falló con `ENOTCACHED` para `xtend`.
  No se ejecutaron scripts de instalación ni se cambiaron manifiestos.
- No hay scripts de lint o build definidos en `package.json`. No se ejecutaron
  migraciones, rollback SQL ni conexiones a bases reales; no se leyeron archivos `.env`.

## Rollback y criterio de entrega

Para revertir esta entrega basta eliminar `CONCURRENCY-TEST.md`; no hay cambios
de comportamiento ni de esquema que revertir. No ejecutar el rollback SQL para
revertir documentación.

La documentación cubre funcionamiento, invariantes, amenazas, contratos, pruebas
reproducibles y límites de evidencia. Permanecen pendientes la ejecución de las
suites bloqueadas con dependencias disponibles y las verificaciones reales de
PostgreSQL, rollback y procesos externos descritas arriba.
