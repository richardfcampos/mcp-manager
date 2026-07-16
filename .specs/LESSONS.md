# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 — Task que muda um type compartilhado precisa de gate build (tsc) na propria task: test:unit/test nao compilam fixtures de outros modulos e o erro fica latente ate a fase final
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `src/domain` · harmful: 0
- features: gateway-discovery
- evidence: InsertServerInput purpose / pnpm build pos-fase-1 (src/domain)
- last seen: 2026-07-16T15:34:25Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
