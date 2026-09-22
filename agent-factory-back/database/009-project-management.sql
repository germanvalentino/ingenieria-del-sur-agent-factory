CREATE UNIQUE INDEX IF NOT EXISTS
projects_name_unique_lower
ON projects (LOWER(name));