import { useState } from 'react';
import type { McpServer } from '../api-types.js';
import { EmptyState, SectionCard } from './ui-primitives.js';

interface McpServerListProps {
  servers: McpServer[];
  onEdit: (server: McpServer) => void;
  onDelete: (id: string) => void | Promise<void>;
}

const TRANSPORT_TONES: Record<McpServer['transport'], string> = {
  stdio: 'border-accent/30 text-accent',
  http: 'border-warn/35 text-warn',
  sse: 'border-warn/35 text-warn',
};

/** Registered MCP catalog: slug + transport badge + secret count per row,
 * with edit and a two-step (confirm) delete -- deleting cascades assignments
 * and rewrites affected project configs server-side (ACC-02). */
export default function McpServerList({ servers, onEdit, onDelete }: McpServerListProps): React.JSX.Element {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <SectionCard
      title="Registered MCP servers"
      aside={<span className="font-mono text-xs text-faint">{servers.length}</span>}
    >
      {servers.length === 0 ? (
        <EmptyState
          title="No MCP servers yet"
          hint="Register the first one above — stdio (npx/uvx) or a remote endpoint."
        />
      ) : (
        <ul className="-m-4 divide-y divide-line/5">
          {servers.map((server) => (
            <li key={server.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition duration-150 hover:bg-raise/50">
              <span className="font-mono text-sm font-medium text-ink">{server.slug}</span>
              <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[11px] ${TRANSPORT_TONES[server.transport]}`}>
                {server.transport}
              </span>
              {server.secrets.length > 0 && (
                <span className="rounded-sm border border-line/10 px-1.5 py-0.5 font-mono text-[11px] text-faint">
                  {server.secrets.length} secret{server.secrets.length > 1 ? 's' : ''}
                </span>
              )}
              <span className="hidden truncate font-mono text-xs text-faint sm:inline">
                {server.transport === 'stdio'
                  ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
                  : server.url}
              </span>
              {server.purpose && (
                <span className="w-full truncate text-xs text-faint" title={server.purpose}>
                  {server.purpose}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(server)}
                  className="cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-dim transition duration-150 hover:bg-raise hover:text-ink"
                >
                  Edit
                </button>
                {confirmingId === server.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                        void onDelete(server.id);
                      }}
                      className="cursor-pointer rounded-md bg-err/15 px-2 py-1 text-sm font-semibold text-err transition duration-150 hover:bg-err/25"
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="cursor-pointer rounded-md px-2 py-1 text-sm text-dim transition duration-150 hover:text-ink"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(server.id)}
                    className="cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-err/80 transition duration-150 hover:bg-err/10 hover:text-err"
                  >
                    Delete
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
