/**
 * Simplified, original brand-colored marks for each MCP client (not exact
 * reproductions of trademarked logos) — enough to identify a client at a
 * glance; the full name always rides along as a title/aria-label at the call
 * site. Colored marks keep their brand hue; monochrome ones use currentColor
 * so they tint with the active/inactive state.
 */
interface IconProps {
  className?: string;
}

/** Anthropic Claude — a terracotta radial "spark". */
export function ClaudeIcon({ className = 'h-4 w-4' }: IconProps): React.JSX.Element {
  const rays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g stroke="#D97757" strokeWidth="1.8" strokeLinecap="round">
        {rays.map((deg) => (
          <line key={deg} x1="12" y1="10.4" x2="12" y2="3.6" transform={`rotate(${deg} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

/** Cursor — a monochrome pointer glyph (tints with currentColor). */
export function CursorIcon({ className = 'h-4 w-4' }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M5 2.5 L5 19.5 L9.4 15.1 L12.6 21.8 L15.1 20.6 L11.9 14 L18.2 14 Z" />
    </svg>
  );
}

/** VS Code — the blue folded-ribbon silhouette (approximation). */
export function VSCodeIcon({ className = 'h-4 w-4' }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#0098ff" aria-hidden>
      <path d="M18.2 2.1 L21.6 3.8 L21.6 20.2 L18.2 21.9 L8.6 13 L4.6 16.6 L2.4 15.4 L2.4 8.6 L4.6 7.4 L8.6 11 Z M18.1 6.3 L11.5 12 L18.1 17.7 Z" />
    </svg>
  );
}

/** Codex (OpenAI) — a monochrome six-petal blossom (tints with currentColor). */
export function CodexIcon({ className = 'h-4 w-4' }: IconProps): React.JSX.Element {
  const petals = [0, 60, 120, 180, 240, 300];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      {petals.map((deg) => (
        <ellipse key={deg} cx="12" cy="8.2" rx="3" ry="5.6" transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}
