# ClipForge Auto-Caption Audit Prompt

> **STATUS SAAT INI (10 Jul 2026): 3 bug + 4 peningkatan fitur. Semua DIFIX.**
>
> - **Bug #1 (RESOLVED):** filter `subtitles` pakai single-quote `filename='...'` → fix: buang quote.
> - **Bug #2 (RESOLVED):** `cutSegment()` menghapus SRT shared di `finally` → fix: hapus deletion.
> - **Bug #2b (RESOLVED):** `ReferenceError: sharedSrtPath` (JS block scoping try/finally) → fix: hoist `let`.
> - **Bug #3 (RESOLVED):** SRT full-video timestamp vs 0-based clip timeline → fix: per-clip SRT clip-relative.
> - **Peningkatan #1 (RESOLVED):** Font terlalu besar nutupin konten. Root cause: libass PlayResY=288 default → FontSize=20 render ~133px. Fix: FontSize=10 (render ~67px, 3.5% tinggi — benchmark TikTok/Reels).
> - **Peningkatan #2 (RESOLVED):** Caption nutupin konten TENGAH. Root cause: MarginV juga di-scale 6.67× (sama seperti FontSize) → MarginV=120 render 800px dari bawah → caption di Y=1120 (58% dari atas = TENGAH). Fix: MarginV=20 (render 133px dari bawah → caption di Y=1787, 93% dari atas — di bawah foreground content yang berakhir di 66%). Verifikasi empiris pixel-scan: text di Y=1600-1750 (83%-91% dari atas), no overlap dengan foreground.
> - **Peningkatan #3 (RESOLVED):** Caption sync tidak akurat (Gemini synthetic timestamps). Fix: YouTube auto-captions via yt-dlp (word-level timing, 642 entries vs 17 Gemini). Fallback ke Gemini subtitles jika auto-sub unavailable.
> - **Peningkatan #4 (RESOLVED):** Generator manual mode. Fix: flag `--no-link-db` di cli.js + checkbox "Manual Mode" di App.jsx. Skip load/write LINKS_FILE untuk one-off runs.

---

Copy this entire file into your AI model to audit the auto-caption feature.

---

## Context

ClipForge is a Node.js CLI tool that downloads YouTube videos, cuts segments, and renders professional Shorts/TikToks. I'm implementing an **auto-caption feature** where Gemini AI generates subtitles alongside clip segments, and FFmpeg burns them into the video.

**The feature has been attempted 5+ times. A first root cause (quote/escape mismatch) was found and fixed. A SECOND latent bug then surfaced: the shared SRT file is deleted after the first clip, so clips 2+ fail to burn subtitles.**

## Tech Stack

- **CLI**: Node.js ESM, spawn child processes
- **Video**: FFmpeg 7.1 (gyan.dev essentials build, via imageio-ffmpeg bundle) via `spawn()`, h264_qsv GPU encoder on Windows
- **AI**: Gemini generates JSON with subtitles + segments
- **Subtitle**: Gemini JSON → Node.js writes .srt file → FFmpeg `subtitles=` filter burns into video
- **Watermark**: FFmpeg `drawtext=` filter overlays source attribution
- **Test**: Vitest (`npm test` = `vitest run`), 14 test files, ESM imports, 1 real-FFmpeg integration test

## Architecture Flow (CURRENT — after Bug #1/#2/#2b/#3 fixes)

```
1. Gemini → JSON with "subtitles" array per clip:
   { start: 0.5, end: 3.0, text: "Assalamualaikum..." }  // timestamps RELATIVE to clip start

2. CLI (cli.js) reads JSON → for EACH clip, generates ONE .srt file (PER-CLIP, clip-relative):
   - Timestamps used AS-IS from Gemini (NO full-video offset — Bug #3 fix)
   - SRT file saved to: batchTempDir/subtitles_<u>_<i>.srt   ← one per clip

3. cutSegment() called per clip in a loop (cli.js:491), passing that clip's captionSrtPath:
   for (let i = 0; i < currentSegments.length; i++) {
     // generate per-clip SRT with clip-relative timestamps (Bug #3 fix)
     captionsSrtPath = path.join(batchTempDir, `subtitles_${u}_${i}.srt`);
     subtitlesToSrt(seg.subtitles, captionSrtPath);
     await cutSegment(resolvedSourcePath, start, end, tempSegmentPath,
       watermarkText, shortsFormat, copyrightBypass,
       18, captionSrtPath, cpuFriendly, onProgress);   // ← per-clip SRT
   }

4. cutSegment() → buildFilterScriptContent() writes filter script:
   [0:v]crop=...,scale=...,format=yuv420p[v_vertical];
   [v_vertical]subtitles=filename=C\:/.../subtitles_0_0.srt:force_style='FontSize=20,...'[v_subbed];
   [v_subbed]drawtext=textfile=C\:/.../watermark.txt:fontfile=C\:/...:...[v]
   // SRT entries now 0.5s..clipDuration → fall INSIDE clip's 0-based timeline → burns ✓

5. FFmpeg runs with -filter_complex_script <scriptPath>
   On success → clip WITH subtitles + watermark
   On failure → fallback ladder (GPU→CPU, then clean cut without filters)
   FINALLY block in cutSegment deletes only per-clip scriptPath/textFilePath
   (SRT deletion REMOVED — Bug #2 fix; SRT is caller-owned per-clip temp)
6. CLI finally (per-URL) cleans up the last clip's captionSrtPath defensively;
   batchTempDir is rm'd at end of main(), sweeping all per-clip SRTs.
```

