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
    const initialZoom = isMobile ? 5.5 : 6.5;
    // Aby przesunąć mapę "w lewo" na ekranie, musimy przesunąć "środek kamery" w prawo (na wschód)
    const initialCenter = isMobile ? [47.84, 35.90] : [47.84, 35.14];

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
