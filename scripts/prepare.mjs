#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const isProjectInstall = process.env.INIT_CWD === process.cwd();
const shouldSkipHusky =
  process.env.CI === 'true' ||
  process.env.HUSKY === '0' ||
  !isProjectInstall ||
  !existsSync('.git');

if (shouldSkipHusky) {
  process.exit(0);
}

const result = spawnSync('npx', ['husky'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.warn(`Skipping husky setup: ${result.error.message}`);
  process.exit(0);
}

process.exit(result.status ?? 0);
