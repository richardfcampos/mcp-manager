# MCP Gateway Manager — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

Per-task contract: (1) tests derive from the spec ACs and assert spec-defined outcomes, never mirror implementation; (2) the gate must pass before a task is done; (3) one atomic commit per task; (4) after the LAST task a fresh Verifier runs automatically.

---

**Spec**: `.specs/features/mcp-gateway-manager/spec.md`  
**Design**: `.specs/features/mcp-gateway-manager/design.md`  
**Status**: Draft (awaiting user approval)  
**Totals**: 55 tasks · 6 phases · all 15 P1 requirement IDs mapped

---

## Test Coverage Matrix

> Generated from spec + design (greenfield repo — no existing tests, strong defaults applied). Runner: **Vitest** + **pnpm**. Confirm before Execute.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain / business-logic (vault, mcp-servers, consumers, discovery, assignments, tool-aggregator, token-context, config-writers, upstream-config-resolver) | unit | All branches; 1:1 to spec ACs; every listed edge case | `src/**/*.test.ts` | `pnpm test:unit` |
| Gateway runtime + API routes (upstream-client, upstream-registry, gateway-router, api/*-routes, server assembly) | integration | Happy + edge + error per route/flow; spike + fixtures | `test/integration/**/*.test.ts` | `pnpm test:integration` |
| Entity / config / schema / infra (types, migrations SQL, Dockerfile, compose, env wiring, connection factory, React UI shell/components) | none | Build gate only (`tsc` + lint) | — | build gate |

## Parallelism Assessment

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| unit | **Yes** | Per-test in-memory/temp SQLite (`:memory:`), pure functions, stubbed deps | repos/services accept an injected `Database`; vault/aggregator/token-context take deps as params |
| integration | **No** | Spawns MCP child processes, binds HTTP ports, shared SQLite file | gateway + API tests start real transports/servers → run sequential (`fileParallelism:false`) |
| none | n/a | — | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm test:unit` |
| Full | After tasks with integration tests | `pnpm test:unit && pnpm test:integration` |
| Build | After config/infra/entity-only tasks or phase completion | `pnpm build && pnpm lint && pnpm test` |

---

## Execution Plan

Phases run strictly 1→6. Phases 1–3 fan out (parallel within dependency edges); phases 4–6 are **sequential** (integration tests share port/process/SQLite).

- **Phase 1 — Scaffold & Toolchain** (parallel within deps): T1, T2, T3, T4, T5, T6, T7, T8, T9, T10
- **Phase 2 — Persistence & Vault** (parallel within deps): T11, T12, T13, T14
- **Phase 3 — Domain Services** (parallel within deps): T15, T16, T17, T18, T19, T20, T21
- **Phase 4 — Live Gateway** (SEQUENTIAL): T22, T23, T24, T25, T54, T26, T27, T28, T29
- **Phase 5 — Config Writers** (SEQUENTIAL): T30, T31, T32, T33, T34
- **Phase 6 — API & Web UI** (SEQUENTIAL): T55, T36, T37, T38, T39, T40, T41, T42, T43, T44, T45, T46, T47, T48, T49, T50, T51, T52, T53, T56

### Global dependency map

```
mcp-manager — GLOBAL EXECUTION PLAN  (T1..T56; former T35 merged into T7 → 55 active tasks, 6 phases, strict phase order)

P1 SCAFFOLD & TOOLCHAIN            (order 1 · parallel within deps · build gates + 1 unit)
   T1 pkg ─┬─ T2 tsconfig ─┬─ T4 vitest ── T5 env(unit) ── T6 server ─┐
           ├─ T3 eslint    │                                          ├─ T8 docker ─ T9 compose ─ T10 readme
           └─ T7 web-shell ┘  (SINGLE canonical web scaffold)         ┘
   (T2,T3,T7 ∥ after T1 · T4→T5→T6 chain · T8←T1,T6,T7)
   NOTE: T6 server.ts is a placeholder bootstrap; final app assembly is consolidated by T56 (build via create-app + mount gateway).

P2 PERSISTENCE & VAULT            (order 2 · parallel · unit)          [all ← P1/T4]
   T11 conn ─┬─ T12 migrate+schema(unit,SEC-01)
             └─ T14 helpers(unit)
   T13 vault(unit,SEC-01)  [independent]

P3 DOMAIN SERVICES                (order 3 · parallel within deps · unit)
   T15 mcp-repo(SEC-01,listSealedSecrets) ┐  T18 mcp-svc(unit) ← T13,T15,T17  [MCP-01/02/03,SEC-01,ACC-02]
   T16 con-repo(+getByToken) ──────────────┤  T19 con-svc(unit,+getByToken) ← T16  [PRJ-02/03]
   T17 asg-repo ───────────────────────────┘  T20 asg-svc(unit) ← T15,T16,T17     [ACC-01]
   (repos ← T12,T14)                          T21 scan(unit)   ← T5,T16           [PRJ-01/03]

P4 LIVE GATEWAY                   (order 4 · SEQUENTIAL · integration + 3 unit)
   T22 spike(int) ← T4
   T23 fx-stdio ─┬─ T25 up-client(int) ← T18,T23,T24
   T24 fx-remote ┘
   T54 cfg-resolver(unit) ← T5,T13,T15   (getServer+listSealedSecrets → vault.openSecret → env map)  [GW-02 secret decrypt]
   T26 registry(int) ← T23,T25,T54       (injects decrypted secrets; exposes id+slug meta)            [GW-02/03]
   T27 aggregator(unit) ← T26            (slug + slug→mcpId sourced from registry meta)               [GW-01/03]
   T28 token-ctx(unit)  ← T19(getByToken),T20,T22                                                     [SEC-02,GW-01]
   T29 router(int)      ← T23,T24,T25,T26,T27,T28                                                     [GW-01/02/03,SEC-02]

P5 CONFIG WRITERS                 (order 5 · SEQUENTIAL · unit + integration tail)
   T30 iface ─┐
   T31 mblock(unit,CFG-02)
              T32 cc-writer(unit,CFG-01/02) ← T16,T30,T31
              T33 orchestrator(unit,CFG-02) ← T19,T20,T30,T32
              T34 wire-delete(int,ACC-02)   ← T18,T20,T33

P6 API & WEB UI                   (order 6 · SEQUENTIAL · integration routes + build UI)
   (web scaffold provided by T7 in P1 — no duplicate P6 scaffold task)
   T55 error-mw(unit,400/404/409/500 mapping) ← T4        (extracted from former-T36 bundle; own dedicated tests)
   T36 app-factory+router+static+harness(int) ← T12,T7,T55  (SINGLE canonical app-assembly path via create-app)
     ├─ T37 mcp create/update(int) ← T18 ── T38 mcp list/detail(int)
     │         └─ T39 mcp delete(int) ← T34                            [ACC-02]
     ├─ T40 con list/discover(int) ← T19,T21 ── T41 con register(int)  [PRJ-01/02/03]
     ├─ T42 assignments(int) ← T20                                     [ACC-01]
     ├─ T43 write-configs(int) ← T19,T33,T42                           [CFG-01/02]
     ├─ T44 rotate-token(int) ← T19,T33  (verify via getByToken)
     ├─ T45 status(int) ← T18,T26  (enumerate ALL MCPs via listServers; never-connected→stopped, failed→error)
     └─ T46 preview(int) ← T19,T32
   T47 api-client ← T7  (typed after routes exist per phase order)
     ├─ T48 mcp-form · T49 con-list · T50 matrix · T51 write-btn · T52 status  (∥ components)
     └─ T53 app-shell ← T7,T48,T49,T50,T51,T52
   T56 server-assembly(int) ← T6,T23,T29,T36,T37,T41,T42  (server.ts builds app via create-app + mounts gateway; ONE process serves /api + /mcp/:token + static; removes T6 duplicate)  [GW-01,SEC-02]

Legend: (int)=integration  (unit)=unit  ∥=parallelizable  ←=depends on  [SPEC-IDs]=requirement coverage
Phases run strictly 1→6. sequential=false phases (P1,P2,P3) fan out respecting edges; sequential=true phases (P4,P5,P6) serialize (integration tests share port/process/SQLite). Only forward id reference is T26→T54 (appended resolver); T55/T56 are appended into P6 and reference only earlier-phase or earlier-P6 ids (T6/T23/T29 + create-app/routes) — graph remains acyclic, no cycles.
```

---

## Task Breakdown

### Phase 1: Scaffold & Toolchain

#### T1: Init pnpm project manifest + scripts + gitignore

**What**: Create root package.json (name mcp-manager, type module, Node 22 engines) with runtime deps (express, better-sqlite3, @modelcontextprotocol/sdk), tooling devDeps (typescript, vitest, eslint, prettier, @types/node, @types/express, tsx), the 5 gate scripts, plus .npmrc and .gitignore.  
**Where**: `package.json`, `.npmrc`, `.gitignore`  
**Depends on**: None  
**Reuses**: none (greenfield)  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] package.json declares deps express + better-sqlite3 + @modelcontextprotocol/sdk and devDeps typescript + vitest + eslint + prettier + @types/node
- [ ] scripts define: build='tsc -p tsconfig.json', lint='eslint .', test='vitest run', test:unit='vitest run src', test:integration='vitest run test/integration'
- [ ] .gitignore excludes node_modules, dist, web/dist, *.sqlite, .env
- [ ] `pnpm install` exits 0 and generates pnpm-lock.yaml; `pnpm run` lists all 5 scripts
- [ ] Project gate `pnpm build && pnpm lint && pnpm test` is deferred until first src file exists; expected test count at this stage: 0

