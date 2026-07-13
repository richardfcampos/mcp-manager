import { useState } from 'react';
import { writeConfigs } from '../api-client.js';
import type { Consumer, McpServer } from '../api-types.js';
import FormatSelector from './format-selector.js';
import McpToggleChips from './mcp-toggle-chips.js';
import { shortNameOf } from './project-category-utils.js';
import { CopyButton, StatusDot } from './ui-primitives.js';

interface ProjectRowProps {
  consumer: Consumer;
  /** Every registered MCP (for the inline assignment editor). */
  servers: McpServer[];
  /** MCP ids currently assigned to this consumer (from the matrix). */
  assignedMcpIds: string[];
  onChanged: () => void | Promise<void>;
}

/** One ledger row: availability, name, origin tag, an expandable MCP badge
 * (inline per-project assignment chips -- the primary flow once there are
 * many MCPs), client-format chips, gateway-URL copy and a scoped config
 * write for THIS project only. */
export default function ProjectRow({
  consumer,
  servers,
  assignedMcpIds,
  onChanged,
}: ProjectRowProps): React.JSX.Element {
  const [writeState, setWriteState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [writeNote, setWriteNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  const gatewayUrl = `${window.location.origin}/mcp/${consumer.token}`;
  const assignedCount = assignedMcpIds.length;

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
    <li className={`group transition duration-150 hover:bg-raise/50 ${consumer.available ? '' : 'opacity-45'}`}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot tone={consumer.available ? 'ok' : 'err'} />
          <span className="truncate font-mono text-sm font-medium text-ink" title={consumer.path}>
            {shortNameOf(consumer)}
          </span>
          {consumer.type === 'project' && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              title="Grant or revoke MCPs for this project"
              className={`inline-flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[11px] transition duration-150 active:scale-[0.98] ${
                assignedCount > 0
                  ? 'bg-accent/12 font-semibold text-accent hover:bg-accent/20'
                  : 'border border-line/10 text-faint hover:bg-raise hover:text-dim'
              }`}
            >
              {assignedCount > 0 ? `${assignedCount} mcp${assignedCount > 1 ? 's' : ''}` : 'no mcps'}
              <svg viewBox="0 0 12 12" className={`h-2 w-2 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} fill="currentColor" aria-hidden>
                <path d="M2 4l4 4 4-4z" />
              </svg>
            </button>
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
      </div>

      {expanded && consumer.type === 'project' && (
        <div className="border-t border-line/5 bg-raise/30 px-4 py-3 pl-9">
          <McpToggleChips
            consumerId={consumer.id}
            servers={servers}
            assignedMcpIds={assignedMcpIds}
            onChanged={onChanged}
          />
        </div>
      )}
    </li>
  );
}
