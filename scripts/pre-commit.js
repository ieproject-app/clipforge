#!/usr/bin/env node
/**
 * Pre-commit hook — blocks commits when .beta-lock is present.
 * 
 * Usage (one-time setup):
 *   node scripts/pre-commit.js --install
 * 
 * This copies itself to .git/hooks/pre-commit so Git enforces it automatically.
 * To remove: delete .git/hooks/pre-commit and .beta-lock
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const LOCK_FILE = path.join(ROOT, '.beta-lock');
const HOOK_DEST = path.join(ROOT, '.git', 'hooks', 'pre-commit');

// ── Install mode ──
if (process.argv.includes('--install')) {
  const hookContent = `#!/bin/sh
# ClipForge pre-commit hook — blocks commits when .beta-lock exists
node "${path.join(ROOT, 'scripts', 'pre-commit.js').replace(/\\/g, '/')}"
`;
  fs.mkdirSync(path.dirname(HOOK_DEST), { recursive: true });
  fs.writeFileSync(HOOK_DEST, hookContent, { mode: 0o755 });
  console.log('✅ Pre-commit hook installed. Commits are now locked during beta.');
  console.log('   To unlock: delete .beta-lock file');
  process.exit(0);
}

// ── Uninstall mode ──
if (process.argv.includes('--uninstall')) {
  if (fs.existsSync(HOOK_DEST)) {
    fs.unlinkSync(HOOK_DEST);
    console.log('✅ Pre-commit hook removed. Commits are now allowed.');
  }
  process.exit(0);
}

// ── Check mode (called by Git hook) ──
if (fs.existsSync(LOCK_FILE)) {
  console.error('');
  console.error('🚫 COMMIT BLOCKED — Beta Mode Active');
  console.error('');
  console.error('   The .beta-lock file is present, which means the project');
  console.error('   is in beta development mode and commits are not allowed.');
  console.error('');
  console.error('   To unlock: delete the .beta-lock file');
  console.error('     del .beta-lock          (Windows)');
  console.error('     rm .beta-lock           (Linux/Mac)');
  console.error('');
  process.exit(1);
}

// All good — allow commit
process.exit(0);
