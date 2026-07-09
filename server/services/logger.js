import fs from 'node:fs';
import path from 'node:path';

/**
 * Append a log message to the job's processing.log file.
 * Falls back to console.log gracefully if fs is mocked in test environments.
 * 
 * @param {string} jobDir - Absolute path of the job directory
 * @param {string} message - Log message content
 */
export function writeJobLog(jobDir, message) {
    if (!jobDir) return;
    try {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;

        if (typeof fs.existsSync === 'function' && typeof fs.appendFileSync === 'function') {
            if (!fs.existsSync(jobDir)) {
                if (typeof fs.mkdirSync === 'function') {
                    fs.mkdirSync(jobDir, { recursive: true });
                }
            }
            const logPath = path.join(jobDir, 'processing.log');
            fs.appendFileSync(logPath, logLine, 'utf8');
        } else {
            // Fallback for mocked/stubbed test environments
            console.log(`[JobLog Fallback] ${logLine.trim()}`);
        }
    } catch (e) {
        console.error('Failed to write job log:', e.message);
    }
}
