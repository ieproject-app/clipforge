#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ora from 'ora';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { getMetadata, downloadWithCache } from './server/services/ytdlp.js';
import { cutSegment, mergeSegments } from './server/services/ffmpeg.js';
import { validateSegment } from './server/services/filterHelpers.js';
import { writeJobLog } from './server/services/logger.js';
import { VIDEO_ENCODER, LINKS_FILE } from './server/services/platform.js';

// Setup environment for CLI mode
process.env.CLI_MODE = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printUsage() {
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
  ${chalk.green('[SHORTS_FORMAT]')}          Optional. Format layout: "vertical_blurred", "original", "vertical_crop" (Defaults to "vertical_blurred").
  ${chalk.green('[COPYRIGHT_BYPASS]')}       Optional. Mirror and adjust speed: "true" or "false" (Defaults to "true").
  ${chalk.green('[MERGE_CLIPS]')}            Optional. Combine all clips into a single compilation file: "true" or "false" (Defaults to "false").

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
async function checkForUpdates(currentVersion) {
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

async function main() {
  const args = process.argv.slice(2);
  
  // Parse flags
  const cpuFriendly = args.includes('--cpu-friendly');
  const noUpdateCheck = args.includes('--no-update-check');
  
  // Filter out flag parameters to get positional arguments
  const positionalArgs = args.filter(a => !a.startsWith('--'));
  
  if (positionalArgs.length < 1) {
    printUsage();
    process.exit(1);
  }

  let segmentsPath = '';
  let url = '';
  let exportDir = '';
  let shortsFormat = '';
  let copyrightBypass = true;
  let mergeClips = false;

  // Detect Batch mode: first argument is a JSON file path
  if (positionalArgs[0].endsWith('.json') || fs.existsSync(positionalArgs[0])) {
    segmentsPath = path.resolve(positionalArgs[0]);
    exportDir = positionalArgs[1] || 'D:\\YT Shorts';
    shortsFormat = positionalArgs[2] || 'vertical_blurred';
    copyrightBypass = positionalArgs[3] !== 'false';
    mergeClips = positionalArgs[4] === 'true';
  } else {
    if (positionalArgs.length < 2) {
      printUsage();
      process.exit(1);
    }
    url = positionalArgs[0];
    segmentsPath = path.resolve(positionalArgs[1]);
    exportDir = positionalArgs[2] || 'D:\\YT Shorts';
    shortsFormat = positionalArgs[3] || 'vertical_blurred';
    copyrightBypass = positionalArgs[4] !== 'false';
    mergeClips = positionalArgs[5] === 'true';
  }

  // 1. Verify files and input
  if (!fs.existsSync(segmentsPath)) {
    console.error(`\x1b[31mError: Segments JSON file not found at: ${segmentsPath}\x1b[0m`);
    process.exit(1);
  }

  let parsedSegments = [];
  try {
    const raw = fs.readFileSync(segmentsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsedSegments = parsed;
    } else if (parsed.segments && Array.isArray(parsed.segments)) {
      parsedSegments = parsed.segments;
    } else if (parsed.clips && Array.isArray(parsed.clips)) {
      parsedSegments = parsed.clips;
    } else {
      throw new Error('JSON root is not an array, and does not contain a "segments" or "clips" array field.');
    }
  } catch (err) {
    console.error(`\x1b[31mError parsing segments JSON: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  if (parsedSegments.length === 0) {
    console.error(`\x1b[31mError: No segments found in the JSON file.\x1b[0m`);
    process.exit(1);
  }

  // Group segments by URL (either segment.url or fallback command-line url)
  const groups = {};
  parsedSegments.forEach(seg => {
    const segUrl = seg.url || url;
    if (!segUrl) {
      console.error(`\x1b[31mError: Segment is missing a URL. Please ensure your JSON contains a "url" property for each segment in batch mode.\x1b[0m`);
      process.exit(1);
    }
    if (!groups[segUrl]) {
      groups[segUrl] = [];
    }
    groups[segUrl].push(seg);
  });

  const urls = Object.keys(groups);

  // Validate all segment start/end values before starting any download
  let validationFailed = false;
  for (const [segUrl, segs] of Object.entries(groups)) {
    segs.forEach((seg, i) => {
      const start = Number(seg.start);
      const end = Number(seg.end);
      // Use a large sentinel duration since we don't have video duration yet;
      // the core check here is that start/end are finite numbers and start < end.
      const result = validateSegment({ start, end }, Infinity);
      if (!result.ok) {
        console.error(`\x1b[31mError in segment ${i + 1} of URL "${segUrl}": ${result.reason}\x1b[0m`);
        validationFailed = true;
      }
    });
  }
  if (validationFailed) {
    console.error(`\x1b[31mAborting: fix segment errors above before running.\x1b[0m`);
    process.exit(1);
  }
  
  // Read version from package.json
  const pkgPath = path.resolve(__dirname, 'package.json');
  const VERSION = (() => {
    try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0'; }
    catch { return '0.0.0'; }
  })();

  console.log(chalk.magenta.bold(`\n=== ClipForge CLI v${VERSION} ===`));
  console.log(chalk.dim(`   https://snipgeek.com`));

  // Check for updates (async, non-blocking, cached 24h)
  if (!noUpdateCheck) {
    checkForUpdates(VERSION);
  }

  console.log(`📂 Export Folder     : ${exportDir}`);
  console.log(`📱 Layout Format     : ${shortsFormat}`);
  console.log(`🛡️ Bypass            : ${copyrightBypass}`);
  console.log(`🔗 Compilation       : ${mergeClips}`);
  console.log(`🍃 CPU Mode          : ${cpuFriendly ? 'CPU-Friendly (1 Core ✓)' : 'Standard (All Cores)'}`);
  console.log(`🎞️ Videos            : ${urls.length}`);
  console.log(`⚡ Video Encoder     : ${VIDEO_ENCODER === 'libx264' ? 'libx264 (CPU)' : chalk.green(`${VIDEO_ENCODER} (GPU ✓)`)}`);

  // Load links database once at start to check which ones are done
  let linksDb = [];
  try {
    if (fs.existsSync(LINKS_FILE)) {
      const content = fs.readFileSync(LINKS_FILE, 'utf8');
      linksDb = parseLinksContent(content);
    }
  } catch (err) {
    console.warn(`\x1b[33mWarning: Failed to load links database for validation: ${err.message}\x1b[0m`);
  }

  const allSegmentPaths = [];
  const cleanTitles = [];
  const successfullyProcessedUrls = [];
  let totalClipsProcessed = 0;
  let totalClipsSkipped = 0;

  // Persistent video cache: downloaded source files are kept here across runs
  // so re-processing the same video (with different segment JSON) is instant.
  const cacheDir = path.resolve(__dirname, 'server', 'temp', 'video_cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Global batch temp directory to stage cut segments before merging/copying
  const batchTempDir = path.resolve(__dirname, 'server', 'temp', `cli-compilation-${Date.now()}`);
  fs.mkdirSync(batchTempDir, { recursive: true });

  try {
    for (let u = 0; u < urls.length; u++) {
      const currentUrl = urls[u];
      const currentSegments = groups[currentUrl];

      // Skip if already marked as completed in links database
      const dbMatch = linksDb.find(l => l.url === currentUrl);
      if (dbMatch && dbMatch.status === 'done') {
        console.log(chalk.dim(`\n📹 [Video ${u + 1}/${urls.length}] ${currentUrl} — Skipped (already done ✓)`));
        continue;
      }

      console.log(chalk.cyan(`\n📹 [Video ${u + 1}/${urls.length}] ${currentUrl}`));

      const jobId = `cli-batch-${Date.now()}-${u}`;
      const jobDir = path.resolve(__dirname, 'server', 'temp', jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      try {
        // Fetch metadata with spinner
        const metaSpinner = ora('Fetching video metadata...').start();
        const meta = await getMetadata(currentUrl);
        const videoDuration = meta.duration || 0;
        const uploader = meta.uploader || 'Unknown';

        // Validate segments against actual video duration (deferred check)
        let durationFailed = false;
        currentSegments.forEach((seg, i) => {
          const end = Number(seg.end);
          if (end > videoDuration) {
            console.error(chalk.red(`\nError in segment ${i + 1} "${seg.title || 'Untitled'}": end (${end}s) exceeds video duration (${videoDuration}s)`));
            durationFailed = true;
          }
        });
        if (durationFailed) {
          metaSpinner.fail('Segment validation failed');
          console.error(chalk.red('Skipping video — fix segment end times before retrying.'));
          continue;
        }

        const shortTitle = meta.title.length > 55 ? meta.title.substring(0, 55) + '...' : meta.title;
        metaSpinner.succeed(`${chalk.bold(shortTitle)} ${chalk.dim(`by ${uploader}`)}`);

        const cleanTitle = meta.title.replace(/[\\/:*?"<>|]/g, '_');
        cleanTitles.push(cleanTitle);

        // Download with modern progress bar
        let resolvedSourcePath;
        let downloadError = null;
        let dlBar = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            let cacheHitShown = false;
            resolvedSourcePath = await downloadWithCache(currentUrl, cacheDir, (pct, info) => {
              if (info && info.isCacheHit) {
                if (!cacheHitShown) {
                  if (dlBar) { dlBar.stop(); dlBar = null; }
                  console.log(chalk.green('  ⚡ Cache Hit — instant ✓'));
                  cacheHitShown = true;
                }
                writeJobLog(jobDir, 'yt-dlp download: 100% (cache hit)');
                return;
              }

              if (!dlBar) {
                dlBar = new cliProgress.SingleBar({
                  format: `  ⬇ Downloading |${chalk.cyan('{bar}')}| {percentage}% · {speed} · ETA {eta_formatted}`,
                  barCompleteChar: '\u2588',
                  barIncompleteChar: '\u2591',
                  hideCursor: true,
                  clearOnComplete: true,
                }, cliProgress.Presets.shades_classic);
                dlBar.start(100, 0, { speed: '--', eta_formatted: '--' });
              }

              const percent = Math.min(pct, 100);
              const speed = info?.speed || '--';
              const eta = info?.eta || '--';

              dlBar.update(percent, { speed, eta_formatted: eta });

              if (percent >= 100) {
                writeJobLog(jobDir, 'yt-dlp download: 100% (complete)');
                dlBar.stop();
                dlBar = null;
              }
            });
            downloadError = null;
            break;
          } catch (err) {
            downloadError = err;
            if (dlBar) { dlBar.stop(); dlBar = null; }
            if (attempt < 2) {
              console.log(chalk.yellow(`  ⚠ Attempt ${attempt} failed, retrying in 5s... (${err.message})`));
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
        if (downloadError) throw downloadError;

        // Process segments with modern per-clip progress bars
        for (let i = 0; i < currentSegments.length; i++) {
          const seg = currentSegments[i];
          const start = Number(seg.start);
          const end = Number(seg.end);
          const title = (seg.title || `Segment_${i + 1}`).trim();
          const cleanSegTitle = title.replace(/[\\/:*?"<>|]/g, '_');

          const clipLabel = `[C${i + 1}/${currentSegments.length}]`;

          // Skip-if-exists check
          if (!mergeClips) {
            fs.mkdirSync(exportDir, { recursive: true });
            const finalOutputPath = path.join(exportDir, `${cleanTitle} - Part ${i + 1} - ${cleanSegTitle}.mp4`);
            if (fs.existsSync(finalOutputPath)) {
              console.log(chalk.yellow(`  ⏭ ${clipLabel} "${title}" — already exists, skipped`));
              totalClipsSkipped++;
              continue;
            }
          }
          
          const tempSegmentPath = path.join(batchTempDir, `segment_${u}_${i}.mp4`);
          const watermarkText = `Source: ${meta.title} by ${uploader}`;
          const totalDuration = end - start;

          // Guard against zero-duration clips
          if (totalDuration <= 0) {
            console.log(chalk.yellow(`  ⚠ ${clipLabel} "${title}" — invalid duration (${totalDuration}s), skipped`));
            continue;
          }

          // Progress bar for this clip
          const clipBar = new cliProgress.SingleBar({
            format: `  ✂ ${clipLabel} ${chalk.cyan('{clipTitle}')} |{bar}| {percentage}% · ~{eta}s`,
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
            clearOnComplete: true,
            barsize: 25,
          }, cliProgress.Presets.shades_classic);

          clipBar.start(totalDuration, 0, { clipTitle: title, eta: '--' });

          const clipStartTime = Date.now();
          let lastRealProgress = 0;

          // Primary: real FFmpeg progress from stderr parsing
          const onProgress = (currentSecs) => {
            lastRealProgress = Math.max(lastRealProgress, currentSecs);
            const elapsed = (Date.now() - clipStartTime) / 1000;
            const remaining = lastRealProgress > 0
              ? Math.round(elapsed / lastRealProgress * (totalDuration - lastRealProgress))
              : 0;
            clipBar.update(Math.min(lastRealProgress, totalDuration), {
              clipTitle: title,
              eta: remaining || '--'
            });
          };

          // Fallback: timer-based estimation (ensures bar moves even if stderr parsing fails)
          const fallbackTimer = setInterval(() => {
            const elapsed = (Date.now() - clipStartTime) / 1000;
            // Estimate: assume 30fps encoding speed as baseline, but never regress
            const estimated = Math.min(elapsed * 0.8, totalDuration * 0.95);
            if (estimated > lastRealProgress + 1) {
              const remaining = estimated > 0
                ? Math.round(elapsed / estimated * (totalDuration - estimated))
                : 0;
              clipBar.update(Math.min(estimated, totalDuration), {
                clipTitle: title,
                eta: remaining || '--'
              });
            }
          }, 500);

          await cutSegment(
            resolvedSourcePath, start, end, tempSegmentPath,
            watermarkText, shortsFormat, copyrightBypass,
            18, false, cpuFriendly, onProgress
          );

          clearInterval(fallbackTimer);
          clipBar.stop();
          const clipDuration = Math.round(totalDuration);
          console.log(chalk.green(`  ✔ ${clipLabel} "${title}" — ${clipDuration}s`));

          totalClipsProcessed++;
          allSegmentPaths.push(tempSegmentPath);

          // Build YouTube-optimized metadata text file
          const ytTitle = (seg.title || title).trim();
          const ytHook = (seg.hook || '').trim();
          const ytDescription = (seg.description || '').trim();
          const ytTags = (seg.tags || '').trim();
          const ytCredits = (seg.credits || `Original content by ${uploader}`).trim();
          const ytDisclaimer = (seg.disclaimer || 'This clip is shared for educational purposes under fair use. All rights belong to the original creator.').trim();

          // SEO-optimized: append uploader & source to title
          const seoTitle = ytTitle.includes(uploader) ? ytTitle : `${ytTitle} | ${uploader}`;
          // SEO-optimized: prepend original video info to description
          const seoDescription = [
            `📺 Original Video: ${meta.title}`,
            `🎙️ Speaker/Channel: ${uploader}`,
            `🔗 Source: ${currentUrl}`,
            ``,
            ytDescription || `Highlight from: ${meta.title}`,
          ].join('\n');

          const descLines = [
            `TITLE:`,
            seoTitle,
            ``,
            ...(ytHook ? [`HOOK:`, ytHook, ``] : []),
            `DESCRIPTION:`,
            seoDescription,
            ``,
            ...(ytTags ? [`TAGS:`, ytTags, ``] : []),
            `CREDITS:`,
            ytCredits,
            ``,
            `DISCLAIMER:`,
            ytDisclaimer,
            ``,
            `---`,
            `Source URL: ${currentUrl}`,
            `Start: ${start}s | End: ${end}s`,
            `Generated with ClipForge CLI — snipgeek.com`,
          ];

          const descPath = path.join(exportDir, `${cleanTitle} - Part ${i + 1} - ${cleanSegTitle}.txt`);
          fs.writeFileSync(descPath, descLines.join('\n'), 'utf8');

          // If NOT compiling, export individual clip immediately
          if (!mergeClips) {
            fs.mkdirSync(exportDir, { recursive: true });
            const finalOutputPath = path.join(exportDir, `${cleanTitle} - Part ${i + 1} - ${cleanSegTitle}.mp4`);
            fs.copyFileSync(tempSegmentPath, finalOutputPath);
          }
        }
        successfullyProcessedUrls.push(currentUrl);
      } finally {
        try {
          if (fs.existsSync(jobDir)) {
            fs.rmSync(jobDir, { recursive: true, force: true });
          }
        } catch {}
      }
    }

    // If Compilation Mode is active, merge all segments together
    if (mergeClips && allSegmentPaths.length > 0) {
      const firstTitle = cleanTitles[0] || 'Compilation';
      const cleanFirstTitle = firstTitle.length > 60 ? firstTitle.substring(0, 60) : firstTitle;
      const finalOutputPath = path.join(exportDir, `Compilation - ${cleanFirstTitle} - ${allSegmentPaths.length} Clips.mp4`);

      if (fs.existsSync(finalOutputPath)) {
        console.log(chalk.yellow(`\n  ⏭ Compilation already exists, skipping: ${path.basename(finalOutputPath)}`));
      } else {
        const mergeSpinner = ora(`Merging ${allSegmentPaths.length} clips into compilation...`).start();
        fs.mkdirSync(exportDir, { recursive: true });
        await mergeSegments(allSegmentPaths, finalOutputPath);
        mergeSpinner.succeed(`Compilation: ${allSegmentPaths.length} clips merged successfully ✓`);
      }

      // Write YouTube-optimized metadata text file for the compilation silently
      const descPath = path.join(exportDir, `Compilation - ${cleanFirstTitle} - ${allSegmentPaths.length} Clips.txt`);
      const compilationDescLines = [
        `TITLE:`,
        `${cleanFirstTitle} | Best Highlights Compilation`,
        ``,
        `DESCRIPTION:`,
        `A curated compilation of the best highlights from ${cleanTitles.length > 1 ? `${cleanTitles.length} videos` : `"${cleanFirstTitle}"`}. ${allSegmentPaths.length} clips selected and edited for maximum impact.`,
        ``,
        `Watch more clips like this and follow for daily highlights!`,
        ``,
        `CREDITS:`,
        `Original content sourced from: ${urls.join(', ')}`,
        ``,
        `DISCLAIMER:`,
        `This compilation is shared for educational and entertainment purposes under fair use. All rights belong to the original creators.`,
        ``,
        `---`,
        `Total clips merged: ${allSegmentPaths.length}`,
        `Source URLs:`,
        ...urls.map(u => `  - ${u}`),
        `Generated with ClipForge CLI — snipgeek.com`,
      ];
      fs.writeFileSync(descPath, compilationDescLines.join('\n'), 'utf8');
    }
  } catch (err) {
    console.error(chalk.red(`\n❌ Batch Job failed: ${err.message}`));
    if (err.stack) {
      console.error(err.stack);
    }
  } finally {
    // Delete global batch temp folder
    try {
      if (fs.existsSync(batchTempDir)) {
        fs.rmSync(batchTempDir, { recursive: true, force: true });
      }
    } catch {}

    // Trigger system beep notification
    process.stdout.write('\u0007');
    
    // Update links database for successfully processed URLs and revert incomplete/failed processing ones
    try {
      if (fs.existsSync(LINKS_FILE)) {
        const content = fs.readFileSync(LINKS_FILE, 'utf8');
        const currentLinks = parseLinksContent(content);
        let updatedCount = 0;
        let revertedCount = 0;
        
        // 1. Mark completed ones as done
        for (const u of successfullyProcessedUrls) {
          const target = currentLinks.find(l => l.url === u);
          if (target && target.status !== 'done') {
            target.status = 'done';
            updatedCount++;
          }
        }

        // 2. Revert incomplete ones that were marked processing
        for (const u of urls) {
          if (!successfullyProcessedUrls.includes(u)) {
            const target = currentLinks.find(l => l.url === u);
            if (target && target.status === 'processing') {
              target.status = 'pending';
              revertedCount++;
            }
          }
        }
        
        if (updatedCount > 0 || revertedCount > 0) {
          const lines = [];
          for (const link of currentLinks) {
            const statusBox = link.status === 'done' ? '[Done]' : 
                              link.status === 'processing' ? '[Processing]' : '[ ]';
            lines.push(`${statusBox} ${link.title}`);
            lines.push(`    ${link.url}`);
          }
          fs.writeFileSync(LINKS_FILE, lines.join('\n') + '\n', 'utf8');
          if (updatedCount > 0) {
            console.log(chalk.green(`\n✔ Updated ${updatedCount} links to 'done' in database ✓`));
          }
          if (revertedCount > 0) {
            console.log(chalk.yellow(`\n↩ Reverted ${revertedCount} incomplete/failed links back to pending ✓`));
          }
        }
      }
    } catch (dbErr) {
      console.error(chalk.yellow(`\nWarning: Failed to update database status: ${dbErr.message}`));
    }

    console.log(chalk.magenta(`\n=== Job Finished ===`));
    const skippedNote = totalClipsSkipped > 0 ? ` ⏭ ${totalClipsSkipped} skipped` : '';
    console.log(`🔗 Completed Batch of ${chalk.cyan(urls.length)} URLs (${chalk.green(totalClipsProcessed)} processed${skippedNote}):`);
    urls.forEach(u => {
      const dbMatch = linksDb.find(l => l.url === u);
      if (dbMatch && dbMatch.status === 'done' && !successfullyProcessedUrls.includes(u)) {
        console.log(chalk.yellow(`  - ${u} (Skipped — already completed ✓)`));
      } else {
        console.log(chalk.cyan(`  - ${u}`));
      }
    });
    console.log();
  }
}

function parseLinksContent(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const links = [];
  let currentItem = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const statusMatch = line.match(/^\[(.*?)\]\s*(.*)$/);
    if (statusMatch) {
      if (currentItem) {
        links.push(currentItem);
      }
      const statusStr = statusMatch[1].trim().toLowerCase();
      const status = (statusStr === 'x' || statusStr === 'done') ? 'done' : 
                     (statusStr === 'processing') ? 'processing' : 'pending';
      const title = statusMatch[2].trim();
      currentItem = {
        title,
        status,
        url: ''
      };
    } else if (line.startsWith('http') || line.includes('youtube.com') || line.includes('youtu.be')) {
      if (currentItem) {
        currentItem.url = line.trim();
        links.push(currentItem);
        currentItem = null;
      }
    }
  }
  
  if (currentItem) {
    links.push(currentItem);
  }
  
  return links;
}

main();
