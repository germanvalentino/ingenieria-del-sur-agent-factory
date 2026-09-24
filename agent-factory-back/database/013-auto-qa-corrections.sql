ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS correction_attempts INTEGER
NOT NULL DEFAULT 0;

UPDATE tasks
SET correction_attempts = correction_count
WHERE correction_attempts = 0
  AND correction_count > 0;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS auto_correction_active BOOLEAN
NOT NULL DEFAULT FALSE;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS auto_correction_stage VARCHAR(20)
CHECK (
  auto_correction_stage IS NULL
  OR auto_correction_stage IN (
    'qa',
    'correction'
  )
);

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS auto_correction_finished_count INTEGER
NOT NULL DEFAULT 0;
