# Gateway Discovery Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/gateway-discovery/design.md`
**Status**: Approved
**Branch**: `feat/gateway-discovery`
**Processo (AD-020)**: orquestrador não implementa; 1 worker por fase (modelo por fase abaixo); Verifier ≠ autores; loop fix→re-verify máx. 3 iterações.

---

## Test Coverage Matrix

> Generated from codebase + spec. Guidelines found: `vitest.config.ts` (projects unit/integration, integration testTimeout 30000), CLAUDE.md global (sem threshold numérico). Floor = testes existentes (`src/gateway/tool-aggregator.test.ts` estilo stub-registry; `test/integration/*.test.ts` estilo supertest + buildTestApp).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Gateway domain (discovery-tools) | unit | 1:1 com ACs DISC/DESC/SEC-10; todo edge case listado | `src/gateway/*.test.ts` | `pnpm test:unit` |
| Repository (leitura escopada, purpose) | unit | Caminhos de query chave + purpose null/set | `src/domain/**/*.test.ts` | `pnpm test:unit` |
| API routes (purpose CRUD) | integration | Happy + edge + error (400 bound, null clear) | `test/integration/*.test.ts` | `pnpm test:integration` |
| Gateway endpoint (protocolo novo) | integration | DISC-01..07, MIG-01, SEC-10: happy + edge + error paths | `test/integration/*.test.ts` | `pnpm test:integration` |
| Schema/migration | none (runner já testado em `src/db/migrate.test.ts`) | — | — | build gate |
| UI web | none (0 testes no repo; sem framework de teste web) | — | — | `pnpm build:web` + lint |

## Parallelism Assessment

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| unit | Yes | DB `:memory:` por teste / stubs puros | `src/db/migrate.test.ts`, `tool-aggregator.test.ts` |
| integration | Yes | `buildTestApp()` por teste (DB temp própria, close no afterEach) | `test/integration/helpers/build-test-app.ts` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Task só com unit tests | `pnpm test:unit` |
| Full | Task com integration | `pnpm test` |
| Build | Última task da fase / task sem testes | `pnpm build && pnpm lint && pnpm test` (fase UI: + `pnpm build:web`) |

⚠️ Hook do ambiente bloqueia comandos Bash contendo os literais `dist`, `node_modules`, `.git` — não inspecionar esses paths por comando; `pnpm build`/`pnpm lint`/`pnpm test` passam normalmente.

---

## Execution Plan

### Phase 1 — Fundação `purpose` (worker: modelo barato/mecânico)

```
T1 → T2 → T3
```

### Phase 2 — Core discovery-tools (worker: modelo forte)

```
T4 → T5
```

### Phase 3 — Integração gateway + regressão (worker: modelo forte)

```
T6 → T7
```

### Phase 4 — UI + docs (worker: modelo médio)

```
T8 → T9
T10 [P]
```

---

## Task Breakdown

### T1: Migration 0002 — coluna `purpose`

**What**: `ALTER TABLE mcp_server ADD COLUMN purpose TEXT;`
**Where**: `src/db/migrations/0002_add_mcp_server_purpose.sql`
**Depends on**: None
**Reuses**: runner idempotente `src/db/migrate.ts` (build já copia `*.sql`, package.json:11)
**Requirement**: DESC-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Migration aplica em DB novo e em DB já migrado (idempotência do runner cobre)
- [ ] Gate passa: `pnpm test` (integration sobe DBs frescos → migration exercitada)

**Tests**: none (schema) · **Gate**: full
**Commit**: `feat(db): add purpose column to mcp_server`

---

### T2: `purpose` + leitura escopada no domain/repository

