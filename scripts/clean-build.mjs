#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

rmSync(resolve('build'), { recursive: true, force: true });
