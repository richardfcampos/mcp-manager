import type { ErrorRequestHandler } from 'express';

/**
 * Base class for every HTTP-aware error the API layer throws deliberately.
 * Carries its own status code so the error middleware never has to guess.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

/**
 * Translates a plain `Error` thrown by a Phase 3-5 domain service (none of
 * which are HTTP-aware) into the matching AppError subclass, based on the
 * domain layer's fixed error-message vocabulary (e.g. "already exists",
 * "No X found with id:", "is required"). Already-classified AppErrors pass
 * through unchanged. A message that matches no known pattern is returned
 * as-is so it falls through to the error middleware's generic-error branch
 * (500) instead of being mis-classified as a 400/404 -- unexpected
 * domain/infra failures should surface as server errors, not client errors.
 */
export function classifyDomainError(err: unknown): unknown {
  if (err instanceof AppError || !(err instanceof Error)) {
    return err;
  }
  if (/already exists/i.test(err.message)) {
    return new ConflictError(err.message);
  }
  if (/^no .+ found with id:/i.test(err.message)) {
    return new NotFoundError(err.message);
  }
  if (/required|does not exist|not writable/i.test(err.message)) {
    return new ValidationError(err.message);
  }
  return err;
}

/**
 * Express error-handling middleware (4-arg signature, must be mounted
 * LAST): maps ValidationError->400, NotFoundError->404, ConflictError->409,
 * and any other/unknown thrown value->500, always serializing
 * `{error: message}` JSON. Never includes a stack trace or logs the raw
 * error body into the response -- unexpected errors are logged server-side
 * only, via console.error, for operator diagnosis.
 */
export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: message });
};
