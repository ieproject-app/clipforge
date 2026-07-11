import fs from 'node:fs';

/**
 * Convert subtitle array to SRT file format.
 *
 * Before writing, overlapping entries are sanitised: each entry's `end` is
 * clamped so it does not exceed the `start` of the next entry (with a 50ms
 * guard gap). This prevents libass/FFmpeg from rendering two subtitle lines
 * simultaneously, which looks messy on screen.
 *
 * @param {Array<{start: number, end: number, text: string}>} subtitles
 * @param {string} srtPath - Output SRT file path
 * @param {'standard'|'kinetic'} [mode='standard'] - Subtitle rendering mode.
 *   'standard' writes each block as a single SRT entry.
 *   'kinetic' splits text into words, each on its own entry with alternating
 *   yellow/white colors, centered position, and per-word proportional timing.
 */
export function subtitlesToSrt(subtitles, srtPath, mode = 'standard') {
  // Sanitise overlaps: clamp each entry's end so it doesn't cross into the
  // next entry's start. Minimum guard gap between entries = 50ms.
  const MIN_GAP = 0.05;
  for (let i = 0; i < subtitles.length - 1; i++) {
    const maxEnd = subtitles[i + 1].start - MIN_GAP;
    if (subtitles[i].end > maxEnd) {
      subtitles[i].end = Math.max(subtitles[i].start + 0.1, maxEnd);
    }
  }

  const lines = [];
  let entryIndex = 0;

  subtitles.forEach((sub) => {
    const fmt = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.round((s % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };

    if (mode === 'kinetic') {
      const words = sub.text.trim().split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0) return;

      const totalChars = words.reduce((sum, w) => sum + w.length, 0);
      if (totalChars === 0) return;

      const totalDuration = sub.end - sub.start;
      const WORD_GAP = 0.05; // 50ms between words
      const availableTime = totalDuration - (words.length - 1) * WORD_GAP;

      const colors = ['&H00FFFF&', '&HFFFFFF&']; // yellow, white
      let currentStart = sub.start;

      words.forEach((word, i) => {
        const wordDuration = (word.length / totalChars) * availableTime;
        const currentEnd = currentStart + wordDuration;
        const color = colors[i % 2];

        entryIndex++;
        lines.push(`${entryIndex}`);
        lines.push(`${fmt(currentStart)} --> ${fmt(currentEnd)}`);
        lines.push(`{\\fs14}{\\pos(540,960)}{\\c${color}}${word}`);
        lines.push('');

        currentStart = currentEnd + WORD_GAP;
      });
    } else {
      entryIndex++;
      lines.push(`${entryIndex}`);
      lines.push(`${fmt(sub.start)} --> ${fmt(sub.end)}`);
      lines.push(sub.text);
      lines.push('');
    }
  });
  fs.writeFileSync(srtPath, lines.join('\n'), 'utf8');
}
