import { spawn } from 'child_process';
import fs from 'node:fs';
import path from 'path';
import { PYTHON_CMD } from './platform.js';
import { extractVideoIdFromUrl } from './ytdlp.js';

/**
 * Download YouTube auto-generated captions for a video and cache them on disk.
 *
 * YouTube's speech-recognition captions have WORD-LEVEL timing accuracy — far
 * more precise than Gemini's synthetic timestamps (Gemini doesn't hear audio;
 * it guesses timing from text structure, producing uniform 0.5s gaps and 2-4s
 * durations that don't match actual speech). This module fetches YouTube's
 * auto-subs via yt-dlp (already a project dependency), parses the VTT output,
 * and exposes helpers to extract clip-relative subtitle entries.
 *
 * Caching: auto-subs are cached as `cacheDir/<videoId>.<lang>.vtt` so re-runs
 * of the same video are instant (no network). The video file itself is cached
 * separately by `downloadWithCache` in ytdlp.js.
 *
 * Multi-lang fallback: accepts an array of language codes tried in order. The
 * first language with a non-empty cached or freshly-downloaded VTT wins. This
 * handles common YouTube naming inconsistencies where Indonesian auto-subs are
 * labelled `id-auto` instead of `id`, or where only an English track exists.
 *
 * @param {string} url - YouTube video URL.
 * @param {string} cacheDir - Directory for cached subtitle files.
 * @param {string|string[]} [langs='id'] - Language code or ordered priority array.
 *   Default: ['id', 'id-auto', 'en'].
 * @returns {Promise<string|null>} - Path to the cached VTT file for the first
 *   available language, or null if no language has auto-subs.
 */
export async function downloadAutoSubs(url, cacheDir, langs = ['id', 'id-auto', 'en']) {
    const videoId = extractVideoIdFromUrl(url);
    if (!videoId) return null;

    // Normalise: accept a single string or an array
    const langList = Array.isArray(langs) ? langs : [langs];

    fs.mkdirSync(cacheDir, { recursive: true });

    for (const lang of langList) {
        // Check cache first — instant on re-runs.
        const cachedPath = path.join(cacheDir, `${videoId}.${lang}.vtt`);
        if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 0) {
            return cachedPath;
        }

        // Download auto-subs via yt-dlp. We request VTT format explicitly and use
        // --convert-subs vtt to ensure we get VTT even if YouTube's native format
        // is srv3/json3. --skip-download means we only fetch subtitles, not video.
        const outputBase = path.join(cacheDir, `${videoId}_sub_${lang}`);

        const result = await new Promise((resolve) => {
            const proc = spawn(PYTHON_CMD, [
                '-m', 'yt_dlp',
                '--write-auto-sub',
                '--sub-lang', lang,
                '--sub-format', 'vtt',
                '--convert-subs', 'vtt',
                '--skip-download',
                '--no-playlist',
                '--no-warnings',
                '--force-ipv4',
                '--no-check-certificates',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--extractor-args', 'youtube:player_client=android,web',
                '-o', `${outputBase}.%(ext)s`,
                url,
            ]);

            proc.stderr.on('data', () => {});
            proc.on('close', (code) => {
                // yt-dlp returns non-zero if auto-subs don't exist for this lang —
                // that's not a crash, just "no subtitles available".
                if (code !== 0) { resolve(null); return; }

                // yt-dlp writes <base>.<lang>.vtt — find it.
                try {
                    const dir = path.dirname(outputBase);
                    const base = path.basename(outputBase);
                    const entries = fs.readdirSync(dir);
                    const match = entries.find((e) => e.startsWith(base + '.') && e.endsWith('.vtt'));
                    if (!match) { resolve(null); return; }
                    const downloadedPath = path.join(dir, match);

                    // Rename to canonical cache name for future re-runs.
                    if (downloadedPath !== cachedPath) {
                        fs.renameSync(downloadedPath, cachedPath);
                    }
                    resolve(cachedPath);
                } catch {
                    resolve(null);
                }
            });
            proc.on('error', () => resolve(null));
        });

        if (result) return result; // First successful lang wins
    }

    return null; // No language had auto-subs available
}

