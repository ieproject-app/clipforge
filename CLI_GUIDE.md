# Panduan ClipForge Terminal CLI 🚀

Dokumentasi ini menjelaskan cara menggunakan ClipForge secara langsung dari terminal (Command Prompt, PowerShell, atau WSL) tanpa harus menggunakan UI browser. Ini sangat cocok jika Anda ingin menghemat penggunaan RAM/CPU dan memproses video dalam jumlah banyak secara otomatis.

---

## 1. Prasyarat Sistem
Pastikan Anda sudah berada di dalam folder proyek (`C:\Users\akses\ZCodeProject\clipforge`) dan dependensi Node.js + Python sudah terinstal.

---

## 2. Cara Menjalankan CLI

Gunakan perintah `node cli.js` dengan format berikut:

```bash
node cli.js <YOUTUBE_URL> <PATH_TO_JSON_SEGMENTS> [EXPORT_DIR]
```

### Parameter:
1. **`<YOUTUBE_URL>`**: URL video YouTube panjang yang ingin Anda potong.
2. **`<PATH_TO_JSON_SEGMENTS>`**: Alamat path (lokasi) file JSON yang berisi durasi potongan segmen.
3. **`[EXPORT_DIR]`** *(Opsional)*: Folder penyimpanan hasil ekspor video pendek. Jika dikosongkan, otomatis akan menyimpan ke `"D:\YT Shorts"`.

---

## 3. Format File JSON Segmen (`segments.json`)

File JSON yang Anda masukkan harus berisi daftar segmen dalam format array objek. Masing-masing objek memiliki atribut `start` (detik mulai), `end` (detik selesai), dan `title` (judul klip).

### Contoh Format `segments.json`:
```json
[
  {
    "start": 60,
    "end": 115,
    "title": "Pembahasan Penting Sabar"
  },
  {
    "start": 180,
    "end": 235,
    "title": "Tips Bersyukur Tiap Hari"
  }
]
```

*Catatan: Durasi setiap segmen direkomendasikan di bawah 60 detik untuk format YouTube Shorts.*

---

## 4. Contoh Pemanggilan Praktis

Berikut adalah contoh cara memanggilnya dari Terminal Windows 11:

```powershell
# 1. Masuk ke folder proyek
cd C:\Users\akses\ZCodeProject\clipforge

# 2. Jalankan CLI dengan file JSON segmen Anda
node cli.js "https://www.youtube.com/watch?v=VIDEO_ID" "C:\Users\akses\Desktop\segments.json"
```

Jika ingin mengekspor ke folder khusus selain default `D:\YT Shorts`:
```powershell
node cli.js "https://www.youtube.com/watch?v=VIDEO_ID" "C:\Users\akses\Desktop\segments.json" "D:\YT Shorts\Folder Khusus"
```

---

## 5. Keunggulan & Default Pengaturan CLI
Perintah CLI ini sudah dikonfigurasi secara otomatis menggunakan optimasi terbaik yang Anda minta:
*   **Copyright Bypass**: Otomatis Aktif (`true`) - Mempercepat audio 1.03x, membalik video secara horizontal (*hflip*), serta meningkatkan kontras & saturasi secara dinamis untuk menghindari deteksi hak cipta.
*   **Burn-In Auto-Captions**: Otomatis Aktif (`true`) - Menganalisis audio dengan Whisper AI dan membakar subtitle teks kuning bergaris tepi hitam langsung ke tengah bawah video.
*   **Vertical Blurred Background**: Otomatis Aktif - Video lanskap asli akan disematkan di tengah dengan latar belakang video yang sama namun diperbesar dan diburamkan (*blurred*).
*   **Kualitas Video**: Otomatis memilih kualitas terbaik (`best`).
*   **Posisi Watermark Baru**: Berada di area tengah bawah layar (tepat di bawah batas area video 16:9 vertical frame, koordinat `y=1280`), tidak lagi menumpuk di dasar layar paling bawah.
*   **Penyimpanan Default**: Disimpan langsung ke folder `"D:\YT Shorts"` lengkap dengan file `.txt` metadata deskripsinya.

---

## 6. Alternatif Flow Otomatisasi (Batch Scripting)

Jika Anda memiliki daftar banyak video beserta file JSON-nya, Anda bisa membuat file batch script (.bat) di Windows agar berjalan bergantian secara otomatis:

Buat file bernama `run_shorts.bat` di folder proyek Anda:
```bat
@echo off
echo Memulai batch processing...
node cli.js "https://www.youtube.com/watch?v=Video1" "C:\path\to\segmen1.json"
node cli.js "https://www.youtube.com/watch?v=Video2" "C:\path\to\segmen2.json"
echo Selesai memproses seluruh video!
pause
```

Cukup klik dua kali file `.bat` tersebut, dan biarkan terminal memproses semuanya hingga selesai di latar belakang!
