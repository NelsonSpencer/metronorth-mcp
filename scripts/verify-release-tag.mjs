#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

const expectedRefName = `v${packageJson.version}`;
const actualRefName = process.env.GITHUB_REF_NAME;

if (actualRefName !== expectedRefName) {
  console.error(
    `Release tag mismatch: expected GITHUB_REF_NAME=${expectedRefName}, got ${
      actualRefName ?? "<unset>"
    }.`,
  );
  process.exit(1);
}

console.log(
  `Release tag ${actualRefName} matches package version ${packageJson.version}.`,
);
