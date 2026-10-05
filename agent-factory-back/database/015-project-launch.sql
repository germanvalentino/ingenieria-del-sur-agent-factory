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

CREATE TABLE IF NOT EXISTS project_launch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID
        REFERENCES projects(id) ON DELETE SET NULL,
    requested_name TEXT,
    requested_project_path TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    current_stage TEXT,
    stages JSONB NOT NULL DEFAULT '[]'::jsonb,
    result JSONB,
    error JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_launch_jobs_project_updated
    ON project_launch_jobs (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_launch_jobs_active_request
    ON project_launch_jobs (requested_name, requested_project_path)
    WHERE status IN ('pending', 'running');
