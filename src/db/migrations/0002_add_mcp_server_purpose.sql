-- Adds a nullable purpose column so each MCP can carry a human-authored
-- "what this is for" description surfaced later by the gateway's discovery
-- tools (falls back to the upstream-announced description when unset).

ALTER TABLE mcp_server ADD COLUMN purpose TEXT;
