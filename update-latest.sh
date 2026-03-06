#!/bin/bash
DATE=$(date +%Y%m%d)
URL="https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_${DATE}.geojson"
DEST="/var/www/gw-ukraine-frontline/geojson/latest.geojson"

curl -sf "$URL" -o "$DEST" || echo "$(date): BŁĄD – plik $DATE nie istnieje w repozytorium GitHub" >> /var/log/ukraine-front.log
