ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS scaffold_db_name VARCHAR(63),
  ADD COLUMN IF NOT EXISTS scaffold_db_created_by_tool BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS project_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
    process_type VARCHAR(20) NOT NULL
        CHECK (process_type IN ('backend', 'frontend')),
    pid INTEGER,
    port INTEGER,
    url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'stopped'
        CHECK (status IN ('stopped', 'starting', 'running', 'failed')),
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    last_log TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_processes_project_type
    ON project_processes (project_id, process_type);
