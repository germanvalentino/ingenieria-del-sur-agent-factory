# 07 - Deployment AS-IS

```mermaid
flowchart TB
    subgraph WIN[Windows - máquina de desarrollo]
        BROWSER[Navegador]
        VITE[React / Vite dev server]
        NODE[Node.js / Express :3001]
        PG[(PostgreSQL)]
        CODEX[Codex CLI]
        CLAUDE[Claude Code CLI]

        subgraph FS[C:\\proyectos]
            AF[ingenieria-del-sur-agent-factory]
            REPOS[Otros proyectos gestionados]
            WTS[.agent-worktrees\\task-id]
        end
    end

    BROWSER --> VITE
    VITE -->|HTTP /api| NODE
    NODE --> PG
    NODE --> CODEX
    NODE --> CLAUDE
    NODE --> AF
    NODE --> REPOS
    NODE --> WTS
    CODEX --> WTS
    CLAUDE --> WTS
```

## Restricciones observadas

- El backend limita las rutas operables a `C:/proyectos`.
- Los worktrees se crean bajo `C:/proyectos/.agent-worktrees`.
- El backend usa Node/Express y PostgreSQL; no depende de Docker.
- Codex y Claude se invocan como CLI locales.
- Ante un reinicio del backend, Recovery Service marca ejecuciones/tareas interrumpidas como fallidas y libera agentes en `working`.
