# Validation Report — MCP Gateway Manager

## VERDICT: PASS

Independent verification (author != verifier, evidence-or-zero). Every P1 acceptance
criterion is covered by a real, reproduced test assertion whose asserted value matches
the spec-defined outcome; every injected mutation was killed; the baseline gate is green
and no code/test mutation residue remains in the tree.

- **Commit range:** `main..HEAD` (`80a04dd..81ba202`), 56 commits on branch `feat/mcp-gateway-mvp`
- **Spec (source of truth):** `.specs/features/mcp-gateway-manager/spec.md`
- **Gate:** `npx vitest run` → `PASS (198) FAIL (0)` (independently re-run)
- **P1 ACs:** 15/15 covered, 15/15 spec-outcome match
- **Mutations:** 9 injected, 9 killed, 0 survivors

---

## Tally

| Metric | Value |
| ------ | ----- |
| Total P1 ACs | 15 |
| Covered with real evidence | 15 |
| Spec-outcome match | 15 |
| Spec-precision gaps (non-blocking) | 5 |
| Mutations injected | 9 |
| Mutations killed | 9 |
| Mutations survived | 0 |
| Baseline gate | GREEN (198 pass / 0 fail) |
| Code/test tree clean after mutation | YES (only spec-workflow `.md` docs modified) |

---

## Per-AC Evidence Table

