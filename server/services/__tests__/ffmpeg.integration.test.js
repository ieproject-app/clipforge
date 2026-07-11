import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { FFMPEG_PATH, getFontPath } from '../platform.js'
import { cutSegment, mergeSegments } from '../ffmpeg.js'

// Integration test (Task 9.1): watermarked cut with a hostile title.
//
// This is a REAL FFmpeg integration test — no mocking. It exercises the actual
// `cutSegment` from ffmpeg.js and the real `FFMPEG_PATH` resolution from
// platform.js against a tiny fixture clip generated on the fly with FFmpeg's
// built-in synthetic sources (lavfi), so no external asset is required.
//
// The hostile title is the exact string from ERROR_LOG.md that repeatedly broke
// the drawtext watermark. The key assertion is that the pipeline produces a
// non-empty output segment even with this title — proving the filter-script
// approach + plain-cut fallback succeeds (Requirements 4.1, 6.1).
//
// _Requirements: 4.1, 6.1_

const HOSTILE_TITLE = "Source: FULL MATCH | MEKSIKO VS INGGRIS | 100% 'HIGHLIGHT'"

/**
 * Spawn FFmpeg with the given args and resolve with the exit code (no shell).
 * Rejects only on a spawn error (binary missing / not launchable).
 */
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(FFMPEG_PATH, args)
        let stderr = ''
        proc.stderr.on('data', (d) => { stderr += d.toString() })
        proc.on('close', (code) => resolve({ code, stderr }))
        proc.on('error', (err) => reject(err))
    })
}

