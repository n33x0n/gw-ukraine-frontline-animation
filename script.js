// Configuration
const FRAME_INTERVAL_MS = 70        // Time each frame represents (ms) (2x faster again)
// To show date approx every 7 "real life" seconds during animation (~co tydzień in data)
// We show data on Mondays. So we don't strictly need intervals, we just display when day === 1.
const DATE_LABEL_DURATION_MS = 700; // Label duration also halved to not overlap too much

// State
let frameList = []; // { dateStr, url, geojson: null | loading | object }
let currentFrameIdx = 0;
let playing = false;
let lastFrameTime = performance.now();
let rafId = null;
let map;
let frontLayer = null;
let dateTimeout = null;

// Elements
const elPlay = document.getElementById('btn-play');
const elPause = document.getElementById('btn-pause');
const elReset = document.getElementById('btn-reset');
const elProgress = document.getElementById('progress-bar');
const elDate = document.getElementById('date-label');
const elLoading = document.getElementById('loading');
const elLoadingText = document.getElementById('loading-text');
const elErrorMsg = document.getElementById('error-msg');
const elSpinner = document.getElementById('spinner');
const elSearchPanel = document.getElementById('search-panel');
const elSearchInput = document.getElementById('search-input');
const elSearchResults = document.getElementById('search-results');
const elBtnCopyEmbed = document.getElementById('btn-copy-embed');
const elCopyStatus = document.getElementById('copy-status');

// ---- Tryb edycji + stan URL (deep-link / embed) -------------------------

const urlParams = new URLSearchParams(window.location.search);
const EDIT_MODE = urlParams.get('edit') === '1';
const TOWN_ZOOM = 11; // domyślne przybliżenie po wyborze miejscowości

// Czyta lat/lng/zoom z URL. Zwraca {center:[lat,lng], zoom} albo null.
function parseLocationFromUrl() {
    const lat = parseFloat(urlParams.get('lat'));
    const lng = parseFloat(urlParams.get('lng'));
    const zoom = parseFloat(urlParams.get('zoom'));
    if (![lat, lng, zoom].every(Number.isFinite)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (zoom < 0 || zoom > 20) return null;
    return { center: [lat, lng], zoom };
}

// Zoom bywa ułamkowy (domyślne 5.5 / 6.5). Całkowite zapisujemy bez kropki.
function formatZoom(z) {
    return Number.isInteger(z) ? String(z) : z.toFixed(1);
}

// Zapisuje bieżący widok do paska adresu (tylko w trybie edycji).
function writeLocationToUrl() {
    if (!EDIT_MODE) return; // czyste embedy nie nadpisują swojego URL
    const c = map.getCenter();
    const p = new URLSearchParams(window.location.search);
    p.set('edit', '1');
    p.set('lat', c.lat.toFixed(5));
    p.set('lng', c.lng.toFixed(5));
    p.set('zoom', formatZoom(map.getZoom()));
    history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
}

async function init() {
    initMap();
    await fetchFrameList();
    if (frameList.length > 0) {
        elLoadingText.innerText = "Buforowanie klatek...";
        await preloadFrames(0, 5); // Preload initial frames to start playing smoothly
        renderFrame(0);
        elLoading.style.display = 'none';
        startPlayback();
    } else {
        showError("Błąd: Nie znaleziono plików geojson.");
    }
}

function initMap() {
    const isMobile = window.innerWidth < 768;
    let initialZoom = isMobile ? 5.5 : 6.5;
    // Aby przesunąć mapę "w lewo" na ekranie, musimy przesunąć "środek kamery" w prawo (na wschód)
    let initialCenter = isMobile ? [47.84, 35.90] : [47.84, 35.14];

    // Deep-link: jeśli URL ma prawidłowe lat/lng/zoom, nadpisz domyślny widok.
    const urlLoc = parseLocationFromUrl();
    if (urlLoc) {
        initialCenter = urlLoc.center;
        initialZoom = urlLoc.zoom;
    }

    map = L.map('map', {
        center: initialCenter,
        zoom: initialZoom,
        scrollWheelZoom: false, // matches mapagw styles behavior
        zoomControl: false,
        gestureHandling: true // if we added the plugin, else it does nothing
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    // Map panes for proper z-index
    map.createPane('countries');
    map.getPane('countries').style.zIndex = 200;

    map.createPane('polygons');
    map.getPane('polygons').style.zIndex = 400;

    map.createPane('labels');
    map.getPane('labels').style.zIndex = 600;
    map.getPane('labels').style.pointerEvents = 'none';

    // Base layer: CartoDB Dark Matter without labels (matches dark #141414 background)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        pane: 'countries',
        attribution: '&copy; <a href="mailto:tomasz.lebioda@wyborcza.pl">Tomasz Lebioda</a> / <a href="https://wyborcza.pl">Wyborcza.pl</a> | &copy; OpenStreetMap, CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Labels layer: light only labels (English default by CARTO)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        pane: 'labels',
        attribution: '',
        className: 'polskie-napisy'
    }).addTo(map);

    // Inset Map Init
    const insetMap = L.map('inset-map', {
        center: [49.0, 31.0], // Środek Ukrainy
        zoom: isMobile ? 2 : 3, // Dopasowane przybliżenie, by pokazać głownie Europę i Ukrainę w rogu
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
    });

    // Base layer for inset
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 10
    }).addTo(insetMap);

    // Viewport Rectangle on inset map
    let viewportRect = null;

    function updateInsetMap() {
        const bounds = map.getBounds();
        if (viewportRect) {
            viewportRect.setBounds(bounds);
        } else {
            viewportRect = L.rectangle(bounds, {
                color: "#dc1a21",
                weight: 1,
                fillOpacity: 0.1
            }).addTo(insetMap);
        }
    }

    map.on('move', updateInsetMap);
    map.on('zoom', updateInsetMap);
    map.whenReady(updateInsetMap);

    if (EDIT_MODE) {
        // moveend/zoomend (nie move/zoom), by nie zalewać history.replaceState
        map.on('moveend', writeLocationToUrl);
        map.on('zoomend', writeLocationToUrl);
        map.whenReady(writeLocationToUrl); // zapisz widok startowy
        initSearchUi();
    }

    // Progress Bar Click Event
    const elProgressContainer = document.getElementById('progress-container');
    elProgressContainer.addEventListener('click', (e) => {
        if (frameList.length === 0) return;
        const rect = elProgressContainer.getBoundingClientRect();
        let clickX = e.clientX - rect.left;
        if (clickX < 0) clickX = 0;
        if (clickX > rect.width) clickX = rect.width;

        const percentage = clickX / rect.width;
        const newIdx = Math.floor(percentage * (frameList.length - 1));

        currentFrameIdx = newIdx;
        renderFrame(newIdx);
        preloadFrames(newIdx, 5);
    });

    // Controls events
    elPlay.addEventListener('click', startPlayback);
    elPause.addEventListener('click', pausePlayback);
    elReset.addEventListener('click', resetPlayback);
}