## Symptoms

### After Bug #1 fix (current state): C1 succeeds, C2+ fail
```
  [Auto-Caption] Writing SRT from Gemini (149 entries, full-video timestamps)...
  [Auto-Caption] ✅ 149 subtitle entries cached
  ✔ [C1/12] "Beda Arti Muharram & Al-Muharram!" — 82s          ← SUCCESS (subtitles burned!)
  ✂ [C2/12] ... |░░░░░░░░░░░░░░░░░░░░░░░░░| 0% · ~0sWatermark or subtitle render failed, falling back to cle
[Parsed_subtitles_10 @ 000002096f3e7840] Unable to open C:/Users/akses/.../video_cache/SwBXKXAjP3E_gemini.srt
[AVFilterGraph @ 000002096f3e0180] Error initializing filters
Failed to set value '...segment_0_1.mp4.filter.txt' for option 'filter_complex_script': No such file or directory
  ✔ [C2/12] "Alasan Mengejutkan..." — ...   ← clip created but WITHOUT subtitles/watermark (fallback)
```

Key observations:
1. **C1 succeeds** — the quote fix worked; `subtitles=` filter now parses and renders. `[Parsed_subtitles_10]` proves FFmpeg parsed the filter successfully.
2. **C2+ fails** with `[Parsed_subtitles] Unable to open .../xxx_gemini.srt` — the SRT file is **gone**.
3. The path libass tries to open (`C:/Users/.../xxx_gemini.srt`) is the un-escaped form of `C\:/Users/...` — so escaping is now correct; the file simply no longer exists.
4. C2 falls back to clean cut → clip exists but without subtitles/watermark.
5. The "truncated option name `filtet`/`filtey`" in the console is an artifact of the CLI progress bar overprinting the error line — NOT a real FFmpeg bug. The real error is "Unable to open ... .srt: No such file or directory".

### Original symptom (Bug #1, now resolved): ALL clips failed
```
[Parsed_subtitles @ ...] No option name near '/Users/.../sub.srt:force_style=FontSize=20'
Failed to set value '...filter.txt' for option 'filter_complex_script': Invalid argument
```
FFmpeg rejected the ENTIRE filter script at PARSE time because the quoted `filename='C\:/...'` had an un-escaped colon.

## Key Code Sections (CURRENT state after Bug #1 fix)

