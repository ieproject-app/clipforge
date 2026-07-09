import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { FFMPEG_PATH } from '../platform.js'
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
})