**What**: `purpose: string | null` em `McpServerRecord/ListItem/InsertServerInput/UpdateServerInput`; insert/update/read no repository; nova `listScopedByIds(db, ids): ScopedMcp[]` retornando SÓ `{id, slug, name, purpose}` (nunca command/args/url/headers/secrets)
**Where**: `src/domain/mcp-servers/mcp-server-types.ts`, `mcp-servers-repository.ts`, novo `mcp-servers-repository.test.ts`
**Depends on**: T1
**Reuses**: padrão update parcial existente; DB `:memory:` + `runMigrations` como em `src/db/migrate.test.ts`
**Requirement**: DESC-01, DISC-02, SEC-10

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] purpose persiste no insert, atualiza/limpa (null) no update, sai no read
- [ ] `listScopedByIds` retorna só ids pedidos, shape só `{id,slug,name,purpose}` (assert de chaves), ids desconhecidos ignorados
- [ ] Gate passa: `pnpm test:unit`

**Tests**: unit · **Gate**: quick
**Commit**: `feat(mcp-servers): persist purpose and add scoped metadata read`

---

### T3: `purpose` no service + rotas API

**What**: validação (trim, máx. 2000 chars → ValidationError) no service; parse de `purpose` (string; null limpa no update) nas rotas; GET list/detail retornam purpose
**Where**: `src/domain/mcp-servers/mcp-servers-service.ts`, `src/api/mcp-servers-routes.ts`, `test/integration/mcp-servers-create.test.ts` (+ read)
**Depends on**: T2
**Reuses**: `parseCreateInput/parseUpdateInput` + `classifyDomainError` existentes
**Requirement**: DESC-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] POST com purpose → 201 com purpose; sem purpose → `purpose: null`
- [ ] PUT purpose seta; PUT `purpose: null` limpa; >2000 chars → 400
- [ ] GET list/detail incluem purpose
- [ ] Gate passa: `pnpm test` (contagem ≥ baseline; nenhum teste removido)

**Tests**: integration · **Gate**: full
**Commit**: `feat(api): accept and return mcp server purpose`

---

### T4: `discovery-tools` — definições + `list_mcps`

**What**: novo módulo com `DISCOVERY_TOOL_DEFINITIONS` (3 tools, inputSchema JSON, descriptions ensinando fluxo list→get→call) + handler `list_mcps`: rows de `deps.listScopedMcps(allowedMcpIds)`; purpose vazio → `registry.getClient(id)` + `getInstructions()` truncado 400 chars (fallback `getServerVersion().title`), qualquer falha → `null`; resposta JSON em content text
**Where**: `src/gateway/discovery-tools.ts`, `src/gateway/discovery-tools.test.ts`
**Depends on**: T2 (shape ScopedMcp; via stub nos testes)
**Reuses**: interfaces narrow `RegistryLike/UpstreamClientLike` (mover de `tool-aggregator.ts` p/ cá); estilo stub de `tool-aggregator.test.ts`
**Requirement**: DISC-01, DISC-02, DISC-07, DESC-02, SEC-10

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] 3 definições exportadas com schemas válidos
- [ ] list_mcps: escopo respeitado; 0 MCPs → lista vazia; purpose manual vence; fallback instructions truncado em 400; upstream fora → purpose null e MCP listado
- [ ] Resposta contém apenas slug/name/purpose por MCP (assert de chaves — SEC-10)
- [ ] Gate passa: `pnpm test:unit`

**Tests**: unit · **Gate**: quick
**Commit**: `feat(gateway): add discovery tool definitions and list_mcps handler`

---

### T5: `discovery-tools` — `get_mcp_tools` + `call_mcp_tool` + dispatch

