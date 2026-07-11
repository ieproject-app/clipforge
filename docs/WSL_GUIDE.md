# Panduan Migrasi dan Setup WSL Ubuntu (ClipForge)

Panduan ini menjelaskan cara memindahkan, melakukan setup, dan menjalankan proyek ClipForge di dalam lingkungan **WSL (Windows Subsystem for Linux) Ubuntu** Anda.

---

## 🛠️ Langkah 1: Mempersiapkan Kode di WSL

Untuk performa baca-tulis file video yang maksimal dari FFmpeg dan Python, sangat disarankan untuk menaruh folder proyek di dalam **sistem file native Linux** (bukan di folder Windows `/mnt/c/...`).

1. Buka terminal WSL Ubuntu Anda.
2. Salin proyek dari direktori Windows ke folder home WSL Anda (misalnya ke `~/clipforge`):
   ```bash
   cp -r /mnt/c/Users/<your-username>/clipforge ~/clipforge
   cd ~/clipforge
   ```

---

## 📦 Langkah 2: Instalasi Kebutuhan Sistem (Ubuntu)

Jalankan perintah berikut di terminal WSL Ubuntu Anda untuk menginstal dependensi sistem (FFmpeg untuk pengolahan video, font standar untuk rendering watermark/takarir, dan Python3):

1. **Perbarui Package Manager**:
   ```bash
   sudo apt update
   ```
2. **Instal FFmpeg (Mesin Render Video)**:
   ```bash
   sudo apt install -y ffmpeg
   ```
3. **Instal Font Standar Linux** (agar tulisan watermark & subtitle ter-render sempurna):
   ```bash
   sudo apt install -y fonts-dejavu fonts-liberation
   ```
4. **Instal Python3 dan Pip**:
   ```bash
   sudo apt install -y python3 python3-pip python3-venv
   ```

---

## 🚀 Langkah 3: Instalasi Dependensi Proyek

### 1. Instalasi Node.js & npm di WSL
Disarankan menggunakan **NVM (Node Version Manager)** untuk menginstal Node.js di Ubuntu:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Muat ulang terminal WSL Anda, lalu instal Node.js:
nvm install 20
```

### 2. Pasang Paket NPM Proyek
Di dalam direktori `~/clipforge`, jalankan:
```bash
npm install
```

### 3. Instal Whisper AI (Speech-to-Text) di Python WSL
Pasang paket OpenAI Whisper secara lokal di WSL Ubuntu Anda:
```bash
pip3 install openai-whisper
```

---

## 💻 Langkah 4: Menjalankan Aplikasi

Buka dua tab terminal/jendela di WSL Ubuntu Anda dan jalankan perintah berikut:

* **Terminal 1 (Backend Express)**:
  ```bash
  npm run server
  ```
  *(Berjalan pada http://localhost:3001)*

* **Terminal 2 (Frontend Vite Studio)**:
  ```bash
  npm run dev
  ```
  *(Berjalan pada http://localhost:5173)*

Buka browser Windows Anda dan akses **`http://localhost:5173`**. Koneksi localhost dari Windows ke WSL Ubuntu Anda akan tersambung secara otomatis!

---

## 💡 Catatan Penting Penggunaan di WSL

1. **Kompatibilitas Tombol "Browse..."**:
   * Tombol **`Browse...`** pada panel folder tujuan ekspor menggunakan dialog native Windows Forms. Di dalam WSL Ubuntu yang bersifat tanpa visual desktop (*headless*), tombol ini tidak akan memunculkan dialog pop-up folder.
   * **Solusi**: Cukup ketik alamat path folder tujuan secara manual di kotak teks.
     * Contoh folder di dalam WSL: `/home/username/ShortsOutput`
     * Contoh folder di dalam Windows: `/mnt/c/ShortsOutput` (otomatis tersimpan ke `C:\ShortsOutput`)

2. **Adaptasi Kode Otomatis**:
   * Logika deteksi platform aplikasi (`platform.js`) akan mendeteksi sistem operasi Linux secara dinamis.
   * Aplikasi otomatis mengganti pemanggilan interpreter perintah ke `python3` dan mencari font standar Linux `/usr/share/fonts/truetype/` tanpa memerlukan konfigurasi manual dari Anda.
