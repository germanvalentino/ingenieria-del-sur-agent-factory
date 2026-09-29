# 01 - Arquitectura de bloques AS-IS

```mermaid
flowchart LR
    U[Usuario] --> UI[React / Vite Dashboard]
    UI -->|HTTP JSON| API[Node.js / Express API]

    API --> DASH[Dashboard Routes]
    API --> TASKS[Tasks Routes]
    API --> PROJ[Projects Routes]
    API --> REC[Recovery Service]

    DASH --> DB[(PostgreSQL)]
    PROJ --> DB
    TASKS --> DB
    REC --> DB

    TASKS --> RUNNER[Agent Runner]
    RUNNER --> CODEX[Codex CLI]
    RUNNER --> CLAUDE[Claude Code CLI]

    TASKS --> GIT[Git Worktree Service]
    GIT --> REPO[(Proyecto Git)]
    GIT --> WT[(Worktree aislado)]

    TASKS --> QA[QA Service]
    QA --> WT
    QA --> CODEX
    QA --> CLAUDE

    TASKS --> EXEC[Task Executions Service]
    EXEC --> DB

    TASKS -->|Aprobación humana| GIT
    GIT -->|commit + rebase + ff-only merge| REPO
```

## Responsabilidades

- El frontend opera proyectos, tareas, QA, correcciones, aprobación e historial.
- Express expone `/api/dashboard`, `/api/tasks`, `/api/projects` y health checks.
- PostgreSQL conserva proyectos, agentes, tareas, estados y métricas de ejecuciones.
- Agent Runner abstrae Codex y Claude.
- Cada desarrollo se ejecuta sobre un Git worktree aislado.
- QA valida el resultado antes de permitir aprobación.
- La aprobación humana finaliza el worktree e integra a la rama base.
