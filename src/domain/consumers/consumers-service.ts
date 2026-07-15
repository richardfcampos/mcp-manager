import { accessSync, constants, existsSync } from 'node:fs';
import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import { generateId, nowIso } from '../../db/repository-helpers.js';
import * as consumersRepository from './consumers-repository.js';
import { generateToken } from './token-generator.js';
import type { ClientFormat, ConsumerRecord } from './consumer-types.js';

export interface ConsumersServiceDeps {
  db: Database.Database;
}

/** PRJ-03 (registration half): throws when `path` doesn't exist or isn't
 * writable by this process; persists nothing in either case. */
function assertRegistrablePath(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Path does not exist: ${path}`);
  }
  try {
    accessSync(path, constants.W_OK);
  } catch {
    throw new Error(`Path is not writable: ${path}`);
  }
}

/** PRJ-02: registers a manually-added project at an existing, writable
 * path -- persisted as discovered=false, available=true, with a fresh
 * base64url bearer token. */
export function registerManualProject(
  deps: ConsumersServiceDeps,
  path: string,
  name?: string,
): ConsumerRecord {
  assertRegistrablePath(path);

  return consumersRepository.insertConsumer(deps.db, {
    id: generateId(),
    type: 'project',
    name: name?.trim() || basename(path),
    path,
    token: generateToken(),
    clientFormats: [],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: nowIso(),
  });
}

/** Registers a Claude Desktop profile as an independent access target,
 * keyed by its data-dir. */
export function registerDesktopProfile(
  deps: ConsumersServiceDeps,
  dataDir: string,
  label: string,
): ConsumerRecord {
  assertRegistrablePath(dataDir);

  return consumersRepository.insertConsumer(deps.db, {
    id: generateId(),
    type: 'desktop-profile',
    name: label,
    path: dataDir,
    token: generateToken(),
    clientFormats: [],
    discovered: false,
    available: true,
    enabled: true,
    createdAt: nowIso(),
  });
}

/** Replaces the consumer's token with a fresh base64url value distinct from
 * the previous one; the old token stops resolving immediately (SEC-03). */
export function rotateToken(deps: ConsumersServiceDeps, consumerId: string): string {
  const token = generateToken();
  consumersRepository.updateToken(deps.db, consumerId, token);
  return token;
}

export function setClientFormats(
  deps: ConsumersServiceDeps,
  consumerId: string,
  clientFormats: ClientFormat[],
): void {
  consumersRepository.updateClientFormats(deps.db, consumerId, clientFormats);
}

/** Delegates to the repository; backs the gateway token-context middleware
 * (T28) and rotate-token verification (T44). */
export function getByToken(deps: ConsumersServiceDeps, token: string): ConsumerRecord | null {
  return consumersRepository.getByToken(deps.db, token);
}

export function listConsumers(deps: ConsumersServiceDeps): ConsumerRecord[] {
  return consumersRepository.listConsumers(deps.db);
}
