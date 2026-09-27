ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS provider VARCHAR(30)
NOT NULL DEFAULT 'codex';

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS model VARCHAR(120);

UPDATE tasks
SET provider = 'codex'
WHERE provider IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass
      AND conname = 'tasks_provider_check'
  ) THEN
    ALTER TABLE tasks
    DROP CONSTRAINT tasks_provider_check;
  END IF;

  ALTER TABLE tasks
  ADD CONSTRAINT tasks_provider_check
  CHECK (provider IN ('codex', 'claude'));
END $$;

ALTER TABLE task_executions
ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12, 6);

ALTER TABLE task_executions
ADD COLUMN IF NOT EXISTS cache_creation_input_tokens BIGINT;

ALTER TABLE task_executions
ADD COLUMN IF NOT EXISTS model_usage JSONB;

ALTER TABLE task_executions
ADD COLUMN IF NOT EXISTS permission_denials JSONB;
