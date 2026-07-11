import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { LINKS_FILE, CHANNELS, getLinksFile } from './services/platform.js';
import { metadataLimiter, processLimiter } from './middleware/rateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // Prevent oversized payload attacks

const VALID_STATUSES = ['pending', 'processing', 'done'];

// ============ PARSER HELPERS ============

function parseLinksContent(content) {
    if (!content) return [];
    const lines = content.split('\n');
    const links = [];
    
    let currentItem = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const statusMatch = line.match(/^\[(.*?)\]\s*(.*)$/);
        if (statusMatch) {
            if (currentItem) {
                links.push(currentItem);
            }
            const statusStr = statusMatch[1].trim().toLowerCase();
            const status = (statusStr === 'x' || statusStr === 'done') ? 'done' : 
                           (statusStr === 'processing') ? 'processing' : 'pending';
            const title = statusMatch[2].trim();
            currentItem = {
                title,
                status,
                url: ''
            };
        } else if (line.startsWith('http') || line.includes('youtube.com') || line.includes('youtu.be')) {
            if (currentItem) {
                currentItem.url = line.trim();
                const videoIdMatch = currentItem.url.match(/(?:v=|\/shorts\/|\/embed\/|\.be\/)([a-zA-Z0-9_-]{11})/);
                currentItem.id = videoIdMatch ? videoIdMatch[1] : currentItem.url;
                links.push(currentItem);
                currentItem = null;
            }
        }
    }
    
    if (currentItem) {
        links.push(currentItem);
    }
    
    return links;
}

function parseLinksFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    return parseLinksContent(fs.readFileSync(filePath, 'utf8'));
}

function writeLinksFile(filePath, links) {
    const lines = [];
    for (const link of links) {
        const statusBox = link.status === 'done' ? '[Done]' : 
                          link.status === 'processing' ? '[Processing]' : '[ ]';
        lines.push(`${statusBox} ${link.title}`);
        lines.push(`    ${link.url}`);
        lines.push(``);
    }
    // Atomic write: write to temp file first, then rename (prevents race condition)
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, lines.join('\n'), 'utf8');
    fs.renameSync(tmpPath, filePath);
}

// ============ API ENDPOINTS ============

// Get available channels
app.get('/api/channels', (req, res) => {
    const channels = Object.entries(CHANNELS).map(([key, val]) => ({
        key,
        label: val.label,
        file: val.file,
    }));
    res.json({ success: true, channels });
});

