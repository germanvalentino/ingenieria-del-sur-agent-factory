CREATE TABLE IF NOT EXISTS task_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL
        REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id VARCHAR(30)
        REFERENCES agents(id) ON DELETE SET NULL,
    execution_type VARCHAR(30) NOT NULL
        CHECK (
            execution_type IN (
                'development',
                'correction',
                'qa',
                'review'
            )
        ),
    provider VARCHAR(30),
    model VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'running'
        CHECK (
            status IN (
                'running',
                'passed',
                'failed'
            )
        ),
    input_tokens BIGINT,
    output_tokens BIGINT,
    total_tokens BIGINT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms BIGINT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
task_executions_task_id_started_at_idx
ON task_executions (task_id, started_at DESC);
