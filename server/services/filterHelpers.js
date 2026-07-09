// Pure, side-effect-free helpers for building and escaping FFmpeg filtergraphs.
// Each function here is unit- and property-testable: same input -> same output,
// with no filesystem or process access.

/**
 * Minimal, correct escaping for a value placed inside a drawtext filter's
 * quoted `text='<value>'` option.
 *
 * Inside a single-quoted drawtext value, only backslash, single-quote, and
 * percent are special to FFmpeg's parser; newlines break the single-line
 * filter value and must be collapsed. Characters such as `:`, `,`, `{`, `}`,
 * `(`, `)` are already literal inside the quoted value and MUST NOT be escaped
 * (over-escaping them is the recurring ERROR_LOG.md #4 regression).
 *
 * Order matters: newlines are collapsed first, then backslash is doubled
 * before the other escapes so the inserted backslashes are not re-escaped.
 *
 * @param {string} text - Raw title text (may be empty, unicode, emoji, or contain any punctuation).
 * @returns {string} The escaped value, safe to embed inside `text='<value>'`.
 */
export function escapeDrawtextText(text) {
  return text
    .replace(/\r\n?|\n/g, ' ') // newlines break single-line filter values -> collapse to space
    .replace(/\\/g, '\\\\') // backslash first
    .replace(/'/g, "\\'") // single quote
    .replace(/:/g, '\\:') // colon (to prevent option splitting)
    .replace(/%/g, '\\%') // percent (FFmpeg expansion char)
}

/**
 * Normalize a filesystem font path for use as an FFmpeg `fontfile=` option value.
 *
 * FFmpeg filtergraph parsing treats backslashes and colons specially, so a
 * Windows path like `C:\Windows\Fonts\segoeui.ttf` must be rewritten to use
 * forward slashes and have its drive-letter colon escaped:
 * `C\:/Windows/Fonts/segoeui.ttf`.
 *
 * Only the drive-letter colon at the start of the path is escaped; any other
 * colons (rare on POSIX paths) are left untouched.
 *
 * @param {string} fontPath - Raw font file path (Windows or POSIX style).
 * @returns {string} The normalized path, safe to embed in `fontfile=<value>`.
 */
export function normalizeFontPath(fontPath) {
  return fontPath
    .replace(/\\/g, '/') // backslashes -> forward slashes
    .replace(/^([A-Za-z]):/, '$1\\\\:') // escape the drive-letter colon with double backslashes
}

/**
 * Build a complete FFmpeg `drawtext` filter string for overlaying a title.
 *
 * Pure and side-effect-free: it composes the escaped text and normalized font
 * path (via {@link escapeDrawtextText} and {@link normalizeFontPath}) with the
 * caller-provided styling into a single filter value. Defaults match the
 * pipeline's standard caption styling.
 *
 * @param {Object} opts
 * @param {string} opts.textFilePath - Normalized path to raw title text file.
 * @param {string} opts.fontPath - Raw font file path (Windows or POSIX style).
 * @param {number} [opts.fontSize=18] - Font size in points.
 * @param {string} [opts.fontColor='white@0.9'] - FFmpeg font color spec.
 * @returns {string} The full `drawtext=...` filter string.
 */
export function buildDrawtextFilter({ textFilePath, fontPath, fontSize = 18, fontColor = 'white@0.9', shortsFormat = 'original' }) {
  const safeFont = normalizeFontPath(fontPath)
  const safeTextPath = normalizeFontPath(textFilePath)
  const yCoord = shortsFormat === 'original' ? 'h-th-36' : '1280'
  return `drawtext=textfile=${safeTextPath}:fontfile=${safeFont}:fontsize=${fontSize}:` +
         `fontcolor=${fontColor}:box=1:boxcolor=black@0.4:x=(w-text_w)/2:y=${yCoord}`
}


/**
 * Build the filtergraph contents for a filter script file.
 *
 * It combines video layout transformations, copyright bypass adjustments,
 * and the optional drawtext watermark.
 *
 * @param {Object} opts
 * @param {string} [opts.watermarkTextFilePath] - Normalized path to raw title text file.
 * @param {string} [opts.fontPath] - Normalized font path.
 * @param {string} [opts.shortsFormat] - 'original', 'vertical_blurred', or 'vertical_crop'.
 * @param {boolean} [opts.copyrightBypass] - Whether to apply copyright bypass.
 * @returns {{ filterContent: string, hasVideoFilter: boolean, hasAudioFilter: boolean }}
 */
export function buildFilterScriptContent({ watermarkTextFilePath, fontPath, shortsFormat = 'original', copyrightBypass = false, watermarkFontSize = 18, autoCaptionsSrtPath = null }) {
  const videoChains = [];
  const audioChains = [];

  let currentVideoOut = '[0:v]';

  // 1. Copyright Bypass (Video part: hflip, setpts, eq)
  if (copyrightBypass) {
    videoChains.push(`${currentVideoOut}hflip,setpts=0.97*PTS,eq=contrast=1.03:saturation=1.05[v_proc]`);
    currentVideoOut = '[v_proc]';
    
    // Audio part: atempo
    audioChains.push(`[0:a]atempo=1.03[a]`);
  }

  // 2. Shorts Formatting (vertical_blurred or vertical_crop)
  if (shortsFormat === 'vertical_blurred') {
    // format=yuv420p prevents green-tint artifacts from pixel-format mismatch
    // between the blurred background and foreground overlay chains (GPU encoders).
    videoChains.push(`${currentVideoOut}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10,format=yuv420p[bg]`);
    videoChains.push(`${currentVideoOut}scale=1080:-1,format=yuv420p[fg]`);
    videoChains.push(`[bg][fg]overlay=0:(main_h-overlay_h)/2:format=yuv420[v_vertical]`);
    currentVideoOut = '[v_vertical]';
  } else if (shortsFormat === 'vertical_crop') {
    videoChains.push(`${currentVideoOut}crop=in_h*9/16:in_h,scale=1080:1920,format=yuv420p[v_vertical]`);
    currentVideoOut = '[v_vertical]';
  }

  // 3. Watermark
  if (watermarkTextFilePath && fontPath) {
    const drawtext = buildDrawtextFilter({ textFilePath: watermarkTextFilePath, fontPath, fontSize: watermarkFontSize, shortsFormat });
    videoChains.push(`${currentVideoOut}${drawtext}[v]`);
    currentVideoOut = '[v]';
  } else if (currentVideoOut !== '[0:v]') {
    // If we have video filters but no watermark, passthrough to [v]
    videoChains.push(`${currentVideoOut}null[v]`);
    currentVideoOut = '[v]';
  }

  const hasVideoFilter = videoChains.length > 0;
  const hasAudioFilter = audioChains.length > 0;

  const parts = [];
  if (hasVideoFilter) parts.push(videoChains.join(';'));
  if (hasAudioFilter) parts.push(audioChains.join(';'));

  return {
    filterContent: parts.join(';'),
    hasVideoFilter,
    hasAudioFilter,
  };
}

/**
 * Build the FFmpeg argument list for cutting (and optionally filtering) a clip.
 *
 * Pure and side-effect-free: given the input/output paths, cut boundaries, and
 * an optional filter script path, it returns the ordered argument array without
 * touching the filesystem or spawning a process. Start/end are coerced via
 * `String()` so numeric or string inputs both produce valid CLI tokens.
 *
 * When `filterScriptPath` is provided, `-filter_complex_script <path>` is
 * inserted after the input; the fixed re-encode flags are always appended
 * before the output path.
 *
 * Each supported `videoEncoder` maps to its own codec flags so all produced
 * segments are concat-compatible regardless of which encoder was used:
 *   - `libx264`   → `-preset ultrafast -crf 23`  (CPU, default fallback)
 *   - `h264_nvenc`→ `-preset p4 -cq 23`          (Nvidia GPU)
 *   - `h264_amf`  → `-quality speed -qp_i 23 -qp_p 23 -qp_b 23` (AMD GPU)
 *   - `h264_qsv`  → `-preset veryfast -global_quality 23` (Intel GPU)
 *
 * @param {Object} opts
 * @param {string} opts.inputPath - Path to the source media file.
 * @param {string|number} opts.start - Cut start time (seconds or ffmpeg timestamp).
 * @param {string|number} opts.end - Cut end time (seconds or ffmpeg timestamp).
 * @param {string} opts.outputPath - Path for the produced clip.
 * @param {string} [opts.filterScriptPath] - Optional filter_complex script path.
 * @param {boolean} [opts.hasVideoFilter] - True if script has video filters.
 * @param {boolean} [opts.hasAudioFilter] - True if script has audio filters.
 * @param {'libx264'|'h264_nvenc'|'h264_amf'|'h264_qsv'} [opts.videoEncoder='libx264'] - H.264 encoder to use.
 * @returns {string[]} The ordered FFmpeg argument list.
 */
export function buildCutArgs({ inputPath, start, end, outputPath, filterScriptPath, hasVideoFilter, hasAudioFilter, videoEncoder = 'libx264', cpuFriendly = false, shortsFormat = 'original' }) {
  const args = ['-y', '-ss', String(start), '-to', String(end), '-i', inputPath];
  if (cpuFriendly && videoEncoder === 'libx264') {
    args.push('-threads', '1', '-filter_threads', '1')
  }
  if (filterScriptPath) {
    args.push('-filter_complex_script', filterScriptPath)
    if (hasVideoFilter) {
      args.push('-map', '[v]')
    } else {
      args.push('-map', '0:v')
    }
    if (hasAudioFilter) {
      args.push('-map', '[a]')
    } else {
      args.push('-map', '0:a')
    }
  }

  const targetQuality = shortsFormat === 'vertical_crop' ? '20' : '23';

  // Per-encoder video codec flags — all produce concat-compatible H.264 output.
  let videoCodecArgs;
  if (videoEncoder === 'h264_nvenc') {
    videoCodecArgs = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', targetQuality];
  } else if (videoEncoder === 'h264_amf') {
    videoCodecArgs = ['-c:v', 'h264_amf', '-quality', 'speed', '-qp_i', targetQuality, '-qp_p', targetQuality, '-qp_b', targetQuality];
  } else if (videoEncoder === 'h264_qsv') {
    videoCodecArgs = ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', targetQuality, '-pix_fmt', 'nv12', '-r', '30'];
  } else {
    // libx264 fallback (default)
    videoCodecArgs = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', targetQuality];
  }

  args.push(
    ...videoCodecArgs,
    '-c:a', 'aac', '-ac', '2', '-ar', '44100', '-b:a', '96k',
    '-avoid_negative_ts', 'make_zero',
    outputPath
  )
  return args
}

/**
 * Validate a single segment against the source video duration.
 *
 * Pure and side-effect-free. A segment `{ start, end }` (both in seconds) is
 * valid if and only if all of the following hold:
 *   - `start` is a finite number
 *   - `end` is a finite number
 *   - `start >= 0`
 *   - `end > start`
 *   - `end <= videoDuration`
 *
 * Conditions are checked in order; on the first failure the function returns
 * `{ ok: false, reason }` where `reason` names the specific failed condition.
 * When all conditions hold it returns `{ ok: true }`.
 *
 * @param {{ start: number, end: number }} seg - Segment time range in seconds.
 * @param {number} videoDuration - Source video duration in seconds.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateSegment(seg, videoDuration) {
  const { start, end } = seg ?? {}

  if (!Number.isFinite(start)) {
    return { ok: false, reason: 'start must be a finite number' }
  }
  if (!Number.isFinite(end)) {
    return { ok: false, reason: 'end must be a finite number' }
  }
  if (start < 0) {
    return { ok: false, reason: 'start must be >= 0' }
  }
  if (end <= start) {
    return { ok: false, reason: 'end must be greater than start' }
  }
  if (end > videoDuration) {
    return { ok: false, reason: `end must be <= video duration (${videoDuration}s)` }
  }

  return { ok: true }
}
