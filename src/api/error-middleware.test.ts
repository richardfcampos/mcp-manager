import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  classifyDomainError,
  errorMiddleware,
} from './error-middleware.js';

/** Minimal Express res double -- the middleware only calls
 * res.status().json(), so a full Express app isn't needed for these tests. */
function fakeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Parameters<typeof errorMiddleware>[2];
  return { res, status, json };
}

describe('error-middleware', () => {
  it('maps ValidationError to 400 with {error} body carrying the message', () => {
    const { res, status, json } = fakeRes();

    errorMiddleware(new ValidationError('name is required'), {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'name is required' });
  });

  it('maps NotFoundError to 404 with {error} body carrying the message', () => {
    const { res, status, json } = fakeRes();

    errorMiddleware(new NotFoundError('No MCP server found with id: x'), {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'No MCP server found with id: x' });
  });

  it('maps ConflictError to 409 with {error} body carrying the message', () => {
    const { res, status, json } = fakeRes();

    errorMiddleware(new ConflictError('MCP server name "x" already exists'), {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ error: 'MCP server name "x" already exists' });
  });

  it('maps a generic Error fallback to 500 with {error} body carrying the message, no stack', () => {
    const { res, status, json } = fakeRes();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorMiddleware(new Error('unexpected database failure'), {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'unexpected database failure' });
    const [body] = json.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(body)).toEqual(['error']);
    expect(JSON.stringify(body)).not.toContain('at ');
    consoleSpy.mockRestore();
  });

  it('maps a non-Error thrown value to 500 with a generic {error} body, never leaking it raw', () => {
    const { res, status, json } = fakeRes();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorMiddleware('a raw string throw', {} as never, res, vi.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error' });
    consoleSpy.mockRestore();
  });

  it('AppError instances are not truncated: subclasses still expose their own status', () => {
    expect(new ValidationError('x').status).toBe(400);
    expect(new NotFoundError('x').status).toBe(404);
    expect(new ConflictError('x').status).toBe(409);
    expect(new AppError('x', 418)).toBeInstanceOf(Error);
  });

  describe('classifyDomainError', () => {
    it('classifies "already exists" messages as ConflictError', () => {
      const result = classifyDomainError(new Error('MCP server name "dup" already exists'));
      expect(result).toBeInstanceOf(ConflictError);
    });

    it('classifies "No X found with id:" messages as NotFoundError', () => {
      const result = classifyDomainError(new Error('No consumer found with id: abc'));
      expect(result).toBeInstanceOf(NotFoundError);
    });

    it('classifies "is required" / "does not exist" / "not writable" messages as ValidationError', () => {
      expect(classifyDomainError(new Error('MCP server name is required'))).toBeInstanceOf(
        ValidationError,
      );
      expect(classifyDomainError(new Error('Path does not exist: /nope'))).toBeInstanceOf(
        ValidationError,
      );
      expect(classifyDomainError(new Error('Path is not writable: /nope'))).toBeInstanceOf(
        ValidationError,
      );
    });

    it('passes an already-classified AppError through unchanged', () => {
      const original = new NotFoundError('already classified');
      expect(classifyDomainError(original)).toBe(original);
    });

    it('passes an unrecognized Error message through unchanged (falls back to 500)', () => {
      const original = new Error('disk is on fire');
      expect(classifyDomainError(original)).toBe(original);
    });

    it('passes a non-Error thrown value through unchanged', () => {
      expect(classifyDomainError('raw string')).toBe('raw string');
    });
  });
});