/**
 * Parse a VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to seconds (float).
 */
function parseVttTimestamp(ts) {
    const parts = ts.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(ts) || 0;
}

/**
 * Parse a WebVTT subtitle file into an array of {start, end, text} entries.
 *
 * YouTube auto-sub VTT files use a ROLLING CAPTION structure with inline
 * word-level timing tags. Each cue repeats the visible text so far and APPENDS
 * new words with embedded timestamps: `<00:00:49.560><c> butuh</c>`. This means
 * the cue-level start timestamp is when the FIRST word of the rolling text was
 * spoken, NOT when the new words at the end appear — so dumping all cue text
 * at cue-start produces a multi-second delay for words spoken mid-cue.
 *
 * To fix this, the parser below:
 *   1. Diffs each cue against the previous one to isolate only NEW words.
 *   2. Extracts the inline `<HH:MM:SS.mmm><c>word</c>` timestamp for each new
 *      word (falling back to cue-start if a new word has no inline tag).
 *   3. Groups consecutive new words into short phrases (~5 words or ~3.5s,
 *      whichever comes first) so each SRT entry is a readable snippet that
 *      appears EXACTLY when its first word is spoken — eliminating the delay.
 *
 * @param {string} vttPath - Path to the .vtt file.
 * @returns {Array<{start: number, end: number, text: string}>} Subtitle entries
 *   with full-video timestamps (0.0 = video start).
 */
