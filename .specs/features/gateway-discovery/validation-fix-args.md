# Gateway Discovery — `call_mcp_tool` args fix: Validation

**Date**: 2026-07-16
**Spec**: `.specs/features/gateway-discovery/spec.md` (ACs DISC-04, DISC-05, DISC-06, DISC-08, DISC-09 + "Nota de design")
**Diff range**: `main..HEAD` (branch `fix/call-mcp-tool-args`; code `b556583`, spec amendment `3d01f95`)
**Verifier**: independent sub-agent (author ≠ verifier), evidence-or-zero
**Verdict**: **PASS ✅**

---

## Summary

The fix renames `call_mcp_tool`'s input field `arguments` → `args` (removing the collision with the MCP `tools/call` envelope), adds a runtime unknown-field guard at the single dispatch entry point, and forwards `{}` instead of `undefined` when `args` is omitted. All 5 in-scope ACs are covered by assertions targeting the spec-defined **values**; all 6 injected faults were killed; all gates green. Author claims B1–B4 confirmed (one wording imprecision noted, no coverage impact).

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| --- | --- | --- | --- |
| **DISC-04**: `call_mcp_tool` with `{mcp, tool, args}` in scope → dispatch upstream, result verbatim | upstream receives the tool's own args; result returned unmodified | `src/gateway/discovery-tools.test.ts:364` — `expect(result.calledWith).toEqual({ name: 'search', arguments: { q: 'hi' } })`; `:365` — `expect(result.structuredContent).toEqual({ ok: true })`; schema pin `:372` — `expect(Object.keys(properties).sort()).toEqual(['args','mcp','tool'])`; `:375` — `expect(callTool?.description).toContain('"args"')`; e2e `test/integration/gateway-discovery.test.ts:170-171` — `toMatchObject({ type:'text', text:'pong' })` + `expect(called.isError).toBeFalsy()` | ✅ PASS |
| **DISC-05** (no regression): out-of-scope/nonexistent slug → opaque isError, no upstream contact | identical opaque message; registry never touched | `test/integration/gateway-discovery.test.ts:234` — `.toBe('MCP "other-mcp" is not available for this consumer')`; `:235-237` — nonexistent slug yields same shape; **new pin** `:247-249` — `expect((calledOutOfScope.content as TextContent[])[0].text).toBe('MCP "other-mcp" is not available for this consumer')`; unit `src/gateway/discovery-tools.test.ts:322` — `expect(outOfScope.content[0].text).toBe(nonexistent.content[0].text)`, `:323-324` — `expect(registry.getClient).not.toHaveBeenCalled()`; `test/integration/spike-token-handler-scope.test.ts:151-153` — exact message | ✅ PASS — not regressed; **strengthened** |
| **DISC-06**: malformed payload (no `mcp`/`tool` string, `args` non-object) → validation error, no crash, no upstream | error names the offending field; registry untouched | `src/gateway/discovery-tools.test.ts:525-531` — `expect(missingMcp.content[0].text).toContain('"mcp"')`, `expect(missingTool.content[0].text).toContain('"tool"')`, `expect(badArgs.content[0].text).toContain('"args"')` (payload `args: [1,2,3]`), `expect(registry.getClient).not.toHaveBeenCalled()` | ✅ PASS |
| **DISC-08**: any top-level field outside `{mcp, tool, args}` → isError naming received field **AND** `args`; no upstream; never treated as "no arguments" | both names present; registry untouched | `src/gateway/discovery-tools.test.ts:414-417` — `expect(result.isError).toBe(true)`, `.toContain('"input"')`, `.toContain('args')`, `expect(registry.getClient).not.toHaveBeenCalled()`; `:435-440` — same for legacy `arguments` (the "never silently no-args" case, pinned by `not.toHaveBeenCalled()`); `:457-460` — every unknown field named (`"input"` + `"params"`); e2e `test/integration/gateway-discovery.test.ts:188-191` — `.toContain('"input"')` + `.toContain('args')`, `:198-199` — legacy `arguments` | ✅ PASS |
| **DISC-09**: `call_mcp_tool` without `args` → forward `{}` upstream, never `undefined` | upstream `arguments` === `{}` | `src/gateway/discovery-tools.test.ts:394` — `expect(result.calledWith).toEqual({ name: 'search', arguments: {} })`; `:398` — `expect(result.calledWith.arguments).not.toBeUndefined()` | ✅ PASS — **payload rule satisfied**: asserts the VALUE forwarded upstream, not merely that `callTool` was called |

**Status**: ✅ 5/5 ACs matched the spec-defined outcome. No spec-precision gaps.