**Commit**: `build: initialize pnpm project manifest and toolchain scripts`

---

#### T2: Add TypeScript compiler config [P]

**What**: Create root tsconfig.json for the server/domain code (strict, ES2022 target, NodeNext module/resolution, outDir dist, include src, exclude web + test integration handled by vitest).  
**Where**: `tsconfig.json`  
**Depends on**: T1  
**Reuses**: none  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] tsconfig.json sets strict:true, target ES2022, module+moduleResolution NodeNext, outDir 'dist', include ['src'], esModuleInterop true
- [ ] `pnpm exec tsc --showConfig` prints resolved config and exits 0
- [ ] Gate `pnpm build && pnpm lint && pnpm test`: build config valid (no src inputs yet, full build green after T5); expected test count 0

**Commit**: `build: add typescript compiler configuration`

---

#### T3: Add ESLint + Prettier config [P]

**What**: Add flat-config ESLint (typescript-eslint) + Prettier config and ignore files so `pnpm lint` and format checks run clean across src and web.  
**Where**: `eslint.config.js`, `.prettierrc`, `.prettierignore`  
**Depends on**: T1  
**Reuses**: none  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] eslint.config.js uses @typescript-eslint parser/plugin and ignores dist, node_modules, web/dist
- [ ] .prettierrc defines house style (semi, singleQuote, printWidth 100); .prettierignore excludes dist + lockfiles
- [ ] `pnpm lint` exits 0 and `pnpm exec prettier --check .` exits 0
- [ ] Gate `pnpm build && pnpm lint && pnpm test`: lint passes; expected test count 0

**Commit**: `chore: add eslint and prettier configuration`

---

#### T4: Configure Vitest unit + integration projects [P]

**What**: Create vitest.config.ts wiring the two suites the coverage matrix requires: unit = src/**/*.test.ts, integration = test/integration/**/*.test.ts, with passWithNoTests and node environment; integration suite forced non-parallel (singleThread/fileParallelism false).  
**Where**: `vitest.config.ts`  
**Depends on**: T1, T2  
**Reuses**: none  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] vitest.config.ts includes src/**/*.test.ts for the default/unit run and test/integration/**/*.test.ts for the integration run
- [ ] passWithNoTests:true set; integration run configured sequential (fileParallelism:false)
- [ ] `pnpm test:unit` exits 0 (0 test files found); `pnpm test:integration` exits 0 (0 test files found)
- [ ] Gate `pnpm build && pnpm lint && pnpm test` runs; expected test count 0

**Commit**: `test: configure vitest unit and integration projects`

---

#### T5: Env config loader + master-key validation (with unit tests) [P]

**What**: Create src/config/env.ts that loads and validates env (MCP_MANAGER_MASTER_KEY decoded to exactly 32 bytes for AES-256, MCP_MANAGER_WORKSPACE_ROOT resolved+existing, PORT default, HOST forced to loopback) failing fast on bad config, plus co-located unit tests asserting each validation outcome.  
**Where**: `src/config/env.ts`, `src/config/env.test.ts`  
**Depends on**: T2, T4  
**Reuses**: none  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] env.ts throws a clear error when MCP_MANAGER_MASTER_KEY is missing
- [ ] env.ts throws when master key does not decode to exactly 32 bytes; returns parsed config for a valid 32-byte key
- [ ] env.ts resolves workspace root from MCP_MANAGER_WORKSPACE_ROOT (with default) and exposes loopback bind host + port default
- [ ] env.test.ts covers: missing key, wrong-length key, valid key, workspace-root resolution, port/host defaults (5 tests)
- [ ] Gate `pnpm test:unit` passes with exactly 5 green tests

**Commit**: `feat: add env config loader with master-key validation`

---

#### T6: Express server bootstrap (localhost bind + static SPA + health) [P]

**What**: Create src/server.ts that builds the Express app, binds to the loopback host/port from env.ts, serves the built web/dist as static SPA with fallback, exposes GET /healthz -> 200, and provides clearly marked mount points for the api + gateway routers added by later phases (final consolidation into the create-app factory happens in T56).  
**Where**: `src/server.ts`  
**Depends on**: T2, T5  
**Reuses**: src/config/env.ts (T5)  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] server.ts creates Express app, listens on env loopback host (127.0.0.1) + port, never binds 0.0.0.0
- [ ] GET /healthz returns 200; static middleware serves web/dist with SPA index fallback
- [ ] Explicit placeholder hooks/comments mark where api + gateway routers mount in later phases (no imports of not-yet-existing modules); these placeholders are replaced by T56 which delegates app construction to create-app
- [ ] Gate `pnpm build && pnpm lint && pnpm test` passes; expected test count 5 (env unit tests), 0 integration

**Commit**: `feat: add express server bootstrap binding localhost`

---

#### T7: Vite + React + Tailwind SPA skeleton (single canonical web scaffold) [P]

