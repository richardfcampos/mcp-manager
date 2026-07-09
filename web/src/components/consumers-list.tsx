import { useCallback, useEffect, useState } from 'react';
import { discoverConsumers, listConsumers, registerProjectConsumer } from '../api-client.js';
import type { Consumer } from '../api-types.js';

/** Lists discovered + manually-registered consumers (PRJ-01/02/03) with a
 * rescan action (workspace auto-discovery) and manual project registration. */
export default function ConsumersList(): React.JSX.Element {
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConsumers(await listConsumers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load consumers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRescan(): Promise<void> {
    setError(null);
    try {
      await discoverConsumers();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rescan failed');
    }
  }

  async function handleRegister(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await registerProjectConsumer(newPath, newName || undefined);
      setNewPath('');
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">Projects &amp; consumers</h3>
        <button
          type="button"
          onClick={() => void handleRescan()}
          className="rounded border border-slate-300 px-3 py-1 text-sm"
        >
          Rescan workspace
        </button>
      </div>

      <form onSubmit={(event) => void handleRegister(event)} className="flex gap-2">
        <input
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="/absolute/path/to/project"
          value={newPath}
          onChange={(event) => setNewPath(event.target.value)}
          required
        />
        <input
          className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="Name (optional)"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white">
          Register
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : consumers.length === 0 ? (
        <p className="text-sm text-slate-500">
          No projects yet. Rescan the mounted workspace or register a path above.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1">Name</th>
              <th>Type</th>
              <th>Path</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {consumers.map((consumer) => (
              <tr key={consumer.id} className="border-t border-slate-100">
                <td className="py-1">{consumer.name}</td>
                <td>{consumer.type}</td>
                <td className="max-w-xs truncate">{consumer.path}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <span className={consumer.available ? 'text-green-600' : 'text-red-600'}>
                    {consumer.available ? 'available' : 'unavailable'}
                  </span>
                  <span className="text-slate-400">{consumer.discovered ? 'discovered' : 'manual'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
