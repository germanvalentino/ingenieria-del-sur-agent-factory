CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    description TEXT,
    frontend_path TEXT,
    backend_path TEXT,
    repository_url TEXT,
    default_branch VARCHAR(100) NOT NULL DEFAULT 'main',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(30) PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    role VARCHAR(30) NOT NULL
        CHECK (role IN ('frontend', 'backend', 'qa')),
    provider VARCHAR(30) NOT NULL
        CHECK (provider IN ('codex', 'claude')),
    status VARCHAR(20) NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'working', 'waiting', 'offline')),
    instructions_path TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assigned_role VARCHAR(30) NOT NULL
        CHECK (assigned_role IN ('frontend', 'backend', 'qa')),
    status VARCHAR(30) NOT NULL DEFAULT 'backlog'
        CHECK (
            status IN (
                'backlog',
                'queued',
                'running',
                'review',
                'passed',
                'failed'
            )
        ),
    branch_name VARCHAR(180),
    pull_request_url TEXT,
    result_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO agents (
    id,
    name,
    role,
    provider,
    status,
    instructions_path
)
VALUES
    (
        'frontend-agent',
        'Frontend Agent',
        'frontend',
        'codex',
        'idle',
        'agents/frontend/AGENT.md'
    ),
    (
        'backend-agent',
        'Backend Agent',
        'backend',
        'codex',
        'idle',
        'agents/backend/AGENT.md'
    ),
    (
        'qa-agent',
        'QA Agent',
        'qa',
        'claude',
        'waiting',
        'agents/qa/AGENT.md'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (
    name,
    description,
    frontend_path,
    backend_path
)
SELECT
    'Agent Factory',
    'Plataforma de Ingeniería del Sur para coordinar agentes',
    'C:/proyectos/ingenieria-del-sur-agent-factory/agent-factory-front',
    'C:/proyectos/ingenieria-del-sur-agent-factory/agent-factory-back'
WHERE NOT EXISTS (
    SELECT 1
    FROM projects
    WHERE name = 'Agent Factory'
);