Implementation anchors: guard `src/gateway/discovery-tools.ts:249-261`, dispatch-time invocation `:349-352`, `{}` forwarding `:327`, valid-field table `:117-121`.

---

## Author-Flagged Claims

### B1 — The hollowed-out-test claim: **CONFIRMED ✅** (highest-value check)

Claim: `spike-token-handler-scope.test.ts` and `gateway-secret-isolation.test.ts` would have kept passing while testing nothing, because the unknown-field guard short-circuits before the DISC-05 scope path / SEC-10 success path those tests exist to cover.

Verified empirically by reconstructing each test as `main` left it (old `arguments: {}` payload) against the fixed implementation:

| Probe | Reconstruction | Result | Meaning |
| --- | --- | --- | --- |
| A | `gateway-secret-isolation.test.ts:173-178` with old payload, **no** anchor (exactly `main`'s test) | **PASSED** | Hollowing was real — `assertNoLeak` trivially passes on the guard's error string, SEC-10 success path never exercised |
| B | Same old payload **with** the author's `expect(success.isError).toBeFalsy()` | **FAILED** — `AssertionError: expected true to be falsy` | The anchor works, and the failure proves `success.isError === true`: the response was the guard's error, not a real upstream call |
| C | `spike-token-handler-scope.test.ts:155-159` with old payload (exactly `main`'s test) | **PASSED** | Hollowing was real here too — `expect(calledOther.isError).toBe(true)` satisfied by the guard, not by scope resolution |

The reasoning is sound and the added anchors do prevent hollowing. This was a genuine, non-obvious hazard: both tests would have gone green while covering nothing.

**Wording imprecision (no coverage impact):** the claim reads as if both anchors landed in the two named files. In fact `expect(success.isError).toBeFalsy()` went to `gateway-secret-isolation.test.ts:177` ✅, while the exact-message pin went to a **third** file, `gateway-discovery.test.ts:247-249` (DISC-05). `spike-token-handler-scope.test.ts` received only the payload rename — its `call_mcp_tool` assertion at `:159` is still a bare `expect(calledOther.isError).toBe(true)` with no message pin. Not a gap: that file's `get_mcp_tools` half (`:151-153`) pins the exact message on a valid-fields-only payload, so it genuinely exercises scope resolution, and the DISC-05 `call_mcp_tool` path is pinned exactly in two other places. Optional hardening, not a defect.

### B2 — DISC-09 integration-test deviation: **CONFIRMED ✅** (premise true, drop was correct)

Claim: the shared fixture's `echo` defaults missing `text` to `''` and returns success, so an integration test cannot distinguish `{}` from `undefined` — any such test would be fake coverage.

**Read**: `test/fixtures/dummy-stdio-mcp.ts:69` — `const text = typeof args?.text === 'string' ? args.text : '';` — optional chaining plus `''` fallback, returning success at `:70`. None of the fixture's three tools (`ping`, `echo`, `read-secret`) declare a `required` parameter, and the low-level `Server` does not validate against `inputSchema`.

**Proven, not merely reasoned** — I built the dropped test and ran it both ways:

| Run | Implementation | Result |
| --- | --- | --- |
| Probe on clean code | `arguments: toolArgs ?? {}` | **PASSED** |
| Probe under fault m3 | `arguments: toolArgs` (the exact bug) | **PASSED** ← survives |

The reconstructed DISC-09 integration test **passes under the exact bug it would exist to catch** — a mutant-surviving test, i.e. fake coverage. Corroborated independently: under m3 the entire real-fixture integration suite reported 0 failures; only the unit test at `:394` caught it. Dropping it was the correct call. (Scratch probe deleted; tree clean.)

### B3 — Unknown-field rejection widened to all three meta-tools: **CONFIRMED ✅**

- **Single entry point, before any registry contact**: `handleDiscoveryToolCall` is the only dispatcher, called from exactly one site — `src/gateway/gateway-router.ts:68` (verified by grep: no other call site). The guard runs at `discovery-tools.ts:349-352`, before the `switch` at `:353` and therefore before every handler and every `registry.getClient`. Empirically enforced by fault m2.
- **`list_mcps` not over-strict**: `src/gateway/discovery-tools.test.ts:238` — "list_mcps accepts both an empty object and no arguments at all" asserts `parseMcps(withEmpty)` and `parseMcps(withNothing)` (args `undefined`) both return the full list. Fault m6 confirms this test is load-bearing.
- **All three schemas already declared `additionalProperties: false` on `main`**: verified via `git show main:src/gateway/discovery-tools.ts` — `list_mcps` line 73, `get_mcp_tools` line 85, `call_mcp_tool` line 104. The diff adds none. (`additionalProperties: true` at line 100 is the *nested* tool-args passthrough — correct.) The claim that this was decorative is proven by fault m1: with the runtime guard removed, the **integration** DISC-08 test fails, i.e. the SDK `Server` performs no inputSchema validation.

Scope note: widening to `get_mcp_tools`/`list_mcps` exceeds the task's stated `call_mcp_tool`-only scope, but it is 3 table entries in a tool-name-keyed guard that had to exist anyway — the narrower alternative would have required *more* code (a tool-name special case). Judged proportionate; no YAGNI objection.

### B4 — No test deleted / skipped / weakened: **CONFIRMED ✅**

- `it(` added: **9**; `it(` removed: **1** — and that one is a rename, not a deletion: `DISC-04: forwards {name, arguments}...` → `DISC-04: forwards args verbatim...`, body preserved with identical expected values (`src/gateway/discovery-tools.test.ts:364-365`). Net **+8** → 277 + 8 = **285** ✅ (matches the observed count exactly).
- No `.skip` / `.todo` / `.only` / `xit(` introduced (grep over added lines: none).
- **401 / token (MIG-01 / SEC-02)**: `test/integration/gateway-router.test.ts` diff is `+1 −1` — a single `arguments:` → `args:` payload key inside one call. No 401/token assertion touched.
- **SEC-10 no-leak**: `test/integration/gateway-secret-isolation.test.ts` diff is `+3 −2` — two payload renames plus one *added* assertion (`:177`). Every `assertNoLeak` call survives with identical arguments. Assertions were **strengthened, never weakened**.
- Other changed test files (`server-assembly`, `spike-token-handler-scope`, `gateway-router`) are `+1 −1` payload renames only — mechanically required by the field rename.

---

## Discrimination Sensor

Depth: **P0-full** (6 mutations ≥ 5, covering all branches of the new code). Each injected alone into scratch state, relevant test file(s) run, then `git checkout --` before the next.

| # | Mutation | File:line | Killed? | Killing test + failing assertion |
| --- | --- | --- | --- | --- |
| m1 | Unknown-field guard removed entirely | `discovery-tools.ts:349-352` | ✅ **Killed** (5 tests) | `discovery-tools.test.ts:215, 401, 420, 443` + `gateway-discovery.test.ts:176` — `expected undefined to be true` on `expect(result.isError).toBe(true)`. Also proves the SDK does not validate inputSchema. |
| m2 | Guard moved to **after** registry resolution | `discovery-tools.ts:322-327` | ✅ **Killed** (3 tests) | `discovery-tools.test.ts:417` — `expect(registry.getClient).not.toHaveBeenCalled()` → `expected "spy" to not be called at all, but actually been called 1 times` (also `:440`, `:460`) |
| m3 | Omitted `args` forwards `undefined` again | `discovery-tools.ts:327` | ✅ **Killed** (1 test) | `discovery-tools.test.ts:394` — `expect(result.calledWith).toEqual({ name:'search', arguments:{} })` → `expected { Object (name, arguments) } to deeply equal { name:'search', arguments:{} }` |
| m4 | Error names only the offending field, not `args` | `discovery-tools.ts:258-260` | ✅ **Killed** (3 tests) | `discovery-tools.test.ts:416` — `expected 'call_mcp_tool: unknown field "argumen…' to contain 'args'` (also `:437`, integration `:191`) |
| m5 | `arguments` accepted as a silent alias for `args` (the original bug) | `discovery-tools.ts:120, 313` | ✅ **Killed** (2 tests) | `discovery-tools.test.ts:420` — "the old field name `arguments` … must NOT silently pass as no-arguments"; `gateway-discovery.test.ts:198` |
| m6 | Shared guard made over-strict (rejects `list_mcps`' valid no-args call) | `discovery-tools.ts:254` | ✅ **Killed** (2 tests) | `discovery-tools.test.ts:238` — `TypeError: Cannot convert undefined or null to object` (also `routes list_mcps to its handler`) |

**Result**: **6/6 killed, 0 survived** — ✅ PASS. Every mutation was killed by an assertion introduced or strengthened by this fix.

**Sensor observation (non-blocking).** m4 did *not* fail the dispatch-level test `discovery-tools.test.ts:215`: its `expect(getTools.content[0].text).toContain('mcp')` (`:232`) is tautologically satisfied by the tool name `get_mcp_tools` in the message prefix. The assertion is weak, but it sits on a **beyond-spec** path — spec DISC-08 scopes the "names both" requirement to `call_mcp_tool`, where it *is* properly pinned (m4 killed via `:416`, `:437`, integration `:191`). Observation only, no fix task.

---

## Gate Check

| Gate | Command | Result |
| --- | --- | --- |
| Unit | `pnpm test:unit` | ✅ **193 passed**, 0 failed |
| Full | `pnpm test` | ✅ **285 passed** (41 files), 0 failed, 0 skipped |
| Lint | `pnpm lint` | ✅ ESLint: No issues found |
| Types | `npx tsc -p tsconfig.json --noEmit` | ✅ TypeScript: No errors found |

- **Test count before**: 277 (author's claim — independently reconstructed: 285 − 8 net new = 277 ✅)
- **Test count after**: 285 — **Delta: +8**
- **Skipped**: none. **Failures**: none.
- Full suite re-run after all sensor mutations were reverted: 285 passed → tree provably restored.

---

## Code Quality

| Check | Status |
| --- | --- |
| No features beyond what was asked | ✅ (guard widened to 3 meta-tools — 3 table entries; narrower would need more code) |
| No abstractions for single-use code | ✅ |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for task | ✅ |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ (tool-name-keyed table mirrors existing `CALL_TOOL_FIELD_ERRORS`) |
| Would a senior engineer approve? | ✅ |
| Tests map to ACs and are non-shallow | ✅ (verified by sensor, 6/6) |
| Spec-anchored outcome check | ✅ 5/5 |
| Every test maps to a spec requirement | ✅ (all 8 new tests cite DISC-04/08/09 or the over-strictness guard) |
| Comments explain *why*, no plan refs | ✅ (`discovery-tools.ts:97-100`, `:113-116`, `:324-326` explain the envelope collision and the `undefined` hazard; only stable AC IDs referenced) |

---

## Edge Cases

- [x] Consumer with 0 MCPs → `list_mcps` empty list, guard tolerates `{}` and no-args (`discovery-tools.test.ts:238`)
- [x] Nonexistent tool on a valid MCP → upstream isError proxied verbatim (`discovery-tools.test.ts:463`)
- [x] Identically-named tools on different MCPs → `{mcp, tool}` disambiguates (`discovery-tools.test.ts:481`)
- [x] Multiple unknown fields at once → all named (`discovery-tools.test.ts:443`)
- [x] `args` present but non-object (array) → DISC-06 error, not a guard error (`discovery-tools.test.ts:519-530`)

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| DISC-04 | Pending (Fix) | ✅ Verified |
| DISC-05 | Verified | ✅ Verified (not regressed; assertion strengthened) |
| DISC-06 | Verified | ✅ Verified |
| DISC-08 | Pending (Fix) | ✅ Verified |
| DISC-09 | Pending (Fix) | ✅ Verified |
| SEC-10 | Verified | ✅ Verified (success-path assertion strengthened) |
| MIG-01 | Verified | ✅ Verified (401/token untouched) |

---

## Deviations Accepted

| Deviation | Verdict |
| --- | --- |
| No DISC-09 integration test | **Accepted** — empirically proven fake coverage against the shared fixture (B2). DISC-09 is pinned at unit level with a value assertion on the forwarded payload. |
| Guard widened beyond `call_mcp_tool` | **Accepted** — proportionate; does not make `list_mcps` over-strict (m6). |

## Optional Hardening (not gaps, no fix tasks)

1. `spike-token-handler-scope.test.ts:159` — bare `expect(calledOther.isError).toBe(true)`; an exact-message pin would make that half self-guarding rather than relying on its `get_mcp_tools` sibling.
2. `discovery-tools.test.ts:232` — `toContain('mcp')` is tautological against the `get_mcp_tools` message prefix; `toContain('Valid fields: mcp')` would discriminate.

---

## Summary

**Overall**: ✅ **Ready**

**Spec-anchored check**: 5/5 ACs matched the spec-defined outcome, 0 spec-precision gaps
**Sensor**: 6/6 mutations killed
**Gate**: 285 passed, lint clean, tsc clean
**Author claims**: B1 ✅, B2 ✅, B3 ✅, B4 ✅ — all confirmed

**What works**: the root cause (envelope field-name collision) is removed at the schema, the runtime guard closes the "stray field degrades to no-arguments" hole at the single entry point before any registry contact, and `{}` forwarding makes a missing-parameter error legible. Crucially, the author identified that the field rename would silently hollow out two pre-existing tests and anchored both — independently reproduced here (a hollow test passes; the anchor fails it).

**Issues found**: none blocking. Two optional hardening notes above.

**Next steps**: ship. Tree left clean (only this report is new); nothing committed.