### 1. Filter Script Generation (filterHelpers.js, line ~116-130) — FIXED
```js
// 3. Subtitles (auto-caption via Gemini)
if (autoCaptionsSrtPath) {
  // The `filename=` value is intentionally UNQUOTED. FFmpeg's filtergraph
  // parser treats backslash as an escape char only in unquoted values; inside
  // single quotes backslashes are literal, so the `\\:` colon escape produced
  // by normalizeFontPath would NOT protect the drive-letter colon and parsing
  // fails (the recurring AUDIT_PROMPT.md auto-caption bug). Unquoted, the same
  // `\\:` escape works — exactly like the `drawtext=textfile=...` chain below.
  // `force_style` stays quoted because its commas would otherwise split options.
  const safeSrtPath = normalizeFontPath(autoCaptionsSrtPath);
  videoChains.push(`${currentVideoOut}subtitles=filename=${safeSrtPath}:force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,MarginV=80'[v_subbed]`);
  currentVideoOut = '[v_subbed]';
}
```
Note: `filename=` is UNQUOTED (was `'...'` before fix). `force_style='...'` stays quoted. This is correct and verified.

### 2. normalizeFontPath (filterHelpers.js line ~44-48) — UNCHANGED, correct
```js
export function normalizeFontPath(fontPath) {
  return fontPath
    .replace(/\\/g, '/')           // backslash → forward slash
    .replace(/^([A-Za-z]):/, '$1\\\\:')  // escape drive colon: C\:/...
}
```
Produces unquoted-safe output (`C\:/...`). JSDoc now explicitly warns: do NOT wrap result in single quotes (quoted vs unquoted escaping rules differ in FFmpeg filtergraphs).

### 3. cutSegment finally block (ffmpeg.js line ~261-267) — BUG #2 HERE
```js
export async function cutSegment(inputPath, start, end, outputPath, watermarkText, shortsFormat = 'original', copyrightBypass = false, watermarkFontSize = 18, autoCaptionsSrtPath = null, cpuFriendly = false, onProgress = null) {
    // ...
    let srtPath = autoCaptionsSrtPath; // Pre-generated by CLI (cached per video)  ← SHARED!

    const textFilePath = outputPath + '.watermark.txt';  // per-clip temp
    const scriptPath = outputPath + '.filter.txt';      // per-clip temp

    if (needsFilterScript) {
        // ... build filter, run FFmpeg, fallback ladder ...
        } finally {
            deleteFileQuiet(scriptPath);    // per-clip temp — OK to delete
            deleteFileQuiet(textFilePath);   // per-clip temp — OK to delete
            if (srtPath) {
                deleteFileQuiet(srtPath);    // ← BUG #2: this is the SHARED SRT
                                             //   (video_cache/<videoId>_gemini.srt)
                                             //   owned by the CLI, reused by all clips.
                                             //   Deleting it after C1 breaks C2-C12.
            }
        }
    }
```

The `scriptPath` and `textFilePath` are per-clip (derived from `outputPath`, unique per clip: `segment_0_0.mp4.filter.txt`, `segment_0_1.mp4.filter.txt`). But `srtPath` is the shared `video_cache/<videoId>_gemini.srt` — generated ONCE in cli.js (line ~407) and passed to every clip in the loop (cli.js:491).

### 4. SRT Generation with Offset (cli.js line ~105-121, ~388-414) — correct
```js
function subtitlesToSrt(subtitles, srtPath) {
  // ... builds SRT with HH:MM:SS,mmm timestamps, writes UTF-8 (no BOM, LF) ...
  fs.writeFileSync(srtPath, lines.join('\n'), 'utf8');
}

// In main(), BEFORE the clip loop:
let sharedSrtPath = null;
if (autoCaptions) {
  const allSubtitles = [];
  for (const seg of currentSegments) {
    if (seg.subtitles && Array.isArray(seg.subtitles)) {
      const clipStart = Number(seg.start);
      for (const sub of seg.subtitles) {
        allSubtitles.push({ start: clipStart + sub.start, end: clipStart + sub.end, text: sub.text });
      }
    }
  }
  if (allSubtitles.length > 0) {
    const videoId = currentSegments[0]?.url?.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1] || 'unknown';
    sharedSrtPath = path.join(cacheDir, `${videoId}_gemini.srt`);  // ← generated ONCE
    subtitlesToSrt(allSubtitles, sharedSrtPath);
  }
}

