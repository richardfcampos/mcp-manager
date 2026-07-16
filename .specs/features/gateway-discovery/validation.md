# Gateway Discovery Validation

**Date**: 2026-07-16
**Spec**: `.specs/features/gateway-discovery/spec.md`
**Diff range**: `f8a53e2..HEAD` (branch `feat/gateway-discovery`; code commits 97c9490, fe10f5e, 04fb6d1, 827aa64, 7cad898, e838e75, 5742d64, dbb1dbd, 720cd56, e855a4e, 6462b31)
**Verifier**: independent sub-agent (author != verifier, evidence-or-zero). Did not write this code; re-derived all coverage from source + tests.

**VERDICT: PASS ✅** — 12/12 ACs matched spec outcome, 7/7 sensor mutants killed, gate green (277 tests), deviations B1–B5 all confirmed OK. 2 non-blocking coverage/precision notes below.

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN → THEN) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **DISC-01** tools/list → exactly 3 meta-tools + schemas, no flattened upstream tools | names = `[list_mcps, get_mcp_tools, call_mcp_tool]`, each inputSchema.type='object'; required arrays correct | `src/gateway/discovery-tools.test.ts:59` `toEqual([...3...])` + `:64-68` schema.type='object' + `:73-75` required `['mcp']`/`['mcp','tool']`; integ `test/integration/gateway-discovery.test.ts:132/141` `tools.map(name).sort()===META_TOOL_NAMES`; `test/integration/gateway-router.test.ts:153`; `test/integration/server-assembly.test.ts:104-108` | ✅ |
| **DISC-02** list_mcps → only consumer-scoped MCPs (slug,name,purpose); empty scope → `[]` not error | scoped list only; `{mcps:[]}` for 0 MCPs | `discovery-tools.test.ts:91` `toEqual([{slug:'a',name:'Alpha',purpose:'do alpha'}])` + `:102` empty `[]`; integ `gateway-discovery.test.ts:153-154` len 1 + slug/name, `:182` `[]`; `gateway-router.test.ts:163` `['stdio-mcp']`, `:170` `[]` | ✅ |
| **DISC-03** get_mcp_tools(slug in scope) → original tool names (no prefix) + inputSchema | `{mcp, tools:[{name,description,inputSchema}]}`, names verbatim | `discovery-tools.test.ts:235-238` `toEqual({mcp:'a',tools:[{name:'search',...}]})`; integ `gateway-discovery.test.ts:162` names `['echo','ping','read-secret']` (no `stdio-mcp__` prefix) + `:163` inputSchema defined | ✅ |
| **DISC-04** call_mcp_tool → dispatch to upstream, return verbatim | upstream result passed through unchanged | `discovery-tools.test.ts:324-325` `calledWith===({name:'search',arguments:{q:'hi'}})` + structuredContent verbatim; integ `gateway-router.test.ts:183` `{type:'text',text:'pong'}`; `gateway-discovery.test.ts:170`; `server-assembly.test.ts:123` | ✅ |
| **DISC-05** slug out-of-scope (incl. exists-for-other-consumer) → opaque tool error, no upstream contact, no existence disclosure | identical error text for out-of-scope vs nonexistent; registry NOT called | `discovery-tools.test.ts:281-284` outOfScope.text===nonexistent.text + both `getClient` `not.toHaveBeenCalled()`; `:412-413` `'MCP "jira" is not available for this consumer'` + not called; integ `gateway-discovery.test.ts:206-209` other-mcp (owned by other consumer) === nonexistent opaque text; `spike-token-handler-scope.test.ts:151-153` | ✅ |
| **DISC-06** malformed call_mcp_tool payload → validation error, no crash, no upstream contact | names offending field; registry untouched | `discovery-tools.test.ts:390-396` isError + text contains `"mcp"`/`"tool"`/`"arguments"` + `getClient` not called; integ leak-free path `gateway-secret-isolation.test.ts:191` | ✅ |
| **DISC-07** in-scope upstream fails to connect → list_mcps still lists it; get/call → isolated error, others unaffected | down MCP still listed; sanitized reach error; healthy MCP still works | `discovery-tools.test.ts:179-182` down→purpose null while up→instructions; integ `gateway-router.test.ts:206` both listed, `:215-217` `Failed to reach MCP "broken-remote-mcp"`, `:222` healthy still returns tools | ✅ |
| **DESC-01** create/edit purpose via API → persisted + returned in GET (list/detail) | round-trips; null default; null clears; 2000-char bound → 400 | repo `mcp-servers-repository.test.ts:178/184/192/200/208` insert/update/null-clear/untouched; API `mcp-servers-create.test.ts:179` echo, `:190` null default, `:200`/`:241` >2000→400, `:214` PUT set, `:228` PUT null clears; read `mcp-servers-read.test.ts:71-72` list+detail include purpose | ✅ |
| **DESC-02** empty purpose + upstream reachable → announced instructions/desc; else → null (still listed) | manual wins; instructions truncated; title fallback; null when down | `discovery-tools.test.ts:128` manual wins (+registry not called), `:144` instructions `'x'.repeat(400)`, `:161` title `'Alpha Server'`, `:185` down→null; integ `gateway-discovery.test.ts:230-231` length 400 + fixture-instructions prefix | ✅ |
| **DESC-03** UI shows + saves purpose field | textarea rendered, wired to create+update payload, shown in list | `web/src/components/mcp-form.tsx:249-260` "Purpose" label+textarea bound to `purpose` state; `:102` update sends `purpose` (null clears), `:114` create sends `purpose`; `web/src/components/mcp-server-list.tsx` renders `server.purpose`. **No automated web test** — verified by code inspection (see Note 1) | ✅ (code) |
| **SEC-10** any meta-tool response (success/error) → no secret plaintext/ciphertext/env values/command/args; only slug/name/purpose + tools | forbidden-substring sweep clean on all paths; scoped read key-set exactly {id,slug,name,purpose} | repo `mcp-servers-repository.test.ts:229` `Object.keys(entry).sort()===['id','name','purpose','slug']` + `:238-239` no `npx`/`cipher-1`; `discovery-tools.test.ts:113-114` list_mcps keys {name,purpose,slug} + no id, `:185/:301/:436` no `/secret/path`; integ `gateway-secret-isolation.test.ts` full-file sweep (list/get/call × success/sanitized-fail/validation-error) vs forbidden `[secrets, ciphertexts, execPath, fixture path, broken cmd/arg, spawn, ENOENT]` | ✅ |
| **MIG-01** new gateway up → endpoint/URL/tokens still valid; 401 for invalid/disabled preserved (SEC-02); no consumer config rewrite | `POST /mcp/:token` 401 on unknown/disabled, verbatim; config writers untouched | `test/integration/gateway-router.test.ts:196` `status===401`; `server-assembly.test.ts:58` `status===401` (real production assembly); `src/gateway/token-context.ts:42` guard `!consumer||!consumer.enabled`→401 (unit-covered, killed by m5); config writers = 0 files changed in diff | ✅ |