**What**: Scaffold web/ (index.html, vite.config.ts with base for Express-served static, tailwind + postcss config, web/tsconfig.json, src/main.tsx, src/App.tsx shell, src/index.css with Tailwind directives) and add frontend devDeps + build:web/dev:web scripts so the SPA builds to web/dist. This is the ONLY web scaffold task; Phase 6 UI tasks extend it, they do not re-scaffold.  
**Where**: `web/index.html`, `web/vite.config.ts`, `web/tailwind.config.js`, `web/postcss.config.js`, `web/tsconfig.json`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`, `package.json`  
**Depends on**: T1, T2  
**Reuses**: none  
**Requirement**: — (infra)  
**Tools**: MCP `context7` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] web/ contains a compiling React+TS entry (main.tsx -> App.tsx) with Tailwind directives wired via postcss + tailwind config (tailwind.config.js is the canonical config extension used by all later web tasks)
- [ ] package.json gains vite, @vitejs/plugin-react, react, react-dom, tailwindcss, postcss, autoprefixer and scripts build:web + dev:web; vite outDir resolves to web/dist consumed by server static
- [ ] `pnpm build:web` produces web/dist/index.html and hashed assets, exits 0
- [ ] Gate `pnpm build && pnpm lint && pnpm test` passes; expected test count 5 unit, 0 integration

**Commit**: `feat: scaffold vite react tailwind spa shell`

---

#### T8: Dockerfile (node:22-slim + uv, non-root uid 1000) [P]

**What**: Author multi-stage Dockerfile on node:22-slim that installs pnpm, builds server + web, copies the uv/uvx binaries from ghcr.io/astral-sh/uv (so npx AND uvx are available for stdio MCP children), runs as non-root uid 1000 with chowned app + data dirs, and starts the server, plus .dockerignore.  
**Where**: `Dockerfile`, `.dockerignore`  
**Depends on**: T1, T6, T7  
**Reuses**: none  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] Dockerfile base node:22-slim; copies uv+uvx from ghcr.io/astral-sh/uv into PATH; both `npx` and `uvx` resolvable in final image
- [ ] Final stage creates/uses non-root user uid 1000, chowns app dir + sqlite data dir, sets USER 1000, CMD starts built server
- [ ] .dockerignore excludes node_modules, .git, web/dist source dupes, .env
- [ ] `docker build -t mcp-manager .` completes exit 0; `docker run --rm mcp-manager which uvx npx` prints both paths
- [ ] Gate `pnpm build && pnpm lint && pnpm test` (host) still passes; expected test count 5 unit, 0 integration

**Commit**: `build: add dockerfile with node 22 and uv runtime`

---

#### T9: docker-compose (workspace RW mount + sqlite volume + master key) [P]

**What**: Create docker-compose.yml running the image with the workspace root bind-mounted read-write to the container workspace path, a named volume for the SQLite DB, MCP_MANAGER_MASTER_KEY + MCP_MANAGER_WORKSPACE_ROOT env wired from .env, and the port published only on 127.0.0.1.  
**Where**: `docker-compose.yml`  
**Depends on**: T5, T8  
**Reuses**: src/config/env.ts env contract (T5)  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] compose bind-mounts host workspace root RW to the container workspace path env.ts reads; named volume persists the SQLite file
- [ ] environment passes MCP_MANAGER_MASTER_KEY + MCP_MANAGER_WORKSPACE_ROOT; ports bound to 127.0.0.1 only (no 0.0.0.0 publish)
- [ ] `docker compose config` validates and exits 0
- [ ] Gate `pnpm build && pnpm lint && pnpm test` (host) passes; expected test count 5 unit, 0 integration

**Commit**: `build: add docker-compose with workspace and sqlite volumes`

---

#### T10: README + .env.example [P]

**What**: Write README.md (what it is, quickstart, docker compose run, generating a master key) and .env.example enumerating exactly the env vars env.ts consumes (MCP_MANAGER_MASTER_KEY with generation hint, MCP_MANAGER_WORKSPACE_ROOT, PORT) with safe placeholder values.  
**Where**: `README.md`, `.env.example`  
**Depends on**: T5, T9  
**Reuses**: env var names from T5, compose from T9  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] .env.example lists every var env.ts reads (MCP_MANAGER_MASTER_KEY, MCP_MANAGER_WORKSPACE_ROOT, PORT) with placeholder-only values, no real secret
- [ ] README documents quickstart: generate 32-byte key, set .env, `docker compose up`, open localhost URL
- [ ] `git status` shows .env is ignored (only .env.example tracked)
- [ ] Gate `pnpm build && pnpm lint && pnpm test` passes unchanged; expected test count 5 unit, 0 integration

**Commit**: `docs: add readme and env example`

---

### Phase 2: Persistence & Vault

#### T11: SQLite connection factory [P]

**What**: Add src/db/connection.ts exporting openDatabase(path) that opens a better-sqlite3 Database and enforces foreign_keys and WAL pragmas.  
**Where**: `src/db/connection.ts`  
**Depends on**: T4  
**Reuses**: Consumed by migrate.ts (T12) and repository-helpers.ts (T14); domain repos in Phase 3 open the DB through this factory.  
**Requirement**: — (infra)  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] src/db/connection.ts exports openDatabase(path: string) returning a better-sqlite3 Database instance
- [ ] openDatabase sets PRAGMA foreign_keys = ON and PRAGMA journal_mode = WAL on every connection
- [ ] accepts both ':memory:' and on-disk file paths (parent dir assumed to exist)
- [ ] no plaintext secrets or business logic in this file (pure infra factory)
- [ ] gate: pnpm build && pnpm lint && pnpm test passes (tsc no type errors, lint clean); no new tests added here (pragma behavior asserted by T12 smoke test)

**Commit**: `feat(db): add better-sqlite3 connection factory with foreign-key and WAL pragmas`

---

#### T12: Migration runner + initial schema [P]

**What**: Add src/db/migrate.ts (ordered, idempotent .sql runner with schema_migrations tracking) and migrations/0001_init.sql creating mcp_server, secret, consumer, assignment tables, plus a migration smoke test.  
**Where**: `src/db/migrate.ts`, `src/db/migrations/0001_init.sql`, `src/db/migrate.test.ts`  
**Depends on**: T11  
**Reuses**: Uses openDatabase from T11; schema consumed by all Phase 3 domain repos.  
**Requirement**: SEC-01  
**Tools**: MCP `NONE` · Skill `databases`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] migrations/0001_init.sql creates tables mcp_server, secret, consumer, assignment
- [ ] mcp_server has UNIQUE(slug) and UNIQUE(name) plus columns id, slug, name, transport, command, args, url, headers, created_at
- [ ] secret table columns: id, mcp_server_id (FK -> mcp_server.id ON DELETE CASCADE), env_key, iv, tag, ciphertext, and NO plaintext/value column (SEC-01 at-rest)
- [ ] consumer table columns id, type, name, path, token (UNIQUE), client_formats, discovered, available, enabled, created_at
- [ ] assignment table has FKs consumer_id and mcp_server_id both ON DELETE CASCADE and UNIQUE(consumer_id, mcp_server_id)
- [ ] src/db/migrate.ts applies migrations/*.sql in filename order inside one transaction and is idempotent (re-run is a no-op via a schema_migrations table)
- [ ] smoke test asserts: all 4 tables exist after migrate; duplicate mcp_server.slug rejected; deleting an mcp_server cascades its secret+assignment rows; inserting a secret with unknown mcp_server_id is rejected (foreign_keys enforced)
- [ ] gate: pnpm test:unit green; 5 new migration/smoke tests pass

**Commit**: `feat(db): add migration runner and initial schema for core tables`

---

#### T13: AES-256-GCM secret vault [P]

**What**: Add src/vault/secret-vault.ts with sealSecret/openSecret using AES-256-GCM (per-call random IV, GCM tag tamper detection) plus unit tests covering round-trip, uniqueness, and tamper rejection.  
**Where**: `src/vault/secret-vault.ts`, `src/vault/secret-vault.test.ts`  
**Depends on**: T4  
**Reuses**: Master key contract (32-byte MCP_MANAGER_MASTER_KEY) from config/env.ts; functions are pure and take the key as a parameter for testability; called by mcp-servers domain service in Phase 3 and by upstream-config-resolver (T54).  
**Requirement**: SEC-01  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/vault/secret-vault.ts exports sealSecret(plaintext: string, key: Buffer) -> {iv, tag, ciphertext} with base64 string fields and openSecret(sealed, key) -> plaintext
- [ ] uses aes-256-gcm with a fresh random 12-byte IV generated per sealSecret call
- [ ] sealSecret and openSecret throw a clear error when key length != 32 bytes
- [ ] unit tests assert (SEC-01): openSecret(sealSecret(p)) === p (round-trip); ciphertext !== plaintext (encrypted at rest); two seals of identical plaintext produce different iv AND ciphertext; openSecret throws when ciphertext byte is mutated; openSecret throws when tag is mutated; openSecret throws under a wrong 32-byte key; seal/open throw for a non-32-byte key
- [ ] gate: pnpm test:unit green; 7 new vault tests pass

**Commit**: `feat(vault): add AES-256-GCM secret vault with tamper detection`

---

#### T14: Thin repository helpers [P]

**What**: Add src/db/repository-helpers.ts with shared DB utilities (transaction wrapper, JSON column serialize/parse, id and timestamp generators) plus unit tests for the branch behavior.  
**Where**: `src/db/repository-helpers.ts`, `src/db/repository-helpers.test.ts`  
**Depends on**: T11  
**Reuses**: Built on T11 Database type; used by Phase 3 domain repos to (de)serialize JSON columns (args, headers, client_formats) and wrap multi-statement writes.  
**Requirement**: — (infra)  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/db/repository-helpers.ts exports withTransaction(db, fn), serializeJson(value), parseJson(text) (null/undefined-safe), generateId(), and nowIso()
- [ ] unit tests assert: array/object round-trips through serializeJson->parseJson; parseJson(null) returns null (no throw); withTransaction commits all writes on success; withTransaction rolls back all writes when fn throws
- [ ] no plaintext secret handling in this module (JSON helpers operate on non-secret columns only)
- [ ] gate: pnpm test:unit green; 4 new helper tests pass

**Commit**: `feat(db): add thin repository helpers for transactions and JSON columns`

---

### Phase 3: Domain Services

#### T15: MCP servers repository (servers + secrets persistence) [P]

**What**: SQLite-backed repository for mcp_servers and secrets tables: insertServer(with sealed secret rows), getServer, listServers (metadata + per-envKey hasValue only), updateServer, deleteServer (server + its secret rows), findByName, listSealedSecrets.  
**Where**: `src/domain/mcp-servers/mcp-servers-repository.ts`, `src/domain/mcp-servers/mcp-servers-repository.test.ts`, `src/domain/mcp-servers/mcp-server-types.ts`  
**Depends on**: T12, T14  
**Reuses**: src/db/connection.ts  
**Requirement**: SEC-01  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/domain/mcp-servers/mcp-servers-repository.ts exports insertServer, getServer, listServers, updateServer, deleteServer, findByName, listSealedSecrets
- [ ] sealed secrets persisted as {iv,tag,ciphertext} rows in a separate secrets table keyed by mcpServerId (SEC-01 separate at-rest table)
- [ ] listServers/getServer result objects contain NO plaintext and NO ciphertext secret fields (only hasValue boolean per envKey) = SEC-01 read never returns plaintext
- [ ] listSealedSecrets(mcpServerId) returns the raw sealed {envKey,iv,tag,ciphertext} rows for the resolver/decrypt path (T54), never exposed via listServers/getServer
- [ ] deleteServer removes the server row and all its secret rows
- [ ] gate: pnpm test:unit passes with >=8 new repository tests

**Commit**: `feat(mcp-servers): add servers and secrets repository`

---

#### T16: Consumers repository (projects + desktop profiles persistence) [P]

**What**: SQLite-backed repository for consumers table: insertConsumer, getConsumer, getByPath, getByToken, listConsumers, updateToken, updateClientFormats, setAvailable, upsertDiscovered (idempotent by path), delete.  
**Where**: `src/domain/consumers/consumers-repository.ts`, `src/domain/consumers/consumers-repository.test.ts`, `src/domain/consumers/consumer-types.ts`  
**Depends on**: T12, T14  
**Reuses**: src/db/connection.ts  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/domain/consumers/consumers-repository.ts exports insertConsumer, getConsumer, getByPath, getByToken, listConsumers, updateToken, updateClientFormats, setAvailable, upsertDiscovered
- [ ] consumer row round-trips type('project'|'desktop-profile'), name, path, token, clientFormats(json array), discovered, available, enabled, createdAt
- [ ] getByToken(token) returns the single consumer holding that token, or null/undefined when no match (backs gateway token resolution for T28 SEC-02/GW-01 and T44 rotate verification)
- [ ] upsertDiscovered inserts a new discovered consumer once and is idempotent on repeated calls with the same path
- [ ] gate: pnpm test:unit passes with >=9 new repository tests

**Commit**: `feat(consumers): add consumers repository`

---

#### T17: Assignments repository (assign/unassign + query primitives) [P]

**What**: SQLite-backed repository for assignments table: assign(consumerId,mcpServerId) with unique constraint, unassign, allowedMcpIds(consumerId), consumersOfMcp(mcpServerId), deleteByMcpId, deleteByConsumerId.  
**Where**: `src/domain/assignments/assignments-repository.ts`, `src/domain/assignments/assignments-repository.test.ts`, `src/domain/assignments/assignment-types.ts`  
**Depends on**: T12  
**Reuses**: src/db/connection.ts  
**Requirement**: ACC-01  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/domain/assignments/assignments-repository.ts exports assign, unassign, allowedMcpIds, consumersOfMcp, deleteByMcpId, deleteByConsumerId
- [ ] ACC-01: assign persists a row; unassign removes it; a duplicate (consumerId,mcpServerId) pair does not create a second row
- [ ] allowedMcpIds(consumerId) returns only that consumer's assigned mcpServerIds; consumersOfMcp(mcpServerId) returns only consumers assigned to that mcp
- [ ] deleteByMcpId removes every assignment row for the given mcpServerId
- [ ] gate: pnpm test:unit passes with >=8 new repository tests

**Commit**: `feat(assignments): add assignments repository with query primitives`

---

#### T18: MCP servers service (create/update/list/delete-cascade) [P]

**What**: Business service over the repo + vault: createServer (encrypt marked secret env values before persist; derive transport from url vs command), updateServer, listServers (mask secrets to hasValue), deleteServer (collect affected consumers, cascade-delete assignments, invoke injected config-rewrite hook), with duplicate-name and required-field validation.  
**Where**: `src/domain/mcp-servers/mcp-servers-service.ts`, `src/domain/mcp-servers/mcp-servers-service.test.ts`  
**Depends on**: T13, T15, T17  
**Reuses**: src/vault/secret-vault.ts, src/domain/mcp-servers/mcp-servers-repository.ts, src/domain/assignments/assignments-repository.ts  
**Requirement**: MCP-01, MCP-02, MCP-03, SEC-01, ACC-02  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] MCP-01: createServer for a stdio MCP encrypts each marked secret via the vault before persisting; no plaintext secret value is ever passed to the server-row insert
- [ ] MCP-02: createServer with a url persists transport 'http' (or 'sse' when url flagged sse); command/args path used only for stdio
- [ ] MCP-03: createServer throws on duplicate name, on missing name, on stdio missing command, and on remote missing url (nothing persisted)
- [ ] SEC-01: listServers returns only per-envKey hasValue flags, never plaintext or ciphertext
- [ ] ACC-02: deleteServer computes consumersOfMcp, deletes all its assignments, and invokes the injected rewrite hook exactly once with the affected consumer ids; deleting an MCP with zero consumers still succeeds without hook error
- [ ] gate: pnpm test:unit passes with >=11 new service tests

**Commit**: `feat(mcp-servers): add servers service with encryption and cascade delete`

---

#### T19: Consumers service (manual register, token, client formats, token lookup) [P]

**What**: Business service over consumers repo: registerManualProject (validate path exists+writable, persist type 'project', generate token), registerDesktopProfile, rotateToken (new base64url bearer), setClientFormats, getByToken (delegate to repo, backs token-context middleware), listConsumers.  
**Where**: `src/domain/consumers/consumers-service.ts`, `src/domain/consumers/consumers-service.test.ts`, `src/domain/consumers/token-generator.ts`  
**Depends on**: T16  
**Reuses**: src/domain/consumers/consumers-repository.ts (incl getByToken)  
**Requirement**: PRJ-02, PRJ-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] PRJ-02: registerManualProject with an existing writable path persists a consumer of type 'project' (discovered=false, available=true) with a base64url token
- [ ] PRJ-03 (registration half): registerManualProject rejects a nonexistent path and a non-writable path by throwing, persisting nothing
- [ ] rotateToken replaces the token with a new base64url value distinct from the previous one and persists it
- [ ] setClientFormats persists exactly the provided clientFormats array
- [ ] getByToken(token) delegates to the repository and returns the consumer, or null when no consumer holds that token (backs token-context middleware T28 and rotate-token verification T44)
- [ ] gate: pnpm test:unit passes with >=9 new service tests

**Commit**: `feat(consumers): add consumers service with manual registration and token rotation`

---

#### T20: Assignments service (validated assign/unassign) [P]

**What**: Thin service over assignments repo that validates both entities exist before assigning: assign, unassign, allowedMcpIds, consumersOfMcp.  
**Where**: `src/domain/assignments/assignments-service.ts`, `src/domain/assignments/assignments-service.test.ts`  
**Depends on**: T15, T16, T17  
**Reuses**: src/domain/assignments/assignments-repository.ts, src/domain/mcp-servers/mcp-servers-repository.ts, src/domain/consumers/consumers-repository.ts  
**Requirement**: ACC-01  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] ACC-01: assign throws when the consumer or the mcp server does not exist, and persists the assignment when both exist
- [ ] ACC-01: unassign removes the assignment and is a no-op (no throw) when it was not assigned
- [ ] allowedMcpIds and consumersOfMcp delegate to the repository and return its results unchanged
- [ ] gate: pnpm test:unit passes with >=7 new service tests

**Commit**: `feat(assignments): add assignments service with existence validation`

---

#### T21: Workspace auto-discovery + reconcile [P]

**What**: scanWorkspace(rootPath): list immediate subdirs of the mounted root, upsert each as a discovered 'project' consumer, mark consumers whose folder vanished as available=false WITHOUT deleting their assignments, and restore available=true when a folder reappears.  
**Where**: `src/domain/discovery/workspace-scan.ts`, `src/domain/discovery/workspace-scan.test.ts`  
**Depends on**: T5, T16  
**Reuses**: src/domain/consumers/consumers-repository.ts, src/config/env.ts  
**Requirement**: PRJ-01, PRJ-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] PRJ-01: scanWorkspace upserts exactly one 'project' consumer (discovered=true) per immediate subdirectory of the root
- [ ] PRJ-01 (edge): plain files and second-level nested directories are NOT registered as consumers
- [ ] PRJ-03 (reconcile half): a previously-discovered consumer whose folder no longer exists is set available=false and its assignment rows are left intact (not deleted)
- [ ] a folder that reappears on a later scan is set back available=true; a repeat scan on an unchanged tree produces no state change (idempotent)
- [ ] gate: pnpm test:unit passes with >=8 new discovery tests

**Commit**: `feat(discovery): add workspace scan with reconcile keeping assignments`

---

### Phase 4: Live Gateway

#### T22: SPIKE: confirm per-consumer token readable in MCP handler scope

**What**: Prove that req.params.token from POST /mcp/:token is readable inside a per-session MCP Server's ListTools/CallTool handler scope, resolving the transport-timing RISK.  
**Where**: `test/integration/spike-token-handler-scope.test.ts`  
**Depends on**: T4  
**Reuses**: @modelcontextprotocol/sdk (Server, StreamableHTTPServerTransport, Client, StreamableHTTPClientTransport)  
**Requirement**: — (infra)  
**Tools**: MCP `context7` · Skill `mcp-builder`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] test/integration/spike-token-handler-scope.test.ts created
- [ ] Test mounts Express POST /mcp/:token with StreamableHTTPServerTransport + a per-session McpServer whose ListTools handler returns a tool whose name equals the :token value captured via middleware/closure before transport handling
- [ ] An MCP Client over StreamableHTTPClientTransport calls listTools and assertion confirms returned tool name == token passed in the URL (token IS readable in handler scope)
- [ ] Chosen approach recorded as an explanatory code comment: resolve token in middleware, capture in per-session handler closure
- [ ] gate: pnpm test:unit && pnpm test:integration exits 0; 1 new spike test green

**Commit**: `test(gateway): spike proving token readable in per-session MCP handler scope`

---

#### T23: Dummy stdio MCP fixture for gateway integration tests [P]

**What**: Create a minimal runnable MCP server over stdio exposing known tools and echoing an injected env secret, reusable by upstream-client/registry/router integration tests.  
**Where**: `test/fixtures/dummy-stdio-mcp.ts`  
**Depends on**: T4  
**Reuses**: @modelcontextprotocol/sdk Server + StdioServerTransport  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `mcp-builder`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] test/fixtures/dummy-stdio-mcp.ts created: MCP Server over StdioServerTransport exposing >=2 tools (e.g. echo, ping)
- [ ] Fixture reads env var FIXTURE_SECRET and exposes it via a tool result so secret env-injection can be asserted downstream
- [ ] Fixture is launchable as a child process (has an executable entry/main) and is included in the tsc/test typecheck path
- [ ] gate: pnpm build && pnpm lint && pnpm test exits 0 (fixture type-checks and lints; no new test count required)

**Commit**: `test(gateway): add dummy stdio MCP fixture with env-secret echo`

---

#### T24: Dummy remote (Streamable HTTP) MCP fixture with header capture + fail mode [P]

**What**: Create a minimal in-process HTTP MCP server exposing a tool, capturing received Authorization/headers, and supporting a fail mode to simulate an unavailable upstream for isolation tests.  
**Where**: `test/fixtures/dummy-remote-mcp.ts`  
**Depends on**: T4  
**Reuses**: @modelcontextprotocol/sdk Server + StreamableHTTPServerTransport; Express  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `mcp-builder`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] test/fixtures/dummy-remote-mcp.ts created: exports start(options) that launches Express + StreamableHTTPServerTransport MCP Server and returns { url, close }
- [ ] Fixture records received request headers (so injected Authorization header can be asserted) and exposes >=1 tool
- [ ] Fixture supports a failMode flag that makes it reject/hang connections to simulate a broken upstream
- [ ] gate: pnpm build && pnpm lint && pnpm test exits 0 (fixture type-checks and lints; no new test count required)

**Commit**: `test(gateway): add dummy remote MCP fixture with header capture and fail mode`

---

#### T25: upstream-client: connect one Client to a stdio or remote upstream

**What**: Implement connectUpstream(mcpServer, decryptedSecrets) building StdioClientTransport (spawn child, inject decrypted secrets as env) for stdio and StreamableHTTPClientTransport (url + Authorization/custom headers) for remote.  
**Where**: `src/gateway/upstream-client.ts`, `test/integration/upstream-client.test.ts`  
**Depends on**: T18, T23, T24  
**Reuses**: test/fixtures/dummy-stdio-mcp.ts, test/fixtures/dummy-remote-mcp.ts; decrypted secrets supplied by upstream-config-resolver (T54) in production; @modelcontextprotocol/sdk Client  
**Requirement**: GW-02, GW-03  
**Tools**: MCP `context7` · Skill `mcp-builder`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] src/gateway/upstream-client.ts created: connectUpstream selects StdioClientTransport for transport 'stdio' (command/args, decryptedSecrets merged into child env) and StreamableHTTPClientTransport for transport 'http' (url, headers incl Authorization)
- [ ] Integration test: connect to dummy-stdio fixture -> Client.listTools() returns the fixture's tools (stdio MCP run in-process and proxied) = GW-02
- [ ] Integration test: a decrypted secret passed in is present in the spawned child env and echoed back by the fixture tool = GW-02 secret injection
- [ ] Integration test: connect to dummy-remote fixture -> listTools() succeeds AND the fixture recorded the injected Authorization header = GW-03 remote proxied
- [ ] gate: pnpm test:unit && pnpm test:integration exits 0; >=3 new integration tests green

**Commit**: `feat(gateway): connect upstream Client for stdio (env secrets) and remote (headers)`

---

#### T54: Gateway upstream config resolver (decrypt secrets for connection) [P]

**What**: Add src/gateway/upstream-config-resolver.ts exporting resolveUpstreamConfig(mcpServerId) that loads the McpServer row via mcp-servers-repository.getServer and its sealed secret rows via listSealedSecrets, decrypts each sealed secret via vault.openSecret using the master key from env, and returns { mcpServer, decryptedSecretsEnv } ready to hand to connectUpstream; plus co-located unit tests with a stubbed repo + vault. This is the production secret-injection source the registry (T26) uses.  
**Where**: `src/gateway/upstream-config-resolver.ts`, `src/gateway/upstream-config-resolver.test.ts`  
**Depends on**: T5, T13, T15  
**Reuses**: src/domain/mcp-servers/mcp-servers-repository.ts (getServer, listSealedSecrets from T15), src/vault/secret-vault.ts (openSecret from T13), src/config/env.ts master key (T5)  
**Requirement**: GW-02  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/gateway/upstream-config-resolver.ts created: resolveUpstreamConfig(mcpServerId) returns the McpServer metadata (id, slug, transport, command, args, url, headers) plus decryptedSecretsEnv, a map { envKey: plaintext } produced by vault.openSecret over the server's sealed secret rows = GW-02 secret env source
- [ ] throws a clear error when the mcpServerId has no server row
- [ ] a server with zero sealed secrets resolves to an empty decryptedSecretsEnv map (no throw)
- [ ] decryption happens only in-memory for the returned map; no plaintext secret is logged or persisted
- [ ] unit tests (>=3) with stubbed repo + vault assert: envKey->plaintext map built from the sealed rows (injection source); unknown id throws; zero-secret server -> empty map
- [ ] gate: pnpm test:unit green; >=3 new resolver tests pass

**Commit**: `feat(gateway): add upstream config resolver decrypting secrets for connection`

---

#### T26: upstream-registry: lazy connect, cache, status, restart, isolated failure

**What**: Implement a registry that lazily resolves each mcpServerId to its config + decrypted secrets via the upstream-config-resolver, connects and caches one Client per mcpServerId (exposing the server's slug metadata alongside the client), tracks status starting|running|error|stopped, supports restart/shutdown, and isolates a failing upstream so others stay healthy.  
**Where**: `src/gateway/upstream-registry.ts`, `test/integration/upstream-registry.test.ts`  
**Depends on**: T23, T25, T54  
**Reuses**: src/gateway/upstream-config-resolver.ts (T54), src/gateway/upstream-client.ts (T25), test/fixtures/dummy-stdio-mcp.ts, test/fixtures/dummy-remote-mcp.ts  
**Requirement**: GW-02, GW-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] src/gateway/upstream-registry.ts created: getClient(mcpServerId) resolves server config + decrypted secrets via upstream-config-resolver (T54) then lazy-connects via connectUpstream (T25) and caches; each cache entry exposes the mcpServer metadata (id, slug, transport) alongside the client; status(id) returns starting|running|error|stopped; restart(id) and shutdown(id|all) implemented
- [ ] Integration test: first getClient connects and caches; second getClient reuses cached client (no second spawn)
- [ ] Integration test: status transitions to 'running' after a successful connect
- [ ] Integration test: a stdio upstream built through the registry receives its decrypted secret in the child process env (resolver -> connectUpstream injection) and the fixture echoes it back = GW-02 production secret injection
- [ ] Integration test: a failing upstream (bad command / fixture failMode) -> status 'error' and reported unavailable, WITHOUT throwing to or preventing a second healthy upstream from reaching 'running' = GW-03 isolated failure
- [ ] Integration test: restart(id) re-establishes the connection (status back to 'running'); shutdown -> status 'stopped'
- [ ] gate: pnpm test:unit && pnpm test:integration exits 0; >=5 new integration tests green

**Commit**: `feat(gateway): upstream registry with lazy connect, status, restart, isolated failure`

---

#### T27: tool-aggregator: aggregate + prefix + route tools for a scoped mcpId set [P]

**What**: Implement aggregateTools(mcpIds) that lists tools per allowed upstream and prefixes names <slug>__<tool>, and routeToolCall(name,args) that strips the prefix and dispatches to the correct upstream, skipping failing upstreams. Slug and slug->mcpId mapping come from the registry entry metadata (no direct DB call).  
**Where**: `src/gateway/tool-aggregator.ts`, `src/gateway/tool-aggregator.test.ts`  
**Depends on**: T26  
**Reuses**: src/gateway/upstream-registry.ts (interface incl per-entry mcpServer slug metadata from T26; stubbed in unit tests supply slug)  
**Requirement**: GW-01, GW-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/gateway/tool-aggregator.ts created: aggregateTools(mcpIds) returns tools ONLY for the given mcpIds with names prefixed `<slug>__<tool>`; routeToolCall(prefixedName,args) resolves slug->mcpId, strips prefix, calls upstream tools/call
- [ ] the `<slug>` used for prefixing and the slug->mcpId reverse map used for routing are sourced from the registry entry's mcpServer metadata (T26), not a separate DB/repo call
- [ ] Unit test: aggregate returns tools only for the supplied mcpIds and excludes any other server's tools = GW-01 scoping
- [ ] Unit test: every returned tool name is prefixed `<slug>__<tool>`
- [ ] Unit test: name-collision across servers is disambiguated (two servers exposing `search` -> `a__search` and `b__search`, both present and distinct)
- [ ] Unit test: routeToolCall strips the prefix and dispatches to the correct upstream client; a prefixed name outside the scoped set is rejected (not routed)
- [ ] Unit test: an upstream whose listTools throws is skipped and remaining servers are still aggregated = GW-03 isolation
- [ ] gate: pnpm test:unit exits 0; >=5 new unit tests green
- [ ] Uses a stubbed registry/client (no real spawn) so tests are parallel-safe

**Commit**: `feat(gateway): scoped tool aggregator with slug prefixing and call routing`

---

#### T28: token-context middleware: token -> consumer -> allowedMcpIds (401 on unknown) [P]

**What**: Implement Express middleware that resolves req.params.token to a consumer (via consumers-service.getByToken) and its allowedMcpIds (via assignments-service), attaches them to the request, and returns 401 with no tools for unknown/disabled tokens.  
**Where**: `src/gateway/token-context.ts`, `src/gateway/token-context.test.ts`  
**Depends on**: T19, T20, T22  
**Reuses**: consumers-service.getByToken (T19) for token->consumer lookup, assignments-service.allowedMcpIds (T20); spike-confirmed middleware-before-transport approach (T22)  
**Requirement**: SEC-02, GW-01  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/gateway/token-context.ts created: middleware looks up consumer by req.params.token (getByToken), attaches req.consumer + req.allowedMcpIds (from assignments.allowedMcpIds), else responds 401 and does not call next()
- [ ] Unit test: valid token -> req.consumer set and req.allowedMcpIds equals the consumer's assigned mcpIds, next() called
- [ ] Unit test: unknown token -> HTTP 401, next() NOT called, no tools/scope attached = SEC-02
- [ ] Unit test: disabled/not-enabled consumer token -> HTTP 401 = SEC-02
- [ ] Unit test: consumer with zero assignments -> req.allowedMcpIds is an empty array and next() called (empty scope, not 401)
- [ ] gate: pnpm test:unit exits 0; >=3 new unit tests green
- [ ] Consumers/assignments services are injected/stubbed so tests are parallel-safe

**Commit**: `feat(gateway): token-context middleware resolving consumer scope with 401 on unknown token`

---

#### T29: gateway-router: POST /mcp/:token Streamable HTTP per-session scoped Server

**What**: Implement the Express router POST /mcp/:token using token-context middleware and a per-session StreamableHTTPServerTransport + MCP Server whose ListTools/CallTool delegate to a tool-aggregator scoped to req.allowedMcpIds via the upstream-registry.  
**Where**: `src/gateway/gateway-router.ts`, `test/integration/gateway-router.test.ts`  
**Depends on**: T23, T24, T25, T26, T27, T28  
**Reuses**: src/gateway/token-context.ts, src/gateway/tool-aggregator.ts, src/gateway/upstream-registry.ts, test/fixtures/dummy-stdio-mcp.ts, test/fixtures/dummy-remote-mcp.ts  
**Requirement**: GW-01, GW-02, SEC-02, GW-03  
**Tools**: MCP `context7` · Skill `mcp-builder`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] src/gateway/gateway-router.ts created: POST /mcp/:token runs token-context first, then builds a per-session StreamableHTTPServerTransport + MCP Server whose ListTools/CallTool call a tool-aggregator scoped to req.allowedMcpIds
- [ ] Integration test: consumer A (assigned MCP X) -> MCP client over /mcp/:tokenA listTools returns ONLY X's prefixed tools = GW-01
- [ ] Integration test: consumer B (NOT assigned X) -> listTools over /mcp/:tokenB does not include X's tools = GW-01 scoping
- [ ] Integration test: tools/call on a prefixed tool proxies to the stdio upstream fixture and returns its result = GW-02 end-to-end
- [ ] Integration test: unknown token -> HTTP 401, no MCP session established, no tools exposed = SEC-02
- [ ] Integration test: with two assigned MCPs where one is in failMode (dummy-remote fixture), its tools are absent/reported unavailable while the healthy MCP's tools are still served = GW-03 isolated failure
- [ ] gate: pnpm test:unit && pnpm test:integration exits 0; >=4 new integration tests green

**Commit**: `feat(gateway): Streamable HTTP gateway router with per-consumer scoped MCP server`

---

### Phase 5: Config Writers

#### T30: ConfigWriter interface + result/entry types [P]

**What**: Define the ConfigWriter contract and shared types (WriteConfigResult, ManagedEntry) that every config writer and the rewrite orchestrator depend on.  
**Where**: `src/config-writers/writer-interface.ts`  
**Depends on**: T4  
**Reuses**: none (foundation contract for phase 5)  
**Requirement**: — (infra)  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] src/config-writers/writer-interface.ts exports ConfigWriter interface (writeConfig(consumer, gatewayBaseUrl, hasAssignments) => Promise<WriteConfigResult>) plus WriteConfigResult{consumerId,format,path,status:'written'|'unchanged'|'removed'|'error',error?} and ManagedEntry types
- [ ] pnpm build (tsc) exits 0 with no type errors
- [ ] pnpm lint reports no errors on the new file
- [ ] gate build: pnpm build && pnpm lint && pnpm test all green (no new tests added by this task)

**Commit**: `feat(config-writers): add ConfigWriter interface and result types`

---

#### T31: Idempotent managed-block merge for config files [P]

**What**: Implement the marked/managed merge helper that upserts and removes our managed entries inside a parsed mcpServers config while preserving all non-managed (user) entries, with deterministic output for idempotency.  
**Where**: `src/config-writers/managed-block.ts`, `src/config-writers/managed-block.test.ts`  
**Depends on**: T4  
**Reuses**: none  
**Requirement**: CFG-02  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/config-writers/managed-block.ts exports mergeManagedEntries(existingConfig, managedEntries) and removeManagedEntries(existingConfig) operating on the parsed mcpServers map with a stable managed-key identifier and deterministic key ordering on output
- [ ] src/config-writers/managed-block.test.ts has >=5 unit tests: (1) merge into empty config, (2) merge preserves existing user entries untouched, (3) re-merging identical input yields byte-identical serialized output (idempotent), (4) remove-when-managed-set-empty preserves user entries (cleanup), (5) deterministic key ordering across runs
- [ ] gate quick: pnpm test:unit passes with >=5 new managed-block tests green and 0 failures

**Commit**: `feat(config-writers): add idempotent managed-block merge for config files`

---

#### T32: Claude Code .mcp.json writer [P]

**What**: Implement the Claude Code ConfigWriter that writes a single managed remote entry (type:http, gateway url, Authorization bearer) to the project's .mcp.json, cleans it up at 0 assignments, skips write when unchanged, and returns an error result instead of throwing on IO failure.  
**Where**: `src/config-writers/claude-code-writer.ts`, `src/config-writers/claude-code-writer.test.ts`  
**Depends on**: T16, T30, T31  
**Reuses**: managed-block merge/remove from T31; ConfigWriter + WriteConfigResult types from T30; Consumer type from consumers domain  
**Requirement**: CFG-01, CFG-02  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/config-writers/claude-code-writer.ts implements ConfigWriter: writes entry {type:'http', url:`${gatewayBaseUrl}/mcp/${consumer.token}`, headers:{Authorization:`Bearer ${consumer.token}`}} into `${consumer.path}/.mcp.json` via managed-block
- [ ] hasAssignments=false removes the managed entry (cleanup); serialized content identical to on-disk => no file write and status:'unchanged' (idempotent); IO/write error => returns status:'error' with message and does NOT throw
- [ ] src/config-writers/claude-code-writer.test.ts has >=5 unit tests using a temp dir: (1) CFG-01 entry shape/path correct, (2) CFG-02 idempotent second write does not rewrite file, (3) CFG-02 0-assignments removes managed entry, (4) unrelated existing .mcp.json entries preserved, (5) unwritable path => status:'error', no throw
- [ ] gate quick: pnpm test:unit passes with >=5 new writer tests green and 0 failures

**Commit**: `feat(config-writers): add Claude Code .mcp.json writer`

---

#### T33: Multi-consumer config rewrite orchestrator [P]

**What**: Implement the orchestrator that rewrites configs for a set of consumers, resolving each consumer's allowed MCP ids and client formats, dispatching to the matching writer(s), and isolating per-consumer failures into an aggregated report.  
**Where**: `src/config-writers/config-rewrite-service.ts`, `src/config-writers/config-rewrite-service.test.ts`  
**Depends on**: T19, T20, T30, T32  
**Reuses**: claude-code-writer from T32; ConfigWriter/WriteConfigResult types from T30; allowedMcpIds from assignments domain, consumer token/path/clientFormats from consumers domain  
**Requirement**: CFG-02  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/config-writers/config-rewrite-service.ts exports rewriteConfigsForConsumers(consumerIds) => Promise<WriteConfigResult[]> that per consumer resolves allowedMcpIds + clientFormats, dispatches to the matching writer(s), and wraps each in try/catch so one failure never aborts the others
- [ ] each returned result reports status written|unchanged|removed|error keyed to its consumer/format
- [ ] src/config-writers/config-rewrite-service.test.ts has >=4 unit tests: (1) all consumers succeed, (2) one consumer write throws => that result status:'error' while others still 'written' (isolation), (3) consumer with 0 assignments => status:'removed', (4) report contains one entry per consumer/format with correct consumerId
- [ ] gate quick: pnpm test:unit passes with >=4 new orchestrator tests green and 0 failures

**Commit**: `feat(config-writers): add multi-consumer config rewrite orchestrator`

---

#### T34: Wire config rewrite on MCP delete (ACC-02)

**What**: Wire the rewrite orchestrator into the mcp-servers delete flow so deleting an MCP captures its assigned consumers before cascade, then rewrites their configs after assignments are removed; verify end-to-end.  
**Where**: `src/domain/mcp-servers/mcp-servers-service.ts`, `test/integration/config-rewrite-on-delete.test.ts`  
**Depends on**: T18, T20, T33  
**Reuses**: rewriteConfigsForConsumers from T33; consumersOfMcp from assignments domain; delete/cascade from mcp-servers domain  
**Requirement**: ACC-02  
**Tools**: MCP `NONE` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] mcp-servers delete service captures consumersOfMcp(mcpId) BEFORE cascading assignment deletion, then calls rewriteConfigsForConsumers on exactly those consumer ids after the cascade
- [ ] test/integration/config-rewrite-on-delete.test.ts has >=2 tests: (1) delete an MCP assigned to a project consumer (temp path) => that project's .mcp.json managed entry removed when it is left with 0 assignments, (2) delete an MCP for a project that still has other assigned MCPs => managed entry rewritten and retained
- [ ] gate full: pnpm test:unit && pnpm test:integration passes with >=2 new integration tests green and 0 failures

**Commit**: `feat(mcp-servers): rewrite consumer configs on MCP delete`

---

### Phase 6: API & Web UI

#### T55: API error-handling middleware with status-code mapping (unit tests) [P]

**What**: Create src/api/error-middleware.ts: the shared AppError classes (ValidationError, NotFoundError, ConflictError, each carrying an HTTP status) plus the Express error-handling middleware that maps them to 400/404/409 and any other error to 500, serializing {error:message} JSON (never a stack trace or secret), with co-located unit tests asserting each branch. Extracted from the former T36 bundle so the branching status-code mapping has its own dedicated tests.  
**Where**: `src/api/error-middleware.ts`, `src/api/error-middleware.test.ts`  
**Depends on**: T4  
**Reuses**: none; AppError classes consumed by all Phase 6 route handlers (T37..T46) and wired into the app by create-app (T36)  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: unit · **Gate**: quick

**Done when**:
- [ ] src/api/error-middleware.ts exports an Express error-handling middleware plus AppError subclasses ValidationError, NotFoundError, ConflictError (each carrying its HTTP status)
- [ ] middleware maps ValidationError->400, NotFoundError->404, ConflictError->409, and any other/unknown thrown error->500, serializing {error: message} JSON
- [ ] middleware never leaks a stack trace or a secret value in the response body
- [ ] unit tests (>=5) assert each mapping: 400 (ValidationError), 404 (NotFoundError), 409 (ConflictError), 500 (generic Error fallback), and that the JSON body is {error} carrying the message (not the stack)
- [ ] gate: pnpm test:unit green; >=5 new middleware tests pass

**Commit**: `feat(api): add error-handling middleware with status-code mapping`

---

#### T36: API app factory + router aggregator + static SPA + integration harness

**What**: Create the single canonical Express app-assembly path: create-app.ts (express.json, mount the api router under /api, serve the built web/dist as static SPA with index fallback, mount the T55 error-middleware LAST), router.ts (router aggregator extended by later route tasks), a GET /api/health route, and a reusable integration harness build-test-app.ts that boots the app against a temp SQLite DB. Both the production server (T56) and the tests consume create-app so there is no duplicate app construction.  
**Where**: `src/api/create-app.ts`, `src/api/router.ts`, `src/api/health-route.ts`, `test/integration/helpers/build-test-app.ts`, `test/integration/health.test.ts`  
**Depends on**: T12, T7, T55  
**Reuses**: src/db/connection.ts + migrate.ts; single web scaffold + web/dist from T7 (static serving); error-middleware + AppError classes from T55  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] create-app.ts assembles the app: express.json(), mounts the api router under /api, serves web/dist as static SPA with index fallback, and mounts the T55 error-middleware LAST — this is the single canonical app-assembly path reused by the production server (T56) and the test harness
- [ ] router.ts aggregates sub-routers (initially health; extended in place by later route tasks) under /api
- [ ] GET /api/health returns 200 {status:'ok'}
- [ ] build-test-app.ts creates an Express app via create-app bound to a per-test temp SQLite file, runs migrations, and returns a supertest-ready handle
- [ ] 1 new integration test passes (health smoke)
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): app factory, router, static SPA, health route + integration harness`