// Then in the loop, the SAME sharedSrtPath is passed to every cutSegment call:
for (let i = 0; i < currentSegments.length; i++) {
  // ...
  await cutSegment(resolvedSourcePath, start, end, tempSegmentPath,
    watermarkText, shortsFormat, copyrightBypass,
    18, sharedSrtPath, cpuFriendly, onProgress);  // ← same path every iteration
}
```
The SRT timestamp offset (clip-relative → full-video) is correct. The file is generated once and intentionally shared. The CLI does NOT delete it — only `cutSegment`'s finally block does, prematurely.

### 5. FFmpeg Arguments (filterHelpers.js buildCutArgs)
```js
if (filterScriptPath) {
  args.push('-filter_complex_script', filterScriptPath)  // works; FFmpeg 7.x prints deprecation warning
  // map [v] / [a] ...
}
```
FFmpeg 7.1 prints `-filter_complex_script is deprecated, use -/filter_complex <file> instead` but the option still functions fully (verified). Left as-is; migrating to inline `-filter_complex` risks Windows command-line length limits.

## The Two Root Causes

### Bug #1 (RESOLVED): Quote vs unquoted escape rule mismatch
FFmpeg filtergraph has TWO different escaping rules depending on whether a value is quoted:
- **Unquoted** (`textfile=C\:/...`): backslash IS an escape char → `\\:` protects colon. ✅ works
- **Single-quoted** (`filename='C\:/...'`): backslash is LITERAL → `\\:` does NOT escape colon → parse fails. ❌

`drawtext` used unquoted (worked). `subtitles` used quoted with the SAME `normalizeFontPath()` output → failed. Fix: make `subtitles=filename=` unquoted too (keep `force_style='...'` quoted for its commas).

Empirically confirmed with a byte-exact variant matrix against the real FFmpeg 7.1 binary:

| `filename=` form | Quote? | Result |
|---|---|---|
| `'C\:/...'` (old code) | ✅ quoted | ❌ FAIL (colon not escaped) |
| `C\:/...` (fix) | ❌ unquoted | ✅ SUCCESS |
| `'C\:/...'` single-backslash | ✅ quoted | ✅ SUCCESS |

Both the unquoted-double-backslash fix and the quoted-single-backslash alternative work on libx264 (CPU) and h264_qsv (GPU).

### Bug #2 (RESOLVED, 10 Jul 2026): Shared SRT deleted after first clip
`cutSegment()`'s `finally` block deletes `srtPath` — but `srtPath` is the **shared** `video_cache/<videoId>_gemini.srt`, generated once by the CLI and reused across all clips. Deleting it after C1 means C2-C12 hit `[Parsed_subtitles] Unable to open ... .srt: No such file or directory`.

This bug was LATENT: before Bug #1 was fixed, the filter always failed at parse time (the SRT was never actually opened by libass), so deleting it was harmless. Once Bug #1 was fixed and C1 actually opened/burned the SRT, the premature deletion became fatal for subsequent clips.

**Fix applied (10 Jul 2026):** Per audit recommendation Q1 / `Files Needing Bug #2 Fix`.
1. `server/services/ffmpeg.js` — removed `if (srtPath) { deleteFileQuiet(srtPath); }` from the `finally` block. Only `scriptPath` and `textFilePath` (both derived from `outputPath`, per-clip) are cleaned up there. Comment added explaining the caller-owned lifecycle.
2. `cli.js` — added cleanup of `sharedSrtPath` in the existing `finally` block per-URL (after the clip loop), so the CLI owns the SRT lifecycle: it generates the SRT once before the loop and removes it once after the whole video's clips complete (or throw). `fs.rmSync(..., { force: true })` no-op if auto-captions disabled / no subtitles.
3. `server/services/__tests__/ffmpeg.integration.test.js` — added multi-clip regression test: calls `cutSegment` TWICE with the SAME `sharedSrtPath`, asserts both outputs burn subtitles and the SRT still exists after both calls. Guards against reintroducing Bug #2.

Validation: `ffmpeg.integration.test.js` 4/4 passed (including the new multi-clip test). Pre-existing unrelated failure in `filterHelpers.normalizeFontPath.test.js` (Property 3) — that test file was modified during Bug #1 work, not by this fix; the failure is a regex bug in the test (`/\\\\:/g` matches double-backslash but `normalizeFontPath` emits single `\:`), surfaced by a fast-check seed; tracked separately, not touched here.

## What's Been Tried