**Status**: ✅ 12/12 ACs traced to file:line with asserted values matching spec outcomes.

### Edge Cases (spec §Edge Cases)

- [x] Consumer 0 MCPs → list_mcps `[]` + tools/list still 3 meta-tools — `gateway-discovery.test.ts:137,176`; `discovery-tools.test.ts:94`
- [x] call_mcp_tool tool inexistente em MCP válido → upstream isError proxied verbatim (no gateway crash) — `discovery-tools.test.ts:328-343` `toEqual(upstreamError)`
- [x] Two MCPs same tool name → `{mcp,tool}` disambiguates — `discovery-tools.test.ts:241-259` (get) + `346-368` (call, `from==='b'`)
- [x] Giant upstream instructions → fallback truncated (400 chars) — `discovery-tools.test.ts:144`; integ `gateway-discovery.test.ts:230` + fixture padded >400 (`dummy-stdio-mcp.ts:29-35`)

---

## Author-Flagged Deviations (B1–B5)

| # | Claim | Verdict | Evidence |
| --- | --- | --- | --- |
| **B1** | Every pre-existing 401 / scope assertion preserved verbatim (MIG-01) across gateway-router, spike, server-assembly | **CONFIRMED OK** | Diffed vs `git show f8a53e2:…`. `gateway-router.test.ts` SEC-02 `toBe(401)` **identical** (was line, still `:196`); GW-01/GW-03 flatten-prefix asserts replaced by DISC-01/02/07 (cut-over, superseded by spec — no 401/scope weakened). `server-assembly.test.ts` 401 assertion **identical** `:58`; GW-01 e2e prefix assert → DISC-01/04. `spike-token-handler-scope.test.ts` original had **no** 401/disabled assertion (pure token-echo spike); rewrite adds real per-token scope isolation asserts — nothing lost. No weakened/lost 401 or scope assertion found. |
| **B2** | tool-aggregator.ts/.test.ts (8 tests) deletion — behavior superseded or re-covered | **CONFIRMED OK** | `tool-aggregator.ts` absent at HEAD (verified). The 8 deleted tests covered flattening/prefixing/aggregation — behavior explicitly removed by spec ("modo achatado" out of scope). Re-mapping: prefix→original names re-covered inversely `discovery-tools.test.ts:217`; name-collision→`{mcp,tool}` `:241/:346`; scope-exclusion→DISC-05 `:261/:399`; skip-broken-upstream(GW-03)→DISC-07 `:164/:287` + `gateway-router.test.ts:199`; prefix-strip-dispatch→DISC-04 `:306`; unprefixed-name reject→DISC-06 validation `:371`. No behavior lost. |
| **B3** | InsertServerInput.purpose optional + 1-alternation classifyDomainError extension, no over-broad classification | **CONFIRMED OK** | `mcp-server-types.ts:73` `purpose?: string \| null` (optional). `error-middleware.ts` diff = single alternation `\|must be at most \d+ characters` added to the **ValidationError(400)** branch. Regex is specific (literal "must be at most <digits> characters"), matches only normalizePurpose's error `:92`; unrelated errors still fall through to 500. Not over-broad. |
| **B4** | api-client.ts untouched (forwards verbatim) — purpose reaches API on create AND update | **CONFIRMED OK** | `web/src/api-client.ts` **not in diff**. `createMcpServer` `:58` `JSON.stringify(input)`, `updateMcpServer` `:62` `JSON.stringify(input)` — both forward whole body. `mcp-form.tsx:114` create sends `purpose` (undefined when blank → omitted), `:102` update sends `purpose` (null when blank → clears). Types carry it (`api-types.ts:49,60`). Purpose reaches API on both paths; server round-trip verified by `mcp-servers-create.test.ts` DESC-01. |
| **B5** | UI label "Purpose" (English) vs task text "Propósito"; DESC-03 no language mandate | **CONFIRMED OK / CLOSED** | `mcp-form.tsx:250` label = "Purpose" + helper "The project AI reads this via list_mcps…". Spec DESC-03 mandates the field be shown+saved, no language requirement. Cosmetic, in-spec. Closed. |

