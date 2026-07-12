import { useState } from 'react';
import { writeConfigs } from '../api-client.js';
import type { Consumer } from '../api-types.js';
import FormatSelector from './format-selector.js';
import { shortNameOf } from './project-category-utils.js';
import { CopyButton, StatusDot } from './ui-primitives.js';

interface ProjectRowProps {
  consumer: Consumer;
  /** How many MCPs are currently assigned to this consumer (from the matrix). */
  assignedCount: number;
  onChanged: () => void | Promise<void>;
}

/** One ledger row: availability, name, origin tag, assigned-MCP count,
 * client-format chips, gateway-URL copy, and a per-project config write
 * (scoped `write-configs` -- writes/cleans only THIS project's files). */
export default function ProjectRow({ consumer, assignedCount, onChanged }: ProjectRowProps): React.JSX.Element {
  const [writeState, setWriteState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [writeNote, setWriteNote] = useState('');
  const gatewayUrl = `${window.location.origin}/mcp/${consumer.token}`;

  async function writeThisProject(): Promise<void> {
    setWriteState('busy');
    try {
      const { results } = await writeConfigs([consumer.id]);
      const failed = results.filter((r) => r.status === 'error');
      if (failed.length > 0) {
        setWriteState('failed');
        setWriteNote(failed[0].error ?? 'write failed');
      } else {
        setWriteState('done');
        setWriteNote(results.map((r) => `${r.format}: ${r.status}`).join(' · ') || 'nothing to write');
      }
    } catch (err) {
      setWriteState('failed');
      setWriteNote(err instanceof Error ? err.message : 'write failed');
    }
    setTimeout(() => setWriteState('idle'), 4000);
  }

  return (
    <li
      className={`group grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-2.5 transition duration-150 hover:bg-raise/50 sm:grid-cols-[minmax(0,1fr)_auto] ${
        consumer.available ? '' : 'opacity-45'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot tone={consumer.available ? 'ok' : 'err'} />
        <span className="truncate font-mono text-sm font-medium text-ink" title={consumer.path}>
          {shortNameOf(consumer)}
        </span>
        {assignedCount > 0 ? (
          <span className="rounded-sm bg-accent/12 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent">
            {assignedCount} mcp{assignedCount > 1 ? 's' : ''}
          </span>
        ) : (
          <span className="rounded-sm border border-line/10 px-1.5 py-0.5 font-mono text-[11px] text-faint">
            no mcps
          </span>
        )}
        {!consumer.discovered && (
          <span className="rounded-sm border border-line/10 px-1.5 py-0.5 font-mono text-[11px] text-faint">manual</span>
        )}
        {!consumer.available && (
          <span className="rounded-sm border border-err/25 px-1.5 py-0.5 font-mono text-[11px] text-err">missing</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {consumer.type === 'project' && <FormatSelector consumer={consumer} onChange={onChanged} />}
        <CopyButton value={gatewayUrl} label="url" />
        {consumer.type === 'project' && (
          <button
            type="button"
            onClick={() => void writeThisProject()}
            disabled={writeState === 'busy' || !consumer.available}
            title={writeNote || 'Write this project’s client config files'}
            className={`inline-flex cursor-pointer items-center rounded-md border px-2 py-1 font-mono text-xs transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${
              writeState === 'done'
                ? 'border-ok/40 text-ok'
                : writeState === 'failed'
                  ? 'border-err/40 text-err'
                  : 'border-line/15 text-dim hover:bg-raise hover:text-ink'
            }`}
          >
            {writeState === 'busy' ? 'writing…' : writeState === 'done' ? 'written' : writeState === 'failed' ? 'failed' : 'write cfg'}
          </button>
        )}
      </div>
    </li>
  );
}
