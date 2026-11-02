# Contexto selectivo de ejecuciones

Desarrollo y corrección reciben tarea y criterios existentes, diff vigente (HEAD contra estado final, incluyendo archivos nuevos) y solo imports relativos directos. QA revisa primero el diff, agrupa frontend/backend/shared y consolida todos los grupos. No se modificaron elección de proveedor, fallback, QA cruzado, controles del worktree, validaciones ni máximo de tres correcciones funcionales.

Configuración (variables del proceso; no requiere editar .env):

| Variable | Predeterminado |
| --- | ---: |
| AGENT_CONTEXT_MAX_FILE_CHARS | 180000 |
| AGENT_CONTEXT_MAX_CHARS | 240000 |
| AGENT_CONTEXT_MAX_RELATED_FILES | 12 |
| AGENT_CONTEXT_MAX_QA_BLOCKS | 8 |

Los valores deben ser enteros positivos. Los límites incluyen prompts e instrucciones; en QA el límite total cuenta los prompts enviados a todos los grupos. Código necesario excedido causa technical_error, sin truncamiento. Los archivos generados, temporales, secretos y binarios se excluyen antes de enviarlos. Un lockfile se considera relevante cuando también cambia su package.json. Dependencias que escapan del worktree no se leen. El agente recibe instrucciones de limitar sus lecturas adicionales a archivos relacionados; las métricas de caracteres miden los prompts enviados, no el contenido interno de respuestas de herramientas del CLI. Los tokens reales se obtienen del proveedor y permanecen nulos cuando no están disponibles.

La migración idempotente 017 agrega context_metrics al historial; se integra al mecanismo de migraciones existente. No fue aplicada a ninguna base durante esta tarea. Incluye caracteres, archivos incluidos/excluidos y bloques terminados. El historial muestra cache y diferencia porcentual contra la ejecución anterior del mismo tipo, proveedor y modelo. El resto de métricas (tokens, duración, proveedor/modelo y costo) conserva el almacenamiento existente. Registros históricos sin métricas muestran Sin datos.

## Comparación reproducible

Ejecutar desde la raíz: `node agent-factory-back/scripts/benchmark-context.mjs`.

Sobre el pequeño cambio de secret-redaction.service.js en este worktree:

- Antes, diff con unified=60: 1635 caracteres.
- Después, diff con unified=3: 798 caracteres.
- Después, contexto selectivo completo de código y encabezados: 827 caracteres, 1 archivo.
- Reducción del contexto de código: **49,42 %**.

Es una comparación local del payload de una etapa pequeña, sin llamadas pagas al proveedor. No representa una medición de tokens facturados, duración remota o costo real; esos resultados deben compararse con las métricas del historial una vez ejecutado en un entorno con proveedores. El prompt de instrucciones de la etapa es común a ambas mediciones y no forma parte de esta comparación.

## Validación

- Suite backend: 47 pruebas pasan; cuatro archivos de suites no arrancan por dependencia pg faltante en este entorno.
- Selección/contexto + QA + migraciones: 41 pruebas pasan.
- Tests frontend existentes: 10 pasan.
- Sintaxis de todos los archivos JS del backend y git diff --check: correctos.
- Lint/build frontend intentados: faltan oxlint/vite. Instalación offline intentada en ambas carpetas, sin paquetes disponibles en caché (ENOTCACHED).

Pendiente en entorno con dependencias: suite backend completa, lint/build frontend, aplicación de migración y comparación de ejecuciones reales Codex/Claude. No se hizo commit, push, deploy ni modificación de credenciales.
