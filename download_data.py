import os
import urllib.request
import json
import re
from datetime import datetime

os.chdir(os.path.dirname(os.path.abspath(__file__)))
dest_dir = "geojson"
os.makedirs(dest_dir, exist_ok=True)

print("Fetching metadata from GitHub...")
req = urllib.request.Request(
    'https://api.github.com/repos/cyterat/deepstate-map-data/git/trees/main?recursive=1',
    headers={'User-Agent': 'Mozilla/5.0'}
)

with urllib.request.urlopen(req) as response:
    tree_data = json.loads(response.read().decode())

paths = [item['path'] for item in tree_data.get('tree', []) 
         if item['path'].startswith('data/deepstatemap_data_') and item['path'].endswith('.geojson')]
paths.sort()

frames = []
for p in paths:
    filename = os.path.basename(p)
    match = re.match(r'deepstatemap_data_(\d{4})(\d{2})(\d{2})\.geojson', filename)
    if match:
        date_str = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        local_file = os.path.join(dest_dir, filename)
        
        if not os.path.exists(local_file):
            print(f"Downloading {filename}...")
            url = f"https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/{p}"
            try:
                # Dodano timeout aby uniknąć zawieszeń
                urllib.request.urlretrieve(url, local_file)
            except Exception as e:
                print(f"Failed to download {filename}: {e}")
                continue
            
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        if dt.weekday() == 0:  # 0 is Monday in Python
            frames.append({
                "name": filename,
                "dateStr": date_str,
                "url": f"./geojson/{filename}"
            })

if not frames and paths:
    print("No Mondays found, using the latest file...")
    filename = os.path.basename(paths[-1])
    match = re.match(r'deepstatemap_data_(\d{4})(\d{2})(\d{2})\.geojson', filename)
    if match:
        date_str = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        frames.append({
            "name": filename,
            "dateStr": date_str,
            "url": f"./geojson/{filename}"
        })

with open(os.path.join(dest_dir, "frames.json"), "w") as f:
    json.dump(frames, f, indent=2)

print("Done generating frames.json!")