---

## Discrimination Sensor (EXPANDED tier — security-critical feature)

7 behavior-level faults injected one-at-a-time in scratch state (edit → run scoped test file → confirm FAIL → `git checkout --`). Tree verified clean after each.

| # | Target `file:line` | Mutation | Killed by | Result |
| --- | --- | --- | --- | --- |
| m1 | `discovery-tools.ts:186` (`resolveScopedMcp`) | out-of-scope slug resolves to synthesized entry instead of null | `discovery-tools.test.ts:283` `getClient` was called + `:412` opaque-text `.toBe` mismatch (DISC-05) | ✅ Killed |
| m2 | `discovery-tools.ts:254` (`handleGetMcpTools` catch) | return raw upstream error instead of `unreachableError` | `gateway-secret-isolation.test.ts:165` leaked `/nonexistent/bin/…` (SEC-10 sweep) | ✅ Killed |
| m3 | `mcp-servers-repository.ts:200-202` (`listScopedByIds`) | add `command` to SELECT + returned shape | `mcp-servers-repository.test.ts:229` key-set `…(4)` vs `…(3)` + `:247` (SEC-10 key-set) | ✅ Killed |
| m4 | `discovery-tools.ts:7` (`PURPOSE_FALLBACK_MAX_CHARS`) | 400 → 4000 (effectively untruncated for 1000-char fixture) | `discovery-tools.test.ts:144` purpose `!== 'x'.repeat(400)` (DESC-02) | ✅ Killed |
| m5 | `token-context.ts:42` (401 guard) | invert enabled check (`!consumer.enabled` → `consumer.enabled`) | `token-context.test.ts` 3 fails incl. SEC-02 disabled→401 (MIG-01/SEC-02) | ✅ Killed |
| m6 | `discovery-tools.ts:212` (`invalidCallToolField`) | always return null (accept any payload) | `discovery-tools.test.ts:390` malformed payload not rejected (DISC-06) | ✅ Killed |
| m7 | `mcp-servers-service.ts:85` (`MAX_PURPOSE_LENGTH`) | 2000 → 100000 (no effective bound) | `mcp-servers-create.test.ts:200,241` POST+PUT >2000 not 400 (DESC-01) | ✅ Killed |

