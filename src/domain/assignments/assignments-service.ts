import type Database from 'better-sqlite3';
import * as consumersRepository from '../consumers/consumers-repository.js';
import * as mcpServersRepository from '../mcp-servers/mcp-servers-repository.js';
import * as assignmentsRepository from './assignments-repository.js';

export interface AssignmentsServiceDeps {
  db: Database.Database;
}

/** ACC-01: validates both the consumer and the MCP server exist before
 * persisting the assignment; throws (persisting nothing) when either is
 * missing. */
export function assign(deps: AssignmentsServiceDeps, consumerId: string, mcpServerId: string): void {
  if (!consumersRepository.getConsumer(deps.db, consumerId)) {
    throw new Error(`No consumer found with id: ${consumerId}`);
  }
  if (!mcpServersRepository.getServer(deps.db, mcpServerId)) {
    throw new Error(`No MCP server found with id: ${mcpServerId}`);
  }

  assignmentsRepository.assign(deps.db, consumerId, mcpServerId);
}

/** ACC-01: removes the assignment; a no-op (no throw) when it was not
 * assigned. */
export function unassign(
  deps: AssignmentsServiceDeps,
  consumerId: string,
  mcpServerId: string,
): void {
  assignmentsRepository.unassign(deps.db, consumerId, mcpServerId);
}

export function allowedMcpIds(deps: AssignmentsServiceDeps, consumerId: string): string[] {
  return assignmentsRepository.allowedMcpIds(deps.db, consumerId);
}

export function consumersOfMcp(deps: AssignmentsServiceDeps, mcpServerId: string): string[] {
  return assignmentsRepository.consumersOfMcp(deps.db, mcpServerId);
}
