import { useEffect, useState } from 'react';
import { createMcpServer, updateMcpServer } from '../api-client.js';
import type { McpServer, McpServerSecretInput } from '../api-types.js';
import { ErrorNote, cls } from './ui-primitives.js';

export interface McpFormProps {
  /** When set, the form edits this existing MCP instead of creating a new
   * one; the transport ('stdio' | 'remote') is fixed once created. */
  mcp?: McpServer;
  onSaved: (server: McpServer) => void;
  onCancel?: () => void;
}

interface SecretDraft {
  envKey: string;
  value: string;
}

const EMPTY_SECRET: SecretDraft = { envKey: '', value: '' };

/** Create/edit form for an MCP server (MCP-01/02/03): toggles between stdio
 * and remote field sets, posts through the typed api-client, and -- in edit
 * mode -- shows each existing secret's `hasValue` flag instead of ever
 * rendering its plaintext (SEC-01; the server never returns it anyway). */
export default function McpForm({ mcp, onSaved, onCancel }: McpFormProps): React.JSX.Element {
  const [name, setName] = useState(mcp?.name ?? '');
  // New MCPs default to stdio (the common case: npx/uvx packages).
  const [kind, setKind] = useState<'stdio' | 'remote'>(!mcp || mcp.transport === 'stdio' ? 'stdio' : 'remote');
  const [command, setCommand] = useState(mcp?.command ?? '');
  const [args, setArgs] = useState((mcp?.args ?? []).join(' '));
  const [url, setUrl] = useState(mcp?.url ?? '');
  const [sse, setSse] = useState(mcp?.transport === 'sse');
  const [headersText, setHeadersText] = useState(mcp?.headers ? JSON.stringify(mcp.headers) : '');
  const [secrets, setSecrets] = useState<SecretDraft[]>([{ ...EMPTY_SECRET }]);
  const [removeKeys, setRemoveKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(mcp?.name ?? '');
    setKind(!mcp || mcp.transport === 'stdio' ? 'stdio' : 'remote');
    setCommand(mcp?.command ?? '');
    setArgs((mcp?.args ?? []).join(' '));
    setUrl(mcp?.url ?? '');
    setSse(mcp?.transport === 'sse');
    setHeadersText(mcp?.headers ? JSON.stringify(mcp.headers) : '');
    setSecrets([{ ...EMPTY_SECRET }]);
    setRemoveKeys([]);
    setError(null);
  }, [mcp]);

  function toggleRemoveKey(envKey: string): void {
    setRemoveKeys((current) =>
      current.includes(envKey) ? current.filter((key) => key !== envKey) : [...current, envKey],
    );
  }

  function updateSecret(index: number, field: keyof SecretDraft, value: string): void {
    setSecrets((current) => current.map((secret, i) => (i === index ? { ...secret, [field]: value } : secret)));
  }

  function addSecretRow(): void {
    setSecrets((current) => [...current, { ...EMPTY_SECRET }]);
  }

  function removeSecretRow(index: number): void {
    setSecrets((current) => current.filter((_, i) => i !== index));
  }

  /** Throws a clear message on invalid JSON instead of silently sending a
   * broken headers object to the server. */
  function parseHeaders(): Record<string, string> | undefined {
    if (!headersText.trim()) return undefined;
    try {
      return JSON.parse(headersText) as Record<string, string>;
    } catch {
      throw new Error('Headers must be valid JSON, e.g. {"Authorization":"Bearer x"}');
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const filledSecrets: McpServerSecretInput[] = secrets.filter(
        (secret) => secret.envKey.trim() && secret.value.trim(),
      );
      const headers = parseHeaders();

      const saved = mcp
        ? await updateMcpServer(mcp.id, {
            name,
            command: kind === 'stdio' ? command : null,
            args: kind === 'stdio' ? args.split(' ').filter(Boolean) : null,
            url: kind === 'remote' ? url : null,
            headers: kind === 'remote' ? (headers ?? null) : null,
            secrets: filledSecrets.length ? filledSecrets : undefined,
            removeSecretKeys: removeKeys.length ? removeKeys : undefined,
          })
        : await createMcpServer({
            name,
            kind,
            command: kind === 'stdio' ? command : undefined,
            args: kind === 'stdio' ? args.split(' ').filter(Boolean) : undefined,
            url: kind === 'remote' ? url : undefined,
            sse: kind === 'remote' ? sse : undefined,
            headers: kind === 'remote' ? headers : undefined,
            secrets: filledSecrets.length ? filledSecrets : undefined,
          });

      onSaved(saved);
      if (!mcp) {
        setName('');
        setCommand('');
        setArgs('');
        setUrl('');
        setSecrets([{ ...EMPTY_SECRET }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MCP server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="rounded-lg border border-line/10 bg-surface">
      <header className="border-b border-line/10 px-4 py-3">
        <h3 className="font-display text-base font-semibold tracking-tight text-ink">
          {mcp ? `Edit ${mcp.name}` : 'Register an MCP server'}
        </h3>
        {!mcp && <p className="mt-0.5 text-xs text-faint">Defined once here; projects opt in via the access matrix.</p>}
      </header>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="mcp-name" className={cls.label}>
              Name
            </label>
            <input
              id="mcp-name"
              className={`${cls.input} mt-1`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="github"
              required
            />
          </div>

          {!mcp && (
            <div>
              <span className={cls.label}>Transport</span>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border border-line/15" role="group" aria-label="Transport kind">
                {(['stdio', 'remote'] as const).map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={kind === option}
                    onClick={() => setKind(option)}
                    className={`cursor-pointer px-3 py-2 font-mono text-sm transition duration-150 ${index > 0 ? 'border-l border-line/15' : ''} ${
                      kind === option ? 'bg-accent/15 font-semibold text-accent' : 'text-faint hover:bg-raise hover:text-dim'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {kind === 'stdio' ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div>
              <label htmlFor="mcp-command" className={cls.label}>
                Command
              </label>
              <input
                id="mcp-command"
                className={`${cls.input} mt-1 font-mono text-sm`}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx"
              />
            </div>
            <div>
              <label htmlFor="mcp-args" className={cls.label}>
                Args <span className="normal-case">(space-separated)</span>
              </label>
              <input
                id="mcp-args"
                className={`${cls.input} mt-1 font-mono text-sm`}
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder="-y @modelcontextprotocol/server-github"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor="mcp-url" className={cls.label}>
                URL
              </label>
              <input
                id="mcp-url"
                className={`${cls.input} mt-1 font-mono text-sm`}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line/15 px-3 py-2 text-sm text-dim">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#9be870]"
                  checked={sse}
                  onChange={(event) => setSse(event.target.checked)}
                />
                Legacy SSE transport
              </label>
              <div className="min-w-64 flex-1">
                <label htmlFor="mcp-headers" className={cls.label}>
                  Headers <span className="normal-case">(JSON)</span>
                </label>
                <input
                  id="mcp-headers"
                  className={`${cls.input} mt-1 font-mono text-sm`}
                  value={headersText}
                  onChange={(event) => setHeadersText(event.target.value)}
                  placeholder='{"Authorization":"Bearer ..."}'
                />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-md border border-line/10 bg-raise/40 p-3">
          <p className={cls.label}>{mcp ? 'Replace / add secret env values' : 'Secret env values'}</p>
          <p className="mt-0.5 text-xs text-faint">
            Encrypted at rest; injected into the MCP process env. Never shown again after saving.
          </p>
          {mcp && mcp.secrets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {mcp.secrets.map((secret) => {
                const marked = removeKeys.includes(secret.envKey);
                return (
                  <li key={secret.envKey} className="flex items-center gap-2 font-mono text-xs">
                    <span className={marked ? 'text-err/80 line-through' : 'text-dim'}>
                      {secret.envKey} = {secret.hasValue ? '●●●' : 'unset'}
                    </span>
                    {marked && <span className="text-[11px] text-err">removes on save</span>}
                    <button
                      type="button"
                      onClick={() => toggleRemoveKey(secret.envKey)}
                      aria-label={marked ? `Keep secret ${secret.envKey}` : `Remove secret ${secret.envKey}`}
                      className={`cursor-pointer rounded-md px-1.5 py-0.5 transition duration-150 ${
                        marked ? 'text-dim hover:bg-raise hover:text-ink' : 'text-err/80 hover:bg-err/10 hover:text-err'
                      }`}
                    >
                      {marked ? 'undo' : '✕'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2 space-y-2">
            {secrets.map((secret, index) => (
              // Width lives on wrapper divs: cls.input carries w-full, and
              // stacking a second width utility on the same element makes the
              // winner depend on generated-CSS order, not class order.
              <div key={index} className="flex items-center gap-2">
                <div className="w-2/5">
                  <input
                    className={`${cls.input} font-mono text-sm`}
                    placeholder="ENV_KEY"
                    aria-label={`Secret ${index + 1} env key`}
                    value={secret.envKey}
                    onChange={(event) => updateSecret(index, 'envKey', event.target.value)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    className={`${cls.input} font-mono text-sm`}
                    type="password"
                    placeholder="value"
                    aria-label={`Secret ${index + 1} value`}
                    value={secret.value}
                    onChange={(event) => updateSecret(index, 'value', event.target.value)}
                  />
                </div>
                <button type="button" onClick={() => removeSecretRow(index)} className={cls.btnDanger} aria-label={`Remove secret ${index + 1}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addSecretRow} className="mt-2 cursor-pointer text-sm font-medium text-accent transition hover:brightness-110">
            + add secret
          </button>
        </div>

        <ErrorNote message={error} />

        <div className="flex gap-2">
          <button type="submit" disabled={submitting} className={cls.btnPrimary}>
            {submitting ? 'Saving…' : mcp ? 'Save changes' : 'Create MCP'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={cls.btnGhost}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
