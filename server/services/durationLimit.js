// Pure, side-effect-free helpers for the duration-limit rejection message.
//
// The pipeline rejects source videos longer than MAX_DURATION. Historically the
// rejection message hardcoded "60 minutes" while MAX_DURATION was 21600s (6h),
// so the stated maximum diverged from the enforced maximum (ERROR_LOG.md #5).
// These helpers derive the stated maximum directly from the constant so the two
// can never drift apart.

/**
 * Format a maximum-duration value (in seconds) as a human-readable string
 * derived entirely from the given constant.
 *
 * The stated maximum is always `round(maxDurationSeconds / 60)` minutes, so the
 * text is a deterministic function of the constant. This guarantees the message
 * reflects whatever MAX_DURATION is configured to, rather than a divergent
 * hardcoded literal.
 *
 * @param {number} maxDurationSeconds - The MAX_DURATION constant, in seconds.
 * @returns {string} e.g. "360 minutes" for a 21600s (6h) limit.
 */
export function formatMaxDuration(maxDurationSeconds) {
  const minutes = Math.round(maxDurationSeconds / 60)
  return `${minutes} minutes`
}

/**
 * Build the full duration-limit rejection message.
 *
 * Reports the actual video duration (rounded to whole minutes) and the maximum
 * allowed duration, where the stated maximum is derived from `maxDurationSeconds`
 * via {@link formatMaxDuration}. Pure and deterministic: same inputs -> same
 * output, no filesystem or process access.
 *
 * @param {number} actualDurationSeconds - The source video's duration, in seconds.
 * @param {number} maxDurationSeconds - The MAX_DURATION constant, in seconds.
 * @returns {string} The rejection message stating the actual and maximum durations.
 */
export function buildDurationLimitMessage(actualDurationSeconds, maxDurationSeconds) {
  const actualMinutes = Math.round(actualDurationSeconds / 60)
  return `Video is too long (${actualMinutes} min). ` +
    `Maximum allowed duration is ${formatMaxDuration(maxDurationSeconds)}.`
}
