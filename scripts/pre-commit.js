#!/usr/bin/env node
/**
 * Pre-commit hook — blocks commits when .beta-lock is present,
 * and warns when package.json version hasn't been updated.
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

// 1. Beta lock check
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

// 2. Version check — warn if version hasn't changed since last tag
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const currentVersion = pkg.version || '0.0.0';

  // Compare against the latest git tag
  const { execSync } = await import('node:child_process');
  let latestTag = '';
  try {
    latestTag = execSync('git --no-pager describe --tags --abbrev=0 2>nul', { cwd: ROOT, encoding: 'utf8' }).trim().replace(/^v/, '');
  } catch {
    // No tags yet — first commit, skip version check
  }

  if (latestTag && currentVersion === latestTag) {
    console.warn('');
    console.warn('⚠️  VERSION NOT UPDATED');
    console.warn(`   package.json version is still ${currentVersion} (same as tag v${latestTag}).`);
    console.warn('   Consider bumping the version before committing major changes.');
    console.warn('   Current: v' + currentVersion);
    console.warn('');
  }
} catch {
  // Silently skip version check on error
}

// 3. Quick syntax check on staged JS files
try {
  const { execSync } = await import('node:child_process');
  const staged = execSync('git --no-pager diff --cached --name-only --diff-filter=ACM 2>nul', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(f => f.endsWith('.js') && fs.existsSync(f));

  if (staged.length > 0) {
    for (const file of staged) {
      try {
        execSync(`node -c "${file}"`, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        const msg = e.stderr || e.message || 'Unknown error';
        console.error(`❌ Syntax error in ${file}:`);
        console.error(`   ${msg.split('\n')[0]}`);
        process.exit(1);
      }
    }
    console.log(`✅ Syntax check passed for ${staged.length} staged file(s)`);
  }
} catch {
  // Silently skip syntax check on error (e.g. no staged .js files)
}

// All good — allow commit
process.exit(0);
