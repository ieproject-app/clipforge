import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { FFMPEG_PATH, getFontPath, VIDEO_ENCODER } from './platform.js';
import { buildDrawtextFilter, buildCutArgs, buildFilterScriptContent } from './filterHelpers.js';
import { writeJobLog } from './logger.js';

/**
 * Spawn FFmpeg with the given argument array (no shell) and resolve when it
 * exits successfully.
 *
 * Collects stderr for diagnostics, rejects on a non-zero exit code or a spawn
 * error, and resolves on exit code 0.
 *
 * @param {string[]} args - Ordered FFmpeg CLI arguments.
 * @returns {Promise<void>}
 */
function runFFmpeg(args, options = {}) {
    console.error(`[FFmpeg Running Command]:\nffmpeg ${args.map(a => a.includes(' ') || a.includes('"') ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ')}`);
    return new Promise((resolve, reject) => {
        const proc = spawn(FFMPEG_PATH, args);

        let stderr = '';
        let progressLineBuffer = '';

        proc.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;

            if (options.onProgress) {
                // Append new chunk to buffer, then process complete lines.
                // This handles stderr chunks that split the "time=" line in half.
                progressLineBuffer += str;
                const lines = progressLineBuffer.split('\n');
                // Keep the last (potentially incomplete) line in the buffer
                progressLineBuffer = lines.pop() || '';

                for (const line of lines) {
                    // Match HH:MM:SS.ms — hours can be 1+ digits (GPU encoders may output single-digit hours)
                    const timeMatch = line.match(/time=\s*(-?\d{1,}):(\d{2}):(\d{2})\.(\d{2})/);
                    if (timeMatch) {
                        const hours = parseInt(timeMatch[1], 10);
                        const minutes = parseInt(timeMatch[2], 10);
                        const seconds = parseInt(timeMatch[3], 10);
                        const centiseconds = parseInt(timeMatch[4], 10);
                        const totalSecs = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
                        options.onProgress(totalSecs);
                    }
                }
            }
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
            }
            resolve();
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
        });
    });
}

/**
 * Delete a file, ignoring the error if it is already absent.
 *
 * @param {string} filePath
 */
function deleteFileQuiet(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch {
        // already absent or not removable — ignore
    }
}

/**
 * Cut a segment from a video file using FFmpeg.
 *
 * When `watermarkText` is provided and a font is available, the drawtext
 * filtergraph is written to a filter script file (`<outputPath>.filter.txt`)
 * and passed to FFmpeg via `-filter_complex_script`, sidestepping both the
 * filtergraph parser's two-level quoting and the OS/`spawn` command-line
 * quoting layer. On any watermark render failure the cut is retried without the
 * watermark so the job still succeeds. Every cut re-encodes with fixed codecs
 * so the resulting segments are concat-compatible.
 *
 * @param {string} inputPath - Input video file path.
 * @param {number} start - Start time in seconds.
 * @param {number} end - End time in seconds.
 * @param {string} outputPath - Output segment file path.
 * @param {string} [watermarkText] - Optional watermark text to overlay.
 * @param {string} [shortsFormat] - Optional Shorts output format ('original', 'vertical_blurred', 'vertical_crop').
 * @param {boolean} [copyrightBypass] - Optional flag to apply hflip/speed adjustments.
 * @returns {Promise<{ watermarked: boolean }>}
 */