**Sensor depth**: P0-full (7 mutations, all branches/ACs of the security surface). **Result**: 7/7 killed — tests are discriminating. No surviving mutants.

---

## Gate Check

- **Commands**: `pnpm build && pnpm lint && pnpm test`
- **Build**: ✅ `tsc -p tsconfig.json` + migration copy — exit 0, no errors
- **Lint**: ✅ ESLint — "No issues found", exit 0
- **Test**: ✅ **41 files passed / 277 tests passed / 0 failed / 0 skipped** (vitest run), duration ~24s
- **Test integrity**: `tool-aggregator.test.ts` (8 tests) deleted — **justified** by cut-over (flattening behavior removed by spec, re-covered per B2). New tests added far exceed deletions (discovery-tools +21, gateway-discovery/secret-isolation integration suites, repo/create/read purpose tests). No assertion weakened (B1 verified verbatim-preservation of 401/scope).

---

## Code Quality

| Principle | Status |
| --- | --- |
| No features beyond spec | ✅ |
| Surgical changes, only required files | ✅ |
| No scope creep | ✅ |
| Matches existing patterns (low-level Server, stateless/request, sanitized reads) | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ |
| Per-layer coverage: domain 1:1 ACs; routes happy+edge+error | ✅ |
| Every in-scope test maps to a spec AC / edge case / Done-when | ✅ |
| No plan-artifact refs in code comments/filenames (checked discovery-tools, migration 0002, tests — use AC ids like DISC-05 which are stable spec ids, acceptable) | ✅ |

---

## Notes (non-blocking)

**Note 1 — DESC-03 has no automated web test.** The purpose field's UI display/save is verified by code inspection only (`mcp-form.tsx`, `mcp-server-list.tsx`) — the web layer has no component test harness in this repo. Behavior is correct and the create/update payloads are covered end-to-end at the API layer (`mcp-servers-create.test.ts`). Low risk; recorded for completeness.

**Note 2 — SEC-10 get_mcp_tools extra-field stripping untested.** `handleGetMcpTools` projects each upstream tool to exactly `{name, description, inputSchema}` (`discovery-tools.ts:248-252`, explicit projection not spread), so an upstream-injected extra field cannot leak. Correct by construction, but no test feeds a tool object carrying an extra field to prove the strip. m3 covers the analogous scoped key-set at the DB layer. Consider adding one assertion; not a gap in behavior.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| DISC-01..07 | Implementing | ✅ Verified |
| DESC-01, DESC-02 | Implementing | ✅ Verified |
| DESC-03 | Implementing | ✅ Verified (code inspection — see Note 1) |
| SEC-10 | Implementing | ✅ Verified |
| MIG-01 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready.

**Spec-anchored**: 12/12 ACs matched spec outcome (0 uncovered, 0 spec-precision gaps that block; 2 minor coverage notes).
**Sensor**: 7/7 mutations killed (P0-full tier).
**Gate**: build ✅ / lint ✅ / 277 tests ✅.
**Deviations B1–B5**: all confirmed OK.

**What works**: 3 fixed meta-tools regardless of scope; per-token scoped discovery with opaque out-of-scope errors that never touch upstream; verbatim call proxying; central error sanitization; purpose persistence + upstream-instructions fallback truncated at 400; 401 regression (SEC-02) preserved verbatim; secret isolation swept across all success/error/validation paths.

**Issues found**: none blocking. Two non-blocking coverage notes (DESC-03 UI test, SEC-10 extra-field strip test).

**Next steps**: none required for PASS. Optionally add the two tests in Notes 1–2 to close coverage.