// ---- Wyszukiwarka Nominatim + generator embed (tylko tryb edycji) -------

let searchDebounce = null;
let lastQueryTime = 0;
let copyStatusTimeout = null;

function initSearchUi() {
    elSearchPanel.hidden = false;
    elSearchPanel.classList.add('edit-visible');

    elSearchInput.addEventListener('input', () => {
        const q = elSearchInput.value.trim();
        clearTimeout(searchDebounce);
        if (q.length < 3) {
            elSearchResults.innerHTML = '';
            return;
        }
        searchDebounce = setTimeout(() => runSearch(q), 400);
    });

    // Zamknij listę po kliknięciu poza panelem.
    document.addEventListener('click', (e) => {
        if (!elSearchPanel.contains(e.target)) {
            elSearchResults.innerHTML = '';
        }
    });

    elBtnCopyEmbed.addEventListener('click', copyEmbedCode);
}

function setResultsState(text) {
    elSearchResults.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'state';
    li.textContent = text;
    elSearchResults.appendChild(li);
}

async function runSearch(q) {
    // Polityka Nominatim: maks. ~1 zapytanie/s.
    const now = Date.now();
    if (now - lastQueryTime < 1000) {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => runSearch(q), 1000 - (now - lastQueryTime));
        return;
    }
    lastQueryTime = now;

    setResultsState('Szukam…');
    const url = 'https://nominatim.openstreetmap.org/search'
        + '?format=jsonv2&countrycodes=ua&accept-language=pl&limit=5'
        + '&q=' + encodeURIComponent(q);

    try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderResults(data);
    } catch (err) {
        console.error('Błąd wyszukiwania:', err);
        setResultsState('Błąd wyszukiwania. Spróbuj ponownie.');
    }
}

function renderResults(items) {
    elSearchResults.innerHTML = '';
    if (!items || items.length === 0) {
        setResultsState('Brak wyników.');
        return;
    }
    items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item.display_name;
        li.addEventListener('click', () => selectResult(item));
        elSearchResults.appendChild(li);
    });
}

function selectResult(item) {
    elSearchResults.innerHTML = '';
    elSearchInput.value = item.display_name.split(',')[0];
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    // Stały zoom miasteczka — przewidywalny widok; autor doprecyzuje przyciskami +/-.
    map.flyTo([lat, lng], TOWN_ZOOM, { duration: 1.2 });
    // writeLocationToUrl() odpali się na zdarzeniu moveend/zoomend.
}

