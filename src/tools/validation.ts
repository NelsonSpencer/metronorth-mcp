import { fromError } from 'zod-validation-error';
import type { z } from 'zod';
import { ToolDomainError } from './errors.js';

export function parseArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: Record<string, unknown>
): z.infer<T> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new ToolDomainError('invalid_arguments', fromError(parsed.error).toString());
  }

  return parsed.data;
}