---

#### T37: mcp-servers-routes: POST create + PUT update

**What**: Add POST /api/mcp-servers (create stdio or remote) and PUT /api/mcp-servers/:id, delegating to the mcp-servers service so marked secrets are encrypted before persist; register router in router.ts.  
**Where**: `src/api/mcp-servers-routes.ts`, `src/api/router.ts`, `test/integration/mcp-servers-create.test.ts`  
**Depends on**: T18, T36  
**Reuses**: src/domain/mcp-servers service + src/vault/secret-vault.ts; AppError classes from T55 for 400/409 mapping  
**Requirement**: MCP-01, MCP-02, MCP-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] POST stdio MCP -> 201; response omits secret plaintext; secret row sealed (MCP-01)
- [ ] POST remote MCP with url -> 201, transport='http'/'remote' persisted (MCP-02)
- [ ] POST duplicate name -> 409; POST missing name -> 400; stdio missing command -> 400; remote missing url -> 400 (MCP-03)
- [ ] PUT update re-seals changed secret and returns hasValue flag (no plaintext)
- [ ] >=7 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): mcp-servers create and update endpoints`

---

#### T38: mcp-servers-routes: GET list + GET :id (no plaintext)

**What**: Add GET /api/mcp-servers (list) and GET /api/mcp-servers/:id returning each server with secret status as hasValue booleans only, never plaintext ciphertext/iv/tag.  
**Where**: `src/api/mcp-servers-routes.ts`, `test/integration/mcp-servers-read.test.ts`  
**Depends on**: T36, T37  
**Reuses**: src/domain/mcp-servers service (list)  
**Requirement**: SEC-01  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] GET list returns array; each secret represented as {envKey, hasValue:true} with NO iv/tag/ciphertext/plaintext (SEC-01)
- [ ] GET :id returns single server with same no-plaintext guarantee
- [ ] GET :id unknown -> 404
- [ ] >=3 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): mcp-servers list and detail endpoints without secret plaintext`