function copyEmbedCode() {
    const c = map.getCenter();
    const params = new URLSearchParams();
    params.set('lat', c.lat.toFixed(5));
    params.set('lng', c.lng.toFixed(5));
    params.set('zoom', formatZoom(map.getZoom()));
    // Świadomie NIE dodajemy edit=1 — embed ma być "czysty".

    const src = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    const snippet =
        `<iframe src="${src}" width="100%" height="600" style="border:0" `
        + `allowfullscreen title="Ukraina – linia frontu"></iframe>`;

    navigator.clipboard.writeText(snippet)
        .then(() => showCopyStatus('Skopiowano!'))
        .catch(() => {
            // Awaryjnie (brak secure context): pokaż kod do ręcznego skopiowania.
            elSearchInput.value = snippet;
            elSearchInput.select();
            showCopyStatus('Skopiuj ręcznie (Ctrl+C)');
        });
}

function showCopyStatus(msg) {
    elCopyStatus.textContent = msg;
    clearTimeout(copyStatusTimeout);
    copyStatusTimeout = setTimeout(() => { elCopyStatus.textContent = ''; }, 2500);
}

async function fetchFrameList() {
    try {
        const res = await fetch(`./geojson/frames.json?t=${Date.now()}`);
        if (!res.ok) {
            throw new Error(`Błąd: ${res.status} ${res.statusText}`);
        }
        frameList = await res.json();
    } catch (err) {
        console.error(err);
        showError("Nie udało się pobrać lokalnej listy klatek. Czy uruchomiłeś skrypt pobierający (download_data.py)?");
    }
}

async function preloadFrames(startIdx, count) {
    let promises = [];
    for (let i = startIdx; i < startIdx + count; i++) {
        if (i >= frameList.length) break;
        const frame = frameList[i];
        if (!frame.geojson && !frame.loading) {
            frame.loading = true;
            promises.push(
                fetch(frame.url).then(r => r.json()).then(data => {
                    frame.geojson = data;
                    frame.loading = false;
                }).catch(err => {
                    console.error('Błąd ładowania pliku:', frame.url, err);
                    frame.loading = false;
                })
            );
        }
    }
    await Promise.all(promises);
}

function renderFrame(idx) {
    if (idx >= frameList.length) return false;
    const frame = frameList[idx];

    if (!frame.geojson) {
        return false; // Not ready yet
    }

    currentFrameIdx = idx;

    if (frontLayer) {
        map.removeLayer(frontLayer);
    }

    frontLayer = L.geoJSON(frame.geojson, {
        pane: 'polygons',
        style: {
            fillColor: '#dc1a21',
            fillOpacity: 0.55,
            color: '#ff5555',
            weight: 1.5,
            opacity: 0.9
        }
    }).addTo(map);

    // Update Progress Bar
    const progress = (idx / (frameList.length - 1)) * 100;
    elProgress.style.width = `${progress}%`;

    // Check if we show Date (e.g. Mondays)
    if (frame.dateStr !== "Unknown") {
        const dDate = new Date(frame.dateStr);
        if (dDate.getDay() === 1) { // 1 = Monday
            showDateLabel(frame.dateStr);
        }
    }

    return true;
}

function showDateLabel(dateStr) {
    elDate.innerText = dateStr;
    elDate.classList.add('visible');

    clearTimeout(dateTimeout);
    dateTimeout = setTimeout(() => {
        elDate.classList.remove('visible');
    }, DATE_LABEL_DURATION_MS);
}

function playbackLoop(timestamp) {
    if (!playing) return;

    const delta = timestamp - lastFrameTime;
    if (delta >= FRAME_INTERVAL_MS) {
        let nextIdx = currentFrameIdx + 1;

        if (nextIdx >= frameList.length) {
            // Auto loop to beginning
            nextIdx = 0;
        }

        const success = renderFrame(nextIdx);
        if (success) {
            // To avoid fast-forward catching up if we lagged, use timestamp
            lastFrameTime = timestamp;
            // Preload ahead (next 3 frames)
            preloadFrames(nextIdx + 1, 3);
        } else {
            // Frame not loaded, keep trying next raf (effectively waiting)
            preloadFrames(nextIdx, 1);
        }
    }

    rafId = requestAnimationFrame(playbackLoop);
}

function startPlayback() {
    if (currentFrameIdx >= frameList.length - 1) {
        // Restart if at end
        currentFrameIdx = 0;
        renderFrame(0);
    }
    playing = true;
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(playbackLoop);
    elPlay.style.display = 'none';
    elPause.style.display = 'inline-flex';
}

function pausePlayback() {
    playing = false;
    cancelAnimationFrame(rafId);
    elPlay.style.display = 'inline-flex';
    elPause.style.display = 'none';
}

function resetPlayback() {
    pausePlayback();
    currentFrameIdx = 0;
    renderFrame(0);
    startPlayback();
}

function showError(msg) {
    elSpinner.style.display = 'none';
    elLoadingText.style.display = 'none';
    elErrorMsg.style.display = 'block';
    elErrorMsg.innerText = msg;
}

// Init on load
window.addEventListener('DOMContentLoaded', init);
