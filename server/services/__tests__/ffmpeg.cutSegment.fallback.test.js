import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'

// Unit tests for cutSegment's watermark fallback path.
// Requirements: 5.3, 5.4
//
// cutSegment(inputPath, start, end, outputPath, watermarkText):
//   - When watermarkText + a font are available it writes a drawtext filter
//     script and spawns FFmpeg with `-filter_complex_script <script>`.
//   - Requirement 5.3: IF FFmpeg exits non-zero while a drawtext filter is
//     applied, the service retries the identical cut WITHOUT the watermark and
//     resolves successfully.
//   - Requirement 5.4: the resolved object reports whether the watermark was
//     applied ({ watermarked: boolean }).
//
// The FFmpeg binary is never actually launched. We mock `child_process.spawn`
// to return a fake child process (EventEmitter) whose exit code we control per
// invocation, distinguishing the drawtext attempt from the plain retry by
// inspecting the argument array for `-filter_complex_script`. `fs` and
// `./platform.js` are mocked so no disk or font-discovery side effects occur.

// --- Module mocks -----------------------------------------------------------

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// ffmpeg.js uses `import fs from 'fs'`, so provide a default export.
vi.mock('fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => true),
  },
}))

// Always report a font so cutSegment takes the watermark path, and pin the
// FFmpeg path so no execSync-based resolution runs at import time.
vi.mock('../platform.js', () => ({
  FFMPEG_PATH: 'ffmpeg',
  getFontPath: () => '/fake/font.ttf',
  VIDEO_ENCODER: 'libx264',
}))

// Import AFTER the mocks are registered.
import { spawn } from 'child_process'
import fs from 'fs'
import { cutSegment } from '../ffmpeg.js'

// --- Helpers ----------------------------------------------------------------

/**
 * Build a fake child process that emits a `close` event with `exitCode`
 * asynchronously, so runFFmpeg's `.on('close', ...)` handler is registered
 * before the event fires. Its `stderr` is a real EventEmitter (runFFmpeg calls
 * `proc.stderr.on('data', ...)`).
 */
function makeFakeProc(exitCode) {
  const proc = new EventEmitter()
  proc.stderr = new EventEmitter()
  setImmediate(() => {
    proc.stderr.emit('data', Buffer.from(exitCode === 0 ? '' : 'drawtext parse error'))
    proc.emit('close', exitCode)
  })
  return proc
}

const hasFilterScript = (args) => args.includes('-filter_complex_script')

beforeEach(() => {
  vi.clearAllMocks()
})

// --- Tests ------------------------------------------------------------------

describe('cutSegment watermark fallback (Requirements 5.3, 5.4)', () => {
  it('retries without the watermark when the drawtext attempt fails and resolves { watermarked: false }', async () => {
    // First (drawtext) invocation fails with code 1; the plain retry succeeds.
    spawn.mockImplementation((_bin, args) => makeFakeProc(hasFilterScript(args) ? 1 : 0))

    const result = await cutSegment('in.mp4', 0, 5, 'out.mp4', 'Hello Title')

    // Requirement 5.4: reports the watermark was NOT applied.
    expect(result).toEqual({ watermarked: false })

    // Requirement 5.3: a second (plain) invocation occurred after the failure.
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(2)

    const firstArgs = spawn.mock.calls[0][1]
    const secondArgs = spawn.mock.calls[1][1]

    // First call is the drawtext attempt (uses the filter script)...
    expect(hasFilterScript(firstArgs)).toBe(true)
    // ...and the retry is a plain re-encoded cut with NO filter script.
    expect(hasFilterScript(secondArgs)).toBe(false)

    // The filter script was written and then cleaned up (Requirement 9.1).
    expect(fs.writeFileSync).toHaveBeenCalledWith('out.mp4.filter.txt', expect.any(String))
    expect(fs.unlinkSync).toHaveBeenCalledWith('out.mp4.filter.txt')
  })

  it('resolves { watermarked: true } with a single invocation when the drawtext attempt succeeds', async () => {
    // Every invocation succeeds; the first (watermarked) attempt is enough.
    spawn.mockImplementation(() => makeFakeProc(0))

    const result = await cutSegment('in.mp4', 0, 5, 'out.mp4', 'Hello Title')

    // Requirement 5.4: reports the watermark WAS applied.
    expect(result).toEqual({ watermarked: true })

    // No fallback needed — spawn called exactly once, using the filter script.
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(hasFilterScript(spawn.mock.calls[0][1])).toBe(true)
  })
})
