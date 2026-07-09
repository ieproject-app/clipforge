# ⚡ ClipForge — AI-Powered YouTube Shorts Factory

> **Turn long YouTube videos into viral Shorts with one command.**
> Forked from [FullStackHarman/youtube-clipper](https://github.com/FullStackHarman/youtube-clipper) — rebuilt with CLI-first workflow, GPU acceleration, and batch processing.

---

## 🎯 What It Does

1. **Paste YouTube URLs** into the web UI (or a links database)
2. **Gemini AI analyzes** the videos and suggests the best clip segments
3. **One CLI command** downloads, crops, watermarks, and renders all clips
4. **Ready to upload** — professional 9:16 vertical Shorts with captions

```
┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  📂 Links DB  │ ──▶ │ 🤖 Gemini AI │ ──▶ │  ⚡ ClipForge │
│  (paste URLs) │     │ (suggests)   │     │  (CLI renders)│
└──────────────┘     └─────────────┘     └──────────────┘
                                              │
                                         ✅ YouTube Shorts
                                         ✅ TikTok
                                         ✅ Instagram Reels
```

---

## 🆚 Why CLI-First?

Most video clipping tools lock you into a GUI — you click, drag, wait, repeat. ClipForge separates the **creative work** (choosing segments with AI) from the **heavy lifting** (downloading + rendering), so you can process dozens of videos without watching progress bars all day.

| | GUI Tools | ClipForge CLI |
|---|---|---|
| **Batch processing** | ❌ One video at a time | ✅ Dozens of URLs in one run |
| **Speed** | 🐢 GUI overhead + manual steps | ⚡ GPU-accelerated, zero UI lag |
| **Re-run** | 🔁 Re-do everything manually | 💾 Persistent cache — instant re-runs |
| **Automation** | ❌ Click-click-click | 🤖 One command, walk away |
| **Server-friendly** | ❌ Needs desktop | ✅ Headless Linux/Docker |
| **Hardware** | 🎮 Any (CPU only) | 🚀 Auto-detect NVENC/AMF/QSV |
| **AI integration** | ❌ Manual segment picking | ✅ Gemini suggests, CLI executes |

> **Workflow:** Use the web UI to generate the command → run it in terminal → done. The UI is your **control panel**, the CLI is your **engine**.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Python 3** + **yt-dlp** (`pip install yt-dlp`)
- **FFmpeg** (with GPU encoders recommended — NVENC, AMF, or QSV)

### Windows — One-Click Start

```bash
# Double-click this file:
start_clipforge.bat
```

It will:
1. Auto-install dependencies (if `node_modules` missing)
2. Open browser at `http://localhost:5173`
3. Spawn a **CLI terminal window** ready for pasting commands
4. Start the frontend + backend servers

### Manual Install

```bash
git clone https://github.com/ieproject-app/clipforge.git
cd clipforge
npm install
```

### CLI Mode (Primary Workflow)

```bash
# 1. Start the web UI to build your segments JSON
npm start                    # → http://localhost:5173

# 2. Use Gemini AI to analyze videos → paste JSON → Generate CLI Command

# 3. Run the generated command in terminal:
node cli.js "segments-abc123.json" "D:\YT Shorts" "vertical_crop" "true" "false"
```

**Or single-URL mode:**
```bash
node cli.js "https://youtube.com/watch?v=..." "segments.json" "D:\YT Shorts"
```

### Web UI (Generator Mode)

```
npm start     # → http://localhost:5173
```

1. Add YouTube URLs to the **Link Manager** (paste in bulk)
2. Click **⚡ Auto 3 Links** to load pending URLs
3. Click **🎯 Copy Prompt** → paste into **Gemini AI**
4. Paste Gemini's JSON response into the editor
5. Click **💻 Generate CLI Command** → run in terminal

---

## 🎨 Output Formats

| Format | Resolution | Quality | Best For |
|---|---|---|---|
| **Vertical Center Crop** | 1080×1920 (9:16) | CRF 20 ✨ | TikTok, Reels, Shorts |
| **Vertical Blurred BG** | 1080×1920 (9:16) | CRF 23 | Shorts with context |
| **Original Widescreen** | Source resolution | CRF 23 | Full clips |

---

## ⚙️ Features

### CLI
- ✅ **Batch multi-video** — process dozens of URLs in one run
- ✅ **Persistent cache** — re-downloads skipped, instant re-runs
- ✅ **GPU auto-detect** — NVENC → AMF → QSV → CPU fallback ladder
- ✅ **Copyright bypass** — mirror + speed adjustment
- ✅ **Auto watermark** — source attribution overlay
- ✅ **Merge mode** — combine all clips into one compilation
- ✅ **Smart skip** — avoids re-processing already-done links
- ✅ **YouTube metadata** — auto-generates title, description, tags `.txt` files

### Web UI
- ✅ **Link Manager** — bulk paste, status tracking, search/filter
- ✅ **Gemini AI Helper** — one-click prompt generation
- ✅ **JSON sanitizer** — handles malformed Gemini output gracefully
- ✅ **Persistent settings** — export folder, format, duration preference
- ✅ **Error Boundary** — graceful crash recovery

### Quality & Resilience
- ✅ **49 automated tests** — property-based + integration
- ✅ **GPU → CPU fallback** — never fails due to encoder issues
- ✅ **Green tint fix** — `format=yuv420p` normalization for all filter chains
- ✅ **API validation** — rate limiting, body size limits, status enums

---

## 📁 Project Structure

```
├── cli.js                           # 🎯 CLI entry point (primary interface)
├── server/
│   ├── index.js                     # Express API server
│   └── services/
│       ├── ffmpeg.js                # FFmpeg cut/merge with GPU fallback
│       ├── filterHelpers.js         # Pure filtergraph builders (tested)
│       ├── ytdlp.js                 # yt-dlp download + cache
│       ├── platform.js              # OS resolution + shared config
│       ├── logger.js                # Job log writer
│       ├── durationLimit.js         # Duration validation helpers
│       └── __tests__/               # 14 test files, 49 tests
├── src/
│   ├── App.jsx                      # React web UI
│   ├── components/ErrorBoundary.jsx # Crash protection
│   └── utils/formatTime.js          # Time formatting utilities
├── link/
│   └── link_uah_100_akurat.txt      # Links database (shared)
├── start_clipforge.bat              # Windows quick-start
└── package.json
```

---

## 🔧 CLI Reference

```
node cli.js <JSON_SEGMENTS> [EXPORT_DIR] [SHORTS_FORMAT] [COPYRIGHT_BYPASS] [MERGE_CLIPS] [--cpu-friendly]

Arguments:
  JSON_SEGMENTS      Path to segments JSON (batch mode)
  EXPORT_DIR         Output directory (default: "D:\YT Shorts")
  SHORTS_FORMAT      vertical_crop | vertical_blurred | original
  COPYRIGHT_BYPASS   true | false (default: true)
  MERGE_CLIPS        true | false (default: false)
  --cpu-friendly     Limit to single CPU core
```

---

## 🆘 Troubleshooting

| Problem | Solution |
|---|---|
| `yt-dlp: command not found` | Install with `pip install yt-dlp` |
| `FFmpeg exited with code 1` | Check GPU drivers or add `--cpu-friendly` flag |
| Green/magenta tint in output | Fixed in v2 — update to latest commit |
| "Video is too long" error | Edit `MAX_DURATION` in `server/services/ytdlp.js` |
| Port 5173/3001 already in use | Kill existing process: `npx kill-port 5173 3001` |
| Gemini JSON parse error | Make sure to paste raw JSON (remove markdown \`\`\` fences) |

---

## ⭐ Support & Author

Jika proyek ini bermanfaat, dukung dengan:

- ⭐ **Star repo ini** di GitHub — bantu orang lain menemukannya
- 🐛 **Laporkan bug** atau request fitur di [Issues](https://github.com/ieproject-app/clipforge/issues)
- 🌐 **Kunjungi [SnipGeek.com](https://snipgeek.com/)** — website pribadi saya seputar coding, tools, dan tips teknologi

```
╔══════════════════════════════════════╗
║  🌐 https://snipgeek.com/           ║
║  Coding, Tools & Tech Tips          ║
╚══════════════════════════════════════╝
```

**Dibuat dengan ❤️ oleh [Iwan Efendi](https://snipgeek.com/)**

---

## 📝 Credits & License

Proyek ini adalah fork dari **[FullStackHarman/youtube-clipper](https://github.com/FullStackHarman/youtube-clipper)** — aplikasi browser-based YouTube segment downloader original. Kami membangun ulang dengan pendekatan CLI-first, batch processing, GPU acceleration, dan integrasi AI workflow.

**License:** MIT — bebas digunakan, dimodifikasi, dan didistribusikan.
