-- Core schema: mcp_server, secret, consumer, assignment.
-- Secrets are stored in their own table as {iv,tag,ciphertext} and never as
-- a plaintext/value column on any table (SEC-01 at-rest requirement) -- the
-- mcp-servers repository/service layer is responsible for only ever
-- returning per-envKey hasValue flags from mcp_server/secret reads.

CREATE TABLE mcp_server (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL,
  command TEXT,
  args TEXT,
  url TEXT,
  headers TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE secret (
  id TEXT PRIMARY KEY,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
  env_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  ciphertext TEXT NOT NULL
);

CREATE INDEX idx_secret_mcp_server_id ON secret(mcp_server_id);

CREATE TABLE consumer (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  client_formats TEXT NOT NULL DEFAULT '[]',
  discovered INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE assignment (
  id TEXT PRIMARY KEY,
  consumer_id TEXT NOT NULL REFERENCES consumer(id) ON DELETE CASCADE,
  mcp_server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(consumer_id, mcp_server_id)
);

CREATE INDEX idx_assignment_consumer_id ON assignment(consumer_id);
CREATE INDEX idx_assignment_mcp_server_id ON assignment(mcp_server_id);
