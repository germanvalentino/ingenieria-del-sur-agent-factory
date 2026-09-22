UPDATE agents
SET provider = 'codex',
    updated_at = NOW()
WHERE id = 'qa-agent';