import { spawn } from 'child_process';
import path from 'path';
import fs from 'node:fs';
import { PYTHON_CMD } from './platform.js';
import { writeJobLog } from './logger.js';

/**
 * Resolve the actual file yt-dlp wrote for a given output base path (no extension).
 *
 * yt-dlp is invoked with an output template of `${outputPathBase}.%(ext)s`, so the
 * real container may be `.mp4`, `.mkv`, `.webm`, etc. This locates the single file
 * on disk whose name is the base name followed by a literal dot and an extension.
 *
 * @param {string} outputPathBase - Output path WITHOUT extension, e.g. `.../temp/<jobid>/source`
 * @returns {string} - The full path to the file yt-dlp actually produced
 * @throws {Error} - When no file matching `${outputPathBase}.*` is found
 */
export function resolveDownloadedFile(outputPathBase) {
    const dir = path.dirname(outputPathBase);
    const base = path.basename(outputPathBase);

    let entries = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        entries = [];
    }

    // Match the base name followed by a literal dot and an extension so that a
    // different base sharing this prefix (e.g. `source_2.mp4`) is not matched.
    const match = entries.find((entry) => entry.startsWith(base + '.'));

    if (!match) {
        throw new Error(
            `Downloaded file not found: expected a file matching "${outputPathBase}.*"`
        );
    }

    return path.join(dir, match);
}

/**
 * Shared base arguments for yt-dlp invocations.
 * These are common to both metadata queries and video downloads.
 * @returns {string[]}
 */
function getYtDlpBaseArgs() {
    return [
        '--no-playlist',
        '--no-warnings',
        '--force-ipv4',
        '--no-check-certificates',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--extractor-args', 'youtube:player_client=android,web',
    ];
}

/**
 * Get video metadata using yt-dlp --dump-json
 *
 * Includes a 30-second timeout to prevent hanging on invalid/malicious URLs
 * that cause yt-dlp to stall (DNS resolution, connection timeout, etc.).
 */
export function getMetadata(url) {
    return new Promise((resolve, reject) => {
        const proc = spawn(PYTHON_CMD, [
                    '-m', 'yt_dlp',
                    '--dump-json',
                    ...getYtDlpBaseArgs(),
                    url,
        ]);

        let stdout = '';
        let stderr = '';
        let settled = false;

        // 30-second timeout to prevent hanging on suspicious/invalid URLs
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            proc.kill('SIGTERM');
            reject(new Error(`yt-dlp metadata timed out after 30s for URL: ${url}`));
        }, 30000);

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (code !== 0) {
                return reject(new Error(`yt-dlp metadata failed: ${stderr}`));
            }
            try {
                const info = JSON.parse(stdout);
                resolve({
                    videoId: info.id,
                    title: info.title || 'Untitled',
                    duration: info.duration || 0,
                    thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
                    uploader: info.uploader || '',
                    description: (info.description || '').substring(0, 200),
                });
            } catch (e) {
                reject(new Error(`Failed to parse yt-dlp output: ${e.message}`));
            }
        });

        proc.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
        });
    });
}

/**
 * Download video using yt-dlp
 * @param {string} url - YouTube video URL
 * @param {string} outputPath - Output file path (without extension)
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<string>} - Path to downloaded file
 */
