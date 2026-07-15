import { existsSync, readdirSync } from 'node:fs';
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

/** Files whose presence marks a directory as a project root (rather than a
 * container/category folder). Kept broad so mixed-stack workspaces are found;
 * over-inclusion is preferable to missing a project during discovery. */
const PROJECT_MARKERS = [
  'package.json',
  '.git',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  '.mcp.json',
];

/** Directory names never treated as a project or descended into. */
const SKIP_DIRS = new Set(['node_modules']);

interface DiscoveredProject {
  path: string;
  name: string;
}

function isUnderRoot(path: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(normalizedRoot);
}

function scannableDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('.') && !SKIP_DIRS.has(name));
  } catch {
    // An unreadable directory (permissions, race) contributes no projects
    // rather than aborting the whole scan.
    return [];
  }
}

function isProjectRoot(dir: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

/**
 * Finds project roots up to TWO levels under `rootPath`:
 * - a first-level directory that looks like a project (has a marker) is
 *   registered as-is and NOT descended into (so a project's own `src/`,
 *   `dist/`, etc. are never mistaken for sub-projects);
 * - a first-level directory WITHOUT a marker is treated as a category and its
 *   immediate subdirectories are checked, registering each one that is a
 *   project root (named `<category>/<project>`).
 * Dot-directories and `node_modules` are skipped at every level.
 */
function findProjects(rootPath: string): DiscoveredProject[] {
  const projects: DiscoveredProject[] = [];
  for (const level1 of scannableDirs(rootPath)) {
    const level1Path = join(rootPath, level1);
    if (isProjectRoot(level1Path)) {
      projects.push({ path: level1Path, name: level1 });
      continue;
    }
    for (const level2 of scannableDirs(level1Path)) {
      const level2Path = join(level1Path, level2);
      if (isProjectRoot(level2Path)) {
        projects.push({ path: level2Path, name: `${level1}/${level2}` });
      }
    }
  }
  return projects;
}

/**
 * PRJ-01/PRJ-03: upserts one discovered `project` consumer per project root
 * found up to two levels under `rootPath` (see `findProjects`), restores
 * available=true for folders that reappeared, and marks previously-discovered
 * consumers under this root whose folder vanished as available=false WITHOUT
 * touching their assignment rows. Re-scanning an unchanged tree is idempotent.
 */
export function scanWorkspace(deps: WorkspaceScanDeps, rootPath: string): WorkspaceScanResult {
  const projects = findProjects(rootPath);
  const currentPaths = new Set(projects.map((project) => project.path));

  const present: string[] = [];
  const restored: string[] = [];
  for (const project of projects) {
    const wasUnavailable = consumersRepository.getByPath(deps.db, project.path)?.available === false;

    const consumer = consumersRepository.upsertDiscovered(deps.db, {
      path: project.path,
      name: project.name,
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