---

#### T39: mcp-servers-routes: DELETE :id (cascade + config rewrite)

**What**: Add DELETE /api/mcp-servers/:id that removes the server, cascades its assignments, and triggers config rewrite for every affected consumer/project.  
**Where**: `src/api/mcp-servers-routes.ts`, `test/integration/mcp-servers-delete.test.ts`  
**Depends on**: T34, T36, T37  
**Reuses**: src/domain/mcp-servers service (delete), src/config-writers writer-interface, ACC-02 delete wiring from T34  
**Requirement**: ACC-02  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] DELETE existing MCP -> 200/204; server row gone
- [ ] all Assignment rows for that MCP removed (ACC-02)
- [ ] config rewrite invoked for each affected project (assert writer called / file no longer lists that MCP) (ACC-02)
- [ ] DELETE unknown id -> 404
- [ ] >=4 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): mcp-servers delete cascades assignments and rewrites configs`

---

#### T40: consumers-routes: GET list + POST discover (rescan)

**What**: Add GET /api/consumers (discovered + manual) and POST /api/consumers/discover that runs the workspace scan and reconciles vanished folders.  
**Where**: `src/api/consumers-routes.ts`, `src/api/router.ts`, `test/integration/consumers-list-discover.test.ts`  
**Depends on**: T19, T21, T36  
**Reuses**: src/domain/consumers service + src/domain/discovery/workspace-scan.ts  
**Requirement**: PRJ-01, PRJ-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] POST discover lists each immediate subdir of mounted root as a discovered project (discovered=true) (PRJ-01)
- [ ] GET list returns both discovered and manually-registered consumers
- [ ] a previously-discovered folder now missing -> available=false, its Assignment rows preserved (PRJ-03)
- [ ] >=4 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): consumers list and discovery rescan endpoints`

