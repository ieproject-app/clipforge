/**
 * Platform Resolution
 *
 * Centralizes OS-specific binary/path resolution so both `ytdlp.js` and
 * `ffmpeg.js` behave identically across Windows (dev) and Linux/Docker (prod).
 *
 * No hardcoded absolute interpreter paths live here — everything is resolved
 * from the current process environment/platform, with an environment override.
 */

import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the Python interpreter used to run `yt_dlp`.
 *
 * Resolution order:
 *   1. `process.env.PYTHON` override (if truthy)
 *   2. Windows (`process.platform === 'win32'`) → `python`
 *   3. Otherwise → `python3`
 *
 * Reads `process.env.PYTHON` and `process.platform` at call time so unit tests
 * can stub either before invoking.
 *
 * @returns {string} the Python command to spawn
 */
export function resolvePythonCmd() {
    if (process.env.PYTHON) {
        return process.env.PYTHON;
    }
    if (process.platform === 'win32') {
        return 'python';
    }
    return 'python3';
}

/**
 * Cached Python command resolved once at module load.
 * Prefer this constant in hot paths; call `resolvePythonCmd()` directly when
 * the resolution must reflect the current process state.
 */
export const PYTHON_CMD = resolvePythonCmd();

/**
 * Resolve the FFmpeg binary to use for segment processing.
 *
 * Resolution order:
 *   1. If an `ffmpeg` binary is runnable on the system PATH → `'ffmpeg'`
 *   2. Otherwise, the FFmpeg executable path provided by the `imageio-ffmpeg`
 *      Python package (resolved via `resolvePythonCmd()`, not a hardcoded
 *      `python`)
 *   3. Otherwise, the literal command `'ffmpeg'` as a last resort
 *
 * Every step is wrapped so that a failing probe simply falls through to the
 * next option; this function never throws.
 *
 * @returns {string} the FFmpeg command/path to spawn
 */
export function getFFmpegPath() {
    // 1. Prefer a runnable `ffmpeg` on PATH.
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return 'ffmpeg';
    } catch {
        // Not on PATH (or not runnable) — fall through to imageio-ffmpeg.
    }

    // 2. Fall back to the binary bundled with the `imageio-ffmpeg` package.
    try {
        const pythonCmd = resolvePythonCmd();
        const result = execSync(
            `${pythonCmd} -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`,
            { encoding: 'utf8' }
        ).trim();
        if (result) {
            return result;
        }
    } catch {
        // imageio-ffmpeg not installed / not resolvable — fall through.
    }

    // 3. Last-resort literal command.
    return 'ffmpeg';
}

/**
 * Cached FFmpeg path resolved once at module load.
 *
 * Wrapped in try/catch so resolution can never throw during module
 * initialization; on any unexpected error we fall back to the literal
 * `'ffmpeg'`. Prefer this constant in hot paths; call `getFFmpegPath()`
 * directly when the resolution must reflect the current environment.
 */
export const FFMPEG_PATH = (() => {
    try {
        return getFFmpegPath();
    } catch {
        return 'ffmpeg';
    }
})();

/**
 * Resolve a usable watermark font path for the current platform.
 *
 * Checks a platform-specific list of candidate font files (read from
 * `process.platform` at call time so behavior is deterministic per call) and
 * returns the first one that exists on disk. If none of the candidates exist,
 * returns `null` so the caller can skip the watermark and fall back to a plain
 * cut.
 *
 * @returns {string | null} the first existing font path, or `null` if none exist
 */
