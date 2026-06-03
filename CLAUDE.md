# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive animated map showing the Ukraine frontline evolution over time. Built for Wyborcza.pl. Pure vanilla HTML/CSS/JS with Leaflet.js — no build system, no package manager, no tests.

## Running Locally

Requires a local HTTP server (fetch won't work from `file://`):
```bash
python -m http.server 8000
# or: npx http-server
```

The `geojson/` directory (including `frames.json`) is **gitignored** — a fresh checkout has no data and the app will show "Nie znaleziono plików geojson." Run a download script (below) before serving.

## Data Pipeline

GeoJSON frontline data comes from `cyterat/deepstate-map-data` on GitHub. Two equivalent download scripts exist:

```bash
python download_data.py   # preferred — Python version
bash download_data.sh     # bash alternative (macOS/Linux)
```

Both scripts:
1. Fetch the GitHub repo tree (`data/deepstatemap_data_YYYYMMDD.geojson`) to discover available files
2. Download any **missing** files to `geojson/` (existing files are skipped — incremental)
3. Build `geojson/frames.json` from **Mondays only** (`weekday()==0`), then **always append the single latest available file** even if it's not a Monday, so the animation ends on the current state

`frames.json` is the manifest consumed by `script.js` — each entry has `{name, dateStr, url}`.

`update_frontline.sh` is the cron wrapper for server deployment at `/var/www/gw-ukraine-frontline/`. It `flock`s to prevent parallel runs, calls `python3 download_data.py`, logs to `/var/log/ukraine-frontline-update.log`, and on success writes a timestamp to `.last_successful_update`. Example crontab: `15 8 * * * /var/www/gw-ukraine-frontline/update_frontline.sh`.

`embed-wyborcza/index.html` is a standalone full-viewport `<iframe>` wrapper pointing at the production URL (`tomaszlebioda.com/gw-ukraine-frontline-animation/`), used to embed the map in the Wyborcza CMS.

## Architecture

- **index.html** — single page: Leaflet map, playback controls, loading overlay, inset minimap
- **script.js** — all application logic:
  - `initMap()` — main map + inset map + CartoDB Dark Matter tiles with 3 panes (countries z:200, polygons z:400, labels z:600)
  - `fetchFrameList()` → `preloadFrames()` → `playbackLoop()` using `requestAnimationFrame` at 70ms/frame (`FRAME_INTERVAL_MS`)
  - **Lazy loading**: GeoJSON is fetched on demand and cached in-place onto each `frameList` entry (`.geojson` / `.loading` fields). Initial 5 frames preload before playback; 3 frames are prefetched ahead each tick; if a frame isn't ready the loop waits rather than skipping
  - Date labels (`showDateLabel`) shown only when the frame's day is Monday (`getDay()===1`), so the appended non-Monday "latest" frame renders without a label
  - Auto-loops back to frame 0 when reaching the end
- **style.css** — dark theme (#141414), Wyborcza red (#dc1a21), Montserrat font, mobile-responsive at 768px breakpoint

## Key Conventions

- **Cache busting**: `index.html` loads `script.js?v=N` and `style.css?v=N` with **independent** version numbers (currently `script.js?v=10`, `style.css?v=8`). Bump the relevant file's number after changing it. The embed iframe URL carries its own `?v=` too.
- **Color scheme**: primary red `#dc1a21`, hover `#ff5555`, dark background `#141414`, borders `#333`
- **UI language**: Polish (button labels, error messages, loading text)
- **No external JS dependencies** beyond Leaflet 1.9.4 loaded from unpkg CDN