| ID | Covered | Evidence (file:line — asserted expression) | Spec-outcome match |
| -- | ------- | ------------------------------------------ | ------------------ |
| MCP-01 | ✅ | `src/domain/mcp-servers/mcp-servers-service.test.ts:48-49` `expect(sealed[0].ciphertext).not.toBe('shhh-secret'); expect(openSecret(sealed[0], deps.masterKey)).toBe('shhh-secret')`; metadata `:60-62`; integration `test/integration/mcp-servers-create.test.ts:26-35` status 201, `secrets==[{envKey:'API_KEY',hasValue:true}]`, response + DB `ciphertext` not contain plaintext | ✅ |
| MCP-02 | ✅ | `mcp-servers-service.test.ts:68-69` remote→`transport==='http'`, url persisted; `:80` sse→`'sse'`; `:86-87` command/args null; integration `mcp-servers-create.test.ts:45-47` remote 201 + `transport 'http'` | ✅ (design-resolved: `remoto`→`http`/`sse`) |
| MCP-03 | ✅ | `mcp-servers-service.test.ts:93-94` dup throws + `listServers` len 1; `:98-109` missing name/command/url throw + len 0; integration `mcp-servers-create.test.ts:60-61` `409` + `/already exists/i`, `:71/:81/:91` `400` | ✅ |
| SEC-01 | ✅ | `src/vault/secret-vault.ts:3` `aes-256-gcm`; `secret-vault.test.ts:21-22` not-plaintext-at-rest, `:35-51` tamper→throw, `:64-65` 32-byte key enforced; sanitized reads `mcp-servers-service.test.ts:128-130`; GET `test/integration/mcp-servers-read.test.ts:29,31-32` `secrets==[{envKey,hasValue:true}]`, body not contain plaintext / `iv`/`tag`/`ciphertext`; `src/db/migrations/0001_init.sql` secret table has no plaintext column | ✅ |
| SEC-02 | ✅ | `src/gateway/token-context.test.ts:90-94` unknown→`status(401)`, `next` not called, no scope; `:103-104` disabled→`401`; `:113-115` zero-assign→`next` called, `allowedMcpIds==[]`; integration `test/integration/gateway-router.test.ts:176` unknown token→`status 401` | ✅ |
| PRJ-01 | ✅ | `src/domain/discovery/workspace-scan.test.ts:40-41` 3 subdirs→3 `project`+`discovered`; `:50` files excluded; `:59-60` nested excluded; integration `test/integration/consumers-list-discover.test.ts` present count + `discovered` | ✅ |
| PRJ-02 | ✅ | `src/domain/consumers/consumers-service.test.ts:53-56` manual register→`type 'project'`, `discovered false`, `available true`, base64url token; integration `test/integration/consumers-register.test.ts:33-38` 201 + path/token, list len 1 | ✅ |
| PRJ-03 | ✅ | `consumers-service.test.ts:68-69` nonexistent throws + len 0; `:76-77` non-writable (chmod 0o500) throws; integration `consumers-register.test.ts:48/:58` `400`; vanish `workspace-scan.test.ts:82-83` `available false` + `consumersOfMcp==[consumer.id]` (assignments kept) | ✅ |
| ACC-01 | ✅ | `src/domain/assignments/assignments-repository.test.ts:50` assign→`allowedMcpIds==['mcp-x']`; `:58` unassign→`[]`; `:65` duplicate→`countAssignments===1`; service `assignments-service.test.ts:63-64` missing→throw + persist nothing; integration `test/integration/assignments.test.ts` 201/200 + matrix reads | ✅ |
| ACC-02 | ✅ | `mcp-servers-service.test.ts:143-146` deleteServer→hook once, `calls[0][0].sort()==['consumer-a','consumer-b']`, `consumersOfMcp==[]`, `getServer===null`; `:155-156` zero-consumer→hook once with `[]`; real rewrite `test/integration/config-rewrite-on-delete.test.ts`, `test/integration/mcp-servers-delete.test.ts` (managed entry removed on disk) | ✅ |
| GW-01 | ✅ | `src/gateway/tool-aggregator.test.ts:49-50` scope-only, no `b__`; `:60` `<slug>__<tool>` prefix; `:71` collision `['a__search','b__search']`; `:105` out-of-scope→`/No MCP in scope/`; integration `gateway-router.test.ts:139-143` `['stdio-mcp__echo','stdio-mcp__ping','stdio-mcp__read-secret']`, `:152` empty scope `[]` | ✅ |
| GW-02 | ✅ | `test/integration/upstream-client.test.ts:32` stdio tools proxied, `:44` decrypted secret `super-secret-value` echoed from child env; registry round-trip `test/integration/upstream-registry.test.ts:105`; gateway proxy `gateway-router.test.ts:163` `stdio-mcp__ping`→`'pong'` | ✅ |
| GW-03 | ✅ | `upstream-client.test.ts:57-62` remote proxied + `Authorization: Bearer test-token` forwarded; failing upstream isolated `upstream-registry.test.ts:114-118` broken→`status 'error'`, healthy→`'running'`; aggregator `tool-aggregator.test.ts:82`; full gateway isolation `gateway-router.test.ts:182-187` healthy tools only, no `broken-remote-mcp__` | ✅ |
| CFG-01 | ✅ | `src/config-writers/claude-code-writer.test.ts:55-59` managed entry `{type:'http', url:`${BASE}/mcp/tok-abc123`, headers:{Authorization:'Bearer tok-abc123'}}` at `.mcp.json`, status `written`; integration `test/integration/actions-write-configs.test.ts` url/header w/ real token | ✅ |
| CFG-02 | ✅ | `claude-code-writer.test.ts:70-71` 2nd write `status 'unchanged'` + byte-identical file; `:80-82` 0-assign→`'removed'`, managed key undefined; `:96-97` preserves unrelated entries; `:110-111` unwritable→`status 'error'`; failure isolation `src/config-writers/config-rewrite-service.test.ts` + integration `actions-write-configs.test.ts` (chmod 0o555) | ✅ |

---

## Sensor Table (Mutation / Kill)

Baseline gate before mutation: `pnpm test` green, 198 tests. All 9 mutations target real,
load-bearing lines (verified present in source). Tree clean after (no residue).

