# ⚡ ClipForge

AI-powered YouTube Shorts factory — download, crop, caption, and render professional Shorts from your terminal.

> 📖 **Full documentation → [`docs/README.md`](docs/README.md)**  
> 📋 **Changelog → [`docs/CHANGELOG.md`](docs/CHANGELOG.md)**  
> 🐛 **Error log → [`docs/ERROR_LOG.md`](docs/ERROR_LOG.md)**

## Quick Start

```bash
npm install
npm start              # Web UI at http://localhost:5173
node cli.js --help     # CLI mode
```

## Project Structure

```
├── cli.js                 # CLI entry point
├── cli/                   # CLI modules
├── src/                   # React frontend
├── server/                # Express API + services
├── docs/                  # Documentation
├── infra/                 # Docker / deployment
├── scripts/               # Utility scripts
└── link/                  # Link database (gitignored)
```
