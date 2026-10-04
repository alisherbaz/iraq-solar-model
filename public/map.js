// ══ Location tab: satellite map, place search, roof drawing ══════════════════
// Uses Leaflet (vendored) with Esri World Imagery tiles and OpenStreetMap Nominatim search.
// The drawn roof is part of the app state (S.roof); this module only edits it and
// displays it — app.js turns it into the model's roof area and orientation.
import { roofApplied, parseRoof, formatRoof, azimuthLabel, compassName } from './geo.js';

const $ = id => document.getElementById(id);
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LBL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export function createMapPanel({ getState, onPick, onRoofChange, toast }) {
  let map, pin, poly, line, drawing = false, pts = [], vertices = [];

  function ensureMap() {
    if (map) { map.invalidateSize(); return; }
    const s = getState();
    map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 21 }).setView([s.lat, s.lon], 17);
    L.tileLayer(ESRI_IMG, { maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.tileLayer(ESRI_LBL, { maxNativeZoom: 19, maxZoom: 21, opacity: 0.9 }).addTo(map);
    pin = L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#e85020', fillOpacity: 1 }).addTo(map);
    map.on('click', e => (drawing ? addPoint(e.latlng) : pick(e.latlng.lat, e.latlng.lng, 'map')));
    loadRoof(true);
  }

  function pick(lat, lon, how) {
    pin?.setLatLng([lat, lon]);
    onPick(lat, lon, how);
  }

  // External location changes (city preset, shared link) move the map
  function setView(lat, lon, zoom) {
    if (!map) return;
    pin.setLatLng([lat, lon]);
    map.setView([lat, lon], zoom ?? Math.max(map.getZoom(), 16));
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  function setButtons() {
    const has = pts.length >= 3 && !drawing;
    $('btn-draw').textContent = drawing ? '✏️ Drawing… tap corners' : (has ? '✏️ Redraw roof' : '✏️ Draw roof');
    $('btn-draw').classList.toggle('on', drawing);
    $('btn-undo').disabled = !drawing || pts.length === 0;
    $('btn-finish').disabled = !drawing || pts.length < 3;
    $('btn-clear').disabled = pts.length === 0;
  }

  const vertexIcon = first => L.divIcon({ className: 'vtx' + (first ? ' first' : ''), iconSize: [16, 16] });

  function addVertex(ll) {
    pts.push(ll);
    const i = pts.length - 1;
    const m = L.marker(ll, { icon: vertexIcon(drawing && i === 0), draggable: true, keyboard: false }).addTo(map);
    m.on('click', () => { if (drawing && i === 0 && pts.length >= 3) finish(); });
    m.on('drag', ev => { pts[i] = ev.target.getLatLng(); redraw(); });
    m.on('dragend', () => { if (!drawing) commit(false); });   // corner moved → update the model
    vertices.push(m);
  }

  function addPoint(ll) { addVertex(ll); redraw(); setButtons(); }

  function removeShape() {
    vertices.forEach(v => map.removeLayer(v));
    vertices = []; pts = [];
    redraw();
  }

  function redraw() {
    poly?.remove(); line?.remove(); poly = line = null;
    if (!map) return;
    if (pts.length >= 3 && !drawing) {
      poly = L.polygon(pts, { color: '#f5c842', weight: 2, fillColor: '#f5c842', fillOpacity: 0.25 }).addTo(map);
    } else if (pts.length >= 2) {
      line = L.polyline(drawing && pts.length >= 3 ? [...pts, pts[0]] : pts, { color: '#f5c842', weight: 2, dashArray: '5 4' }).addTo(map);
    }
  }

  function startDraw() {
    ensureMap();
    removeShape();
    drawing = true;
    map.doubleClickZoom.disable();
    $('map').classList.add('drawing');
    $('map-hint').textContent = 'Tap each corner of the roof in order. Tap the first corner (or Finish) to close the shape. Corners can be dragged afterwards.';
    setButtons();
  }

  function undo() {
    if (!pts.length) return;
    pts.pop();
    map.removeLayer(vertices.pop());
    redraw();
    setButtons();
  }

  function stopDrawing() {
    drawing = false;
    map?.doubleClickZoom.enable();
    $('map').classList.remove('drawing');
  }

  function finish() {
    if (pts.length < 3) return;
    stopDrawing();
    vertices[0]?.setIcon(vertexIcon(false));
    redraw();
    commit(true);
    const c = poly.getBounds().getCenter();
    pick(c.lat, c.lng, 'roof');
    $('map-hint').textContent = 'Roof measured and applied to the model. Drag corners to adjust, or choose flat/pitched below.';
    setButtons();
  }

  // Hand the outline to the app (which applies area + orientation to the model)
  function commit(announce) {
    onRoofChange({ roof: pts.length >= 3 ? formatRoof(pts) : '', announce });
  }

  function clearAll() {
    stopDrawing();
    removeShape();
    commit(false);
    $('map-hint').textContent = 'Tap the map to set the location, or press Draw roof and tap each corner of the roof.';
    setButtons();
  }

  // Draw the roof stored in the state (after reload / shared link / reset)
  function loadRoof(fit = false) {
    if (!map || drawing) return;
    const s = getState(), saved = parseRoof(s.roof);
    if (s.roof === (pts.length >= 3 ? formatRoof(pts) : '')) return;     // already showing it
    removeShape();
    if (saved) {
      saved.forEach(p => addVertex(L.latLng(p.lat, p.lng)));
      redraw();
      if (fit) map.fitBounds(poly.getBounds(), { maxZoom: 20, padding: [40, 40] });
    }
    setButtons();
  }

  // Roof result card — rendered from the state on every model update
  function renderCard(s, linked) {
    const saved = parseRoof(s.roof);
    $('roof-result').hidden = !saved;
    document.querySelectorAll('input[name="rooftype"]').forEach(r => { r.checked = r.value === s.roofType; });
    if (!saved) return;
    const a = roofApplied(saved, s), g = a.geom;
    $('flip-row').hidden = s.roofType !== 'pitched';
    $('rr-area').textContent = fmt(a.area, a.area < 100 ? 1 : 0);
    $('rr-plan').textContent = fmt(g.area, g.area < 100 ? 1 : 0);
    $('rr-perim').textContent = fmt(g.perimeter, 1);
    $('rr-edge').textContent = `${fmt(g.longest.length, 1)} m · ${compassName(g.longest.bearing)}–${compassName((g.longest.bearing + 180) % 360)}`;
    $('rr-facing').textContent = azimuthLabel(a.orient) + (s.roofType === 'flat' ? ' (racks)' : '');
    $('rr-status').textContent = linked ? 'applied to the model' : 'not applied: area or facing changed by hand';
    $('rr-status').classList.toggle('warn-text', !linked);
    $('btn-apply-roof').hidden = linked;
    $('rr-note').textContent = s.roofType === 'pitched'
      ? `Sloped area = plan area ÷ cos(${s.pitch}° tilt). Panels follow the roof slope. If the panels go on the other side of the ridge, use “Other side”.`
      : 'Flat roof: panels go on tilted racks facing the sun. Leave gaps between rows to avoid shading; 30–50% coverage is typical.';
  }

  // ── Search & geolocation ───────────────────────────────────────────────
  async function search(q) {
    const list = $('loc-results');
    list.hidden = false;
    list.innerHTML = '<li class="muted">Searching…</li>';
    try {
      const get = async extra => (await fetch(`${NOMINATIM}?format=jsonv2&limit=5${extra}&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } })).json();
      let res = await get('&countrycodes=iq');       // prefer Iraq
      if (!res.length) res = await get('');           // then anywhere
      if (!res.length) { list.innerHTML = '<li class="muted">No places found.</li>'; return; }
      list.innerHTML = '';
      res.forEach(r => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = r.display_name;            // textContent: never inject remote HTML
        b.addEventListener('click', () => {
          list.hidden = true;
          ensureMap();
          const lat = +r.lat, lon = +r.lon;
          map.setView([lat, lon], 18);
          pick(lat, lon, 'search');
        });
        li.appendChild(b);
        list.appendChild(li);
      });
    } catch {
      list.innerHTML = '<li class="muted">Search is unavailable right now. Tap the map instead.</li>';
    }
  }

  $('loc-search').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('loc-q').value.trim();
    if (q.length >= 2) search(q);
  });
  $('btn-geoloc').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser');
    navigator.geolocation.getCurrentPosition(
      p => { ensureMap(); map.setView([p.coords.latitude, p.coords.longitude], 19); pick(p.coords.latitude, p.coords.longitude, 'gps'); },
      () => toast('Could not get your location'), { enableHighAccuracy: true, timeout: 10000 });
  });
  $('btn-draw').addEventListener('click', () => (drawing ? null : startDraw()));
  $('btn-undo').addEventListener('click', undo);
  $('btn-finish').addEventListener('click', finish);
  $('btn-clear').addEventListener('click', clearAll);

  return {
    show: ensureMap,
    setView,
    loadRoof,
    renderCard,
    googleUrl: (lat, lon) => `https://www.google.com/maps/@${lat.toFixed(6)},${lon.toFixed(6)},19z/data=!3m1!1e3`,
  };
}
