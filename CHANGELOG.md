# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-07-09

### Added
- **CLI batch mode** — process dozens of YouTube URLs in a single run
- **GPU auto-detect** — NVENC → AMF → QSV → CPU fallback ladder for maximum speed
- **Modern CLI UI** — `ora` spinners, `cli-progress` bars with ETA, `chalk` colors
- **Web UI Generator** — paste URLs, Gemini AI analysis, JSON validator, CLI command builder
- **Link Manager** — bulk paste with status tracking (`[ ]` / `[Processing]` / `[Done]`)
- **Auto-Select** — automatically pick pending links and mark them as processing
- **Gemini AI Helper** — one-click copy prompt for AI-powered segment suggestions
- **Copyright bypass** — mirror + speed adjustment for content transformation
- **Auto watermark** — source attribution overlay on every clip
- **Merge mode** — combine all clips into a single compilation file
- **Persistent cache** — downloaded source videos are cached for instant re-runs
- **Smart skip** — avoids re-processing already-completed links and existing files
- **YouTube metadata** — auto-generates title, description, tags `.txt` files for upload
- **Windows `.bat` launcher** — one-click start for frontend + backend + CLI terminal
- **React Error Boundary** — graceful crash recovery instead of white screen
- **Update checker** — CLI checks GitHub Releases for new versions (cached 24h)
- **49 automated tests** — property-based + integration tests for critical paths

### Changed
- **Rebranded** from `youtube-clipper` to **ClipForge**
- **CLI-first architecture** — web UI is the control panel, CLI is the engine
- **Quality**: `vertical_crop` uses CRF 20 (professional tier), others CRF 23
- **Shared config**: `LINKS_FILE` path centralized in `platform.js`
- **README**: comprehensive documentation with step-by-step tutorials

### Fixed
- **Green tint** on `vertical_blurred` — `format=yuv420p` normalization prevents pixel-format mismatch
- **Progress bar 0%** — fixed stderr chunk splitting in FFmpeg time regex parser
- **Reset form** — only reverts `processing` links, preserves manually marked `done` links
- **API validation** — body size limit (2MB) + status enum validation

### Security
- No hardcoded credentials or API keys
- Personal filesystem paths anonymized (`<your-username>` placeholders)
- Express body size limited to 2MB

---

## Credits

Forked from [FullStackHarman/youtube-clipper](https://github.com/FullStackHarman/youtube-clipper) — the original browser-based YouTube segment downloader.

Built with ❤️ by [Iwan Efendi](https://snipgeek.com)
