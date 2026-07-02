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

  it('fails fast on invalid configuration instead of silently using defaults', async () => {
    // An invalid HTTP setting must not silently drop the HTTP opt-in and boot stdio.
    vi.stubEnv('MCP_HTTP', '1');
    vi.stubEnv('MCP_HTTP_PORT', 'not-a-port');
    const exitError = new Error('process.exit');
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw exitError;
      }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();

    await expect(import('../src/config.js')).rejects.toBe(exitError);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
