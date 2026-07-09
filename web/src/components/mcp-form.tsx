import { useEffect, useState } from 'react';
import { createMcpServer, updateMcpServer } from '../api-client.js';
import type { McpServer, McpServerSecretInput } from '../api-types.js';

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
  const [kind, setKind] = useState<'stdio' | 'remote'>(mcp?.transport === 'stdio' ? 'stdio' : 'remote');
  const [command, setCommand] = useState(mcp?.command ?? '');
  const [args, setArgs] = useState((mcp?.args ?? []).join(' '));
  const [url, setUrl] = useState(mcp?.url ?? '');
  const [sse, setSse] = useState(mcp?.transport === 'sse');
  const [headersText, setHeadersText] = useState(mcp?.headers ? JSON.stringify(mcp.headers) : '');
  const [secrets, setSecrets] = useState<SecretDraft[]>([{ ...EMPTY_SECRET }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(mcp?.name ?? '');
    setKind(mcp?.transport === 'stdio' ? 'stdio' : 'remote');
    setCommand(mcp?.command ?? '');
    setArgs((mcp?.args ?? []).join(' '));
    setUrl(mcp?.url ?? '');
    setSse(mcp?.transport === 'sse');
    setHeadersText(mcp?.headers ? JSON.stringify(mcp.headers) : '');
    setSecrets([{ ...EMPTY_SECRET }]);
    setError(null);
  }, [mcp]);

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
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h3 className="text-lg font-semibold text-slate-900">{mcp ? `Edit ${mcp.name}` : 'Register MCP server'}</h3>

      <label className="block text-sm font-medium text-slate-700">
        Name
        <input
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>

      {!mcp && (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={kind === 'stdio'} onChange={() => setKind('stdio')} />
            stdio
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={kind === 'remote'} onChange={() => setKind('remote')} />
            remote
          </label>
        </div>
      )}

      {kind === 'stdio' ? (
        <>
          <label className="block text-sm font-medium text-slate-700">
            Command
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npx"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Args (space-separated)
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="-y some-mcp-package"
            />
          </label>
        </>
      ) : (
        <>
          <label className="block text-sm font-medium text-slate-700">
            URL
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={sse} onChange={(event) => setSse(event.target.checked)} />
            SSE transport
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Headers (JSON)
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              value={headersText}
              onChange={(event) => setHeadersText(event.target.value)}
              placeholder='{"Authorization":"Bearer ..."}'
            />
          </label>
        </>
      )}

      {mcp && mcp.secrets.length > 0 && (
        <p className="text-sm text-slate-600">
          Existing secrets: {mcp.secrets.map((secret) => `${secret.envKey} (${secret.hasValue ? 'set' : 'unset'})`).join(', ')}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">
          {mcp ? 'Replace/add secret env values' : 'Secret env values'}
        </p>
        {secrets.map((secret, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="w-1/3 rounded border border-slate-300 px-2 py-1"
              placeholder="ENV_KEY"
              value={secret.envKey}
              onChange={(event) => updateSecret(index, 'envKey', event.target.value)}
            />
            <input
              className="flex-1 rounded border border-slate-300 px-2 py-1"
              type="password"
              placeholder="value"
              value={secret.value}
              onChange={(event) => updateSecret(index, 'value', event.target.value)}
            />
            <button type="button" onClick={() => removeSecretRow(index)} className="text-slate-500">
              remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addSecretRow} className="text-sm text-blue-600">
          + add secret
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {mcp ? 'Save changes' : 'Create MCP'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
