export function buildGeminiPrompt(urls, durationPref) {
    let durationRules = '';
    if (durationPref === 'short') {
        durationRules = `- Each Shorts clip must be **15-60 seconds** long (ideally under 60s). Focus on quick hooks, punchlines, and high-energy/fast-paced moments.
- **Exception — "Deep" complete point:** If a segment contains a SINGLE, complete, cohesive point (e.g. one full lesson, a complete story, an uninterrupted explanation) that CANNOT be split without losing meaning, you may extend up to **180 seconds (3 minutes)** max. Label such segments as "deep" in your reasoning. Only use this exception when truly necessary — do not pad lengths.`;
    } else if (durationPref === 'deep') {
        durationRules = `- Each Shorts clip must be **30-90 seconds** long. Focus on delivering a complete, meaningful point, lesson, or explanation without cutting off mid-sentence.
- **Exception — Extended deep point:** For a single uninterrupted point that forms a complete lesson or narrative arc, you may extend up to **180 seconds (3 minutes)** max. Only use this when splitting would break the coherence of the message.`;
    } else if (durationPref === 'long') {
        durationRules = '- This is a **long-form highlight reel (3-15 minutes total)**. Extract the most important segments that preserve the full narrative arc — intro, key points, climax, and conclusion. Cut repetitive or less important parts, but keep the story flowing naturally from start to finish.\n- Each individual segment should be 30 seconds to 3 minutes long.\n- When combined in order, the segments should feel like one cohesive video — not a compilation of random clips.';
    } else {
        durationRules = '- Each Shorts clip can be **15-120 seconds** long. Let the content dictate the length: keep it brief (15-45s) for quick visual hooks/remarks, and longer (60-120s) for deeper explanations or stories where a complete, cohesive point is made.';
    }

    let urlsSection = '';
    if (urls.length === 1) {
        urlsSection = `## Video URL\n${urls[0]}`;
    } else {
        urlsSection = `## Video URLs to Analyze\n` + urls.map((u, idx) => `- Video ${idx + 1}: ${u}`).join('\n');
    }

    const isLongForm = durationPref === 'long';
    const promptIntro = isLongForm
      ? `You are a professional video editor and content strategist. Analyze the following YouTube video(s) and create a **comprehensive highlight reel** that preserves the original narrative flow — not individual Shorts clips.`
      : `You are a professional YouTube Shorts content strategist and editor. Analyze the following YouTube video(s) and extract the BEST segments to turn into viral Shorts clips.`;

    const prompt = `${promptIntro}

${urlsSection}

Please OPEN each video URL above to watch/analyze the content directly. Pay careful attention to:
- Hook moments (first 3 seconds must grab attention)
- The most emotionally resonant, informative, or entertaining parts
- Natural sentence breakpoints (never cut mid-sentence)
${isLongForm ? '- **The narrative arc** — intro → development → climax → conclusion must flow naturally when segments are combined' : '- Moments that stand alone without needing prior context'}

## Rules
${durationRules}
${isLongForm
  ? `- Prioritize the CORE message: focus on the essential talking points, skip tangents and repetition
- Keep the story coherent — viewers should understand the full message without watching the original
- Start strong (hook the viewer), end with a clear takeaway or call-to-action
- Total segments: Dynamically determine based on video duration:
  - Under 15 minutes → 3-5 segments
  - 15-30 minutes → 5-10 segments
  - Over 30 minutes → 10-20 segments
  (The combined duration should be 3-15 minutes)`
  : `- Prioritize the MOST engaging parts: strong openings, surprising facts, emotional peaks, clear takeaways
- Segments must NOT overlap with each other
- Total suggestions: Dynamically determine the number based on each video's duration:
  - Under 10 minutes → suggest 2-3 clips
  - 10-30 minutes → suggest 4-7 clips
  - Over 30 minutes → suggest 8-15 clips
  (Prioritize only the most impactful highlights)`}

## Output Format
Return ONLY a raw JSON array (no markdown code blocks, no extra text). Each item must contain ALL of the following fields:

- **url**: The exact YouTube URL of the source video for this clip
- **start**: Start time in seconds (integer)
- **end**: End time in seconds (integer)
- **title**: ${isLongForm ? 'A short, descriptive segment label summarizing what this section covers (max 60 chars). These titles will appear as chapters in the final video.' : 'A short, catchy, viral-ready YouTube Shorts title (max 60 chars). Use power words, numbers, or questions. Must work as a standalone hook.'}
- **hook**: ${isLongForm ? 'A brief transition sentence connecting this segment to the next one (max 100 chars). Helps the narrative flow.' : 'The opening sentence/phrase that appears in the first 3 seconds to stop the scroll. Make it bold, punchy, and curiosity-driven.'}
- **subtitles**: An array of subtitle entries for the ENTIRE clip. Write EVERY spoken word — do NOT summarize. Each entry: { "start": startSec, "end": endSec, "text": "..." }. Timestamps RELATIVE to clip start (0.0 = beginning). Max 60 chars per text. Keep 0.3-0.5s gaps. Include ALL words, Arabic terms as-is. Example: [{"start": 0.5, "end": 3.0, "text": "Assalamualaikum warahmatullahi wabarakatuh"}, {"start": 3.5, "end": 7.2, "text": "Alhamdulillah, segala puji bagi Allah"}]
  **CRITICAL JSON rule for every string value (subtitles.text, title, hook, etc.):** You MUST NOT put a literal double-quote character (\") inside a JSON string value — it breaks the JSON parser and aborts the whole run. Spoken dialogue, quotations, and dialogue markers must use single quotes (') or curly quotes (“ ”) instead of straight double quotes. Examples of what to write and what to avoid:
  • WRONG: {"text": ""Ali, kamu tidur di tempat tidur saya.""}   ← parser sees empty string, then garbage
  • RIGHT: {"text": "'Ali, kamu tidur di tempat tidur saya.'"}     ← single-quote safe in JSON
  • RIGHT: {"text": "\\"Ali, kamu tidur di tempat tidur saya.\\""}     ← backslash-escaped if you must use \\", but prefer the single-quote form above
  Never wrap spoken dialogue in straight double quotes inside any string field — always use ' or “ ”.
- **description**: ${isLongForm ? 'A segment summary (2-3 sentences) explaining the key point covered and why it matters. Include relevant timestamps and hashtags.' : 'A complete YouTube Shorts description (3-5 sentences). Include: what the clip is about, why it matters, a call-to-action. Write naturally as if speaking to the viewer. End with relevant hashtags on a new line.'}
- **tags**: A comma-separated string of 10-15 YouTube SEO tags relevant to this specific clip. Include both broad and niche tags (e.g. "islamic lectures, motivation, self improvement, ustadz adi hidayat, ...").
- **playlist**: A suggested YouTube playlist name where this video belongs (1 line, max 80 chars). Helps organize content into series/categories (e.g. "Ustadz Adi Hidayat — Full Lectures", "Tech Reviews 2026", "Cooking Tutorials").
- **category**: One of: "Education", "Entertainment", "Music", "Science & Technology", "Comedy", "Gaming", "Sports", "News & Politics", "People & Blogs", "Howto & Style". Pick the most relevant category for YouTube.
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
    "subtitles": [
      {"start": 0.5, "end": 3.0, "text": "Assalamualaikum warahmatullahi wabarakatuh"},
      {"start": 3.5, "end": 7.2, "text": "Alhamdulillah, segala puji bagi Allah SWT"},
      {"start": 7.5, "end": 12.0, "text": "Hari ini kita akan membahas tentang makna"}
    ],
    "description": "In this clip, [speaker] breaks down the exact reason why most people struggle with [topic]. This insight completely shifts how you approach [subject]. If you've been making this mistake, here's how to fix it.\n\nFollow for more tips like this!\n\n#Shorts #[Topic] #[Niche] #Tips #Learning",
    "tags": "shorts, [topic], [niche], tips, tutorial, educational, viral, learning, [keyword1], [keyword2]",
    "playlist": "[Channel Name] — Highlights & Key Moments",
    "category": "Education",
    "credits": "Original content by [Channel Name]",
    "disclaimer": "This clip is shared for educational purposes under fair use. All rights belong to the original creator."
  }
]`;

    return prompt;
}
