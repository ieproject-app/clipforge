import subprocess
import json
import sys

channel_url = "https://www.youtube.com/adihidayatofficial/videos"
command = [
    sys.executable,
    "-m",
    "yt_dlp",
    "--flat-playlist",
    "-J",
    channel_url
]

print("Mengambil semua metadata video (~1,684 video) untuk menemukan yang terpopuler...")
try:
    result = subprocess.run(command, capture_output=True, text=True, check=True, encoding="utf-8")
    data = json.loads(result.stdout)
    entries = data.get('entries', [])
    
    # Filter video panjang (> 60s) dan valid
    valid_entries = []
    for e in entries:
        if e and e.get('id') and len(e['id']) == 11:
            duration = e.get('duration')
            view_count = e.get('view_count')
            if duration and duration > 60 and view_count is not None:
                valid_entries.append(e)
                
    # Urutkan berdasarkan views secara descending
    valid_entries.sort(key=lambda x: x.get('view_count', 0), reverse=True)
    
    print(f"Berhasil memfilter {len(valid_entries)} video panjang.")
    
    # Tulis top 100 ke file
    with open("link_uah_populer_100.txt", "w", encoding="utf-8") as f:
        f.write("=== 100 VIDEO PANJANG TERPOPULER USTADZ ADI HIDAYAT ===\n")
        f.write(f"Diurutkan berdasarkan jumlah views (Total video disaring: {len(valid_entries)})\n\n")
        for idx, entry in enumerate(valid_entries[:100], 1):
            video_url = f"https://www.youtube.com/watch?v={entry['id']}"
            title = entry.get('title', 'Kajian UAH')
            views = entry.get('view_count', 0)
            f.write(f"{idx}. {title}\n   Link: {video_url}\n   Views: {views:,} kali ditonton\n\n")
            
    print("BERHASIL: File 'link_uah_populer_100.txt' siap.")
    
    # Print 5 teratas untuk analisis
    print("\nTop 5 Video Terpopuler:")
    for idx, entry in enumerate(valid_entries[:5], 1):
        print(f"{idx}. {entry['title']} ({entry['view_count']:,} views)")
except Exception as e:
    print(f"EROR: {e}")
