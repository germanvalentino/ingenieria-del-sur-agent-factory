ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS agent_working_path TEXT;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS qa_status VARCHAR(20)
CHECK (
  qa_status IS NULL
  OR qa_status IN (
    'pending',
    'running',
    'passed',
    'failed'
  )
);

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS qa_summary TEXT;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS qa_started_at TIMESTAMPTZ;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS qa_finished_at TIMESTAMPTZ;