import { createRequire } from 'node:module';

interface PackageJson {
  name: string;
  version: string;
}

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as PackageJson;

export const packageMetadata = Object.freeze({
  name: packageJson.name,
  version: packageJson.version,
  userAgent: `MetroNorth-MCP/${packageJson.version}`,
});

export function getServerInfo() {
  return {
    name: packageMetadata.name,
    version: packageMetadata.version,
  };
}
