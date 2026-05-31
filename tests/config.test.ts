import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { homedir } from 'node:os';

describe('configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a stable cache database path when DB_PATH is not set', async () => {
    vi.stubEnv('DB_PATH', '');
    vi.stubEnv('REDIS_URL', '');
    vi.resetModules();

    const { config } = await import('../src/config.js');

    expect(config.DB_PATH).toBe(
      path.join(homedir(), '.cache', 'metronorth-mcp', 'metronorth.db')
    );
    expect(config.REDIS_URL).toBeUndefined();
  });

  it('respects an explicit DB_PATH', async () => {
    vi.stubEnv('DB_PATH', '/tmp/metronorth-test.db');
    vi.resetModules();

    const { config } = await import('../src/config.js');

    expect(config.DB_PATH).toBe('/tmp/metronorth-test.db');
  });
});
