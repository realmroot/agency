UPDATE projects
SET name = 'Default',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE name = 'Default project';
