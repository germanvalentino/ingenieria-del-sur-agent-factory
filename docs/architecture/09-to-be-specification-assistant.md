# TO-BE - Specification Assistant

```mermaid
flowchart LR
    U[Usuario] --> UI[Specification Assistant UI]
    UI --> API[POST /api/specifications/analyze]
    API --> ORCH[Specification Orchestrator]
    ORCH --> C[Claude - Analisis funcional]
    ORCH --> X[Codex - Revision tecnica]
    C --> ORCH
    X --> ORCH
    ORCH --> DEC{Informacion suficiente?}
    DEC -- No --> Q[Repreguntas al usuario]
    Q --> UI
    DEC -- Si --> SPEC[Especificacion estructurada]
    SPEC --> TASK[Crear Task]
    TASK --> PIPE[Pipeline existente Agent Factory]

    C -. provider error .-> FB[Fallback automatico]
    X -. provider error .-> FB
    FB --> ORCH
```

## Regla de fallback

Un error operativo del proveedor (cuota, autenticacion, timeout, CLI o infraestructura) no se interpreta como una decision funcional. El orquestador continua con el proveedor alternativo cuando sea posible y registra el recorrido en `trace`.