export async function cutSegment(inputPath, start, end, outputPath, watermarkText, shortsFormat = 'original', copyrightBypass = false, watermarkFontSize = 18, autoCaptions = false, cpuFriendly = false, onProgress = null) {
    const jobDir = path.dirname(outputPath);
    writeJobLog(jobDir, `--- Cutting Segment: ${path.basename(outputPath)} [${start}s to ${end}s] ---`);

    const fontPath = watermarkText ? getFontPath() : null;
    const canWatermark = Boolean(watermarkText && fontPath);
    
    let srtPath = null;
    let tempPlainPath = null;

    // 3. Auto-Captions (Burn-in subtitles - DISABLED)
    // Disabled per user request.
    
    // Check if we need a filter script (watermark, vertical layout, bypass, or captions)
    const needsFilterScript = canWatermark || shortsFormat !== 'original' || copyrightBypass || srtPath;
    const textFilePath = outputPath + '.watermark.txt';
    const scriptPath = outputPath + '.filter.txt';

    if (needsFilterScript) {
        writeJobLog(jobDir, `[FFmpeg] Building filter complex script (watermark: ${canWatermark}, format: ${shortsFormat}, bypass: ${copyrightBypass}, captions: ${Boolean(srtPath)})`);
        if (canWatermark) {
            fs.writeFileSync(textFilePath, watermarkText, 'utf8');
        }

        const { filterContent, hasVideoFilter, hasAudioFilter } = buildFilterScriptContent({
            watermarkTextFilePath: canWatermark ? textFilePath : null,
            fontPath,
            shortsFormat,
            copyrightBypass,
            watermarkFontSize,
            autoCaptionsSrtPath: srtPath,
        });

        writeJobLog(jobDir, `[FFmpeg] Script content:\n${filterContent}`);
        fs.writeFileSync(scriptPath, filterContent);
        try {
            writeJobLog(jobDir, `[FFmpeg] Rendering video with script...`);
            await runFFmpeg(
                buildCutArgs({
                    inputPath,
                    start,
                    end,
                    outputPath,
                    filterScriptPath: scriptPath.replace(/\\/g, '/'),
                    hasVideoFilter,
                    hasAudioFilter,
                    videoEncoder: VIDEO_ENCODER,
                    cpuFriendly,
                    shortsFormat,
                }),
                { onProgress }
            );
            writeJobLog(jobDir, `[FFmpeg] Rendering segment success.`);
            return { watermarked: canWatermark };
        } catch (e) {
            writeJobLog(jobDir, `[FFmpeg] ERROR: Rendering failed: ${e.message}`);
            
            // Tier 1 GPU fallback: if we used a GPU encoder and it failed, retry rendering using CPU (libx264)
            let currentErr = e;
            if (VIDEO_ENCODER !== 'libx264') {
                try {
                    writeJobLog(jobDir, `[FFmpeg] GPU fallback: Retrying rendering with CPU (libx264)...`);
                    await runFFmpeg(
                        buildCutArgs({
                            inputPath,
                            start,
                            end,
                            outputPath,
                            filterScriptPath: scriptPath.replace(/\\/g, '/'),
                            hasVideoFilter,
                            hasAudioFilter,
                            videoEncoder: 'libx264',
                            cpuFriendly,
                            shortsFormat,
                        }),
                        { onProgress }
                    );
                    writeJobLog(jobDir, `[FFmpeg] GPU fallback to CPU rendering success.`);
                    return { watermarked: canWatermark };
                } catch (cpuErr) {
                    writeJobLog(jobDir, `[FFmpeg] CPU rendering failed: ${cpuErr.message}`);
                    currentErr = cpuErr;
                }
            }
            
            // Tier 2 Watermark fallback: retry clean cut without watermark/captions
            if (canWatermark || srtPath) {
                writeJobLog(jobDir, `[FFmpeg] Fallback: Retrying clean cut without watermark/captions...`);
                console.warn(`Watermark or subtitle render failed, falling back to clean cut: ${currentErr.message}`);
                
                const fallbackNeedsScript = shortsFormat !== 'original' || copyrightBypass;
                if (fallbackNeedsScript) {
                    const fallbackFilter = buildFilterScriptContent({
                        watermarkTextFilePath: null,
                        fontPath: null,
                        shortsFormat,
                        copyrightBypass,
                    });
                    fs.writeFileSync(scriptPath, fallbackFilter.filterContent);
                    
                    // Try first with GPU (if not libx264)
                    try {
                        await runFFmpeg(
                            buildCutArgs({
                                inputPath,
                                start,
                                end,
                                outputPath,
                                filterScriptPath: scriptPath.replace(/\\/g, '/'),
                                hasVideoFilter: fallbackFilter.hasVideoFilter,
                                hasAudioFilter: fallbackFilter.hasAudioFilter,
                                videoEncoder: VIDEO_ENCODER,
                                cpuFriendly,
                                shortsFormat,
                            }),
                            { onProgress }
                        );
                        writeJobLog(jobDir, `[FFmpeg] Fallback rendering success.`);
                        return { watermarked: false };
                    } catch (fallbackGpuErr) {
                        writeJobLog(jobDir, `[FFmpeg] Fallback GPU rendering failed: ${fallbackGpuErr.message}`);
                        // If GPU failed, retry with CPU
                        if (VIDEO_ENCODER !== 'libx264') {
                            try {
                                writeJobLog(jobDir, `[FFmpeg] Fallback CPU retry: Retrying clean cut with CPU (libx264)...`);
                                await runFFmpeg(
                                    buildCutArgs({
                                        inputPath,
                                        start,
                                        end,
                                        outputPath,
                                        filterScriptPath: scriptPath.replace(/\\/g, '/'),
                                        hasVideoFilter: fallbackFilter.hasVideoFilter,
                                        hasAudioFilter: fallbackFilter.hasAudioFilter,
                                        videoEncoder: 'libx264',
                                        cpuFriendly,
                                        shortsFormat,
                                    }),
                                    { onProgress }
                                );
                                writeJobLog(jobDir, `[FFmpeg] Fallback CPU rendering success.`);
                                return { watermarked: false };
                            } catch (fallbackCpuErr) {
                                deleteFileQuiet(outputPath);
                                throw fallbackCpuErr;
                            }
                        } else {
                            deleteFileQuiet(outputPath);
                            throw fallbackGpuErr;
                        }
                    }
                }
            } else {
                deleteFileQuiet(outputPath);
                throw currentErr;
            }
        } finally {
            deleteFileQuiet(scriptPath);
            deleteFileQuiet(textFilePath);
            if (srtPath) {
                deleteFileQuiet(srtPath);
            }
        }
    }

    // Plain cut: no filters at all
    try {
        writeJobLog(jobDir, `[FFmpeg] Plain cut re-encoding (no watermark, formatting, or subtitles)...`);
        await runFFmpeg(buildCutArgs({ inputPath, start, end, outputPath, videoEncoder: VIDEO_ENCODER, cpuFriendly, shortsFormat }), { onProgress });
        writeJobLog(jobDir, `[FFmpeg] Plain segment cut success.`);
        return { watermarked: false };
    } catch (e) {
        writeJobLog(jobDir, `[FFmpeg] Plain cut with encoder ${VIDEO_ENCODER} failed: ${e.message}`);
        if (VIDEO_ENCODER !== 'libx264') {
            try {
                writeJobLog(jobDir, `[FFmpeg] Plain cut CPU retry: Retrying plain cut with CPU (libx264)...`);
                await runFFmpeg(buildCutArgs({ inputPath, start, end, outputPath, videoEncoder: 'libx264', cpuFriendly, shortsFormat }), { onProgress });
                writeJobLog(jobDir, `[FFmpeg] Plain cut CPU retry success.`);
                return { watermarked: false };
            } catch (cpuErr) {
                deleteFileQuiet(outputPath);
                throw cpuErr;
            }
        } else {
            deleteFileQuiet(outputPath);
            throw e;
        }
    }
}

/**
 * Merge multiple video segments into a single file using the FFmpeg concat
 * demuxer with stream copy (`-c copy`).
 *
 * All segments produced by `cutSegment` are re-encoded with identical codecs
 * and parameters, so a stream-copy concat is safe and avoids a second
 * re-encode. A temporary concat list file is written next to the output and is
 * always removed afterward — on both success and failure — via a `finally`
 * block.
 *
 * @param {string[]} segmentPaths - Array of segment file paths.
 * @param {string} outputPath - Output merged file path.
 * @returns {Promise<void>}
 */
export async function mergeSegments(segmentPaths, outputPath) {
    // Create the concat list file next to the output.
    const listPath = outputPath.replace('.mp4', '_list.txt');
    const listContent = segmentPaths
        .map((p) => `file '${p}'`)
        .join('\n');

    fs.writeFileSync(listPath, listContent);

    try {
        await runFFmpeg([
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', listPath,
            '-c', 'copy',
            outputPath,
        ]);
    } finally {
        // Always remove the concat list file, regardless of outcome.
        deleteFileQuiet(listPath);
    }
}
