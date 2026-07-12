import { useState } from 'react';
import type { ReactNode } from 'react';

/** Shared class vocabulary so every panel speaks the same visual language.
 * Buttons/inputs are 150-200ms transitions with pressed feedback; inputs are
 * 16px (text-base) to avoid mobile zoom. */
export const cls = {
  btnPrimary:
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition duration-150 hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
  btnGhost:
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line/15 px-3 py-2 text-sm font-medium text-dim transition duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
  btnDanger:
    'inline-flex cursor-pointer items-center rounded-md px-2 py-1 text-sm font-medium text-err/90 transition duration-150 hover:bg-err/10 hover:text-err active:scale-[0.98]',
  input:
    'w-full rounded-md border border-line/15 bg-raise/60 px-3 py-2 text-base text-ink placeholder:text-faint transition duration-150 focus:border-accent/50 focus:outline-none',
  label: 'block text-xs font-medium uppercase tracking-wider text-faint',
} as const;

export function SectionCard({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-lg border border-line/10 bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line/10 px-4 py-3">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">{title}</h3>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Copies `value` to the clipboard with a brief inline confirmation. */
export function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API can be unavailable on plain-HTTP LAN origins; fall back.
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={value}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-line/15 px-2 py-1 font-mono text-xs transition duration-150 active:scale-[0.98] ${
        copied ? 'border-ok/40 text-ok' : 'text-dim hover:bg-raise hover:text-ink'
      }`}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        {copied ? (
          <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </>
        )}
      </svg>
      {copied ? 'copied' : label}
    </button>
  );
}

const DOT_TONES: Record<string, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  idle: 'bg-faint',
};

export function StatusDot({ tone, pulse = false }: { tone: keyof typeof DOT_TONES; pulse?: boolean }): React.JSX.Element {
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden>
      <span className={`h-2 w-2 rounded-full ${DOT_TONES[tone]} ${pulse ? 'animate-pulse-dot' : ''}`} />
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-line/15 px-6 py-10 text-center">
      <svg viewBox="0 0 24 24" className="mb-1 h-6 w-6 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
        <path d="M12 8v4l2.5 2.5" strokeLinecap="round" />
      </svg>
      <p className="text-sm font-medium text-dim">{title}</p>
      <p className="max-w-sm text-xs text-faint">{hint}</p>
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-raise" />
          <div className="h-3 rounded bg-raise" style={{ width: `${52 + ((i * 17) % 34)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Inline error line, placed near the action that caused it. */
export function ErrorNote({ message }: { message: string | null }): React.JSX.Element | null {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-err/25 bg-err/10 px-3 py-2 text-sm text-err">
      {message}
    </p>
  );
}