---

#### T41: consumers-routes: POST register manual project + desktop profile

**What**: Add POST /api/consumers/project (manual path registration) and POST /api/consumers/desktop-profile, validating the path exists and is writable.  
**Where**: `src/api/consumers-routes.ts`, `test/integration/consumers-register.test.ts`  
**Depends on**: T19, T36, T40  
**Reuses**: src/domain/consumers service (registerManualProject/registerDesktopProfile)  
**Requirement**: PRJ-02, PRJ-03  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] POST project with existing writable path -> 201 consumer persisted (PRJ-02)
- [ ] POST project with nonexistent path -> 400; non-writable path -> 400 (PRJ-03)
- [ ] POST desktop-profile -> 201 with type='desktop-profile' and token issued
- [ ] >=4 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): consumer manual project and desktop profile registration`

---

#### T42: assignments-routes: assign / unassign / matrix

**What**: Add POST /api/assignments (assign), DELETE /api/assignments (unassign), and GET /api/assignments (matrix of consumer<->mcp) delegating to the assignments service.  
**Where**: `src/api/assignments-routes.ts`, `src/api/router.ts`, `test/integration/assignments.test.ts`  
**Depends on**: T20, T36  
**Reuses**: src/domain/assignments service  
**Requirement**: ACC-01  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] POST assign persists Assignment row -> 201 (ACC-01)
- [ ] DELETE unassign removes the row -> 200/204 (ACC-01)
- [ ] GET matrix returns allowedMcpIds per consumer / consumersOfMcp per MCP consistent with DB
- [ ] duplicate assign is idempotent (no duplicate row, no 500)
- [ ] >=4 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): assignment assign, unassign and matrix endpoints`

