DO $$
BEGIN
  ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS frontend_working_path TEXT NULL;

  ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS backend_working_path TEXT NULL;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'agents'::regclass
      AND conname = 'agents_role_check'
  ) THEN
    ALTER TABLE agents
    DROP CONSTRAINT agents_role_check;
  END IF;

  ALTER TABLE agents
  ADD CONSTRAINT agents_role_check
  CHECK (role IN ('frontend', 'backend', 'fullstack', 'qa'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass
      AND conname = 'tasks_assigned_role_check'
  ) THEN
    ALTER TABLE tasks
    DROP CONSTRAINT tasks_assigned_role_check;
  END IF;

  ALTER TABLE tasks
  ADD CONSTRAINT tasks_assigned_role_check
  CHECK (assigned_role IN ('frontend', 'backend', 'fullstack', 'qa'));
END $$;

INSERT INTO agents (
  id,
  name,
  role,
  provider,
  status,
  instructions_path,
  active
)
VALUES (
  'fullstack-agent',
  'Fullstack Agent',
  'fullstack',
  'codex',
  'idle',
  'agents/fullstack/AGENT.md',
  TRUE
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    role = EXCLUDED.role,
    provider = EXCLUDED.provider,
    status = EXCLUDED.status,
    instructions_path = EXCLUDED.instructions_path,
    active = TRUE,
    updated_at = NOW();
