ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_requested_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS tasks_execution_queue_idx
ON tasks (execution_requested_at, id)
WHERE execution_requested_at IS NOT NULL;
