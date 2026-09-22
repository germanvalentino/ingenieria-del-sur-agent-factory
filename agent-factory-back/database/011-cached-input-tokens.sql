ALTER TABLE task_executions
ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT NULL;
