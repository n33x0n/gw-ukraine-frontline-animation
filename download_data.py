import os
import sys
import urllib.request
import urllib.error
import json
import re
import time
from datetime import datetime

os.chdir(os.path.dirname(os.path.abspath(__file__)))
dest_dir = "geojson"
os.makedirs(dest_dir, exist_ok=True)

# Fetch metadata from GitHub with retry logic
METADATA_URL = 'https://api.github.com/repos/cyterat/deepstate-map-data/git/trees/main?recursive=1'
MAX_RETRIES = 3
RETRY_DELAY_S = 30

tree_data = None
for attempt in range(1, MAX_RETRIES + 1):
    try:
        print(f"Fetching metadata from GitHub (attempt {attempt}/{MAX_RETRIES})...")
        req = urllib.request.Request(METADATA_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            tree_data = json.loads(response.read().decode())
        break
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f"Attempt {attempt} failed: {e}")
        if attempt < MAX_RETRIES:
            print(f"Retrying in {RETRY_DELAY_S}s...")
            time.sleep(RETRY_DELAY_S)

if tree_data is None:
    print("ERROR: Could not fetch metadata from GitHub after all retries.")
    sys.exit(1)

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
                urllib.request.urlretrieve(url, local_file)
            except Exception as e:
                print(f"Failed to download {filename}: {e}")
                continue

        dt = datetime.strptime(date_str, "%Y-%m-%d")
        if dt.weekday() == 0:  # 0 is Monday
            frames.append({
                "name": filename,
                "dateStr": date_str,
                "url": f"./geojson/{filename}"
            })

# Always include the latest available file so the animation ends with current state
if paths:
    latest_path = paths[-1]
    latest_filename = os.path.basename(latest_path)
    latest_match = re.match(r'deepstatemap_data_(\d{4})(\d{2})(\d{2})\.geojson', latest_filename)
    if latest_match:
        latest_date_str = f"{latest_match.group(1)}-{latest_match.group(2)}-{latest_match.group(3)}"
        if not frames or frames[-1]["dateStr"] != latest_date_str:
            latest_local = os.path.join(dest_dir, latest_filename)
            if os.path.exists(latest_local):
                frames.append({
                    "name": latest_filename,
                    "dateStr": latest_date_str,
                    "url": f"./geojson/{latest_filename}"
                })

with open(os.path.join(dest_dir, "frames.json"), "w") as f:
    json.dump(frames, f, indent=2)

print(f"Done! frames.json has {len(frames)} entries, last: {frames[-1]['dateStr'] if frames else 'none'}")
