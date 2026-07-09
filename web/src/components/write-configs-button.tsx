import { useState } from 'react';
import { writeConfigs } from '../api-client.js';
import type { WriteConfigResult } from '../api-types.js';

/** CFG-01/02: triggers write-configs for every consumer and renders the
 * per-project result (written/unchanged/removed/error) -- one project's
 * failure is isolated by the server and never hides the others' outcomes. */
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

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Write client configs</h3>
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={submitting}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Writing…' : 'Write configs'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results && (
        <ul className="space-y-1 text-sm">
          {results.length === 0 && <li className="text-slate-500">No projects to write configs for yet.</li>}
          {results.map((result) => (
            <li key={`${result.consumerId}-${result.format}`} className="flex justify-between gap-2">
              <span className="truncate">{result.path}</span>
              <span className={result.status === 'error' ? 'text-red-600' : 'text-green-600'}>
                {result.status}
                {result.error ? `: ${result.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
