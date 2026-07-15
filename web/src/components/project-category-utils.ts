import type { Consumer } from '../api-types.js';

/** Derives a grouping category for a consumer. Two-level discovered projects
 * are named `<category>/<project>`; older single-level ones fall back to the
 * parent directory of their path, so both discovery eras group consistently. */
export function categoryOf(consumer: Consumer): string {
  if (consumer.type === 'desktop-profile') return 'desktop profiles';
  if (consumer.name.includes('/')) return consumer.name.split('/')[0];
  const segments = consumer.path.split('/').filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2] : 'workspace';
}

/** Name without the category prefix (what the row actually displays). */
export function shortNameOf(consumer: Consumer): string {
  return consumer.name.includes('/')
    ? consumer.name.split('/').slice(1).join('/')
    : consumer.name;
}

export interface ConsumerGroup {
  category: string;
  items: Consumer[];
}

/** Groups + sorts: categories alphabetically, items alphabetically with
 * unavailable ones sunk to the bottom of their group. */
export function groupConsumers(consumers: Consumer[]): ConsumerGroup[] {
  const byCategory = new Map<string, Consumer[]>();
  for (const consumer of consumers) {
    const category = categoryOf(consumer);
    const bucket = byCategory.get(category) ?? [];
    bucket.push(consumer);
    byCategory.set(category, bucket);
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return shortNameOf(a).localeCompare(shortNameOf(b));
      }),
    }));
}

/** Case-insensitive match on name or path for the filter box. */
export function matchesQuery(consumer: Consumer, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return consumer.name.toLowerCase().includes(q) || consumer.path.toLowerCase().includes(q);
}
