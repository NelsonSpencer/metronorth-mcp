import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getServerInfo, packageMetadata } from '../src/package-metadata.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(testDir, '..', 'package.json'), 'utf-8')
) as {
  name: string;
  version: string;
};

describe('package metadata', () => {
  it('uses package.json as the version source of truth', () => {
    expect(packageMetadata.name).toBe(packageJson.name);
    expect(packageMetadata.version).toBe(packageJson.version);
    expect(getServerInfo()).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
  });

  it('builds User-Agent strings from the package version', () => {
    expect(packageMetadata.userAgent).toBe(
      `MetroNorth-MCP/${packageJson.version}`
    );
  });
});
