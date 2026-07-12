import { useState } from 'react';
import { writeConfigs } from '../api-client.js';
import type { WriteConfigResult, WriteConfigStatus } from '../api-types.js';
import { ErrorNote, SectionCard, cls } from './ui-primitives.js';

const STATUS_TONES: Record<WriteConfigStatus, string> = {
  written: 'text-ok',
  removed: 'text-warn',
  unchanged: 'text-faint',
  error: 'text-err',
};

/** CFG-01/02: triggers write-configs for every consumer and renders the
 * per-project result (written/unchanged/removed/error) -- one project's
 * failure is isolated by the server and never hides the others' outcomes.
 * For a single project, use the scoped `write cfg` action on its row in
 * the Projects tab instead. */
export default function WriteConfigsButton(): React.JSX.Element {
  const [results, setResults] = useState<WriteConfigResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const response = await writeConfigs();
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'write-configs failed');
    } finally {
      setSubmitting(false);
    }
  }

  const summary = results
    ? (['written', 'removed', 'unchanged', 'error'] as const)
        .map((status) => [status, results.filter((r) => r.status === status).length] as const)
        .filter(([, count]) => count > 0)
    : [];

  return (
    <SectionCard
      title="Write client configs"
      aside={
        <button type="button" onClick={() => void handleClick()} disabled={submitting} className={cls.btnPrimary}>
          {submitting ? 'Writing…' : 'Write all projects'}
        </button>
      }
    >
      <p className="text-xs text-faint">
        Writes each project's selected config formats against its current assignments. For one project only, use
        the <span className="font-mono">write cfg</span> action on its row in the Projects tab.
      </p>

      <div className="mt-3 space-y-3">
        <ErrorNote message={error} />

        {results && (
          <>
            <div className="flex flex-wrap gap-2">
              {summary.map(([status, count]) => (
                <span key={status} className={`rounded-sm border border-line/10 px-2 py-0.5 font-mono text-xs ${STATUS_TONES[status]}`}>
                  {count} {status}
                </span>
              ))}
              {results.length === 0 && <span className="text-sm text-faint">No projects to write configs for yet.</span>}
            </div>

            {results.length > 0 && (
              <ul className="max-h-72 divide-y divide-line/5 overflow-auto rounded-md border border-line/10">
                {results.map((result) => (
                  <li key={`${result.consumerId}-${result.format}`} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="w-10 shrink-0 font-mono text-[11px] text-faint">{result.format}</span>
                    <span className="truncate font-mono text-xs text-dim" title={result.path}>
                      {result.path}
                    </span>
                    <span className={`ml-auto shrink-0 font-mono text-xs ${STATUS_TONES[result.status]}`}>
                      {result.status}
                      {result.error ? ` — ${result.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