**What**: resolve slug SÓ dentro do conjunto escopado (fora/inexistente → isError opaco idêntico, sem tocar registry); `get_mcp_tools` → listTools nomes originais + description + inputSchema; `call_mcp_tool` valida shape `{mcp: string, tool: string, arguments?: object}` → proxy verbatim; `handleDiscoveryToolCall` dispatch (tool desconhecida → isError); sanitização: falha upstream → `Failed to reach MCP "<slug>"` (mensagem crua NUNCA na resposta)
**Where**: `src/gateway/discovery-tools.ts`, `src/gateway/discovery-tools.test.ts`
**Depends on**: T4
**Reuses**: isolamento do registry
**Requirement**: DISC-03, DISC-04, DISC-05, DISC-06, DISC-07, SEC-10

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Todos os ACs DISC-03..07 com teste 1:1 (incl.: msg out-of-scope idêntica p/ inexistente vs. fora-do-escopo; malformado não toca registry; erro upstream sanitizado — raw msg com path não aparece)
- [ ] Proxy verbatim: resultado do upstream retorna intacto
- [ ] Gate passa: `pnpm test:unit`

**Tests**: unit · **Gate**: quick
**Commit**: `feat(gateway): route discovery tool calls with scoped opaque errors`

---

### T6: Swap no gateway-router + integração de descoberta

**What**: `ListToolsRequestSchema` → definições; `CallToolRequestSchema` → `handleDiscoveryToolCall`; injetar `listScopedMcps` (via AppDeps/server-assembly); **remover** `tool-aggregator.ts` + `tool-aggregator.test.ts` (superseded por spec — AD-019); estender `test/fixtures/dummy-stdio-mcp.ts` com `instructions`; novo `test/integration/gateway-discovery.test.ts`
**Where**: `src/gateway/gateway-router.ts`, `src/api/router.ts`/`server-assembly` (wiring), fixture, novo teste de integração
**Depends on**: T3, T5
**Reuses**: mount/token-context/transporte stateless intactos
**Requirement**: DISC-01..07, DESC-02, MIG-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `tools/list` → exatamente 3 meta-tools (DISC-01) via cliente MCP real
- [ ] Fluxo completo list→get→call contra fixture stdio funciona; consumer 0 MCPs → lista vazia; slug fora do escopo → isError opaco
- [ ] DESC-02 integração: purpose vazio → instructions da fixture aparecem truncadas
- [ ] Justificativa da remoção do tool-aggregator registrada no commit body (spec supersede)
- [ ] Gate passa: `pnpm test`

**Tests**: integration · **Gate**: full
**Commit**: `feat(gateway)!: replace flattened tools with discovery meta-tools`

---

### T7: Regressão MIG-01 + varredura SEC-10

**What**: reescrever `test/integration/gateway-router.test.ts` + `spike-token-handler-scope.test.ts` para o protocolo novo **preservando verbatim os asserts de 401/token** (MIG-01); novo teste SEC-10: MCP com secret + command; serializar respostas de TODAS as meta-tools em sucesso E erro (upstream quebrado) e assertar ausência de plaintext, ciphertext, command, paths de spawn
**Where**: `test/integration/gateway-router.test.ts`, `test/integration/spike-token-handler-scope.test.ts`, novo `test/integration/gateway-secret-isolation.test.ts`
**Depends on**: T6
**Reuses**: fixtures e buildTestApp existentes
**Requirement**: MIG-01, SEC-10, DISC-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] 401 token inválido/disabled asserts idênticos aos atuais
- [ ] SEC-10 sweep cobre caminho de sucesso e de erro de cada meta-tool
- [ ] Gate passa (última da fase): `pnpm build && pnpm lint && pnpm test`
- [ ] Contagem final ≥ baseline − (testes do tool-aggregator removidos em T6, delta documentado)

**Tests**: integration · **Gate**: build
**Commit**: `test(gateway): rewrite protocol regressions and add secret isolation sweep`

---

### T8: Tipos + client da web

**What**: `purpose: string | null` em `McpServer` de `web/src/api-types.ts`; create/update payloads em `api-client.ts`
**Where**: `web/src/api-types.ts`, `web/src/api-client.ts`
**Depends on**: T3
**Reuses**: shapes existentes
**Requirement**: DESC-03

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Tipos compilam; payloads enviam purpose
- [ ] Gate passa: `pnpm build:web && pnpm lint`

