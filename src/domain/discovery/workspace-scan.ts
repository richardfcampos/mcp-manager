import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { nowIso } from '../../db/repository-helpers.js';
import * as consumersRepository from '../consumers/consumers-repository.js';

export interface WorkspaceScanDeps {
  db: Database.Database;
}

/** Ids of consumers touched by this scan, split by what changed. */
export interface WorkspaceScanResult {
  /** Every discovered-project consumer id present on disk this run
   * (whether newly inserted, already existing, or restored). */
  present: string[];
  /** Ids newly marked available=false because their folder vanished. */
  vanished: string[];
  /** Ids that flipped back to available=true because their folder reappeared. */
  restored: string[];
}

function isUnderRoot(path: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(normalizedRoot);
}

/** PRJ-01/PRJ-03: upserts one discovered `project` consumer per immediate
 * subdirectory of `rootPath` (files and nested subfolders are ignored),
 * restores available=true for folders that reappeared, and marks
 * previously-discovered consumers under this root whose folder vanished as
 * available=false WITHOUT touching their assignment rows. Re-scanning an
 * unchanged tree is idempotent (no state change). */
export function scanWorkspace(deps: WorkspaceScanDeps, rootPath: string): WorkspaceScanResult {
  const immediateDirs = readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const currentPaths = new Set(immediateDirs.map((name) => join(rootPath, name)));

  const present: string[] = [];
  const restored: string[] = [];
  for (const dirName of immediateDirs) {
    const path = join(rootPath, dirName);
    const wasUnavailable = consumersRepository.getByPath(deps.db, path)?.available === false;

    const consumer = consumersRepository.upsertDiscovered(deps.db, {
      path,
      name: dirName,
      createdAt: nowIso(),
    });
    present.push(consumer.id);

    if (wasUnavailable) {
      consumersRepository.setAvailable(deps.db, consumer.id, true);
      restored.push(consumer.id);
    }
  }

  const vanished: string[] = [];
  const discoveredUnderRoot = consumersRepository
    .listConsumers(deps.db)
    .filter((consumer) => consumer.discovered && isUnderRoot(consumer.path, rootPath));

  for (const consumer of discoveredUnderRoot) {
    if (!currentPaths.has(consumer.path) && consumer.available) {
      consumersRepository.setAvailable(deps.db, consumer.id, false);
      vanished.push(consumer.id);
    }
  }

  return { present, vanished, restored };
}
