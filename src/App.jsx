import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import { formatTime } from './utils/formatTime.js';

export default function App() {
    const [activeTab, setActiveTab] = useState('generator');
    const [videoUrl1, setVideoUrl1] = useState('');
    const [videoUrl2, setVideoUrl2] = useState('');
    const [videoUrl3, setVideoUrl3] = useState('');
    const [jsonInput, setJsonInput] = useState('');
    const [segments, setSegments] = useState([]);
    const [jsonError, setJsonError] = useState('');
    const [exportDir, setExportDir] = useState(() => localStorage.getItem('clipforge_exportDir') || 'D:\\YT Shorts');
    const [shortsFormat, setShortsFormat] = useState(() => localStorage.getItem('clipforge_shortsFormat') || 'vertical_blurred');
    const [cliCommand, setCliCommand] = useState('');
    const [processing, setProcessing] = useState(false);
    const [toast, setToast] = useState(null);
    const [durationPref, setDurationPref] = useState(() => localStorage.getItem('clipforge_durationPref') || 'dynamic');
    const [mergeClips, setMergeClips] = useState(() => localStorage.getItem('clipforge_mergeClips') === 'true');
    const [cpuFriendly, setCpuFriendly] = useState(() => localStorage.getItem('clipforge_cpuFriendly') === 'true');
    const [urlCount, setUrlCount] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Link Manager States & Functions
    const [links, setLinks] = useState([]);
    const [loadingLinks, setLoadingLinks] = useState(false);
    const [linkFilter, setLinkFilter] = useState('pending');
    const [linkSearch, setLinkSearch] = useState('');
    const [newLinkTitle, setNewLinkTitle] = useState('');
    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [selectedUrls, setSelectedUrls] = useState([]);

    const [bulkInput, setBulkInput] = useState('');
    const [autoProcessedUrls, setAutoProcessedUrls] = useState([]);

    // Toast alert helper
    const showToast = useCallback((msg, type = 'success') => {
        setToast({ msg, type });
        const timer = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(timer);
    }, []);

    const fetchLinks = useCallback(async (silent = false) => {
        if (!silent) setLoadingLinks(true);
        try {
            const res = await fetch('/api/links');
            if (res.ok) {
                const data = await res.json();
                setLinks(data.links || []);
            } else {
                showToast('Failed to load links from file.', 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            if (!silent) setLoadingLinks(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchLinks();
    }, [fetchLinks]);

    const handleToggleStatus = async (url, currentStatus) => {
        const nextStatus = currentStatus === 'done' ? 'pending' : 'done';
        try {
            const res = await fetch('/api/links/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, status: nextStatus })
            });
            if (res.ok) {
                showToast(`Status updated to ${nextStatus}! ✓`);
                fetchLinks(true);
            } else {
                const data = await res.json();
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handleImportBulk = async (e) => {
        e.preventDefault();
        if (!bulkInput.trim()) return;
        try {
            const res = await fetch('/api/links/add-bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: bulkInput })
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message);
                setBulkInput('');
                fetchLinks(true);
            } else {
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const copyTemplateFormat = () => {
        const template = `[ ] Practices & Virtues of Tashriq Days - Ustadz Adi Hidayat\n    https://www.youtube.com/watch?v=GlH04MmbRKM\n\n[ ] Waqf for the Construction of Dormitory - Ustadz Adi Hidayat\n    https://www.youtube.com/watch?v=tA2h9jn4PiQ`;
        navigator.clipboard.writeText(template);
        showToast('Template format copied! 📋');
    };

    const handleDeleteLink = async (url) => {
        if (!window.confirm('Are you sure you want to delete this link?')) return;
        try {
            const res = await fetch('/api/links', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (res.ok) {
                showToast('Link deleted successfully. 🗑');
                fetchLinks(true);
            } else {
                const data = await res.json();
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    };

    const handleUseLink = (url) => {
        setVideoUrl1(url);
        setVideoUrl2('');
        setVideoUrl3('');
        setUrlCount(1);
        setSegments([]);
        setJsonInput('');
        setCliCommand('');
        setSelectedUrls([]);
        setActiveTab('generator');
        showToast('Link sent to Form! 📝');
    };

    const handleToggleSelect = (url) => {
        setSelectedUrls((prev) => {
            if (prev.includes(url)) {
                return prev.filter(u => u !== url);
            }
            if (prev.length >= 3) {
                showToast('You can select a maximum of 3 URLs at once.', 'warning');
                return prev;
            }
            return [...prev, url];
        });
    };

    const handleSendSelectedToForm = () => {
        if (selectedUrls.length === 0) return;
        setVideoUrl1(selectedUrls[0] || '');
        setVideoUrl2(selectedUrls[1] || '');
        setVideoUrl3(selectedUrls[2] || '');
        setUrlCount(selectedUrls.length);
        setSegments([]);
        setJsonInput('');
        setCliCommand('');
        setSelectedUrls([]);
        setActiveTab('generator');
        showToast(`${selectedUrls.length} URLs sent to form! 📝`);
    };

    const handleMarkSelectedDone = async () => {
        if (selectedUrls.length === 0) return;
        try {
            await Promise.all(
                selectedUrls.map(url =>
                    fetch('/api/links/status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url, status: 'done' })
                    })
                )
            );
            showToast(`Marked ${selectedUrls.length} links as Done! ✓`);
            setSelectedUrls([]);
            fetchLinks(true);
        } catch (err) {
            showToast(`Error updating status: ${err.message}`, 'error');
        }
    };

    const handleAutoSelect = async (count = 3) => {
        const pendingLinks = links.filter(link => link.status === 'pending');
        if (pendingLinks.length === 0) {
            showToast('No pending links available in the database! 🎉', 'warning');
            return;
        }
        const batch = pendingLinks.slice(0, count);
        const batchUrls = batch.map(link => link.url);
        setVideoUrl1(batchUrls[0] || '');
        setVideoUrl2(batchUrls[1] || '');
        setVideoUrl3(batchUrls[2] || '');
        setUrlCount(batchUrls.length);
        setSegments([]);
        setJsonInput('');
        setCliCommand('');
        setSelectedUrls([]);
        try {
            await Promise.all(
                batchUrls.map(url =>
                    fetch('/api/links/status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url, status: 'processing' })
                    })
                )
            );
            // Accumulate URLs so Reset Form can revert them back to pending
            setAutoProcessedUrls(prev => [...new Set([...prev, ...batchUrls])]);
            fetchLinks(true);
            setActiveTab('generator');
            showToast(`Auto-selected ${batchUrls.length} pending links (marked as Processing)! ⚡`);
        } catch (err) {
            showToast(`Error updating status: ${err.message}`, 'error');
        }
    };

    const handleCleanCache = useCallback(async () => {
        if (!window.confirm('Clear temporary video files and download cache? (This will not delete your pending links list)')) return;
        try {
            const res = await fetch('/api/clean-cache', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || 'Cache cleaned successfully! 🧹');
            } else {
                showToast(`Error: ${data.error}`, 'error');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        }
    }, [showToast]);

    const filteredLinks = links.filter((link) => {
        const matchesStatus =
            linkFilter === 'all' ||
            (linkFilter === 'pending' && (link.status === 'pending' || link.status === 'processing')) ||
            (linkFilter === 'processing' && link.status === 'processing') ||
            (linkFilter === 'done' && link.status === 'done');
        const matchesSearch =
            link.title.toLowerCase().includes(linkSearch.toLowerCase()) ||
            link.url.toLowerCase().includes(linkSearch.toLowerCase());
        return matchesStatus && matchesSearch;
    });

    // Sync all persistent settings to LocalStorage in one effect
    useEffect(() => {
        localStorage.setItem('clipforge_mergeClips', mergeClips);
        localStorage.setItem('clipforge_durationPref', durationPref);
        localStorage.setItem('clipforge_exportDir', exportDir);
        localStorage.setItem('clipforge_shortsFormat', shortsFormat);
        localStorage.setItem('clipforge_cpuFriendly', cpuFriendly);
    }, [mergeClips, durationPref, exportDir, shortsFormat, cpuFriendly]);



    const handleResetForm = useCallback(async () => {
        setVideoUrl1('');
        setVideoUrl2('');
        setVideoUrl3('');
        setUrlCount(1);
        setJsonInput('');
        setSegments([]);
        setJsonError('');
        setCliCommand('');
        setMergeClips(false);
        setCpuFriendly(false);

        // Revert auto-selected links that are still "processing" back to "pending".
        // Links that were manually marked "done" by the user are NOT reverted.
        if (autoProcessedUrls.length > 0) {
            const urlsToRevert = autoProcessedUrls.filter(url => {
                const link = links.find(l => l.url === url);
                return link && link.status === 'processing';
            });
            if (urlsToRevert.length > 0) {
                try {
                    await Promise.all(
                        urlsToRevert.map(url =>
                            fetch('/api/links/status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ url, status: 'pending' })
                            })
                        )
                    );
                    fetchLinks(true);
                    showToast(`Form reset! ${urlsToRevert.length} link(s) returned to pending. 🧹`);
                } catch (err) {
                    showToast(`Form reset, but failed to revert link status: ${err.message}`, 'warning');
                }
            } else {
                showToast('Form reset successfully! 🧹');
            }
            setAutoProcessedUrls([]);
        } else {
            showToast('Form reset successfully! 🧹');
        }
    }, [showToast, autoProcessedUrls, fetchLinks]);

    // Copy Gemini Prompt trigger
    const copyGeminiPrompt = useCallback(() => {
        const urls = [videoUrl1, videoUrl2, videoUrl3].map(u => u.trim()).filter(Boolean);
        if (urls.length === 0) {
            showToast('Please enter at least one YouTube video URL.', 'error');
            return;
        }

        let durationRules = '';
        if (durationPref === 'short') {
            durationRules = '- Each Shorts clip must be **15-60 seconds** long (ideally under 60s). Focus on quick hooks, punchlines, and high-energy/fast-paced moments.';
        } else if (durationPref === 'deep') {
            durationRules = '- Each Shorts clip must be **30-90 seconds** long. Focus on delivering a complete, meaningful point, lesson, or explanation without cutting off mid-sentence.';
        } else {
            durationRules = '- Each Shorts clip can be **15-120 seconds** long. Let the content dictate the length: keep it brief (15-45s) for quick visual hooks/remarks, and longer (60-120s) for deeper explanations or stories where a complete, cohesive point is made.';
        }

        let urlsSection = '';
        if (urls.length === 1) {
            urlsSection = `## Video URL\n${urls[0]}`;
        } else {
            urlsSection = `## Video URLs to Analyze\n` + urls.map((u, idx) => `- Video ${idx + 1}: ${u}`).join('\n');
        }

        const prompt = `You are a professional YouTube Shorts content strategist and editor. Analyze the following YouTube video(s) and extract the BEST segments to turn into viral Shorts clips.

${urlsSection}

Please OPEN each video URL above to watch/analyze the content directly. Pay careful attention to:
- Hook moments (first 3 seconds must grab attention)
- The most emotionally resonant, informative, or entertaining parts
- Natural sentence breakpoints (never cut mid-sentence)
- Moments that stand alone without needing prior context

## Rules
${durationRules}
- Prioritize the MOST engaging parts: strong openings, surprising facts, emotional peaks, clear takeaways
- Segments must NOT overlap with each other
- Total suggestions: Dynamically determine the number based on each video's duration:
  - Under 10 minutes → suggest 2-3 clips
  - 10-30 minutes → suggest 4-7 clips
  - Over 30 minutes → suggest 8-15 clips
  (Prioritize only the most impactful highlights)

## Output Format
Return ONLY a raw JSON array (no markdown code blocks, no extra text). Each item must contain ALL of the following fields:

- **url**: The exact YouTube URL of the source video for this clip
- **start**: Start time in seconds (integer)
- **end**: End time in seconds (integer)
- **title**: A short, catchy, viral-ready YouTube Shorts title (max 60 chars). Use power words, numbers, or questions. Must work as a standalone hook.
- **hook**: The opening sentence/phrase that appears in the first 3 seconds to stop the scroll. Make it bold, punchy, and curiosity-driven.
- **description**: A complete YouTube Shorts description (3-5 sentences). Include: what the clip is about, why it matters, a call-to-action. Write naturally as if speaking to the viewer. End with relevant hashtags on a new line.
- **tags**: A comma-separated string of 10-15 YouTube SEO tags relevant to this specific clip. Include both broad and niche tags.
- **credits**: A short credit line referencing the original creator/channel name (e.g. "Original content by [Channel Name]").
- **disclaimer**: A short fair-use disclaimer (1-2 sentences max).

## Example output structure:
[
  {
    "url": "<exact_youtube_url>",
    "start": 120,
    "end": 175,
    "title": "Why 99% of People Get This Wrong",
    "hook": "Most people don't know this, but it changes everything...",
    "description": "In this clip, [speaker] breaks down the exact reason why most people struggle with [topic]. This insight completely shifts how you approach [subject]. If you've been making this mistake, here's how to fix it.\n\nFollow for more tips like this!\n\n#Shorts #[Topic] #[Niche] #Tips #Learning",
    "tags": "shorts, [topic], [niche], tips, tutorial, educational, viral, learning, [keyword1], [keyword2]",
    "credits": "Original content by [Channel Name]",
    "disclaimer": "This clip is shared for educational purposes under fair use. All rights belong to the original creator."
  }
]`;

        navigator.clipboard.writeText(prompt)
            .then(() => showToast('Gemini Prompt copied to clipboard! 📋'))
            .catch(() => showToast('Failed to copy prompt automatically.', 'error'));
    }, [videoUrl1, videoUrl2, videoUrl3, durationPref, showToast]);

    // Parse and validate pasted JSON
    const handleJsonChange = (val) => {
        setJsonInput(val);
        setJsonError('');
        setCliCommand('');
        
        if (!val.trim()) {
            setSegments([]);
            return;
        }

        try {
            // Clean up Markdown formatting codeblocks
            let cleanVal = val.trim();
            if (cleanVal.startsWith('```')) {
                cleanVal = cleanVal.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
            }

            // Sanitizer: Fix raw newlines inside JSON string values.
            // We loop through the characters and find strings wrapped in double quotes.
            // If we find newlines inside a double-quoted string block, we replace them with literal "\\n".
            let insideString = false;
            let escapeActive = false;
            let chars = cleanVal.split('');
            for (let i = 0; i < chars.length; i++) {
                const char = chars[i];
                if (char === '"' && !escapeActive) {
                    insideString = !insideString;
                }
                if (insideString) {
                    if (char === '\n') {
                        chars[i] = '\\n'; // Replace raw newline with escaped \n
                    } else if (char === '\r') {
                        chars[i] = ''; // Remove carriage return
                    } else if (char === '\t') {
                        chars[i] = '\\t'; // Replace raw tab with escaped \t
                    }
                }
                if (char === '\\' && !escapeActive) {
                    escapeActive = true;
                } else {
                    escapeActive = false;
                }
            }
            cleanVal = chars.join('');

            // Sanitizer Part 2: Fix unescaped double quotes inside JSON string values.
            // We split by lines and look for "key": "value" patterns. Any unescaped double quotes inside "value" are escaped.
            const lines = cleanVal.split('\n');
            const fixedLines = lines.map(line => {
                const match = line.match(/^(\s*"[^"]+"\s*:\s*")([\s\S]*)("\s*,?\s*)$/);
                if (match) {
                    const prefix = match[1];
                    const content = match[2];
                    const suffix = match[3];
                    
                    let cleanContent = '';
                    for (let i = 0; i < content.length; i++) {
                        if (content[i] === '"') {
                            if (i > 0 && content[i - 1] === '\\') {
                                cleanContent += '"';
                            } else {
                                cleanContent += '\\"';
                            }
                        } else {
                            cleanContent += content[i];
                        }
                    }
                    return prefix + cleanContent + suffix;
                }
                return line;
            });
            cleanVal = fixedLines.join('\n');

            // Remove invalid trailing commas
            cleanVal = cleanVal.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

            const parsed = JSON.parse(cleanVal);
            let extracted = [];
            
            if (Array.isArray(parsed)) {
                extracted = parsed;
            } else if (parsed.segments && Array.isArray(parsed.segments)) {
                extracted = parsed.segments;
            } else if (parsed.clips && Array.isArray(parsed.clips)) {
                extracted = parsed.clips;
            } else {
                throw new Error('Could not find segments array in JSON.');
            }

            // Validate start and end values
            const valid = extracted.every(s => typeof s.start !== 'undefined' && typeof s.end !== 'undefined');
            if (!valid) {
                throw new Error('Each segment must have a "start" and "end" properties.');
            }

            setSegments(extracted);
        } catch (err) {
            setJsonError(`Invalid JSON format: ${err.message}`);
            setSegments([]);
        }
    };

    // Call backend to save temporary JSON and generate node command
    const handleGenerateCLICommand = useCallback(async () => {
        const urls = [videoUrl1, videoUrl2, videoUrl3].map(u => u.trim()).filter(Boolean);
        if (urls.length === 0 || segments.length === 0) return;

        setProcessing(true);
        setCliCommand('');

        try {
            const res = await fetch('/api/generate-cli', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    urls,
                    segments: segments.map((s) => ({
                        url: s.url || urls[0], // fallback to first URL if none provided in JSON
                        start: s.start,
                        end: s.end,
                        title: s.title || 'Clip'
                    })),
                    exportDir: exportDir.trim() || 'D:\\YT Shorts',
                    shortsFormat,
                    copyrightBypass: true,
                    mergeClips,
                    cpuFriendly
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to generate command');
            }

            const data = await res.json();
            setCliCommand(data.command);
            setIsModalOpen(true);
            setAutoProcessedUrls([]); // User is proceeding — clear auto-select tracking
            
            // Auto copy to clipboard!
            try {
                await navigator.clipboard.writeText(data.command);
                showToast('Command generated & copied to clipboard! 📋✈️');
            } catch (err) {
                showToast('Command generated! (Failed to auto-copy)', 'warning');
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setProcessing(false);
        }
    }, [segments, videoUrl1, videoUrl2, videoUrl3, exportDir, shortsFormat, mergeClips, cpuFriendly, showToast]);

    const totalDuration = segments.reduce((sum, s) => sum + (Number(s.end) - Number(s.start) || 0), 0);

    return (
        <div className="app-viewport-wrapper">
            {/* Sleek Horizontal Navbar */}
            <nav className="sleek-navbar">
                <div className="nav-brand">
                    <span className="nav-logo-icon">⚡</span>
                    <span className="nav-logo-text">ClipForge <span>CLI Hub</span></span>
                    <a href="https://snipgeek.com" target="_blank" rel="noopener noreferrer" 
                       style={{ fontSize: '10px', color: '#9ca3af', textDecoration: 'none', marginLeft: '8px', opacity: 0.6, transition: 'opacity 0.2s' }}
                       onMouseEnter={e => e.target.style.opacity = '1'}
                       onMouseLeave={e => e.target.style.opacity = '0.6'}
                    >by snipgeek.com</a>
                </div>

                <div className="nav-tabs">
                    <button
                        type="button"
                        className={`nav-tab-btn ${activeTab === 'generator' ? 'active' : ''}`}
                        onClick={() => setActiveTab('generator')}
                    >
                        ⚡ Generator
                    </button>
                    <button
                        type="button"
                        className={`nav-tab-btn ${activeTab === 'links' ? 'active' : ''}`}
                        onClick={() => setActiveTab('links')}
                    >
                        📂 Link Manager
                    </button>
                </div>

                <div className="nav-actions">
                    {activeTab === 'generator' && (
                        <button
                            type="button"
                            className="btn btn-secondary btn-nav-action"
                            onClick={handleResetForm}
                        >
                            🔄 Reset Form
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn-secondary btn-nav-action"
                        style={{
                            background: 'rgba(244, 67, 54, 0.08)',
                            border: '1px solid rgba(244, 67, 54, 0.15)',
                            color: '#FF5252'
                        }}
                        onClick={handleCleanCache}
                    >
                        🧹 Clean Cache
                    </button>
                </div>
            </nav>

            <div className="app-container">

            {activeTab === 'generator' ? (
                <main className="main-content-grid">
                    {/* Left Card: Input & Settings */}
                    <div className="glass-card">
                        <div className="card-header">
                            <h2>⚙️ 1. Source & Options</h2>
                        </div>
                        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* YouTube URL input group */}
                            <div className="form-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                                    <label style={{ margin: 0 }}>YouTube Video URLs</label>
                                    <span style={{ fontSize: '11px', background: 'rgba(255, 152, 0, 0.12)', color: '#FF9800', padding: '3px 8px', borderRadius: '12px', fontWeight: 'bold', border: '1px solid rgba(255, 152, 0, 0.2)', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                                        ⏳ {links.filter(l => l.status === 'pending').length} pending left
                                    </span>
                                </div>
                                
                                {/* Auto-Select Toolbar Row */}
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ flex: 1, height: '32px', fontSize: '11.5px', borderRadius: 'var(--radius-sm)', fontWeight: '600', cursor: 'pointer', background: 'rgba(156, 39, 176, 0.08)', color: '#E040FB', border: '1px solid rgba(156, 39, 176, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                                        onClick={() => handleAutoSelect(1)}
                                    >
                                        ⚡ Auto 1 Link
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ flex: 1, height: '32px', fontSize: '11.5px', borderRadius: 'var(--radius-sm)', fontWeight: '600', cursor: 'pointer', background: 'rgba(156, 39, 176, 0.08)', color: '#E040FB', border: '1px solid rgba(156, 39, 176, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                                        onClick={() => handleAutoSelect(3)}
                                    >
                                        ⚡ Auto 3 Links
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <input
                                        type="text"
                                        className="premium-input"
                                        placeholder="Video URL 1 (Required)"
                                        value={videoUrl1}
                                        onChange={(e) => {
                                            setVideoUrl1(e.target.value);
                                            setCliCommand('');
                                        }}
                                    />
                                    {urlCount >= 2 && (
                                        <input
                                            type="text"
                                            className="premium-input fade-in"
                                            placeholder="Video URL 2 (Optional)"
                                            value={videoUrl2}
                                            onChange={(e) => {
                                                setVideoUrl2(e.target.value);
                                                setCliCommand('');
                                            }}
                                        />
                                    )}
                                    {urlCount >= 3 && (
                                        <input
                                            type="text"
                                            className="premium-input fade-in"
                                            placeholder="Video URL 3 (Optional)"
                                            value={videoUrl3}
                                            onChange={(e) => {
                                                setVideoUrl3(e.target.value);
                                                setCliCommand('');
                                            }}
                                        />
                                    )}
                                </div>

                                {/* Add/Remove URL Action buttons */}
                                <div style={{ display: 'flex', gap: '8px', marginTop: '4px', justifyContent: 'flex-end' }}>
                                    {urlCount > 1 && (
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ padding: '4px 10px', height: '26px', fontSize: '11px', borderRadius: 'var(--radius-sm)' }}
                                            onClick={() => {
                                                if (urlCount === 3) setVideoUrl3('');
                                                else if (urlCount === 2) setVideoUrl2('');
                                                setUrlCount(prev => prev - 1);
                                                setCliCommand('');
                                            }}
                                        >
                                            ➖ Remove URL
                                        </button>
                                    )}
                                    {urlCount < 3 && (
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ padding: '4px 10px', height: '26px', fontSize: '11px', borderRadius: 'var(--radius-sm)' }}
                                            onClick={() => setUrlCount(prev => prev + 1)}
                                        >
                                            ➕ Add URL
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Duration Preference Pill Group */}
                            <div className="form-group">
                                <label style={{ marginBottom: '6px' }}>🎯 Target Clip Duration</label>
                                <div className="duration-pill-group">
                                    <button
                                        type="button"
                                        className={`pill-btn ${durationPref === 'dynamic' ? 'active' : ''}`}
                                        onClick={() => { setDurationPref('dynamic'); setCliCommand(''); }}
                                    >
                                        🌟 Dynamic (15-120s)
                                    </button>
                                    <button
                                        type="button"
                                        className={`pill-btn ${durationPref === 'short' ? 'active' : ''}`}
                                        onClick={() => { setDurationPref('short'); setCliCommand(''); }}
                                    >
                                        ⚡ Short (15-60s)
                                    </button>
                                    <button
                                        type="button"
                                        className={`pill-btn ${durationPref === 'deep' ? 'active' : ''}`}
                                        onClick={() => { setDurationPref('deep'); setCliCommand(''); }}
                                    >
                                        📚 Deep (30-90s)
                                    </button>
                                </div>
                            </div>

                            {/* Settings inline grid */}
                            <div className="settings-inline-grid" style={{ marginBottom: '0' }}>
                                <div className="form-group">
                                    <label>📂 Export Folder</label>
                                    <input
                                        type="text"
                                        className="premium-input"
                                        value={exportDir}
                                        onChange={(e) => {
                                            setExportDir(e.target.value);
                                            setCliCommand('');
                                        }}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>📱 Layout Format</label>
                                    <select
                                        value={shortsFormat}
                                        onChange={(e) => {
                                            setShortsFormat(e.target.value);
                                            setCliCommand('');
                                        }}
                                        className="premium-select"
                                    >
                                        <option value="vertical_blurred">Vertical Blurred Background (9:16)</option>
                                        <option value="original">Original Widescreen (16:9)</option>
                                        <option value="vertical_crop">Vertical Center Crop (9:16)</option>
                                    </select>
                                </div>
                            </div>

                            {/* Checkbox Panels */}
                            <div className="checkbox-panels-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <label 
                                    htmlFor="mergeClips" 
                                    className={`premium-checkbox-card ${mergeClips ? 'active' : ''}`}
                                    style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px', borderRadius: 'var(--radius-md)', background: mergeClips ? 'rgba(59, 130, 246, 0.08)' : 'rgba(0, 0, 0, 0.12)', border: mergeClips ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--surface-border)', cursor: 'pointer', transition: 'all 0.2s', userSelect: 'none' }}
                                >
                                    <input
                                        type="checkbox"
                                        id="mergeClips"
                                        checked={mergeClips}
                                        onChange={(e) => {
                                            setMergeClips(e.target.checked);
                                            setCliCommand('');
                                        }}
                                        style={{ display: 'none' }}
                                    />
                                    <span className="checkbox-custom-indicator" style={{ width: '16px', height: '16px', borderRadius: '4px', border: '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', background: mergeClips ? 'var(--primary-color)' : 'transparent', color: '#fff', borderColor: mergeClips ? 'var(--primary-color)' : 'var(--text-muted)' }}>
                                        {mergeClips && '✓'}
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                        <span style={{ fontSize: '12.5px', fontWeight: '600', color: 'var(--text-primary)' }}>🔗 Compilation</span>
                                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Merge clips together</span>
                                    </div>
                                </label>

                                <label 
                                    htmlFor="cpuFriendly" 
                                    className={`premium-checkbox-card ${cpuFriendly ? 'active' : ''}`}
                                    style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px', borderRadius: 'var(--radius-md)', background: cpuFriendly ? 'rgba(59, 130, 246, 0.08)' : 'rgba(0, 0, 0, 0.12)', border: cpuFriendly ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--surface-border)', cursor: 'pointer', transition: 'all 0.2s', userSelect: 'none' }}
                                >
                                    <input
                                        type="checkbox"
                                        id="cpuFriendly"
                                        checked={cpuFriendly}
                                        onChange={(e) => {
                                            setCpuFriendly(e.target.checked);
                                            setCliCommand('');
                                        }}
                                        style={{ display: 'none' }}
                                    />
                                    <span className="checkbox-custom-indicator" style={{ width: '16px', height: '16px', borderRadius: '4px', border: '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', background: cpuFriendly ? 'var(--primary-color)' : 'transparent', color: '#fff', borderColor: cpuFriendly ? 'var(--primary-color)' : 'var(--text-muted)' }}>
                                        {cpuFriendly && '✓'}
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                        <span style={{ fontSize: '12.5px', fontWeight: '600', color: 'var(--text-primary)' }}>🍃 CPU-Friendly</span>
                                        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Use single core limit</span>
                                    </div>
                                </label>
                            </div>

                            {/* Large Generation button & View command button */}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                <button
                                    type="button"
                                    className="btn btn-primary btn-large-cli"
                                    style={{ flex: 1.5, height: '46px', maxWidth: 'none', marginTop: 0 }}
                                    onClick={handleGenerateCLICommand}
                                    disabled={(!videoUrl1.trim() && !videoUrl2.trim() && !videoUrl3.trim()) || segments.length === 0 || !!jsonError || processing}
                                >
                                    {processing ? 'Generating...' : '💻 Generate CLI Command'}
                                </button>
                                {cliCommand && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ flex: 0.8, height: '46px', fontSize: '13px' }}
                                        onClick={() => setIsModalOpen(true)}
                                    >
                                        📋 View Command
                                    </button>
                                )}
                            </div>

                            {/* Gemini helper prompt section inside left card */}
                            <div className="gemini-prompts-section" style={{ margin: '0' }}>
                                <label>🤖 Gemini AI Helper</label>
                                <p className="section-desc">Generate segments layout prompt using the URLs to analyze with Gemini.</p>
                                <div className="gemini-btn-row">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={copyGeminiPrompt}
                                        disabled={!videoUrl1.trim() && !videoUrl2.trim() && !videoUrl3.trim()}
                                        style={{ flex: 1.2 }}
                                    >
                                        🎯 Copy Prompt
                                    </button>
                                    <a
                                        href="https://gemini.google.com"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-gemini"
                                        style={{ flex: 0.8 }}
                                    >
                                        🌐 Open Gemini
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Card: JSON Input & Validation */}
                    <div className="glass-card">
                        <div className="card-header">
                            <h2>📋 2. Paste Gemini JSON Result</h2>
                        </div>
                        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <textarea
                                className={`premium-textarea log-monospace ${jsonError ? 'error-border' : ''}`}
                                placeholder='Paste Gemini JSON output here...&#10;Expected fields per clip: url, start, end, title, hook, description, tags, credits, disclaimer'
                                value={jsonInput}
                                onChange={(e) => handleJsonChange(e.target.value)}
                            />
                            {jsonError && (
                                <div className="error-message-text">
                                    ⚠️ {jsonError}
                                </div>
                            )}
                            {segments.length > 0 && !jsonError && (
                                <div className="success-message-text" style={{ lineHeight: '1.6' }}>
                                    <div>✅ Detected <strong>{segments.length} clips</strong> (Total length: {formatTime(totalDuration)})</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px', paddingLeft: '14px' }}>
                                        {Object.entries(
                                            segments.reduce((acc, s) => {
                                                const key = s.url || 'Default Video';
                                                acc[key] = (acc[key] || 0) + 1;
                                                return acc;
                                            }, {})
                                        ).map(([urlKey, count]) => {
                                            const displayUrl = urlKey.length > 40 ? urlKey.substring(0, 40) + '...' : urlKey;
                                            return (
                                                <div key={urlKey}>• {displayUrl}: <strong>{count} clips</strong></div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            ) : (
                <div className="link-manager-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
                     {/* Add New Link Card */}
                     <div className="glass-card full-width-card">
                         <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                             <h2>➕ Add Bulk Target Links</h2>
                             <button
                                 type="button"
                                 className="btn btn-secondary"
                                 style={{ padding: '6px 12px', fontSize: '12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                 onClick={copyTemplateFormat}
                             >
                                 📋 Copy Template Format
                             </button>
                         </div>
                         <div className="card-body">
                             <form onSubmit={handleImportBulk} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                 <div className="form-group">
                                     <label>Paste Links (Use formatting: <code>[ ] Title</code> on one line, and <code>URL</code> on the line directly below it)</label>
                                     <textarea
                                         className="premium-textarea"
                                         placeholder={`[ ] Video Title 1\n    https://www.youtube.com/watch?v=video1\n\n[ ] Video Title 2\n    https://www.youtube.com/watch?v=video2`}
                                         value={bulkInput}
                                         onChange={(e) => setBulkInput(e.target.value)}
                                         style={{ minHeight: '120px', fontFamily: 'inherit', fontSize: '13.5px', lineHeight: '1.6' }}
                                         required
                                     />
                                 </div>
                                 <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                     <button type="submit" className="btn btn-primary" style={{ height: '40px', padding: '0 25px', borderRadius: 'var(--radius-md)', fontWeight: '600', cursor: 'pointer' }}>
                                         ➕ Add & Merge to Master List
                                     </button>
                                 </div>
                             </form>
                         </div>
                     </div>

                     {/* Links Table Card */}
                     <div className="glass-card full-width-card">
                         <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                             <h2>📂 Target Links Database ({filteredLinks.length} items)</h2>
                             <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                 {selectedUrls.length > 0 && (
                                     <div style={{ display: 'flex', gap: '8px' }}>
                                         <button
                                             type="button"
                                             className="btn btn-primary"
                                             style={{ padding: '0 16px', height: '36px', fontSize: '13px', borderRadius: 'var(--radius-md)', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}
                                             onClick={handleSendSelectedToForm}
                                         >
                                             ➡️ Send Selected ({selectedUrls.length}/3)
                                         </button>
                                         <button
                                             type="button"
                                             className="btn btn-secondary"
                                             style={{ padding: '0 16px', height: '36px', fontSize: '13px', borderRadius: 'var(--radius-md)', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(76, 175, 80, 0.15)', color: '#4CAF50', border: '1px solid rgba(76, 175, 80, 0.2)' }}
                                             onClick={handleMarkSelectedDone}
                                         >
                                             ✓ Mark Done ({selectedUrls.length})
                                         </button>
                                     </div>
                                 )}
                                 <input
                                     type="text"
                                     className="premium-input"
                                     placeholder="🔍 Search title or URL..."
                                     style={{ width: '220px', height: '36px', padding: '0 12px', fontSize: '13px' }}
                                     value={linkSearch}
                                     onChange={(e) => setLinkSearch(e.target.value)}
                                 />
                                 <select
                                     className="premium-select"
                                     style={{ width: '130px', height: '36px', padding: '0 12px', fontSize: '13px' }}
                                     value={linkFilter}
                                     onChange={(e) => setLinkFilter(e.target.value)}
                                 >
                                     <option value="all">All Items</option>
                                     <option value="pending">Pending</option>
                                     <option value="processing">Processing</option>
                                     <option value="done">Done</option>
                                 </select>
                                  <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '0 16px', height: '36px', fontSize: '13px', borderRadius: 'var(--radius-md)', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(156, 39, 176, 0.12)', color: '#E040FB', border: '1px solid rgba(156, 39, 176, 0.2)' }}
                                      onClick={() => handleAutoSelect(1)}
                                  >
                                      ⚡ Auto 1 Link
                                  </button>
                                  <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{ padding: '0 16px', height: '36px', fontSize: '13px', borderRadius: 'var(--radius-md)', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(156, 39, 176, 0.12)', color: '#E040FB', border: '1px solid rgba(156, 39, 176, 0.2)' }}
                                      onClick={() => handleAutoSelect(3)}
                                  >
                                      ⚡ Auto 3 Links
                                  </button>
                             </div>
                         </div>
                         <div className="card-body" style={{ padding: '10px 0' }}>
                             {loadingLinks ? (
                                 <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                     Loading links database... ⏳
                                 </div>
                             ) : filteredLinks.length === 0 ? (
                                 <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                     No links found matching criteria.
                                 </div>
                             ) : (
                                 <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 460px)', minHeight: '180px', overflowY: 'auto' }}>
                                     <table className="links-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
                                         <thead>
                                             <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}>
                                                 <th style={{ padding: '14px 18px', width: '40px', textAlign: 'center' }}>Select</th>
                                                 <th style={{ padding: '14px 18px' }}>Status</th>
                                                 <th style={{ padding: '14px 18px' }}>Title</th>
                                                 <th style={{ padding: '14px 18px' }}>YouTube URL</th>
                                                 <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
                                             </tr>
                                         </thead>
                                         <tbody>
                                             {filteredLinks.map((link) => (
                                                 <tr key={link.url} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }} className="table-row-hover">
                                                     <td style={{ padding: '14px 18px', width: '40px', textAlign: 'center' }}>
                                                         {link.status === 'pending' && (
                                                             <input
                                                                 type="checkbox"
                                                                 checked={selectedUrls.includes(link.url)}
                                                                 onChange={() => handleToggleSelect(link.url)}
                                                                 style={{
                                                                     width: '16px',
                                                                     height: '16px',
                                                                     accentColor: 'var(--primary-color)',
                                                                     cursor: 'pointer'
                                                                 }}
                                                             />
                                                         )}
                                                     </td>
                                                     <td style={{ padding: '14px 18px' }}>
                                                         <span
                                                             onClick={() => handleToggleStatus(link.url, link.status)}
                                                             style={{
                                                                 padding: '6px 12px',
                                                                 borderRadius: '20px',
                                                                 fontSize: '11px',
                                                                 fontWeight: 'bold',
                                                                 cursor: 'pointer',
                                                                 background: link.status === 'done' ? 'rgba(76, 175, 80, 0.12)' : 
                                                                             link.status === 'processing' ? 'rgba(33, 150, 243, 0.12)' : 'rgba(255, 152, 0, 0.12)',
                                                                 color: link.status === 'done' ? '#4CAF50' : 
                                                                        link.status === 'processing' ? '#2196F3' : '#FF9800',
                                                                 border: link.status === 'done' ? '1px solid rgba(76, 175, 80, 0.25)' : 
                                                                         link.status === 'processing' ? '1px solid rgba(33, 150, 243, 0.25)' : '1px solid rgba(255, 152, 0, 0.25)',
                                                                 display: 'inline-flex',
                                                                 alignItems: 'center',
                                                                 gap: '6px'
                                                             }}
                                                         >
                                                             <span style={{
                                                                 width: '6px',
                                                                 height: '6px',
                                                                 borderRadius: '50%',
                                                                 background: link.status === 'done' ? '#4CAF50' : 
                                                                             link.status === 'processing' ? '#2196F3' : '#FF9800',
                                                                 display: 'inline-block'
                                                             }}></span>
                                                             {link.status === 'done' ? 'DONE' : 
                                                              link.status === 'processing' ? 'PROCESSING' : 'PENDING'}
                                                         </span>
                                                     </td>
                                                     <td style={{ padding: '14px 18px', fontWeight: '500', color: 'var(--text-primary)' }}>
                                                         {link.title}
                                                     </td>
                                                     <td style={{ padding: '14px 18px' }}>
                                                         <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                                                             {link.url.length > 40 ? link.url.substring(0, 40) + '...' : link.url}
                                                         </a>
                                                     </td>
                                                     <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                                                         <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                             {link.status !== 'done' ? (
                                                                 <>
                                                                     <button
                                                                         type="button"
                                                                         className="btn btn-secondary"
                                                                         style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: 'var(--radius-sm)' }}
                                                                         onClick={() => handleUseLink(link.url)}
                                                                     >
                                                                         → Send to Form
                                                                     </button>
                                                                     <button
                                                                         type="button"
                                                                         className="btn btn-secondary"
                                                                         style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: 'var(--radius-sm)', background: 'rgba(76, 175, 80, 0.15)', color: '#4CAF50', border: '1px solid rgba(76, 175, 80, 0.2)' }}
                                                                         onClick={() => handleToggleStatus(link.url, link.status)}
                                                                     >
                                                                         ✓ Done
                                                                     </button>
                                                                 </>
                                                             ) : (
                                                                 <button
                                                                     type="button"
                                                                     className="btn btn-secondary"
                                                                     style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: 'var(--radius-sm)', background: 'rgba(255, 152, 0, 0.15)', color: '#FF9800', border: '1px solid rgba(255, 152, 0, 0.2)' }}
                                                                     onClick={() => handleToggleStatus(link.url, 'done')}
                                                                 >
                                                                     ↩ Pending
                                                                 </button>
                                                             )}
                                                             <button
                                                                 type="button"
                                                                 className="btn btn-secondary"
                                                                 style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: 'var(--radius-sm)', background: 'rgba(244, 67, 54, 0.15)', color: '#FF5252', border: '1px solid rgba(244, 67, 54, 0.2)' }}
                                                                 onClick={() => handleDeleteLink(link.url)}
                                                             >
                                                                 × Delete
                                                             </button>
                                                         </div>
                                                     </td>
                                                 </tr>
                                             ))}
                                         </tbody>
                                     </table>
                                 </div>
                             )}
                         </div>
                     </div>
                </div>
            )}

            {/* Generated Command Modal */}
            {isModalOpen && cliCommand && (
                <div className="modal-backdrop fade-in" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content glass-card" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ margin: 0 }}>💻 PowerShell / Terminal Command Ready</h2>
                            <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>×</button>
                        </div>
                        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="command-output-wrapper" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0, boxShadow: 'none' }}>
                                <div className="command-output-header" style={{ marginBottom: '10px' }}>
                                    <span>💻 Output Command</span>
                                    <button
                                        type="button"
                                        className="btn-copy-action"
                                        onClick={() => {
                                            navigator.clipboard.writeText(cliCommand);
                                            showToast('Command copied! 📋');
                                        }}
                                    >
                                        📋 Copy Command
                                    </button>
                                </div>
                                <div className="command-code-display">
                                    <code className="log-monospace">{cliCommand}</code>
                                </div>
                                <div className="command-help-tip">
                                    <strong>How to run:</strong> Open your terminal, go to project folder (<code>cd clipforge</code>), paste the command, and press <strong>Enter</strong>.<br />
                                    <span style={{ fontSize: '10px', opacity: 0.6, marginTop: '4px', display: 'inline-block' }}>
                                        ⚡ Powered by <a href="https://snipgeek.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>SnipGeek.com</a>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Alerts */}
            {toast && (
                <div className={`toast-alert toast-${toast.type} fade-in`}>
                    {toast.msg}
                </div>
            )}

            {/* Footer Attribution */}
            <footer style={{
                textAlign: 'center', padding: '16px 0', fontSize: '11px',
                color: '#6b7280', borderTop: '1px solid rgba(255,255,255,0.04)',
                marginTop: '24px'
            }}>
                ⚡ ClipForge — Forked from{' '}
                <a href="https://github.com/FullStackHarman/youtube-clipper" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>
                    FullStackHarman/youtube-clipper
                </a>
                {' '}· Built by{' '}
                <a href="https://snipgeek.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>
                    SnipGeek.com
                </a>
            </footer>
        </div>
    </div>
    );
}