app.get('/api/links', processLimiter, (req, res) => {
    try {
        const channel = req.query.channel || 'default';
        const linksFile = getLinksFile(channel);
        if (!fs.existsSync(linksFile)) {
            fs.mkdirSync(path.dirname(linksFile), { recursive: true });
            fs.writeFileSync(linksFile, '', 'utf8');
        }
        const links = parseLinksFile(linksFile);
        res.json({ success: true, links, channel });
    } catch (err) {
        console.error('Failed to get links:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/links/status', processLimiter, (req, res) => {
    const { url, status, channel } = req.body;
    if (!url || !status) {
        return res.status(400).json({ error: 'Missing url or status.' });
    }
    if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    try {
        const linksFile = getLinksFile(channel);
        const links = parseLinksFile(linksFile);
        const link = links.find(l => l.url === url);
        if (link) {
            link.status = status;
            writeLinksFile(linksFile, links);
            res.json({ success: true, message: 'Status updated.' });
        } else {
            res.status(404).json({ error: 'Link not found.' });
        }
    } catch (err) {
        console.error('Failed to update status:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/links/add-bulk', processLimiter, (req, res) => {
    const { text, channel } = req.body;
    if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Text content is empty.' });
    }
    try {
        const linksFile = getLinksFile(channel);
        const currentLinks = parseLinksFile(linksFile);
        const parsedLinks = parseLinksContent(text);
        
        if (parsedLinks.length === 0) {
            return res.status(400).json({ error: 'No valid links found in the text. Make sure to follow the format.' });
        }
        
        let addedCount = 0;
        let skippedCount = 0;
        
        for (const newLink of parsedLinks) {
            if (currentLinks.some(l => l.url === newLink.url)) {
                skippedCount++;
            } else {
                currentLinks.push(newLink);
                addedCount++;
            }
        }
        
        if (addedCount > 0) {
            writeLinksFile(linksFile, currentLinks);
        }
        
        res.json({
            success: true,
            addedCount,
            skippedCount,
            message: `Import complete. Added ${addedCount} new links, skipped ${skippedCount} duplicates.`
        });
    } catch (err) {
        console.error('Failed to add bulk links:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/links', processLimiter, (req, res) => {
    const { url, channel } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'Missing url.' });
    }
    try {
        const linksFile = getLinksFile(channel);
        let links = parseLinksFile(linksFile);
        const originalLength = links.length;
        links = links.filter(l => l.url !== url);
        if (links.length < originalLength) {
            writeLinksFile(linksFile, links);
            res.json({ success: true, message: 'Link deleted.' });
        } else {
            res.status(404).json({ error: 'Link not found.' });
        }
    } catch (err) {
        console.error('Failed to delete link:', err.message);
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/generate-cli', processLimiter, (req, res) => {
    const { url, urls, segments, exportDir, shortsFormat, copyrightBypass, mergeClips, cpuFriendly, autoCaptions, quality4k, kineticTypo, manualMode, channel } = req.body;

    const activeUrls = urls && Array.isArray(urls) ? urls.map(u => u.trim()).filter(Boolean) : [url].filter(Boolean);

    if (activeUrls.length === 0 || !segments || !Array.isArray(segments)) {
        return res.status(400).json({ error: 'Missing url/urls or segments array.' });
    }

    const jobId = uuidv4();
    const jsonFilename = `segments-${jobId}.json`;
    const jsonPath = path.join(TEMP_DIR, jsonFilename);

    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        // Write the segments to the temp folder
        fs.writeFileSync(jsonPath, JSON.stringify(segments, null, 2), 'utf8');

        // Resolve absolute path for Windows
        const absoluteJsonPath = path.resolve(jsonPath);
        const resolvedExportDir = exportDir || 'D:\\YT Shorts';
        const resolvedShortsFormat = shortsFormat || 'vertical_blurred';
        const resolvedBypass = typeof copyrightBypass !== 'undefined' ? copyrightBypass : true;
        const resolvedMerge = mergeClips ? 'true' : 'false';

        // Generate the node command:
        // If there's only 1 URL, use single URL format for backward compatibility,
        // otherwise use Batch Mode format (omit url argument).
        let command = '';
        const cpuFriendlyFlag = cpuFriendly ? ' --cpu-friendly' : '';
        const autoCaptionsFlag = autoCaptions ? ' --auto-captions' : '';
        const quality4kFlag = quality4k ? ' --4k' : '';
        const kineticFlag = kineticTypo ? ' --kinetic' : '';
        const manualModeFlag = manualMode ? ' --no-link-db' : '';
        const channelFlag = channel && channel !== 'default' ? ` --channel ${channel}` : '';
        if (activeUrls.length === 1) {
            command = `node cli.js "${activeUrls[0]}" "${absoluteJsonPath}" "${resolvedExportDir}" "${resolvedShortsFormat}" "${resolvedBypass}" "${resolvedMerge}"${cpuFriendlyFlag}${autoCaptionsFlag}${quality4kFlag}${kineticFlag}${manualModeFlag}${channelFlag}`;
        } else {
            command = `node cli.js "${absoluteJsonPath}" "${resolvedExportDir}" "${resolvedShortsFormat}" "${resolvedBypass}" "${resolvedMerge}"${cpuFriendlyFlag}${autoCaptionsFlag}${quality4kFlag}${kineticFlag}${manualModeFlag}${channelFlag}`;
        }

        res.json({
            success: true,
            jobId,
            command,
            jsonPath: absoluteJsonPath
        });
    } catch (err) {
        console.error('Failed to generate CLI JSON/command:', err.message);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

app.post('/api/clean-cache', (req, res) => {
    try {
        if (!fs.existsSync(TEMP_DIR)) {
            return res.json({ success: true, message: 'Cache directory is already empty.' });
        }
        
        let cleanedFilesCount = 0;
        let cleanedBytes = 0;
        
        const cleanDirRecursive = (dirPath) => {
            const entries = fs.readdirSync(dirPath);
            const now = Date.now();
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    cleanDirRecursive(fullPath);
                    // If directory is empty after cleaning, delete it
                    if (fs.readdirSync(fullPath).length === 0) {
                        fs.rmdirSync(fullPath);
                    }
                } else {
                    // Skip files modified in the last 10 minutes (prevents active job deletion)
                    if (now - stat.mtimeMs > 10 * 60 * 1000) {
                        cleanedBytes += stat.size;
                        fs.unlinkSync(fullPath);
                        cleanedFilesCount++;
                    }
                }
            }
        };
        
        cleanDirRecursive(TEMP_DIR);
        
        const formatMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
        
        res.json({
            success: true,
            message: `Cleared ${cleanedFilesCount} cache files (${formatMB(cleanedBytes)} MB freed!) 🧹`
        });
    } catch (err) {
        console.error('Failed to clear cache:', err.message);
        res.status(500).json({ error: `Failed to clear cache: ${err.message}` });
    }
});

// ============ TEMP FILE CLEANUP ============
// Delete job JSON files older than 30 minutes
setInterval(() => {
    try {
        const entries = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        for (const entry of entries) {
            const filePath = path.join(TEMP_DIR, entry);
            const stat = fs.statSync(filePath);
            if (stat.isFile() && now - stat.mtimeMs > 30 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log(`Cleaned up temporary config file: ${entry}`);
            }
        }
    } catch { }
}, 5 * 60 * 1000); // Every 5 minutes

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 ClipForge server running at http://localhost:${PORT}`);
});
