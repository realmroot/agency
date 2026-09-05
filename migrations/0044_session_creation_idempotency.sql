CREATE TABLE session_creations (
  session_id text PRIMARY KEY NOT NULL REFERENCES sessions(id),
  project_id text NOT NULL REFERENCES projects(id),
  key_hash text NOT NULL,
  fingerprint text NOT NULL,
  cloud_start text,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX idx_session_creations_project_key ON session_creations(project_id, key_hash);