export function parseVttToSubtitles(vttPath) {
    if (!fs.existsSync(vttPath)) return [];

    const content = fs.readFileSync(vttPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const cues = []; // parsed cues: { start, end, bodyLines: string[] }
    let i = 0;

    // Skip WEBVTT header and metadata lines (Kind:, Language:, NOTE, etc.)
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line.match(/^\d{2}:\d{2}/) || line.match(/^\d{2}:\d{2}:\d{2}/)) break;
        i++;
    }

    // Phase 1: parse raw cues with body lines preserved (NOT concatenated).
    // YouTube rolling captions put history on L1 and new content on L2; concatenating
    // them would obscure the rolling structure (previous code lumped history + new).
    while (i < lines.length) {
        const line = lines[i].trim();
        const tsMatch = line.match(
            /(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/
        );
        if (tsMatch) {
            const start = parseVttTimestamp(tsMatch[1]);
            const end = parseVttTimestamp(tsMatch[2]);
            i++;
            const bodyLines = [];
            while (i < lines.length && lines[i].trim() !== '') {
                bodyLines.push(lines[i]);
                i++;
            }
            cues.push({ start, end, bodyLines });
        } else {
            i++;
        }
    }

    // Phase 2: for each REAL cue (duration > 0.05s), parse ONLY the last body line
    // (L2 = the new content being appended with inline word-level timestamps).
    // MARKER cues (duration ~0.01s) repeat L1 only (already-emitted L2 promoted to
    // history) — skipping them entirely avoids the rolling-text duplication that
    // plagued the previous naive diff approach.
    const allWords = [];
    // Tokenize: capture each inline <timestamp> tag followed by EVERYTHING up to
    // the NEXT inline <timestamp> tag.
    const tokenRegex = /<(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})>([\s\S]*?)(?=<(?:\d{2}:\d{2})|$)/g;

    // TIMING_ADVANCE: advance all subtitle timestamps by this amount (seconds)
    // so text appears slightly BEFORE the word is spoken. This compensates for
    // two real-world delays:
    //   1. YouTube’s auto-sub timestamps mark when a word FINISHES being spoken
    //      (speech recognition latency), not when it starts.
    //   2. Viewer reading lag — the eye needs ~100-150ms to process new text.
    // 0.12s (120ms) is the standard broadcast practice for live caption lead-time.
    const TIMING_ADVANCE = 0.12;

    /**
     * Push a word to allWords, skipping exact duplicates (same text + same ts).
     * All timestamps are advanced by TIMING_ADVANCE to compensate for recognition
     * latency and reading lag. Timestamps are clamped to ≥0 to avoid negatives.
     */
    function pushWord(ts, text) {
        const adjusted = Math.max(0, ts - TIMING_ADVANCE);
        const last = allWords[allWords.length - 1];
        if (last && last.ts === adjusted && last.text === text) return; // dedup
        allWords.push({ ts: adjusted, text });
    }

    for (const cue of cues) {
        if ((cue.end - cue.start) < 0.05) continue; // marker cue, skip
        const bodyLines = cue.bodyLines.filter(l => l.trim());
        if (bodyLines.length === 0) continue;
        const lastLine = bodyLines[bodyLines.length - 1];

        // For words that appear BEFORE the first inline timestamp tag in a line
        // (YouTube leaves the first new word un-tagged), we use the timestamp of
        // the FIRST inline tag in the same line as a fallback — this is far more
        // accurate than cue.start, which can be several words earlier in rolling
        // window cues. If no inline tag exists at all, fall back to cue.start.
        const firstTagMatch = lastLine.match(/<(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})>/);
        const firstTagTs = firstTagMatch ? parseVttTimestamp(firstTagMatch[1]) : cue.start;

        const firstTagIdx = lastLine.search(/<\d{2}:\d{2}/);
        if (firstTagIdx > 0) {
            // Plain text before the first inline tag — use firstTagTs as the
            // reference (better accuracy than cue.start for rolling-window cues).
            const plain = lastLine.slice(0, firstTagIdx).replace(/<[^>]+>/g, '').trim();
            if (plain) {
                for (const w of plain.split(/\s+/)) {
                    const clean = w.replace(/<[^>]+>/g, '').trim();
                    if (clean) pushWord(firstTagTs, clean);
                }
            }
        } else if (firstTagIdx === -1) {
            // No inline tags in this line at all (rare) — entire text is "plain".
            const plain = lastLine.replace(/<[^>]+>/g, '').trim();
            if (plain) {
                for (const w of plain.split(/\s+/)) {
                    const clean = w.replace(/<[^>]+>/g, '').trim();
                    if (clean) pushWord(cue.start, clean);
                }
            }
            continue; // skip the tag-token loop below
        }

        // Inline-typed tokens: <HH:MM:SS.mmm> followed by text up to the next tag.
        tokenRegex.lastIndex = 0;
        let match;
        while ((match = tokenRegex.exec(lastLine)) !== null) {
            const ts = parseVttTimestamp(match[1]);
            // Strip alignment tags (<c>, </c>) and any nested formatting, then
            // split the captured chunk into individual words so each word gets a
            // discrete timestamp (multiple words per chunk share the timestamp).
            const chunk = (match[2] || '').replace(/<[^>]+>/g, '').trim();
            if (chunk) {
                for (const w of chunk.split(/\s+/)) {
                    const clean = w.replace(/<[^>]+>/g, '').trim();
                    if (clean) pushWord(ts, clean);
                }
            }
        }
    }

    // Phase 3: group consecutive words into short, readable SRT phrases.
    //
    // Grouping rules (in priority order):
    //   a) Speech pause gap: if the gap between the last word of a group and the
    //      next word is >= PAUSE_GAP (0.8s), flush the group immediately. This
    //      ensures a new cue starts right when speech resumes after a silence,
    //      which feels far more natural than mechanically filling 5-word slots.
    //   b) Character limit: flush when accumulated text would exceed MAX_CHARS
    //      (~42 chars). Keeps captions comfortably within one screen-width line
    //      on mobile without text wrapping (which looks messy on Shorts/Reels).
    //   c) Word count: flush at MAX_WORDS (6) as a hard upper bound.
    //   d) Time span: flush at MAX_DURATION (4.0s) to prevent stale captions.
    //
    // End-timestamp strategy:
    //   - For all entries except the last, set `end` to the START of the next
    //     group's first word, minus a 40 ms guard gap. This produces a clean
    //     cut exactly when the next caption should appear — no overlap, no gap.
    //   - For the very last entry (no next word available), fall back to
    //     lastWord.ts + 0.8s as a conservative hold time.
    const subtitles = [];
    let group = [];
    const MAX_WORDS = 6;
    const MAX_CHARS = 42;
    const MAX_DURATION = 4.0;
    const PAUSE_GAP = 0.8; // seconds — flush on speech pause

    function flushGroup(nextWordTs = null) {
        if (group.length === 0) return;
        // End timestamp: cut exactly when the next caption starts (minus 20ms
        // guard). This is tighter than the previous 40ms gap, reducing the
        // "blank subtitle" window between consecutive entries and making captions
        // feel more continuous and less choppy.
        const endTs = nextWordTs !== null
            ? Math.max(group[group.length - 1].ts + 0.05, nextWordTs - 0.02)
            : group[group.length - 1].ts + 0.8;
        subtitles.push({
            start: group[0].ts,
            end: endTs,
            text: group.map(x => x.text).join(' '),
        });
        group = [];
    }

    for (let wi = 0; wi < allWords.length; wi++) {
        const w = allWords[wi];
        const nextW = allWords[wi + 1] || null;

        if (group.length === 0) {
            group.push(w);
        } else {
            const lastWord = group[group.length - 1];
            const span = w.ts - group[0].ts;
            const gap = w.ts - lastWord.ts;
            const projectedText = group.map(x => x.text).join(' ') + ' ' + w.text;

            const shouldFlush =
                gap >= PAUSE_GAP ||                   // (a) speech pause
                projectedText.length > MAX_CHARS ||   // (b) char limit
                group.length >= MAX_WORDS ||           // (c) word count
                span >= MAX_DURATION;                  // (d) time span

            if (shouldFlush) {
                flushGroup(w.ts);
                group.push(w);
            } else {
                group.push(w);
            }
        }

        // If this is the last word, flush the remaining group
        if (wi === allWords.length - 1) {
            flushGroup(null);
        }
    }

    return subtitles;
}

