# Design guidelines — mcp/manager console

Aesthetic direction: **network-ops console**. Dark graphite-green, one phosphor
accent, hairline dividers over heavy cards, monospace for data. All future UI
work should extend this language, not introduce a new one.

## Tokens (source of truth: `web/src/index.css` + `web/tailwind.config.js`)

| Token | Value | Use |
| ----- | ----- | --- |
| `bg` | `#0c0f0d` | page background (never pure black) |
| `surface` | `#121613` | panels |
| `raise` | `#1a1f1b` | hover states, nested panels |
| `line` | `#e8ede6` @ 5–15% | hairline borders/dividers |
| `ink` / `dim` / `faint` | `#e8ede6` / `#a4b0a4` / `#7e897f` | text hierarchy |
| `accent` | `#9be870` | THE accent: primary buttons, active states, live dots |
| `ok` / `warn` / `err` | `#7fd98b` / `#e3c36b` / `#e2744f` | status semantics |

## Typography (self-hosted via Fontsource — no network dependency)

- `font-display` — **Bricolage Grotesque** (wordmark, panel titles, group headers)
- `font-sans` — **IBM Plex Sans** (body, controls)
- `font-mono` — **IBM Plex Mono** (paths, tokens, slugs, counters — always `tabular-nums` for numbers)

Never introduce Inter/Roboto/Arial. Inputs are ≥16px (`text-base`) to avoid mobile zoom.

## Patterns

- Shared primitives live in `web/src/components/ui-primitives.tsx` (`cls.*`,
  `SectionCard`, `CopyButton`, `StatusDot`, `EmptyState`, `SkeletonRows`,
  `ErrorNote`). Use them before writing new styles.
- **Width utilities:** `cls.input` carries `w-full`. Never stack another width
  utility on the same element (CSS-order roulette) — put the width on a
  wrapper `div`.
- Density: rows + `divide-line/5` dividers, not per-item cards. Group headers
  are sticky, uppercase, `font-display` tracking-widest.
- Motion: 150ms transitions, `active:scale-[0.98]`, one pulsing status dot;
  `prefers-reduced-motion` is respected globally in `index.css`.
- States: every async view has skeleton + designed empty state + inline
  `ErrorNote` near the action. Destructive actions are two-step (Confirm).
- Icons: small hand-drawn inline SVGs (stroke 1.4–1.5), not icon-library defaults.
- Texture: global grain + top radial accent wash live in `index.css` — do not
  add per-component glows.