export function getFontPath() {
    let candidates;

    if (process.platform === 'win32') {
        candidates = [
            'C:\\Windows\\Fonts\\segoeui.ttf',
            'C:\\Windows\\Fonts\\arial.ttf',
            'C:\\Windows\\Fonts\\tahoma.ttf',
        ];
    } else if (process.platform === 'darwin') {
        candidates = [
            '/System/Library/Fonts/Supplemental/Arial.ttf',
            '/Library/Fonts/Arial.ttf',
            '/System/Library/Fonts/Helvetica.ttc',
        ];
    } else {
        candidates = [
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
        ];
    }

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Cached font path resolved once at module load.
 * Prefer this constant in hot paths; call `getFontPath()` directly when the
 * resolution must reflect the current filesystem/platform state.
 */
export const FONT_PATH = getFontPath();

/**
 * Returns a modified PATH environment variable containing a directory with an
 * executable named exactly 'ffmpeg' (or 'ffmpeg.exe' on Windows).
 * If FFmpeg is already globally available on the system PATH, returns the original PATH.
 * Otherwise, copies the imageio-ffmpeg binary to a temp directory and prepends it.
 *
 * @returns {string} The modified PATH value
 */
export function getPATHWithFFmpeg() {
    if (FFMPEG_PATH === 'ffmpeg') {
        return process.env.PATH || '';
    }

    const tempBinDir = path.resolve(__dirname, '..', 'temp', 'bin');
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const targetPath = path.join(tempBinDir, exeName);

    if (!existsSync(targetPath)) {
        try {
            mkdirSync(tempBinDir, { recursive: true });
            copyFileSync(FFMPEG_PATH, targetPath);
        } catch (e) {
            console.error('Failed to copy FFmpeg to temp bin:', e.message);
        }
    }
    return `${tempBinDir}${path.delimiter}${process.env.PATH || ''}`;
}
/**
 * Probe FFmpeg for a working hardware-accelerated H.264 encoder.
 *
 * Checks in preference order: Nvidia (nvenc) → AMD (amf) → Intel (qsv).
 * Availability is confirmed by actually running a tiny 1-frame null-sink
 * encode so we don't rely on `-encoders` output alone (which lists compiled-in
 * encoders regardless of whether drivers are present).
 *
 * Falls back to `'libx264'` if none succeed or if FFmpeg is unavailable.
 *
 * @returns {'h264_nvenc'|'h264_amf'|'h264_qsv'|'libx264'}
 */
export function resolveVideoEncoder() {
    const candidates = ['h264_nvenc', 'h264_amf', 'h264_qsv'];
    for (const encoder of candidates) {
        try {
            // Tiny 1-frame 320x240 null-sink encode — fast enough to use as a probe and matches hardware min resolutions.
            execSync(
                `${FFMPEG_PATH} -f lavfi -i color=black:s=320x240:d=0.04 -c:v ${encoder} -frames:v 1 -f null -`,
                { stdio: 'ignore', timeout: 8000 }
            );
            return encoder;
        } catch {
            // Encoder unavailable or driver missing — try next.
        }
    }
    return 'libx264';
}

/**
 * Cached video encoder resolved once at module load.
 *
 * Prefer this constant in hot paths; call `resolveVideoEncoder()` directly
 * when the resolution must reflect the current environment state.
 */
export const VIDEO_ENCODER = (() => {
    try {
        return resolveVideoEncoder();
    } catch {
        return 'libx264';
    }
})();

/**
 * Channel presets for the Link Manager.
 * Each channel has its own label and separate link database file.
 * Add new channels here as needed.
 */
export const CHANNELS = {
    'default': { label: 'Default Channel', file: 'link/default.txt' },
    'channel1': { label: 'Channel 1', file: 'link/channel1.txt' },
    'channel2': { label: 'Channel 2', file: 'link/channel2.txt' },
    'channel3': { label: 'Channel 3', file: 'link/channel3.txt' },
};

/**
 * Resolve the links file path for a given channel key.
 * Falls back to 'default' if the channel key is unknown.
 * @param {string} [channel='default']
 * @returns {string} Absolute path to the channel's link database file
 */
export function getLinksFile(channel = 'default') {
    const ch = CHANNELS[channel] || CHANNELS['default'];
    return path.resolve(__dirname, '..', '..', ch.file);
}

// Legacy constant: resolves to the default channel file
export const LINKS_FILE = getLinksFile('default');
