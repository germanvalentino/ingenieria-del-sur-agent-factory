# 08 - Modelo de datos lógico

```mermaid
erDiagram
    PROJECTS ||--o{ TASKS : contiene
    TASKS ||--o{ TASK_EXECUTIONS : registra
    AGENTS ||--o{ TASK_EXECUTIONS : ejecuta

    PROJECTS {
        uuid id PK
        varchar name
        text description
        text frontend_path
        text backend_path
        text repository_url
        varchar default_branch
        boolean active
        timestamptz created_at
        timestamptz updated_at
    }

    AGENTS {
        varchar id PK
        varchar name
        varchar role
        varchar provider
        varchar status
        text instructions_path
        boolean active
        timestamptz created_at
        timestamptz updated_at
    }

    TASKS {
        uuid id PK
        uuid project_id FK
        varchar title
        text description
        varchar assigned_role
        varchar provider
        varchar status
        varchar branch_name
        text worktree_path
        text agent_working_path
        varchar base_branch
        varchar qa_status
        text qa_summary
        text review_feedback
        int correction_count
        int correction_attempts
        boolean auto_correction_active
        varchar auto_correction_stage
        int auto_correction_finished_count
        varchar commit_hash
        timestamptz approved_at
        text result_summary
    }

    TASK_EXECUTIONS {
        uuid id PK
        uuid task_id FK
        varchar agent_id FK
        varchar execution_type
        varchar provider
        varchar model
        varchar status
        bigint input_tokens
        bigint cached_input_tokens
        bigint output_tokens
        bigint total_tokens
        numeric cost_usd
        bigint duration_ms
        jsonb model_usage
        jsonb permission_denials
        text error_message
        timestamptz started_at
        timestamptz finished_at
    }
```

## Relaciones principales

`projects -> tasks` es 1:N. `tasks -> task_executions` es 1:N y permite conservar development, QA, correcciones y review como ejecuciones separadas. `agents -> task_executions` es 1:N y conserva qué agente produjo cada ejecución incluso cuando una tarea atraviesa varios ciclos.
