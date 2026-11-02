-- Stop the backend and drain the queue before rollback.
DROP INDEX IF EXISTS tasks_execution_queue_idx;
ALTER TABLE tasks DROP COLUMN IF EXISTS execution_requested_at;
