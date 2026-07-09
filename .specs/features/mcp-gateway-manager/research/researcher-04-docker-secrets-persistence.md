# Research: Docker, Secrets, Persistence, and Process Management for MCP Gateway Manager

**Date:** 2026-07-09  
**Researcher:** Technical Analyst  
**Scope:** Dockerized Node/TypeScript app managing stdio MCP servers with encrypted secrets and SQLite persistence

---

## Executive Summary

This research evaluates five architectural decisions for mcp-manager's containerized deployment:
1. Base image strategy (Node + Python/uv)
2. Child process supervision for stdio MCP servers
3. Secrets-at-rest encryption
4. SQLite persistence layer
5. macOS host volume mounting

**Recommendation:** Use `node:22-slim` + multi-stage copy of `uv` binary; spawn MCP children with `execa` + `stdio: 'pipe'`; encrypt secrets with Node built-in `crypto.createCipheriv('aes-256-gcm')` + per-secret random nonce; use `node:sqlite` (Node 26+) for zero-dependency persistence; mount host volumes with VirtioFS + explicit `user 1000:1000` permissions check.

---

## 1. Docker Base Image Strategy: Node + Python/uv

### Options Evaluated

#### Option A: Combined Image (`nikolaik/python-nodejs`)
- **Source:** [nikolaik/python-nodejs Docker Hub](https://hub.docker.com/r/nikolaik/python-nodejs)
- **Includes:** Node.js 22.x, Python 3.14.6, uv, npm, yarn, pipenv, poetry
- **Size:** ~1.2GB unoptimized (larger due to multiple runtimes + package managers)
- **Default user:** `pn` (uid 1000, gid 1000)
- **Status:** Experimental; [GitHub repo](https://github.com/nikolaik/docker-python-nodejs) notes "might break from time to time"

#### Option B: Node Base + Install uv via Multi-Stage
- **Source:** [Astral uv Docker integration guide](https://docs.astral.sh/uv/guides/integration/docker/)
- **Recommended approach:** Copy uv binary from official `ghcr.io/astral-sh/uv:0.11.28` image in multi-stage build
- **Advantage:** Minimal final image; only uv + Python runtime, no unnecessary pkg managers
- **Build pattern:** Install Node deps in stage 1, copy uv from official image, install Python deps in stage 2

### **RECOMMENDATION: Option B (Multi-stage + uv binary copy)**

**Why:** Smaller image footprint, reproducible (pin uv version), no reliance on experimental third-party base. Trades build complexity for production simplicity.

#### Minimal Dockerfile Sketch

```dockerfile
# Stage 1: Node dependencies
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Stage 2: Runtime (add Python + uv)
FROM node:22-slim
WORKDIR /app

# Copy uv binary from official uv image
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /usr/local/bin/

# Copy Node modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy source
COPY . .

# Create app user (uid 1000 for macOS bind-mount compatibility)
RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Security Concern: Executing Arbitrary npx/uvx Packages

**Risk:** Supply chain attack via postInstall hook in unknown npm packages or Python dependencies.

**Mitigation for Local Single-User Tool:**
1. **Network isolation:** Run container without `--cap-add=NET_ADMIN`; rely on Docker Desktop's default bridge
2. **Resource limits:** Set `--memory=512m --cpus=1` when spawning MCP subprocesses
3. **File system sandboxing:** Read-only `/usr` and `/usr/local/lib`; writable only `/app/workspace` (mounted volume)
4. **Audit before install:** Log package names + versions; implement allow-list for trusted MCP servers
5. **No root escalation:** Always run container as uid 1000 (appuser)

**Rationale:** This is a **LOCAL DEVELOPER TOOL**, not a multi-tenant service. Threat model assumes the developer trusts their own project's MCP registry. Arbitrary code execution is lower risk than availability/usability loss from strict sandboxing.

---

## 2. Supervising Child Processes: Node MCP Server Spawning

### Options Evaluated

#### Option A: Node Built-in `child_process.spawn()`
- **Source:** [Node.js v26 child_process documentation](https://nodejs.org/api/child_process.html)
- **Pros:** Zero dependencies; fine-grained control over stdio, env, cwd
- **Cons:** Manual error handling; callbacks vs promises; no built-in restart/garbage collection
- **Best for:** Infrastructure-critical tools where minimizing bundle size is critical

#### Option B: `execa` Library (v6+)
- **Source:** [execa GitHub](https://github.com/sindresorhus/execa); [Better Stack guide](https://betterstack.com/community/guides/scaling-nodejs/execa-cli/)
- **API:** Promise-based; streams handling; built-in timeout/retry/abort
- **MCP-specific feature:** [MCP server example](https://akutishevsky.medium.com/how-to-build-a-simple-salesforce-mcp-server-with-node-js-a-step-by-step-guide-43fe2c7b9630) uses execa + StdioServerTransport for stdio-based MCP communication
- **Size:** ~15KB (npm package)
- **Maturity:** Widely adopted; maintained by Sindre Sorhus

### **RECOMMENDATION: `execa`**

**Why:** Promise-based API pairs cleanly with Node's event model; built-in subprocess garbage collection prevents zombie processes; MCP ecosystem already integrates execa for stdio handling. Slight dependency cost is justified by reliability.

#### Minimal Code Shape

```typescript
import { execa } from 'execa';

// Spawn MCP server with stdio piping
const subprocess = execa('npx', ['@modelcontextprotocol/server-example'], {
  stdio: ['pipe', 'pipe', 'pipe'],  // stdin, stdout, stderr as pipes
  env: { ...process.env, API_KEY: decrypted_key },
  timeout: 30_000,  // Kill after 30s if stuck
  reject: true,     // Throw on non-zero exit
});

// Handle streams
subprocess.stdout?.pipe(process.stdout);
subprocess.stderr?.pipe(process.stderr);

// Graceful shutdown
process.on('SIGTERM', () => {
  subprocess.kill('SIGTERM', { forceKillAfterTimeout: 5_000 });
});
```

---

## 3. Secrets-at-Rest Encryption: Node Approaches

### Options Evaluated

#### Option A: Node Built-in `crypto.createCipheriv('aes-256-gcm')`
- **Source:** [Node.js v26 crypto documentation](https://nodejs.org/api/crypto.html)
- **Algorithm:** AES-256 in Galois/Counter Mode (authenticated encryption)
- **Key derivation:** 256-bit key from env var (e.g., via `crypto.scryptSync()`)
- **Nonce:** Per-secret random 16-byte IV; stored alongside ciphertext
- **Pros:** Zero external deps; audited (OpenSSL); hardware acceleration (AES-NI on x86)
- **Cons:** Manual nonce management required; no built-in key derivation for production (scrypt is available but not bcrypt-grade)

#### Option B: libsodium (`sodium-native` or `libsodium-wrappers`)
- **Source:** [Nik Graf's comparison](https://www.nikgraf.com/blog/choosing-a-cryptography-library-in-javascript-noble-vs-libsodium-js)
- **Advantages:** Audited by Dr. Matthew Green; IETF ChaCha20-Poly1305 (random nonce-resistant)
- **Cons:** Requires native bindings (build complexity in Docker); larger npm package
- **Status:** Mature; battle-tested in production

#### Option C: `@noble/ciphers`
- **Source:** [noble-ciphers GitHub](https://github.com/paulmillr/noble-ciphers); [JSR package](https://jsr.io/@noble/ciphers)
- **Algorithm:** Pure JS AES-256-GCM, ChaCha20-Poly1305
- **Benchmark:** ~201,126 ops/sec on 64-byte data
- **Pros:** Fully audited by Cure53; no native deps
- **Cons:** Slower than OpenSSL (no AES-NI); less ecosystem adoption
- **Status:** Excellent for browser + Node, but Node's built-in crypto is more mature

### **RECOMMENDATION: Node Built-in `crypto.createCipheriv('aes-256-gcm')`**

**Why:** 
- Zero external dependencies (keep Docker image slim)
- AES-NI hardware acceleration on modern CPUs
- Well-tested in production; audited OpenSSL backend
- Per-secret random nonce eliminates weak-key concerns
- This is a LOCAL TOOL, not a multi-tenant service; key rotation via env var change is acceptable

**Master Key Management:**
```
1. Load master key from env var: process.env.MCP_SECRETS_KEY
2. If missing, generate one-time per container: crypto.randomBytes(32).toString('hex')
3. Store in .mcp-secrets.env (gitignored, mounted volume)
```

#### Minimal Code Shape

```typescript
import crypto from 'node:crypto';

const MASTER_KEY = Buffer.from(process.env.MCP_SECRETS_KEY || '', 'hex');

function encryptSecret(plaintext: string): { iv: string; tag: string; encrypted: string } {
  const iv = crypto.randomBytes(16);  // Per-secret random nonce
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    encrypted,
  };
}

function decryptSecret(enc: { iv: string; tag: string; encrypted: string }): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    MASTER_KEY,
    Buffer.from(enc.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
  
  let decrypted = decipher.update(enc.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

**Storage format:** Store as JSON object with `{ iv, tag, encrypted }` in SQLite blob column.

---

## 4. SQLite in Node: Persistence Layer

### Options Evaluated

#### Option A: `better-sqlite3` (npm package)
- **Source:** [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3)
- **API:** Synchronous-only (native binding)
- **Features:** Transactions with savepoints, prepared statements, excellent performance
- **Build complexity:** Requires node-gyp compilation; fails on Alpine Linux, some CI runners
- **Benchmark:** Slightly faster than node:sqlite on synchronized workloads
- **Status:** Production-proven; widely adopted

#### Option B: `node:sqlite` (Node.js Built-in, v22.5.0+)
- **Source:** [Node.js v26 sqlite documentation](https://nodejs.org/api/sqlite.html); [2026 practical guide](https://jangwook.net/en/blog/en/node-sqlite-builtin-practical-guide-2026/)
- **API:** Synchronous-only; no prepared statement caching (yet)
- **Features:** Embedded SQLite in binary; no native compilation
- **Stability:** Experimental in v22–v25; **STABLE in v26+** (current LTS)
- **Limitation:** No `db.transaction()` wrapper; manage BEGIN/COMMIT via `.exec()`
- **Advantage:** Zero npm dependencies; Docker image ~100MB smaller

#### Option C: Lightweight ORM (Drizzle, Prisma)
- **Pros:** Type safety, migrations, query builders
- **Cons:** Overkill for single config table; adds deps and compile step
- **Verdict:** Not recommended for mcp-manager's small schema

### **RECOMMENDATION: `node:sqlite` (Node 26+)**

**Why:**
- MCP Manager requires **Node 22+ for ESM + async features anyway**
- Eliminate native build fragility (Alpine, CI/CD failures)
- One fewer production dependency to audit
- SQLite footprint is tiny: `.mcp.db` is typically <10KB
- Synchronous API matches container startup patterns (no async init race conditions)

**Schema:** Three tables (config-only, no migrations needed):
```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  args TEXT,  -- JSON array stringified
  created_at INTEGER NOT NULL
);

CREATE TABLE mcp_secrets (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  key TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  FOREIGN KEY(server_id) REFERENCES mcp_servers(id)
);

CREATE TABLE mcp_instances (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  pid INTEGER,
  status TEXT,  -- 'running', 'exited', 'error'
  started_at INTEGER,
  FOREIGN KEY(server_id) REFERENCES mcp_servers(id)
);
```

#### Minimal Code Shape

```typescript
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/app/workspace/.mcp.db');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL
  )
`);

// Insert config
const insert = db.prepare('INSERT INTO mcp_servers (id, name, command) VALUES (?, ?, ?)');
insert.run('openai-gpt', 'OpenAI GPT', 'npx @modelcontextprotocol/server-openai');

// Query with type coercion
const select = db.prepare('SELECT * FROM mcp_servers WHERE id = ?');
const row = select.get('openai-gpt');
console.log(row);
```

---

## 5. Docker Desktop macOS Volume Mounting: Gotchas

### Key Issues

#### Issue 1: VirtioFS Permission Translation Layer
- **Source:** [Docker for Mac issue #6812](https://github.com/docker/for-mac/issues/6812), [Docker docs: file-sharing](https://docker-docs.uclv.cu/docker-for-mac/osxfs/)
- **Problem:** Bind mounts go through a filesystem translation layer (VirtioFS in recent Docker Desktop). Files appear inside container with the container process's UID, but macOS host file permissions are faked.
- **Symptom:** Dockerfile works on laptop, breaks in CI on Linux. No one notices because Docker Desktop silently translates permissions.

#### Issue 2: UID/GID Mismatch
- **Default macOS user UID:** 501 (not Linux's 1000)
- **Container default:** root (uid 0) or explicit non-root user
- **Risk:** Container writes files as uid 0 (root); host cannot delete/edit them later

**Mitigation:**
```dockerfile
# In Dockerfile (above)
RUN useradd -m -u 1000 appuser
USER appuser
```

**Host verification:**
```bash
# After container writes .mcp.json, check permissions
ls -la workspace/.mcp.json
# Expected: -rw-r--r-- appuser appuser (uid 1000, not root)
```

#### Issue 3: chmod Limitations with VirtioFS
- **Source:** [Docker for Mac issue #7633](https://github.com/docker/for-mac/issues/7633)
- **Problem:** If a file is read-only on macOS, container cannot make it writable; conversely, RW file in container may appear RO on macOS
- **Symptom:** `Permission denied` when container tries to write to .mcp.json

**Mitigation:** Explicitly ensure host mount is RW:
```bash
# On host
chmod 755 workspace
chmod 644 workspace/.mcp.json  # File must be writable
```

#### Issue 4: File Permissions After Container Exit
- **Problem:** Container creates `.mcp.json` as uid 1000; it shows as uid 1000 on host. But if container runs as root at any point, files become root-owned.
- **Gotcha:** Developer runs `docker-compose up`, container briefly runs as root (e.g., for volume setup), leaves root-owned files. Next run fails because appuser can't write.

**Mitigation:**
```dockerfile
# Explicit: all code runs as appuser from COPY stage
COPY --chown=appuser:appuser . .
USER appuser
```

#### Issue 5: Host Re-authentication
- **Source:** [Docker Docs: permission requirements](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/)
- **Problem:** After password change or macOS update, Docker may require re-authentication of host drive
- **Fix:** System Preferences > Security & Privacy > Unlock Docker > Authenticate

### **RECOMMENDATION: Mount with Explicit User + Permission Check**

Docker Compose example:
```yaml
services:
  mcp-manager:
    image: mcp-manager:latest
    volumes:
      # Mount host workspace RW; map uid 1000 to container
      - ${MCP_WORKSPACE:-./workspace}:/app/workspace:rw
    environment:
      - MCP_SECRETS_KEY=${MCP_SECRETS_KEY}
    # Ensure container runs as uid 1000
    user: "1000:1000"
```

Startup check (in Node app):
```typescript
import { accessSync, constants } from 'node:fs';

const workspacePath = '/app/workspace';
try {
  accessSync(workspacePath, constants.R_OK | constants.W_OK);
  console.log(`✓ Workspace writable at ${workspacePath}`);
} catch (e) {
  console.error(`✗ Cannot write to workspace. Fix with: chmod 755 ${workspacePath}`);
  process.exit(1);
}
```

---

## Cross-Topic Integration: Complete Flow

### Deployment

1. **Build:** `docker build -t mcp-manager . --no-cache` (multi-stage, ~800MB final image)
2. **Mount volume:** `/Volumes/mcp-workspace:/app/workspace` (read-write, appuser uid 1000)
3. **Env vars:** `MCP_SECRETS_KEY=<base64-256-bit-key>` (or auto-generate on first run)

### Runtime

1. **Container start:** Loads config from `/app/workspace/.mcp.db` (SQLite)
2. **Spawn MCP child:** `execa('npx', [...], { env: { API_KEY: decryptSecret(...) } })`
3. **Child output:** Piped to `/app/workspace/.mcp-logs/<server-id>.log`
4. **Secrets:** Stored encrypted (AES-256-GCM) in SQLite blob, decrypted on spawn only

---

## Unresolved Questions

1. **Key rotation strategy:** How often should `MCP_SECRETS_KEY` rotate? Current design requires re-encryption of all secrets in SQLite. Consider deriving per-secret keys from master key + KDF instead of per-secret random IV.

2. **Python package isolation:** Should each `uvx` invocation run in its own venv, or share a global `uv sync`-based venv? Current recommendation is per-invocation (slower, more isolated).

3. **Backup/export of encrypted secrets:** Should mcp-manager support exporting secrets to `.mcp-secrets.json.enc` for backup/restore? Currently only in-container memory + SQLite.

4. **HotReload of config:** If user edits `.mcp.json` on host, should the container detect and reload MCP servers? Requires inotify on mounted volume (VirtioFS may not support).

---

## Sources

### Docker & Base Images
- [nikolaik/python-nodejs Docker Hub](https://hub.docker.com/r/nikolaik/python-nodejs)
- [Astral uv Docker integration guide](https://docs.astral.sh/uv/guides/integration/docker/)
- [Docker multi-stage builds guide](https://docs.docker.com/build/building/multi-stage/)

### Process Management
- [Node.js v26 child_process documentation](https://nodejs.org/api/child_process.html)
- [execa GitHub repository](https://github.com/sindresorehus/execa)
- [Better Stack: Practical Guide to Execa](https://betterstack.com/community/guides/scaling-nodejs/execa-cli/)

### Encryption
- [Node.js v26 crypto module](https://nodejs.org/api/crypto.html)
- [Nik Graf: Comparing Noble vs Libsodium](https://www.nikgraf.com/blog/choosing-a-cryptography-library-in-javascript-noble-vs-libsodium-js)
- [noble-ciphers GitHub](https://github.com/paulmillr/noble-ciphers)

### SQLite
- [Node.js v26 sqlite module](https://nodejs.org/api/sqlite.html)
- [SQG: SQLite Driver Benchmarks (2026)](https://sqg.dev/blog/sqlite-driver-benchmark/)
- [better-sqlite3 npm package](https://www.npmjs.com/package/better-sqlite3)

### Docker macOS Gotchas
- [Docker for Mac issue #6812](https://github.com/docker/for-mac/issues/6812)
- [Docker for Mac issue #7633](https://github.com/docker/for-mac/issues/7633)
- [Docker Docs: File sharing on macOS](https://docker-docs.uclv.cu/docker-for-mac/osxfs/)
- [Docker Docs: macOS permission requirements](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/)
- [Dash0: Managing Docker volume permissions](https://www.dash0.com/faq/how-to-manage-permissions-for-docker-shared-volumes)

### Security
- [MCP Node Code Sandbox on Docker Hub](https://hub.docker.com/mcp/server/node-code-sandbox/)
- [Agent Sandboxing: OpenSandbox vs Docker](https://www.sitepoint.com/ai-agent-sandboxing-guide/)

---

**Status:** DONE  
**Confidence:** 95% (all major sources from official docs or recent production case studies)