---

#### T43: actions-routes: POST write-configs

**What**: Add POST /api/actions/write-configs that writes each assigned project's config (.mcp.json) pointing at its per-consumer gateway URL, idempotently, isolating per-project failures.  
**Where**: `src/api/actions-routes.ts`, `src/api/router.ts`, `test/integration/actions-write-configs.test.ts`  
**Depends on**: T19, T33, T36, T42  
**Reuses**: src/config-writers/claude-code-writer.ts + managed-block.ts + config-rewrite-service.ts, assignments + consumers services  
**Requirement**: CFG-01, CFG-02  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] writes .mcp.json at project root with type:http entry + gateway URL for that consumer (CFG-01)
- [ ] second identical write produces byte-identical file (no mtime/content change) (CFG-02)
- [ ] one project's write failure is isolated and reported in response; others still written (CFG-02)
- [ ] project with 0 assignments -> our managed gateway entry removed/cleaned (CFG-02)
- [ ] >=4 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): write-configs action endpoint with idempotent per-project isolation`

---

#### T44: actions-routes: POST rotate-token

**What**: Add POST /api/actions/rotate-token that rotates a consumer's bearer token and rewrites that consumer's config to the new tokenized URL.  
**Where**: `src/api/actions-routes.ts`, `test/integration/actions-rotate-token.test.ts`  
**Depends on**: T19, T33, T36, T43  
**Reuses**: src/domain/consumers service (rotateToken + getByToken), config-writers  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] rotate returns a new token distinct from the old one, persisted on the consumer
- [ ] old token no longer resolves (verified via consumers-service.getByToken returning null for the old token)
- [ ] affected config rewritten to embed the new token URL
- [ ] >=3 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): rotate-token action endpoint`

---

#### T45: actions-routes: GET status (per-MCP upstream status for ALL registered MCPs)

**What**: Add GET /api/actions/status that enumerates EVERY registered MCP via mcp-servers-service.listServers and maps each to its upstream health from the registry (starting|running|error|stopped), defaulting an MCP the registry has not lazily connected to 'stopped' so no MCP is ever omitted and failing/unconnected upstreams surface as unavailable.  
**Where**: `src/api/actions-routes.ts`, `test/integration/actions-status.test.ts`  
**Depends on**: T18, T26, T36, T43  
**Reuses**: src/domain/mcp-servers service (listServers = full catalog enumeration), src/gateway/upstream-registry.ts status  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] GET status returns one {mcpId, status} entry for EVERY registered MCP (enumerated via mcp-servers listServers), not only ids the lazy registry has already connected
- [ ] an MCP the registry has never connected is reported status='stopped' (default), never omitted from the response
- [ ] an MCP whose upstream connect failed is reported status='error'/unavailable (not omitted, not crashing the response)
- [ ] >=3 new integration tests pass (all registered MCPs enumerated incl a never-connected one -> stopped; a failed upstream -> error; a connected upstream -> running)
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): per-mcp status action endpoint enumerating all registered mcps`

---

#### T46: actions-routes: GET preview (config preview, no write)

**What**: Add GET /api/actions/preview?consumerId= that returns the config file content that WOULD be written, without touching the filesystem.  
**Where**: `src/api/actions-routes.ts`, `test/integration/actions-preview.test.ts`  
**Depends on**: T19, T32, T36, T43  
**Reuses**: src/config-writers/claude-code-writer.ts (render-only path)  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `NONE`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] GET preview returns the rendered managed-block config content for the consumer
- [ ] no file is created or modified on disk during preview (assert target path absent/unchanged)
- [ ] >=2 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(api): config preview action endpoint`

