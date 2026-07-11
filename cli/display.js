import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename), '..');

export function printUsage() {
  console.log(`
${chalk.cyan.bold('ClipForge Terminal CLI')}
${chalk.dim('https://snipgeek.com  ·  Forked from FullStackHarman/youtube-clipper')}
--------------------------
Process long YouTube videos into shorts directly from your terminal.

${chalk.bold('Usage:')}
  node cli.js <YOUTUBE_URL> <PATH_TO_JSON_SEGMENTS> [EXPORT_DIR] [SHORTS_FORMAT] [COPYRIGHT_BYPASS] [MERGE_CLIPS]
  OR (Batch Mode):
  node cli.js <PATH_TO_JSON_SEGMENTS> [EXPORT_DIR] [SHORTS_FORMAT] [COPYRIGHT_BYPASS] [MERGE_CLIPS]

${chalk.bold('Parameters:')}
  ${chalk.green('<YOUTUBE_URL>')}            URL of the long YouTube video to process.
  ${chalk.green('<PATH_TO_JSON_SEGMENTS>')}  Path to a JSON file containing clips timestamps.
  ${chalk.green('[EXPORT_DIR]')}             Optional. Directory to save the final shorts (Defaults to "D:\\YT Shorts").
  ${chalk.green('[SHORTS_FORMAT]')}          Optional. Format layout: "vertical_blurred", "original", "vertical_crop", "vertical_moderate" (Defaults to "vertical_blurred").
  ${chalk.green('[COPYRIGHT_BYPASS]')}       Optional. Mirror and adjust speed: "true" or "false" (Defaults to "true").
  ${chalk.green('[MERGE_CLIPS]')}            Optional. Combine all clips into a single compilation file: "true" or "false" (Defaults to "false").

${chalk.bold('Flags:')}
  ${chalk.green('--cpu-friendly')}           Limit to single CPU core (slower but compatible).
  ${chalk.green('--auto-captions')}          Download YouTube auto-captions for accurate subtitles.
  ${chalk.green('--4k')}                     Download source video in 4K (2160p) for sharper center crop quality. Default is 1080p.
  ${chalk.green('--no-link-db')}             Skip read/write of Link Manager database (manual mode).

${chalk.bold('JSON Segments Format Example (Single or Multi-URL):')}
  [
    { "url": "https://youtube.com/watch?v=...", "start": 120, "end": 175, "title": "Highlight 1" },
    { "url": "https://youtube.com/watch?v=...", "start": 300, "end": 355, "title": "Highlight 2" }
  ]
`);
}

/**
 * Check GitHub Releases API for newer version (async, non-blocking, cached 24h).
 * @param {string} currentVersion - Current version from package.json
 */
export async function checkForUpdates(currentVersion) {
  const cacheDir = path.resolve(__dirname, 'server', 'temp');
  const cacheFile = path.join(cacheDir, '.update-check');
  
  // Respect cache: only check once per 24 hours
  try {
    if (fs.existsSync(cacheFile)) {
      const lastCheck = parseInt(fs.readFileSync(cacheFile, 'utf8'), 10);
      if (Date.now() - lastCheck < 24 * 60 * 60 * 1000) return;
    }
  } catch { /* cache read error — proceed with check */ }

  try {
    const res = await fetch(
      'https://api.github.com/repos/ieproject-app/clipforge/releases/latest',
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return;
    
    const data = await res.json();
    const latestVersion = (data.tag_name || '').replace(/^v/, '');
    if (!latestVersion) return;

    // Simple semver comparison: split by dot, compare numerically
    const current = currentVersion.split('.').map(Number);
    const latest = latestVersion.split('.').map(Number);
    const isNewer = latest.length >= 2 && current.length >= 2 &&
      (latest[0] > current[0] ||
       (latest[0] === current[0] && latest[1] > current[1]) ||
       (latest[0] === current[0] && latest[1] === current[1] && (latest[2] || 0) > (current[2] || 0)));

    if (isNewer) {
      console.log(chalk.yellow(`\n📦 Update available! v${currentVersion} → v${latestVersion}`));
      console.log(chalk.dim(`   Run: git pull && npm install`));
      console.log(chalk.dim(`   Changelog: ${data.html_url || 'https://github.com/ieproject-app/clipforge/releases'}`));
    }

    // Write cache timestamp
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, String(Date.now()));
    } catch { /* silent */ }
  } catch {
    // Network error, rate limit, or timeout — silent skip
  }
}