| # | Attempt | Change | Result |
|---|---------|--------|--------|
| 1 | Used `faster-whisper` Python library | — | Too slow (2-5 min), dependency issues |
| 2 | Switched to Gemini for subtitles | — | Fast, but subtitles didn't appear |
| 3 | Keep native backslashes in script path | — | Still fails |
| 4 | `normalizeFontPath()` for SRT path | — | Still fails (used inside quotes) |
| 5 | Fixed SRT timestamp offset (clip-relative → full-video) | — | Correct, but filter never ran |
| 6 | Added `MarginV=80` for subtitle positioning | — | N/A (filter never ran) |
| 7 | **Diagnosed empirically: FFmpeg HAS subtitles/ass/drawtext filters** (libass present) | `-filters` check | Ruled out "filter missing" hypothesis (Q#7) |
| 8 | **Built byte-exact variant matrix** (quoted vs unquoted × backslash counts) | tested against real FFmpeg 7.1 | Identified quote/escape mismatch as Bug #1 |
| 9 | **Fixed Bug #1: removed single-quote on `filename=`** | `filterHelpers.js` | ✅ C1 now burns subtitles; C2+ fail → exposed Bug #2 |
| 10 | **Identified Bug #2: shared SRT deleted in finally block** | `ffmpeg.js` finally | ⏳ Not yet fixed — current blocker |

## Environment

- OS: Windows 11
- FFmpeg: 7.1-essentials_build (gyan.dev), via imageio-ffmpeg bundle. Filters confirmed: `subtitles`, `ass`, `drawtext` all available (libass + libfreetype included).
- Binary path: `C:\Users\akses\AppData\Local\Programs\Python\Python313\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe`
- GPU: Intel QSV (h264_qsv encoder, `VIDEO_ENCODER = 'h264_qsv'`)
- Font: `C:\Windows\Fonts\segoeui.ttf` (resolved via `getFontPath()` in platform.js)
- Node.js: v24.16.0
- SRT encoding: UTF-8, no BOM, LF line endings (verified via hexdump)

## Questions to Investigate (focus on Bug #2)

1. **What is the correct ownership of the SRT file lifecycle?** The CLI generates `video_cache/<videoId>_gemini.srt` once per video and reuses it for all clips. `cutSegment` (a shared library, also imported by the server) deletes it in its `finally` block. Should the deletion be moved to the CLI after the clip loop, or removed entirely (the path is keyed by videoId, so it acts as a cache)?

2. **Does the fallback path also rely on the SRT being present?** When the primary render fails (Bug #2), the Tier-2 fallback calls `buildFilterScriptContent` WITHOUT `autoCaptionsSrtPath` (clean cut), but the SAME `finally` block still runs and tries to delete the (already-deleted) SRT. Is there any path where the SRT deletion causes a secondary issue beyond the "Unable to open" error?

3. **Should `cutSegment` treat `autoCaptionsSrtPath` as read-only (caller-owned) input** rather than a temp file it owns? The parameter naming and the `// Pre-generated by CLI (cached per video)` comment suggest it was always intended to be caller-owned, making the `finally` deletion a bug.

4. **After fixing Bug #2, do all 12 clips burn subtitles correctly on both CPU (libx264) and GPU (h264_qsv)?** Bug #1 was verified end-to-end on a 2s test fixture; Bug #2 only manifests on multi-clip runs (C2+), which the test fixture didn't cover.

5. **Is there a per-clip SRT alternative?** Instead of one shared SRT with full-video timestamps, could each clip get its own clip-relative SRT (timestamps 0..clipDuration)? This would make the SRT a true per-clip temp file that the `finally` block could legitimately delete. Trade-off: requires changing the CLI to generate per-clip SRTs and the timestamp offset logic.

## Debugging Suggestions

1. After fixing Bug #2, log the EXACT filter script content + SRT existence check before each FFmpeg run across all 12 clips.
2. Add an integration test that runs cutSegment TWICE with the SAME autoCaptionsSrtPath (multi-clip simulation) to catch Bug #2 regressions — the existing integration test only runs one captioned clip.
3. Run the CLI with `--auto-captions` on a real multi-clip video and confirm subtitles appear in C1 AND C2...C12.
4. Consider logging in `cutSegment` whether `srtPath` exists at entry (it won't for C2+ after Bug #2), to make this failure mode loud rather than a silent FFmpeg fallback.

## Files Touched by Bug #1 Fix (for reference)

- `server/services/filterHelpers.js` — removed single-quote on `filename=`, updated JSDoc/comments
- `server/services/__tests__/filterHelpers.buildFilterScriptContent.test.js` — regression test: `filename=` must be unquoted
- `server/services/__tests__/filterHelpers.normalizeFontPath.test.js` — property: output never contains single-quote
- `server/services/__tests__/ffmpeg.integration.test.js` — caption burn integration test
- `ERROR_LOG.md` — entry #8 documenting Bug #1
- `AUDIT_PROMPT.md` — this file (status update)

## Files Needing Bug #2 Fix (APPLIED, 10 Jul 2026)

- ✅ `server/services/ffmpeg.js` (line ~261-274) — removed `deleteFileQuiet(srtPath)` from the `finally` block; SRT is caller-owned (CLI), not a per-clip temp file.
- ✅ `cli.js` — added `sharedSrtPath` cleanup in the per-URL `finally` block (after the clip loop completes), restoring CLI ownership of the SRT lifecycle.
- ✅ `server/services/__tests__/ffmpeg.integration.test.js` — added multi-clip regression test (two `cutSegment` calls sharing one SRT path) to guard against Bug #2 regression.