**Tests**: none (camada UI sem framework de teste) · **Gate**: build
**Commit**: `feat(web): add purpose to api types and client`

---

### T9: Campo purpose na UI

**What**: textarea "Propósito (a IA lê isso no list_mcps)" no `mcp-form.tsx` (create/edit, limpar → null); exibição resumida em `mcp-server-list.tsx`
**Where**: `web/src/components/mcp-form.tsx`, `web/src/components/mcp-server-list.tsx`
**Depends on**: T8
**Reuses**: primitivos `cls`/`ui-primitives.tsx` (AD-018)
**Requirement**: DESC-03

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Form salva/edita/limpa purpose; lista mostra resumo
- [ ] Gate passa: `pnpm build:web && pnpm lint`

**Tests**: none · **Gate**: build
**Commit**: `feat(web): edit mcp purpose in form and show it in list`

---

### T10: Docs do protocolo novo [P]

**What**: README seção gateway: fluxo de descoberta (3 meta-tools, exemplos de chamada), nota de cut-over; `docs/codebase-summary.md` se existir a seção do gateway
**Where**: `README.md`, `docs/`
**Depends on**: T7 (comportamento final)
**Reuses**: —
**Requirement**: MIG-01 (comunicação do cut-over)

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] README descreve as 3 meta-tools e o fluxo list→get→call
- [ ] Gate passa: `pnpm lint`

**Tests**: none · **Gate**: build (lint)
**Commit**: `docs(gateway): document discovery meta-tools protocol`

---

## Parallel Execution Map

```
Phase 1: T1 ──→ T2 ──→ T3
Phase 2: T4 ──→ T5            (T4 usa stubs; fase inicia após Phase 1)
Phase 3: (T3,T5) ──→ T6 ──→ T7
Phase 4: T8 ──→ T9 ; T10 [P] (independente dentro da fase, após T7)
```

4 fases → 1 worker/fase, sequencial; Verifier automático após T10 (author ≠ verifier).

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | 1 arquivo SQL | ✅ |
| T2 | types+repo (coeso) + teste | ✅ |
| T3 | service+rota (mesmo fluxo) + teste | ✅ |
| T4 | 1 módulo (defs + 1 handler) + teste | ✅ |
| T5 | 2 handlers + dispatch no mesmo módulo | ✅ |
| T6 | swap router + wiring + 1 teste integração | ✅ (coeso: um comportamento) |
| T7 | reescrita 2 testes + 1 novo | ✅ |
| T8 | tipos+client (coeso) | ✅ |
| T9 | form+list (coeso) | ✅ |
| T10 | docs | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram Shows | Status |
| ---- | ----------------- | ------------- | ------ |
| T1 | None | início Phase 1 | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3 | T2 | T2→T3 | ✅ |
| T4 | T2 (stub) | Phase 2 após Phase 1 | ✅ |
| T5 | T4 | T4→T5 | ✅ |
| T6 | T3, T5 | (T3,T5)→T6 | ✅ |
| T7 | T6 | T6→T7 | ✅ |
| T8 | T3 | Phase 4 após Phase 3 | ✅ |
| T9 | T8 | T8→T9 | ✅ |
| T10 | T7 | T10 [P] pós-T7 | ✅ |

## Test Co-location Validation

| Task | Layer | Matrix Requires | Task Says | Status |
| ---- | ----- | --------------- | --------- | ------ |
| T1 | schema | none | none (full gate roda migração) | ✅ |
| T2 | repository | unit | unit | ✅ |
| T3 | API route | integration | integration | ✅ |
| T4 | gateway domain | unit | unit | ✅ |
| T5 | gateway domain | unit | unit | ✅ |
| T6 | gateway endpoint | integration | integration | ✅ |
| T7 | gateway endpoint | integration | integration | ✅ |
| T8 | UI | none | none | ✅ |
| T9 | UI | none | none | ✅ |
| T10 | docs | none | none | ✅ |
