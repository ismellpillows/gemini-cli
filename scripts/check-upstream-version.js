/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return pkg.version;
}

function getUpstreamVersion() {
  try {
    const output = execSync('npm view @google/gemini-cli dist-tags.latest', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch (error) {
    console.error('Failed to fetch upstream version from npm:', error.message);
    process.exit(1);
  }
}

function main() {
  const current = getCurrentVersion();
  const latest = getUpstreamVersion();
  
  console.log(JSON.stringify({
    current,
    latest,
    updateNeeded: current !== latest,
    upstreamTag: `v${latest}`,
  }));
}

main();
