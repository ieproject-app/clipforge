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

## 8. 🐛 FFmpeg subtitles filter: Quote vs drawtext Escape Rule Mismatch (Auto-Caption)

**Error:**
```
[AVFilterGraph] No option name near '/Users/.../subtitles.srt:force_style=FontSize=20'
[AVFilterGraph] Error parsing filterchain '[0:v]subtitles=filename='C\:/.../sub.srt':...'
Failed to set value '...filter.txt' for option 'filter_complex_script': Invalid argument
Error parsing global options: Invalid argument
Watermark or subtitle render failed, falling back to clean cut
```

**Gejala:** Auto-caption (Gemini → SRT → FFmpeg `subtitles=` filter) gagal 5+ percobaan. Clip berhasil dibuat tapi **tanpa caption dan tanpa watermark** — karena keduanya berada di filter chain yang sama, dan FFmpeg menolak seluruh `-filter_complex_script` saat filter `subtitles=` gagal parse. Fallback clean cut (tanpa filter) berhasil, sehingga clip tetap ada tapi polos.

**Penyebab Root Cause:**

FFmpeg filtergraph memiliki **dua aturan escaping yang berbeda** tergantung apakah value di-quote atau tidak:

| Konteks | Backslash | Colon escape yang bekerja |
|---------|-----------|---------------------------|
| **Unquoted** (`textfile=C\:/...`) | Escape char | `\\:` (double) — backslash melindungi colon |
| **Single-quoted** (`filename='C\:/...'`) | **Literal** | `\:` (single) — backslash literal, colon tetap mentah |

Filter `drawtext` di kode pakai **unquoted** (`textfile=C\:/...`) → `normalizeFontPath()` menghasilkan `C\:/` (double backslash) → **berhasil**.

Tapi filter `subtitles` di kode pakai **single-quoted** (`filename='C\:/...'`) dengan output `normalizeFontPath()` yang sama (`C\:/`) → di dalam single-quote, backslash bersifat **literal** → `\\:` tidak meng-escape colon → colon memecah parsing option FFmpeg → **gagal**.

Inilah "Core Mystery" di AUDIT_PROMPT.md: `drawtext` bekerja tapi `subtitles` + `drawtext` gagal, padahal keduanya pakai helper escaping yang sama. Bedanya hanya: `drawtext` unquoted, `subtitles` quoted.

**Konfirmasi Empiris (diagnostik langsung ke FFmpeg 7.1):**

| Bentuk `filename=` | Quote? | Hasil |
|--------------------|--------|-------|
| `filename='C\:/...'` (kode lama) | ✅ quoted | ❌ FAIL |
| `filename=C\:/...` (fix) | ❌ unquoted | ✅ SUCCESS |
| `filename='C\:/...'` (single backslash) | ✅ quoted | ✅ SUCCESS |

Diverifikasi end-to-end pada encoder **libx264 (CPU)** dan **h264_qsv (GPU)**.

**Fix:**

Buang single-quote di sekitar `filename=` di `filterHelpers.js`, pertahankan quote pada `force_style` (komanya butuh proteksi):

```js
// DARI (broken):
subtitles=filename='${safeSrtPath}':force_style='...'
// KE (fixed):
subtitles=filename=${safeSrtPath}:force_style='...'
```

Sekarang `filename` unquoted (konsisten dengan `drawtext=textfile=...`), dan `normalizeFontPath()` tetap menghasilkan `C\:/` yang valid untuk unquoted value.

**Pelajaran:**

1. FFmpeg filtergraph **bukan** aturan escaping tunggal. Quoted vs unquoted value punya perilaku backslash yang **berbeda** — helper escaping harus tahu konteks pemakaian.
2. Pesan error "truncated option name `filtet`" di log CLI adalah **artefak pemotongan tampilan progress bar**, bukan bug FFmpeg nyata. Error sebenarnya adalah "Failed to set value for option 'filter_complex_script': Invalid argument" karena isi script tidak bisa di-parse.
3. Filter `subtitles`, `ass`, dan `drawtext` **semuanya tersedia** di build imageio-ffmpeg (gyan.dev essentials, libass included) — bukan masalah filter hilang.
4. Test yang hanya cek `toContain("subtitles=")` **bisa lolos padahal broken** — assertion harus spesifik (e.g. `not.toMatch(/filename='/)` untuk menangkap quote mismatch).

**Files:** `server/services/filterHelpers.js`, `server/services/__tests__/filterHelpers.buildFilterScriptContent.test.js`, `server/services/__tests__/ffmpeg.integration.test.js`

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
| 8 | subtitles filter quote vs drawtext escape mismatch (auto-caption) | FFmpeg filter escaping | ✅ Fixed |