/**
 * Extract subtitle entries that fall within a clip's [clipStart, clipEnd] range
 * and convert their timestamps to clip-relative (0.0 = clip start).
 *
 * This mirrors how FFmpeg processes the clip: input seek (`-ss clipStart`) +
 * PTS reset (`-avoid_negative_ts make_zero`) makes the output timeline 0-based.
 * So the SRT burned into the clip must also be 0-based (clip-relative).
 *
 * Entries that partially overlap the clip boundary are clamped:
 *   - If subtitle starts before clipStart → relStart = 0
 *   - If subtitle ends after clipEnd → relEnd = clipEnd - clipStart
 *
 * @param {Array<{start: number, end: number, text: string}>} fullSubs - Full-video subtitles.
 * @param {number} clipStart - Clip start time in seconds (full-video timeline).
 * @param {number} clipEnd - Clip end time in seconds (full-video timeline).
 * @returns {Array<{start: number, end: number, text: string}>} Clip-relative subtitles.
 */
export function extractClipSubtitles(fullSubs, clipStart, clipEnd) {
    const clipDuration = clipEnd - clipStart;
    const result = [];

    for (const sub of fullSubs) {
        // Skip entries entirely outside the clip range.
        if (sub.end <= clipStart || sub.start >= clipEnd) continue;

        // Clamp partial overlaps to clip boundaries, then offset to clip-relative.
        const relStart = Math.max(0, sub.start - clipStart);
        const relEnd = Math.min(clipDuration, sub.end - clipStart);

        if (relEnd > relStart) {
            result.push({
                start: Math.round(relStart * 1000) / 1000,
                end: Math.round(relEnd * 1000) / 1000,
                text: sub.text,
            });
        }
    }

    return result;
}
