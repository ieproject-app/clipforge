#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
\x1b[1m\x1b[36mClipForge Terminal CLI\x1b[0m
--------------------------
Process long YouTube videos into shorts directly from your terminal.

\x1b[1mUsage:\x1b[0m
  node cli.js <YOUTUBE_URL> <PATH_TO_JSON_SEGMENTS> [EXPORT_DIR] [SHORTS_FORMAT] [COPYRIGHT_BYPASS] [MERGE_CLIPS]
  OR (Batch Mode):
  node cli.js <PATH_TO_JSON_SEGMENTS> [EXPORT_DIR] [SHORTS_FORMAT] [COPYRIGHT_BYPASS] [MERGE_CLIPS]

\x1b[1mParameters:\x1b[0m
  \x1b[32m<YOUTUBE_URL>\x1b[0m            URL of the long YouTube video to process.
  \x1b[32m<PATH_TO_JSON_SEGMENTS>\x1b[0m  Path to a JSON file containing clips timestamps.
  \x1b[32m[EXPORT_DIR]\x1b[0m             Optional. Directory to save the final shorts (Defaults to "D:\\YT Shorts").
  \x1b[32m[SHORTS_FORMAT]\x1b[0m          Optional. Format layout: "vertical_blurred", "original", "vertical_crop" (Defaults to "vertical_blurred").
  \x1b[32m[COPYRIGHT_BYPASS]\x1b[0m       Optional. Mirror and adjust speed: "true" or "false" (Defaults to "true").
  \x1b[32m[MERGE_CLIPS]\x1b[0m            Optional. Combine all clips into a single compilation file: "true" or "false" (Defaults to "false").

\x1b[1mJSON Segments Format Example (Single or Multi-URL):\x1b[0m
  [
    { "url": "https://youtube.com/watch?v=...", "start": 120, "end": 175, "title": "Highlight 1" },
    { "url": "https://youtube.com/watch?v=...", "start": 300, "end": 355, "title": "Highlight 2" }
  ]
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse flags
  const cpuFriendly = args.includes('--cpu-friendly');
  
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
  
  console.log(`\n\x1b[35m=== Starting ClipForge Job ===\x1b[0m`);
  console.log(`📂 Export Folder     : ${exportDir}`);
  console.log(`📱 Layout Format     : ${shortsFormat}`);
  console.log(`🛡️ Bypass            : ${copyrightBypass}`);
  console.log(`🔗 Compilation       : ${mergeClips}`);
  console.log(`🍃 CPU Mode          : ${cpuFriendly ? 'CPU-Friendly (1 Core ✓)' : 'Standard (All Cores)'}`);
  console.log(`🎞️ Videos            : ${urls.length}`);
  console.log(`⚡ Video Encoder     : ${VIDEO_ENCODER === 'libx264' ? 'libx264 (CPU)' : `${VIDEO_ENCODER} (GPU ✓)`}`);

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
        console.log(`\n📹 [Video ${u + 1}/${urls.length}] ${currentUrl}`);
        console.log(`   Status  : \x1b[33mSkipped (Already completed in database ✓)\x1b[0m`);
        continue;
      }

      console.log(`\n📹 [Video ${u + 1}/${urls.length}] ${currentUrl}`);
      process.stdout.write(`   Status  : Fetching video metadata...\n`);

      const jobId = `cli-batch-${Date.now()}-${u}`;
      const jobDir = path.resolve(__dirname, 'server', 'temp', jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      try {
        // Fetch metadata
        const meta = await getMetadata(currentUrl);
        const videoDuration = meta.duration || 0;

        // Validate segments against actual video duration (deferred check)
        let durationFailed = false;
        currentSegments.forEach((seg, i) => {
          const end = Number(seg.end);
          if (end > videoDuration) {
            console.error(`\x1b[31mError in segment ${i + 1} "${seg.title || 'Untitled'}": end (${end}s) exceeds video duration (${videoDuration}s)\x1b[0m`);
            durationFailed = true;
          }
        });
        if (durationFailed) {
          console.error(`\x1b[31mSkipping video — fix segment end times before retrying.\x1b[0m`);
          continue;
        }

        const cleanTitle = meta.title.replace(/[\\/:*?"<>|]/g, '_');
        cleanTitles.push(cleanTitle);
        const uploader = meta.uploader || 'Unknown';

        // Update video header and status cleanly in place
        process.stdout.write(
          `\x1b[2A\x1b[K📹 [Video ${u + 1}/${urls.length}] "${meta.title.length > 55 ? meta.title.substring(0, 55) + '...' : meta.title}" by ${uploader}\n` +
          `\x1b[K   Status  : Downloading source video...\n` +
          `\x1b[K   Progress: [░░░░░░░░░░░░░░░░░░░░░░░░░] 0.0%`
        );

        // Download source video via persistent cache (with 1 automatic retry)
        let resolvedSourcePath;
        let downloadError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            let hasShownCacheHit = false;
            resolvedSourcePath = await downloadWithCache(currentUrl, cacheDir, (pct, info) => {
              if (info && info.isCacheHit) {
                if (!hasShownCacheHit) {
                  process.stdout.write(`\r\x1b[K   Progress: ⚡ Cache Hit: Using cached video source (instant ✓)\n`);
                  hasShownCacheHit = true;
                }
                writeJobLog(jobDir, 'yt-dlp download: 100% (cache hit)');
                return;
              }
              
              if (pct === 100) {
                writeJobLog(jobDir, 'yt-dlp download: 100% (complete)');
              }

              const percent = Math.min(pct, 100);
              const barWidth = 20;
              const completedWidth = Math.round((percent / 100) * barWidth);
              const remainingWidth = barWidth - completedWidth;
              
              const bar = '█'.repeat(completedWidth) + '░'.repeat(remainingWidth);
              
              const speed = info?.speed || 'N/A';
              const eta = info?.eta || 'N/A';
              const size = info?.size || 'N/A';

              // Carriage return (\r) updates the single line in the terminal dynamically
              process.stdout.write(`\r\x1b[K   Progress: [${bar}] ${percent.toFixed(1)}% | 📦 ${size} | ⚡ ${speed} | ⏳ ETA: ${eta}`);
              
              if (percent >= 100) {
                process.stdout.write('\n'); // Line break on complete
              }
            });
            downloadError = null;
            break;
          } catch (err) {
            downloadError = err;
            if (attempt < 2) {
              process.stdout.write(`\n\x1b[33m   ⚠ Download attempt ${attempt} failed, retrying in 5 seconds... (${err.message})\x1b[0m\n`);
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
        if (downloadError) throw downloadError;

        // Clear progress/status lines and set status to processing segments
        process.stdout.write(`\x1b[2A\x1b[K   Status  : Processing and formatting segments...\n\x1b[K\n`);

        // Process segments
        for (let i = 0; i < currentSegments.length; i++) {
          const seg = currentSegments[i];
          const start = Number(seg.start);
          const end = Number(seg.end);
          const title = (seg.title || `Segment_${i + 1}`).trim();
          const cleanSegTitle = title.replace(/[\\/:*?"<>|]/g, '_');

          // Skip-if-exists check
          if (!mergeClips) {
            fs.mkdirSync(exportDir, { recursive: true });
            const finalOutputPath = path.join(exportDir, `${cleanTitle} - Part ${i + 1} - ${cleanSegTitle}.mp4`);
            if (fs.existsSync(finalOutputPath)) {
              process.stdout.write(`   ⏭ Clip ${i + 1}/${currentSegments.length}: "${title}" [${start}s-${end}s] ... \x1b[33mSkipped (already exists)\x1b[0m\n`);
              totalClipsSkipped++;
              continue;
            }
          }
          
          process.stdout.write(`   ⏳ Clip ${i + 1}/${currentSegments.length}: "${title}" [${start}s-${end}s] ... \x1b[33mRendering: 0% [□□□□□□□□□□]\x1b[0m`);
          
          const tempSegmentPath = path.join(batchTempDir, `segment_${u}_${i}.mp4`);
          const watermarkText = `Source: ${meta.title} by ${uploader}`;

          const totalDuration = end - start;
          const onProgress = (currentSecs) => {
            const pct = Math.min(99, Math.max(0, Math.round((currentSecs / totalDuration) * 100)));
            const barLength = 10;
            const filledLength = Math.round((pct / 100) * barLength);
            const emptyLength = barLength - filledLength;
            const bar = '■'.repeat(filledLength) + '□'.repeat(emptyLength);
            process.stdout.write(`\r\x1b[K   ⏳ Clip ${i + 1}/${currentSegments.length}: "${title}" [${start}s-${end}s] ... \x1b[33mRendering: ${pct}% [${bar}]\x1b[0m`);
          };

          await cutSegment(
            resolvedSourcePath,
            start,
            end,
            tempSegmentPath,
            watermarkText,
            shortsFormat,
            copyrightBypass,
            18,
            false,
            cpuFriendly,
            onProgress
          );

          totalClipsProcessed++;
          allSegmentPaths.push(tempSegmentPath);

          // Build YouTube-optimized metadata text file silently
          const ytTitle = (seg.title || title).trim();
          const ytHook = (seg.hook || '').trim();
          const ytDescription = (seg.description || '').trim();
          const ytTags = (seg.tags || '').trim();
          const ytCredits = (seg.credits || `Original content by ${uploader}`).trim();
          const ytDisclaimer = (seg.disclaimer || 'This clip is shared for educational purposes under fair use. All rights belong to the original creator.').trim();

          const descLines = [
            `TITLE:`,
            ytTitle,
            ``,
            ...(ytHook ? [`HOOK:`, ytHook, ``] : []),
            `DESCRIPTION:`,
            ytDescription || `Clip from: ${meta.title}\nSource: ${currentUrl}`,
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
            `Generated with ClipForge CLI`,
          ];

          const descPath = path.join(exportDir, `${cleanTitle} - Part ${i + 1} - ${cleanSegTitle}.txt`);
          fs.writeFileSync(descPath, descLines.join('\n'), 'utf8');

          // If NOT compiling, export individual clip immediately and print status
          if (!mergeClips) {
            fs.mkdirSync(exportDir, { recursive: true });
            const finalOutputPath = path.join(exportDir, `${cleanTitle} - Part ${i + 1} - ${cleanSegTitle}.mp4`);
            fs.copyFileSync(tempSegmentPath, finalOutputPath);
            
            process.stdout.write(`\r\x1b[K   ✔ Clip ${i + 1}/${currentSegments.length}: "${title}" [${start}s-${end}s] ... \x1b[32mSuccess ✓\x1b[0m\n`);
          } else {
            process.stdout.write(`\r\x1b[K   ✔ Clip ${i + 1}/${currentSegments.length}: "${title}" [${start}s-${end}s] ... \x1b[32mStaged ✓\x1b[0m\n`);
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

      // Skip-if-exists for compilation output
      if (fs.existsSync(finalOutputPath)) {
        process.stdout.write(`\n   ⏭ Compilation already exists, skipping merge: ${path.basename(finalOutputPath)}\n`);
      } else {
        process.stdout.write(`\n   ⏳ Concat: Merging ${allSegmentPaths.length} clips into compilation...\n`);
        fs.mkdirSync(exportDir, { recursive: true });
        await mergeSegments(allSegmentPaths, finalOutputPath);
        process.stdout.write(`\x1b[1A\x1b[K   ✔ Compilation: Merged ${allSegmentPaths.length} clips successfully ✓\n`);
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
        `Generated with ClipForge CLI`,
      ];
      fs.writeFileSync(descPath, compilationDescLines.join('\n'), 'utf8');
    }
  } catch (err) {
    console.error(`\n\x1b[31m❌ Batch Job failed: ${err.message}\x1b[0m`);
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
            console.log(`\n\x1b[32m✔ Updated ${updatedCount} links to status 'done' in database! ✓\x1b[0m`);
          }
          if (revertedCount > 0) {
            console.log(`\n\x1b[33m↩ Reverted ${revertedCount} incomplete/failed links back to pending ' [ ]' state! ✓\x1b[0m`);
          }
        }
      }
    } catch (dbErr) {
      console.error(`\n\x1b[33mWarning: Failed to update database status: ${dbErr.message}\x1b[0m`);
    }

    console.log(`\n\x1b[35m=== Job Finished ===\x1b[0m`);
    const skippedNote = totalClipsSkipped > 0 ? ` ⏭ ${totalClipsSkipped} skipped` : '';
    console.log(`🔗 Completed Batch of \x1b[36m${urls.length}\x1b[0m URLs (\x1b[32m${totalClipsProcessed}\x1b[0m processed${skippedNote}):`);
    urls.forEach(u => {
      const dbMatch = linksDb.find(l => l.url === u);
      if (dbMatch && dbMatch.status === 'done' && !successfullyProcessedUrls.includes(u)) {
        console.log(`  \x1b[33m- ${u} (Skipped - already completed in database ✓)\x1b[0m`);
      } else {
        console.log(`  \x1b[36m- ${u}\x1b[0m`);
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