export function downloadVideo(url, outputPath, quality, onProgress) {
    return new Promise((resolve, reject) => {
        const jobDir = path.dirname(outputPath);
        writeJobLog(jobDir, `Starting yt-dlp download for URL: ${url} (quality: ${quality || 'best'})`);

        let formatStr = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

        if (quality === '2160p') {
            formatStr = 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]/best';
        } else if (quality === '1080p') {
            formatStr = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
        } else if (quality === '720p') {
            formatStr = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';
        } else if (quality === '480p') {
            formatStr = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best';
        } else if (quality === '360p') {
            formatStr = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best';
        }

        const outputTemplate = `${outputPath}.%(ext)s`;
        const proc = spawn(PYTHON_CMD, [
            '-m', 'yt_dlp',
            '-f', formatStr,
            '--merge-output-format', 'mp4',
            '--newline',
            '--progress',
            ...getYtDlpBaseArgs(),
            '--retries', '10',
            '--fragment-retries', '10',
            '--extractor-retries', '5',
            '--sleep-requests', '2',
            '--sleep-interval', '5',
            '--max-sleep-interval', '60',
            '-o', outputTemplate,
            url,
        ]);

        let stderr = '';
        let lastProgress = 0;
        let lastProgressLog = -1;

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                const match = line.match(/(\d+\.?\d*)%/);
                if (match) {
                    const pct = parseFloat(match[1]);
                    if (pct > lastProgress) {
                        lastProgress = pct;

                        // Try to extract speed, ETA, and size in standard yt-dlp format
                        const sizeMatch = line.match(/of\s+(\S+)/);
                        const speedMatch = line.match(/at\s+(\S+)/);
                        const etaMatch = line.match(/ETA\s+(\S+)/);

                        const info = {
                            percent: pct,
                            size: sizeMatch ? sizeMatch[1] : 'unknown',
                            speed: speedMatch ? speedMatch[1] : 'unknown',
                            eta: etaMatch ? etaMatch[1] : 'unknown'
                        };

                        onProgress?.(Math.min(pct, 100), info);
                        
                        const roundedPct = Math.round(pct);
                        if (roundedPct % 10 === 0 && roundedPct !== lastProgressLog) {
                            lastProgressLog = roundedPct;
                            writeJobLog(jobDir, `yt-dlp download: ${lastProgressLog}%`);
                        }
                    }
                }
            }
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                writeJobLog(jobDir, `yt-dlp download failed with exit code ${code}. Error: ${stderr}`);
                return reject(new Error(`yt-dlp download failed: ${stderr}`));
            }
            // Resolve the actual output file rather than assuming a .mp4 extension.
            try {
                const finalPath = resolveDownloadedFile(outputPath);
                writeJobLog(jobDir, `yt-dlp download completed. Target: ${finalPath}`);
                resolve(finalPath);
            } catch (err) {
                reject(err);
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
        });
    });
}

/**
 * Extract a YouTube video ID from any standard YouTube URL format.
 *
 * Supports watch, short, embed, and youtu.be URL patterns.
 * Returns `null` if no video ID can be identified.
 *
 * @param {string} url - YouTube URL string.
 * @returns {string|null} The 11-character video ID, or null.
 */
export function extractVideoIdFromUrl(url) {
    const patterns = [
        /[?&]v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /\/shorts\/([a-zA-Z0-9_-]{11})/,
        /\/embed\/([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Download a video with a persistent disk cache.
 *
 * Before downloading, checks if a cached copy already exists under
 * `cacheDir/<videoId>.mp4`. If it does, returns the cached path immediately
 * without hitting the network. Otherwise downloads at max-1080p quality,
 * moves the result into the cache, and returns the cached path.
 *
 * Falls back to a no-cache download if the video ID cannot be extracted from
 * the URL (e.g. private/unlisted videos without a standard ID in the URL).
 *
 * @param {string} url        - YouTube video URL.
 * @param {string} cacheDir   - Directory to store cached video files.
 * @param {Function} [onProgress] - Optional progress callback `(pct) => void`.
 * @param {string} [quality='1080p'] - Video resolution: '2160p', '1080p', '720p', '480p', or '360p'.
 * @returns {Promise<string>} - Resolved path to the (possibly cached) video file.
 */
export async function downloadWithCache(url, cacheDir, onProgress, quality = '1080p') {
    const videoId = extractVideoIdFromUrl(url);

    if (videoId) {
        const cachedPath = path.join(cacheDir, `${videoId}.mp4`);
        if (fs.existsSync(cachedPath)) {
            onProgress?.(100, { percent: 100, isCacheHit: true });
            return cachedPath;
        }

        // Download to a temp base path inside the cache dir, then resolve the
        // actual extension yt-dlp wrote before renaming to the canonical .mp4 name.
        fs.mkdirSync(cacheDir, { recursive: true });
        const tempBase = path.join(cacheDir, `${videoId}_dl`);
        await downloadVideo(url, tempBase, quality, onProgress);
        const downloadedPath = resolveDownloadedFile(tempBase);

        // Rename to the canonical cache filename so future calls hit the cache.
        if (downloadedPath !== cachedPath) {
            fs.renameSync(downloadedPath, cachedPath);
        }
        return cachedPath;
    }

    // No video ID extractable — fall back to uncached download into cacheDir.
    fs.mkdirSync(cacheDir, { recursive: true });
    const tempBase = path.join(cacheDir, `nocache_${Date.now()}`);
    await downloadVideo(url, tempBase, quality, onProgress);
    return resolveDownloadedFile(tempBase);
}
