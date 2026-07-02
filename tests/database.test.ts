import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";

const dbMethods = vi.hoisted(() => ({
  close: vi.fn(),
  exec: vi.fn(),
  pragma: vi.fn(),
  // Schema initialization now runs migrations, which read/write metadata via
  // prepared statements. Return empty result sets so the migration path runs
  // against the mock without touching a real database.
  prepare: vi.fn(() => ({
    all: vi.fn(() => []),
    get: vi.fn(() => undefined),
    run: vi.fn(),
  })),
}));
const databaseConstructorMock = vi.hoisted(() => vi.fn());

vi.mock("better-sqlite3", () => ({
  default: vi.fn(function MockDatabase(dbPath: string) {
    databaseConstructorMock(dbPath);
    return dbMethods;
  }),
}));

describe("database initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DB_PATH", path.join(tmpdir(), "metronorth-mcp-test.db"));
    vi.stubEnv("REDIS_URL", "");
    dbMethods.close.mockReset();
    dbMethods.exec.mockReset();
    dbMethods.pragma.mockReset();
    dbMethods.prepare.mockClear();
    databaseConstructorMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses only static SQLite PRAGMA settings", async () => {
    const { closeDatabase, getDatabase } =
      await import("../src/infrastructure/database.js");

    getDatabase();
    closeDatabase();

    expect(dbMethods.pragma.mock.calls.map(([pragma]) => pragma)).toEqual([
      "journal_mode = WAL",
      "synchronous = NORMAL",
      "cache_size = 10000",
      "temp_store = MEMORY",
    ]);
  });
});
