# 05 - Estados de Task y QA

El modelo actual usa dos estados relacionados: `tasks.status` y `tasks.qa_status`.

```mermaid
stateDiagram-v2
    [*] --> backlog: tarea creada
    backlog --> queued: preparada/encolada
    queued --> running: /run
    running --> review: development OK
    running --> failed: error de ejecución / reinicio
    failed --> queued: /retry

    state review {
        [*] --> QA_pending
        QA_pending --> QA_running: /qa
        QA_running --> QA_passed: validación OK
        QA_running --> QA_failed: findings/error
        QA_failed --> Correction: autocorrección o /correct
        Correction --> QA_pending: cambios aplicados
        QA_failed --> HumanFeedback: /reject
        HumanFeedback --> Correction: /correct
    }

    review --> passed: /approve y QA passed
    passed --> [*]
```

Estados persistidos de `tasks.status`: `backlog`, `queued`, `running`, `review`, `passed`, `failed`.

QA mantiene su propio ciclo (`pending`, `running`, `passed`, `failed`) y la autocorrección agrega `auto_correction_active`, `auto_correction_stage`, intentos y cantidad de correcciones terminadas.
