# Error Log & Fix Documentation — ClipForge

> Dokumentasi semua error yang ditemukan selama pengembangan ClipForge (YouTube Video Clipper)
> dan cara memperbaikinya.

---

## 1. 🐛 Backend: Python Path Hardcoded macOS

**Error:**
```
Failed to spawn yt-dlp: spawn /opt/homebrew/opt/python@3.11/bin/python3.11 ENOENT
```

**Penyebab:** Kode `server/services/ytdlp.js` pakai path absolut Python untuk macOS (`/opt/homebrew/...`). Di Windows path-nya beda.

**Fix:** Ganti dengan variabel dinamis. Deteksi platform otomatis:
```js
const PYTHON_CMD = process.platform === 'win32' ? 'python' : '/opt/homebrew/opt/python@3.11/bin/python3.11';
```

**File:** `server/services/ytdlp.js`

---

## 2. 🐛 FFmpeg Binary Not Found di Windows

**Error:**
```
Failed to spawn FFmpeg: spawn ffmpeg ENOENT
```

**Penyebab:** FFmpeg tidak ada di PATH Windows. Tapi `imageio-ffmpeg` (Python package) sudah menyediakan binary.

**Fix:** Deteksi otomatis binary dari `imageio-ffmpeg` kalau tidak ada di PATH:
```js
function getFFmpegPath() {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        return 'ffmpeg';
    } catch {
        const result = execSync(
            'python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"'
        ).trim();
        return result || 'ffmpeg';
    }
}
```

**File:** `server/services/ffmpeg.js`

---

## 3. 🐛 Video Duration Over Limit

**Error:**
```
Video is too long (160 min). Maximum allowed duration is 60 minutes.
```

**Penyebab:** `MAX_DURATION = 3600` (1 jam). Video user 160 menit.

**Fix:** Dinaikkan jadi 6 jam:
```js
const MAX_DURATION = 21600; // 6 hours in seconds
```

**File:** `server/index.js`

---

## 4. 🐛 FFmpeg drawtext: Single Quotes & Special Chars di Teks

**Error (Percobaan 1 — `text=` langsung):**
```
[AVFilterGraph] Error parsing filterchain 'drawtext=text='Source: [LIVE] Kajian Adabul '\\\''Alim...
Error opening output file
```

**Error (Percobaan 2 — `textfile=`):**
```
[AVFilterGraph] Error parsing filterchain 'drawtext=textfile=C\:/Users/...'
Error opening output file
```

**Penyebab:**
- **Percobaan 1:** Judul video mengandung tanda petik (`'`) dan karakter spesial yang bentrok dengan sintaks filter `drawtext=text='...'`
- **Percobaan 2:** `textfile=` gagal karena path Windows (backslash + colon) sulit di-escape untuk sintaks filter ffmpeg

**Fix Final — `text=` dengan escaping manual semua karakter spesial ffmpeg:**

Karakter yang perlu di-escape di `drawtext` filter ffmpeg:
| Karakter | Escape | Contoh |
|----------|--------|--------|
| `\` | `\\` | Backslash |
| `'` | `\'` | Single quote |
| `:` | `\:` | Colon (separator filter) |
| `,` | `\,` | Comma |
| `%` | `\%` | Percent |
| `{}` | `\{` `\}` | Curly braces |
| `()` | `\(` `\)` | Parentheses |

```js
let safeText = watermarkText
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/[{}]/g, (c) => '\\' + c)
    .replace(/[()]/g, (c) => '\\' + c);

// Font path: backslash → forward slash, escape colon
const safeFontPath = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:');

// Final filter:
'-vf', `drawtext=text='${safeText}':fontfile=${safeFontPath}:fontsize=18:...`
```

**Pelajaran:** Jangan pake `textfile=` di Windows — path-nya bermasalah. Lebih aman `text=` dengan manual escaping.

**File:** `server/services/ffmpeg.js`

---

## ~~5. 🐛 FFmpeg drawtext: Backslash & Colon di Path Windows~~ (Merged ke #4)

**Status:** Masalah ini sudah terselesaikan bersamaan dengan fix #4.
Path Windows di-escape dengan: backslash → forward slash, colon → `\:`.

---

## 6. 🐛 Vite Proxy Timeout

**Gejala:** Request `/api/metadata` dari frontend sering timeout. Dari curl langsung ke backend (port 3001) bekerja.

**Penyebab:** Vite dev server proxy punya default timeout pendek. Request yt-dlp ke YouTube bisa makan waktu 8-15 detik.

**Fix:** (Belum diimplementasi — kalau muncul bisa tambah):
```js
// vite.config.js
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    timeout: 30000, // 30 detik
  }
}
```

---

## 7. 🐛 EADDRINUSE: Port Conflict

**Error:**
```
Error: listen EADDRINUSE: address already in use :::3001
```

**Penyebab:** Server sebelumnya belum dimatikan dengan benar.

**Fix:** Force kill semua node process sebelum restart:
```bash
taskkill -f -im node.exe
```

**Note:** Ini bukan bug kode — masalah operasional.

---

## Ringkasan

| # | Error | Kategori | Status |
|---|-------|----------|--------|
| 1 | Python path hardcoded macOS | Platform compatibility | ✅ Fixed |
| 2 | FFmpeg binary not found | Platform compatibility | ✅ Fixed |
| 3 | Video duration limit | Configuration | ✅ Fixed |
| 4 | Special chars in drawtext (quotes, backslash, colon) | FFmpeg filter escaping | ✅ Fixed |
| 5 | (Merged with #4 — Windows path escaping) | — | ✅ |
| 6 | Vite proxy timeout | Development | 📝 On demand |
| 7 | EADDRINUSE port conflict | Operational | ✅ Workaround |
