import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { tmpdir } from "node:os";

const dbMethods = vi.hoisted(() => ({
  close: vi.fn(),
  exec: vi.fn(),
  pragma: vi.fn(),
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