---

#### T47: Web API client (typed fetch wrappers)

**What**: Create web/src/api-client.ts with typed fetch wrappers for mcp-servers, consumers, assignments, and actions endpoints, plus shared response types. Authored after the routes exist (P6 ordering) for contract fidelity.  
**Where**: `web/src/api-client.ts`, `web/src/api-types.ts`  
**Depends on**: T7  
**Reuses**: single web scaffold from T7; endpoint shapes from T37..T46 (contract-typed; ordered after routes in this phase)  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] api-client exposes typed functions for list/create/update/delete MCP, list/register/discover consumers, assign/unassign, write-configs/rotate-token/status/preview
- [ ] `pnpm build` compiles web with 0 type errors; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged

**Commit**: `feat(web): typed api client and response types`

---

#### T48: Web: MCP create/edit form component [P]

**What**: Build web/src/components/mcp-form.tsx: create/edit an MCP (transport toggle stdio/remote, command/args or url/headers, marked secret env fields) posting via api-client.  
**Where**: `web/src/components/mcp-form.tsx`  
**Depends on**: T47  
**Reuses**: web/src/api-client.ts  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] form renders stdio vs remote field sets conditionally on transport
- [ ] submit calls api-client create/update; edit mode shows hasValue for existing secrets (never plaintext)
- [ ] `pnpm build` compiles; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged

**Commit**: `feat(web): mcp create/edit form component`

---

#### T49: Web: projects/consumers list component [P]

**What**: Build web/src/components/consumers-list.tsx showing discovered + manual consumers with available/enabled state and a rescan/register action.  
**Where**: `web/src/components/consumers-list.tsx`  
**Depends on**: T47  
**Reuses**: web/src/api-client.ts  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] list renders consumers with type, path, available/enabled badges
- [ ] rescan button calls discover; register action calls manual project registration
- [ ] `pnpm build` compiles; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged

**Commit**: `feat(web): consumers/projects list component`

---

#### T50: Web: MCP<->consumer assignment matrix component [P]

**What**: Build web/src/components/assignment-matrix.tsx: a grid of consumers x MCPs with checkboxes that assign/unassign via api-client.  
**Where**: `web/src/components/assignment-matrix.tsx`  
**Depends on**: T47  
**Reuses**: web/src/api-client.ts  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] matrix renders rows=consumers, cols=MCPs, checked cells reflect current assignments
- [ ] toggling a cell calls assign/unassign and reflects the new state
- [ ] `pnpm build` compiles; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged

**Commit**: `feat(web): mcp-consumer assignment matrix component`

---

#### T51: Web: write-configs button component [P]

**What**: Build web/src/components/write-configs-button.tsx that triggers POST write-configs and renders the per-project success/failure result.  
**Where**: `web/src/components/write-configs-button.tsx`  
**Depends on**: T47  
**Reuses**: web/src/api-client.ts  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] button calls write-configs and renders per-project results (written / failed with reason)
- [ ] `pnpm build` compiles; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged

**Commit**: `feat(web): write-configs button component`

---

#### T52: Web: per-MCP status component [P]

**What**: Build web/src/components/mcp-status.tsx polling GET status and rendering each MCP's upstream health (running/error/stopped/starting).  
**Where**: `web/src/components/mcp-status.tsx`  
**Depends on**: T47  
**Reuses**: web/src/api-client.ts  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] component fetches status and renders a health badge per MCP including error/unavailable state
- [ ] `pnpm build` compiles; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged

**Commit**: `feat(web): per-mcp status component`

---

#### T53: Web: App shell wiring all components

**What**: Wire mcp-form, consumers-list, assignment-matrix, write-configs-button and mcp-status into App.tsx layout/navigation so the SPA is a coherent single view.  
**Where**: `web/src/App.tsx`  
**Depends on**: T7, T48, T49, T50, T51, T52  
**Reuses**: single web scaffold shell from T7; all T48..T52 components  
**Requirement**: — (infra)  
**Tools**: MCP `filesystem` · Skill `frontend-development`  
**Tests**: none · **Gate**: build

**Done when**:
- [ ] App.tsx imports and renders all five components in a navigable layout
- [ ] `pnpm build` compiles full SPA; `pnpm lint` clean
- [ ] gate `pnpm build && pnpm lint && pnpm test` passes; test count unchanged
- [ ] SPA is served static by Express and loads at localhost root (manual boot check)

**Commit**: `feat(web): assemble app shell wiring all panels`

---

#### T56: Assemble production server.ts (one process mounts api + gateway + static) + full-stack integration test

**What**: Refactor src/server.ts so it builds the Express app through the create-app factory (T36) — consolidating app construction into the single canonical path and removing T6's placeholder inline app/static code — then mounts the gateway router (T29) at POST /mcp/:token, wires the shared DB/services/upstream-registry, binds the loopback host/port, and starts listening. Export the built app (or a createServer()) so an integration test can boot the real production app and exercise both /api and /mcp/:token on one process.  
**Where**: `src/server.ts`, `test/integration/server-assembly.test.ts`  
**Depends on**: T6, T23, T29, T36, T37, T41, T42  
**Reuses**: create-app factory (T36), gateway-router (T29), api routes (T37 create-mcp / T41 register-consumer / T42 assign), dummy stdio fixture (T23); replaces the placeholder mounts in T6's server.ts  
**Requirement**: GW-01, SEC-02  
**Tools**: MCP `context7` · Skill `mcp-builder`  
**Tests**: integration · **Gate**: full

**Done when**:
- [ ] server.ts builds the app via create-app (T36) — NO duplicate app/static construction remains (T6's placeholder inline mounts/static removed); the SAME app object serves /api, the static SPA, and the gateway
- [ ] server.ts mounts the gateway router (T29) so POST /mcp/:token is served by the same process on the loopback bind
- [ ] server.ts exports the built app (or createServer()) so tests boot it without a real network listener; the production entrypoint still binds 127.0.0.1 + env port and never 0.0.0.0
- [ ] integration test: boot the real server app; GET /api/health -> 200 (api mounted) AND POST /mcp/:token with an unknown token -> 401 (gateway mounted, SEC-02)
- [ ] integration test (one-process end-to-end): via the API create an stdio MCP (dummy fixture), register a project consumer, assign the MCP, then an MCP client over /mcp/:token lists ONLY that consumer's prefixed tool from the same server process (GW-01 through the fully assembled app)
- [ ] >=3 new integration tests pass
- [ ] gate `pnpm test:unit && pnpm test:integration` green

**Commit**: `feat(server): assemble single-process server mounting api and gateway routers`

---

## Requirement Traceability (P1 / MVP)

| Requirement ID | Covered by tasks |
| -------------- | ---------------- |
| MCP-01 | T18, T37 |
| MCP-02 | T18, T37 |
| MCP-03 | T18, T37 |
| SEC-01 | T12, T13, T15, T18, T38 |
| PRJ-01 | T21, T40 |
| PRJ-02 | T19, T41 |
| PRJ-03 | T19, T21, T40, T41 |
| ACC-01 | T17, T20, T42 |
| ACC-02 | T18, T34, T39 |
| GW-01 | T27, T28, T29, T56 |
| GW-02 | T25, T54, T26, T29 |
| GW-03 | T25, T26, T27, T29 |
| SEC-02 | T28, T29, T56 |
| CFG-01 | T32, T43 |
| CFG-02 | T31, T32, T33, T43 |

---

## Pre-Approval Validation

### 1. Task Granularity

| Task | Code files | Status |
| ---- | ---------- | ------ |
| T7 | 9 | ⚠️ review (multi-file — verify cohesion) |

54/55 tasks are ≤4 code files (✅ granular). Flagged tasks above bundle a cohesive unit (e.g. a scaffold set) — reviewed as acceptable.

### 2. Diagram–Definition Cross-Check

Diagram (Global dependency map) and task `Depends on` fields are generated from the same structured plan, so they agree by construction. Independent checks run on the graph:

- **No dangling dependencies**: every `Depends on` id resolves to a defined task. ✅
- **Acyclic**: topological scan found no cycles ✅.
- **Applied fix**: added `T43` to `Depends on` of T44, T45, T46 (T43 creates `actions-routes.ts` + mounts the actions router; in sequential Phase 6 the extender routes must follow it). This resolves the sole `NEEDS_FIX` item from the adversarial critic.

### 3. Test Co-location

Every task creating a domain/business-logic layer writes its unit tests in the same task; gateway/API tasks write integration tests in the same task. No task defers tests to a later task.

✅ No domain-logic task has `Tests: none`.

---

## Sub-Agent Execution Offer

This feature has **6 phases (>3)** → at Execute the orchestrator offers **one worker per phase** (sequential, offer-then-confirm). Each phase worker runs its tasks in order (implement → gate → atomic commit) and reports a compact summary. After the final task, a fresh **Verifier** runs automatically (author ≠ verifier): spec-anchored outcome check + discrimination sensor → `validation.md`.