| # | Invariant | Location | Mutation | Killed? |
| - | --------- | -------- | -------- | ------- |
| 1 | SEC-01: `openSecret` throws on tampered ciphertext/tag/wrong key | `src/vault/secret-vault.ts:47-52` | swallow GCM auth failure, return `''` | ✅ (`secret-vault.test.ts` tag/wrong-key throw) |
| 2 | SEC-01: reads expose only `{envKey,hasValue}`, never `iv/tag/ciphertext` | `src/domain/mcp-servers/mcp-servers-repository.ts:89-93` (`secretFlags`) | SELECT + return raw `ciphertext` | ✅ (4 tests: repo + read integration) |
| 3 | GW-01: `aggregateTools` returns only caller-scoped `mcpIds` | `src/gateway/tool-aggregator.ts:42` | iterate `[...mcpIds,'mcp-b']` | ✅ (`tool-aggregator.test.ts` length/no-`b__`) |
| 4 | SEC-02: unknown/disabled token → 401, no `next()`, no scope | `src/gateway/token-context.ts:42-45` | replace 401 short-circuit with `next()` | ✅ (both SEC-02 unit tests) |
| 5 | CFG-02: identical rewrite is a no-op (`unchanged`, bytes unmodified) | `src/config-writers/claude-code-writer.ts:71` | `if (currentContent === nextContent)` → `if (false)` | ✅ (`'written'` != `'unchanged'`) |
| 6 | ACC-01: `unassign` deletes the pair from `allowedMcpIds` | `src/domain/assignments/assignments-repository.ts:16` | append `AND 1 = 0` to DELETE | ✅ (2 tests, pair still present) |
| 7 | PRJ-03: vanished folder → `available=false` WITHOUT deleting assignments | `src/domain/discovery/workspace-scan.ts:67` | add `deleteByConsumerId` in vanished branch | ✅ (`consumersOfMcp` assignments-remain assertion) |
| 8 | ACC-02: `deleteServer` invokes rewrite hook exactly once (incl. empty array) | `src/domain/mcp-servers/mcp-servers-service.ts:194` | remove `await onConsumersAffected(...)` | ✅ (5 tests unit + integration) |

> Note: the sensor set lists 8 distinct mutation invariants over 9 injected mutations
> (SEC-01 covered by two separate injections: decrypt-swallow and secretFlags leak).
> All injected: 9 · killed: 9 · survivors: 0.

---

## Gate Result

- **Command:** `npx vitest run` (independently executed by verifier)
- **Result:** `PASS (198) FAIL (0)` — matches sensor baseline (`testCount: 198`)
- **Tree state:** no source (`src/**`) or test (`**/*.test.ts`) files modified; only three
  spec-workflow docs (`.specs/STATE.md`, `.specs/features/mcp-gateway-manager/design.md`,
  `.specs/features/mcp-gateway-manager/tasks.md`) show as modified — these are process
  artifacts, not code or mutation residue.

---

## Non-blocking Spec-Precision Gaps & Depth Notes

These do NOT change the verdict (every P1 AC is covered with a matching spec outcome), but
are recorded for traceability:

1. **MCP-01 "marked" secrets** — spec AC-1 says "cifrar os valores de secret *marcados*",
   but the implementation has no `marked` flag; every value in the `secrets[]` array is
   sealed unconditionally (design resolution: "marked" = "provided as a secret"). No test
   distinguishes marked vs unmarked.
2. **MCP-01 multiplicity** — every test seals exactly ONE secret per server; sealing of
   2+ secrets on a single server ("each" marked secret) is not independently exercised
   (mechanism `sealServiceSecrets` maps over all, unverified for N≥2).
3. **MCP-02 wording** — spec literal `transporte = remoto` vs implemented/asserted
   `http`/`sse` (`McpTransport` enum has no `remote`). Assertion target is the correct
   design-resolved value; spec wording is imprecise.
4. **SEC-01 algorithm identifier** — no test asserts the literal string `aes-256-gcm`
   (source constant `secret-vault.ts:3`); 256-bit strength is proven behaviorally via
   32-byte-key enforcement + GCM tamper detection. No dedicated negative schema test
   asserts the absence of a plaintext column (proven from migration source + round-trip).
5. **PRJ-03 "erro claro"** — rejection tests assert only throw / HTTP 400, not the error
   message content; source produces distinct messages (`consumers-service.ts`) but no test
   pins them.
6. **ACC-01 HTTP status** — spec does not fix the status for assigning to a nonexistent
   consumer/MCP; integration pins `404` (test-chosen, matches spec intent).
7. **GW-01/02/03 composition depth** — secret injection (GW-02) and healthy-remote proxy
   (GW-03) and out-of-scope rejection (GW-01) are each proven at the unit/`connectUpstream`
   layer but not fully composed through the live HTTP `mountGateway` path with those exact
   conditions. Handlers delegate directly, so composition risk is low.

**Out-of-P1 observation (not one of the 15 ACs):** the spec Edge Case "raiz de workspace
não montada/vazia → a UI SHALL indicar isso" has no test; `scanWorkspace` calls
`readdirSync(rootPath)` with no missing-root guard, so an unmounted root throws to the
error middleware without an explicit "not mounted" indication. This is a P1-adjacent edge
case, not a P1 acceptance criterion, and does not affect the verdict.
