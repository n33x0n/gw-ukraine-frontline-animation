#!/bin/bash
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:$PATH

# Zmień katalog na ten w którym znajduje się skrypt
cd "$(dirname "$0")"

# Katalog docelowy na geojson
DEST_DIR="geojson"
mkdir -p "$DEST_DIR"

echo "Pobieram metadane z repozytorium GitHub..."
# Pobierz listę plików uzywając API drzewa git (bez omijania limitu, ale dużo wydajniej)
TREE_URL="https://api.github.com/repos/cyterat/deepstate-map-data/git/trees/main?recursive=1"

# Pobieranie listy
FILES_JSON=$(curl -s "$TREE_URL")

# Wyciągnięcie odpowiednich tras plików (tylko /data/deepstatemap_data_*.geojson)
FILE_PATHS=$(echo "$FILES_JSON" | grep -o 'data/deepstatemap_data_[0-9]*\.geojson')

if [ -z "$FILE_PATHS" ]; then
    echo "Błąd: nie znaleziono plików geojson w repozytorium."
    exit 1
fi

echo "Przetwarzam pliki..."

# Tablica na obiekty do pliku frames.json
declare -a FRAMES

# Sortujemy alfabetycznie/chronologicznie
SORTED_PATHS=$(echo "$FILE_PATHS" | sort)

# Dla każdego pliku
for PATH in $SORTED_PATHS; do
    FILENAME=$(basename "$PATH")
    
    # Wyciągamy datę z pliku
    if [[ $FILENAME =~ deepstatemap_data_([0-9]{4})([0-9]{2})([0-9]{2})\.geojson ]]; then
        DATE_STR="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
        
        # Opcjonalnie: pobieranie jeśli plik nie istnieje lokalnie
        LOCAL_FILE="$DEST_DIR/$FILENAME"
        if [ ! -f "$LOCAL_FILE" ]; then
            echo "Pobieram $FILENAME..."
            curl -s "https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/$PATH" -o "$LOCAL_FILE"
        fi
        
        # Filtrowanie co tydzień (Poniedziałki)
        DAY_OF_WEEK=$(date -j -f "%Y-%m-%d" "$DATE_STR" "+%w" 2>/dev/null || date -d "$DATE_STR" "+%w" 2>/dev/null)
        
        # Ponieważ to jest budowanie na macOS(BSD date) a czasami Linux, obsuwamy na 1 (Poniedziałek)
        if [ "$DAY_OF_WEEK" = "1" ]; then
            FRAMES+=("{\"name\":\"$FILENAME\", \"dateStr\":\"$DATE_STR\", \"url\":\"./geojson/$FILENAME\"}")
        fi
    fi
done

# Jeżeli mamy pustą listę (np brak poniedziałków), dodaj choć jeden element (ostatni)
if [ ${#FRAMES[@]} -eq 0 ]; then
    echo "Nie znaleziono poniedziałków, używam po prostu ostatniego pliku."
    LAST_FILE=$(echo "$SORTED_PATHS" | tail -n 1)
    FILENAME=$(basename "$LAST_FILE")
    if [[ $FILENAME =~ deepstatemap_data_([0-9]{4})([0-9]{2})([0-9]{2})\.geojson ]]; then
        DATE_STR="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
        FRAMES+=("{\"name\":\"$FILENAME\", \"dateStr\":\"$DATE_STR\", \"url\":\"./geojson/$FILENAME\"}")
    fi
fi

echo "Generuje frames.json..."

# Budowanie tablicy JSON
JSON_OUTPUT="["
for (( i=0; i<${#FRAMES[@]}; i++ )); do
    JSON_OUTPUT="${JSON_OUTPUT}${FRAMES[$i]}"
    if [ $i -lt $((${#FRAMES[@]}-1)) ]; then
        JSON_OUTPUT="${JSON_OUTPUT},"
    fi
done
JSON_OUTPUT="${JSON_OUTPUT}]"

# Zapisanie frames.json
echo "$JSON_OUTPUT" > "$DEST_DIR/frames.json"

echo "Gotowe! Lista klatek zapisana do $DEST_DIR/frames.json"