describe('ffmpeg integration: watermarked cut with a hostile title', () => {
    let tmpDir
    let inputPath
    let ffmpegAvailable = false

    beforeAll(async () => {
        // Determine whether FFmpeg is resolvable/runnable in this environment.
        // Prefer to run the test; only skip gracefully if the binary is absent.
        try {
            const { code } = await runFFmpeg(['-version'])
            ffmpegAvailable = code === 0
        } catch {
            ffmpegAvailable = false
        }

        if (!ffmpegAvailable) return

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipforge-itest-'))
        inputPath = path.join(tmpDir, 'input.mp4')

        // Generate a tiny fixture clip using FFmpeg's synthetic sources so no
        // external asset is needed: 2s of testsrc video + a sine audio tone.
        const { code, stderr } = await runFFmpeg([
            '-y',
            '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
            '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2',
            '-shortest',
            '-c:v', 'libx264', '-preset', 'ultrafast',
            '-c:a', 'aac',
            inputPath,
        ])

        // If the fixture can't be generated, treat FFmpeg as unavailable and skip.
        if (code !== 0 || !fs.existsSync(inputPath) || fs.statSync(inputPath).size === 0) {
            ffmpegAvailable = false
            // eslint-disable-next-line no-console
            console.warn(`Fixture generation failed, skipping integration test: ${stderr.slice(-300)}`)
        }
    }, 60000)

    afterAll(() => {
        if (tmpDir) {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    })

    it('produces a non-empty segment even with the hostile ERROR_LOG.md title', async () => {
        if (!ffmpegAvailable) {
            // FFmpeg not available in this environment — skip gracefully.
            // eslint-disable-next-line no-console
            console.warn('FFmpeg not available; skipping real-encode integration test.')
            return
        }

        const outputPath = path.join(tmpDir, 'out.mp4')

        // Cut a 1s segment with the hostile title as the watermark text.
        const result = await cutSegment(inputPath, 0, 1, outputPath, HOSTILE_TITLE)

        // The pipeline returns { watermarked: boolean }. We do NOT hard-assert
        // watermarked === true: a host lacking fonts is a valid fallback path.
        expect(result).toBeTypeOf('object')
        expect(typeof result.watermarked).toBe('boolean')

        // Key assertion: the output segment exists and is non-empty, proving the
        // pipeline succeeded even with the hostile title (Req 4.1, 6.1).
        expect(fs.existsSync(outputPath)).toBe(true)
        expect(fs.statSync(outputPath).size).toBeGreaterThan(0)
    }, 60000)

    // Integration test (Task 9.2): plain cut + merge.
    //
    // Exercises the concat demuxer with stream copy against two plain cuts (Req 6.3, 6.4).
    it('produces two plain re-encoded cuts and merges them; asserts the output file exists and is non-empty', async () => {
        if (!ffmpegAvailable) {
            // FFmpeg not available in this environment — skip gracefully.
            // eslint-disable-next-line no-console
            console.warn('FFmpeg not available; skipping plain cut & merge integration test.')
            return
        }

        const cutPath1 = path.join(tmpDir, 'cut1.mp4')
        const cutPath2 = path.join(tmpDir, 'cut2.mp4')
        const mergedPath = path.join(tmpDir, 'merged.mp4')

        // 1. Cut segment 1 (0s to 1s) without watermark
        const result1 = await cutSegment(inputPath, 0, 1, cutPath1)
        expect(result1.watermarked).toBe(false)
        expect(fs.existsSync(cutPath1)).toBe(true)
        expect(fs.statSync(cutPath1).size).toBeGreaterThan(0)

        // 2. Cut segment 2 (1s to 2s) without watermark
        const result2 = await cutSegment(inputPath, 1, 2, cutPath2)
        expect(result2.watermarked).toBe(false)
        expect(fs.existsSync(cutPath2)).toBe(true)
        expect(fs.statSync(cutPath2).size).toBeGreaterThan(0)

        // 3. Merge the two segments
        await mergeSegments([cutPath1, cutPath2], mergedPath)

        // 4. Assert single output file exists and is non-empty
        expect(fs.existsSync(mergedPath)).toBe(true)
        expect(fs.statSync(mergedPath).size).toBeGreaterThan(0)

        // Verify the concat list file next to output was deleted
        const listPath = mergedPath.replace('.mp4', '_list.txt')
        expect(fs.existsSync(listPath)).toBe(false)
    }, 60000)

    // Integration test (auto-caption regression, AUDIT_PROMPT.md / ERROR_LOG.md #8):
    // burn a real SRT file into a clip via the `subtitles=` filter.
    //
    // Reproduces the recurring auto-caption failure: FFmpeg rejected the entire
    // `-filter_complex_script` because the `subtitles=filename='...'` value was
    // single-quoted, which made the `\\:` colon escape from normalizeFontPath
    // ineffective (backslashes are literal inside single quotes). With the fix,
    // `filename=` is unquoted and the filter chain renders successfully — the
    // pipeline returns { watermarked: true } instead of falling back to a clean
    // cut. This test guards against reintroducing that quote/escape mismatch.
    //
    // The subtitle burn requires libass (present in the gyan.dev essentials
    // build used by imageio-ffmpeg) and an available font. If fonts are absent
    // the run still falls back to a clean cut, so we assert the output exists
    // and is non-empty regardless; the stronger { watermarked: true } assertion
    // is skipped only when the environment lacks the prerequisite font.
    it('burns a real SRT file into the clip via the subtitles filter (no fallback)', async () => {
        if (!ffmpegAvailable) {
            // eslint-disable-next-line no-console
            console.warn('FFmpeg not available; skipping auto-caption integration test.')
            return
        }

        // Write a minimal valid SRT (UTF-8, no BOM, LF line endings).
        const srtPath = path.join(tmpDir, 'captions.srt')
        const srtContent = '1\n00:00:00,000 --> 00:00:02,000\nHello subtitles\n\n'
        fs.writeFileSync(srtPath, srtContent, 'utf8')

        const outputPath = path.join(tmpDir, 'captioned.mp4')
        const fontPath = getFontPath()

        // Cut a 2s segment with watermark + the auto-caption SRT path. Both the
        // drawtext watermark and the subtitles filter live in the same filter
        // chain; if either fails to parse, the whole chain is rejected and the
        // pipeline falls back to a clean cut (watermarked: false).
        const result = await cutSegment(
            inputPath, 0, 2, outputPath,
            'Source: Caption Test', 'original', false,
            18, srtPath, false, null,
        )

        expect(result).toBeTypeOf('object')
        expect(typeof result.watermarked).toBe('boolean')

        // When a font is available, the filter chain (watermark + subtitles) must
        // render without falling back — this is the core regression assertion.
        if (fontPath) {
            expect(result.watermarked).toBe(true)
        }

        // Key assertion regardless of font availability: the segment exists and
        // is non-empty, proving the pipeline completed (filter or fallback).
        expect(fs.existsSync(outputPath)).toBe(true)
        expect(fs.statSync(outputPath).size).toBeGreaterThan(0)
    }, 60000)

    // Multi-clip regression test (Bug #2, AUDIT_PROMPT.md / ERROR_LOG.md #9):
    // `cutSegment`'s `finally` block used to delete `autoCaptionsSrtPath`, a
    // SHARED caller-owned SRT generated once per video and reused by every
    // clip. That deletion broke clip 2+ ("[Parsed_subtitles] Unable to open
    // ... .srt: No such file or directory") once Bug #1 was fixed and clip 1
    // actually opened/burned the SRT. This test calls `cutSegment` twice with
    // the SAME SRT path and asserts both the SRT and both outputs survive —
    // guarding against reintroducing that premature deletion.
    it('does not delete the shared auto-caption SRT between consecutive cutSegment calls (multi-clip)', async () => {
        if (!ffmpegAvailable) {
            // eslint-disable-next-line no-console
            console.warn('FFmpeg not available; skipping multi-clip auto-caption regression test.')
            return
        }

        // Shared SRT, generated once by the caller (CLI) and intentionally reused
        // for both clips — mirrors the real CLI loop in cli.js.
        const sharedSrtPath = path.join(tmpDir, 'shared.srt')
        const srtContent = '1\n00:00:00,000 --> 00:00:02,000\nClip A subtitle\n\n'
        fs.writeFileSync(sharedSrtPath, srtContent, 'utf8')

        const out1 = path.join(tmpDir, 'clip_a.mp4')
        const out2 = path.join(tmpDir, 'clip_b.mp4')
        const fontPath = getFontPath()

        // Clip A (0s-2s): should burn the SRT and leave it intact.
        const result1 = await cutSegment(
            inputPath, 0, 2, out1,
            'Source: Clip A', 'original', false,
            18, sharedSrtPath, false, null,
        )
        expect(fs.existsSync(out1)).toBe(true)
        expect(fs.statSync(out1).size).toBeGreaterThan(0)
        expect(fs.existsSync(sharedSrtPath)).toBe(true)

        // Clip B (0s-2s): reuses the SAME SRT. Before Bug #2 fix this failed
        // with [Parsed_subtitles] Unable to open ... .srt and fell back to a
        // clean cut. Assert the SRT still exists so the filter can parse it.
        const result2 = await cutSegment(
            inputPath, 0, 2, out2,
            'Source: Clip B', 'original', false,
            18, sharedSrtPath, false, null,
        )
        expect(fs.existsSync(out2)).toBe(true)
        expect(fs.statSync(out2).size).toBeGreaterThan(0)

        // If a font is available, both clips must render the filter chain
        // (watermark + subtitles) WITHOUT falling back to a clean cut. A
        // `watermarked: false` here would indicate Bug #2 has regressed: the
        // SRT was deleted after clip A, so clip B's `subtitles=` filter fails.
        if (fontPath) {
            expect(result1.watermarked).toBe(true)
            expect(result2.watermarked).toBe(true)
        }

        // The shared SRT must survive both calls — caller-owned lifecycle.
        expect(fs.existsSync(sharedSrtPath)).toBe(true)
    }, 60000)
})
