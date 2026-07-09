import subprocess
import json
import sys

# Menggunakan URL channel yang terverifikasi dan berfungsi
channel_url = "https://www.youtube.com/adihidayatofficial/videos"
command = [
    sys.executable,
    "-m",
    "yt_dlp",
    "--flat-playlist",
    "--playlist-end", "120",  # Mengambil sedikit lebih dari 100 untuk mengantisipasi jika ada shorts yang difilter, agar target 100 video panjang tercapai
    "--match-filter", "duration > 60",
    "-J",
    channel_url
]

print("Menjalankan ekstraksi dengan command:", " ".join(command))

try:
    result = subprocess.run(command, capture_output=True, text=True, check=True, encoding="utf-8")
    data = json.loads(result.stdout)
    
    entries = data.get('entries', [])
    # Saring hanya yang valid dan batasi maksimal 100 video
    valid_entries = [e for e in entries if e and e.get('id') and len(e['id']) == 11][:100]
    
    with open("link_uah_100_akurat.txt", "w", encoding="utf-8") as f:
        f.write("=== 100 LINK VIDEO REALS USTADZ ADI HIDAYAT ===\n\n")
        for idx, entry in enumerate(valid_entries, 1):
            video_url = f"https://www.youtube.com/watch?v={entry['id']}"
            title = entry.get('title', 'Kajian UAH')
            f.write(f"{idx}. {title}\n   {video_url}\n\n")
            
    print(f"BERHASIL: File 'link_uah_100_akurat.txt' siap dengan {len(valid_entries)} video.")
except Exception as e:
    print(f"EROR: {e}")
    if 'result' in locals() and result.stderr:
        print("Detail Eror Stderr:", result.stderr)
