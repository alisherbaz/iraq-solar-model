// ══ Location tab: satellite map, place search, roof drawing ══════════════════
// Uses Leaflet (vendored) with Esri World Imagery tiles and OpenStreetMap Nominatim search.
// All model updates go through the callbacks passed in from app.js.
import { roofGeometry, azimuthLabel, compassName, azimuthToBearing } from './geo.js';

const $ = id => document.getElementById(id);
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const ESRI_IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LBL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export function createMapPanel({ getState, onPick, onRoof, toast }) {
  let map, pin, poly, line, drawing = false, pts = [], vertices = [], geom = null, flipped = false;

  const roofType = () => document.querySelector('input[name="rooftype"]:checked').value;

  function ensureMap() {
    if (map) { map.invalidateSize(); return; }
    const { lat, lon } = getState();
    map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 21 }).setView([lat, lon], 17);
    L.tileLayer(ESRI_IMG, { maxNativeZoom: 19, maxZoom: 21,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.tileLayer(ESRI_LBL, { maxNativeZoom: 19, maxZoom: 21, opacity: 0.9 }).addTo(map);
    pin = L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#e85020', fillOpacity: 1 }).addTo(map);
    map.on('click', e => (drawing ? addPoint(e.latlng) : pick(e.latlng.lat, e.latlng.lng, 'map')));
  }

  function pick(lat, lon, how) {
    pin.setLatLng([lat, lon]);
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
    $('btn-draw').textContent = drawing ? '✏️ Drawing… tap corners' : (geom ? '✏️ Redraw roof' : '✏️ Draw roof');
    $('btn-draw').classList.toggle('on', drawing);
    $('btn-undo').disabled = !drawing || pts.length === 0;
    $('btn-finish').disabled = !drawing || pts.length < 3;
    $('btn-clear').disabled = pts.length === 0;
  }

  function startDraw() {
    ensureMap();
    clearShape();
    drawing = true;
    map.doubleClickZoom.disable();
    $('map').classList.add('drawing');
    $('map-hint').textContent = 'Tap each corner of the roof in order. Tap the first corner (or Finish) to close the shape. Corners can be dragged afterwards.';
    setButtons();
  }

  function vertexIcon(first) {
    return L.divIcon({ className: 'vtx' + (first ? ' first' : ''), iconSize: [16, 16] });
  }

  function addPoint(ll) {
    pts.push(ll);
    const i = pts.length - 1;
    const m = L.marker(ll, { icon: vertexIcon(i === 0), draggable: true, keyboard: false }).addTo(map);
    m.on('click', () => { if (drawing && i === 0 && pts.length >= 3) finish(); });
    m.on('drag', ev => { pts[i] = ev.target.getLatLng(); redraw(); if (!drawing) analyse(); });
    vertices.push(m);
    redraw();
    setButtons();
  }

  function undo() {
    if (!pts.length) return;
    pts.pop();
    map.removeLayer(vertices.pop());
    redraw();
    setButtons();
  }

  function redraw() {
    poly?.remove(); line?.remove(); poly = line = null;
    if (pts.length >= 3 && !drawing) {
      poly = L.polygon(pts, { color: '#f5c842', weight: 2, fillColor: '#f5c842', fillOpacity: 0.25 }).addTo(map);
    } else if (pts.length >= 2) {
      line = L.polyline(drawing && pts.length >= 3 ? [...pts, pts[0]] : pts, { color: '#f5c842', weight: 2, dashArray: '5 4' }).addTo(map);
    }
  }

  function finish() {
    if (pts.length < 3) return;
    drawing = false;
    map.doubleClickZoom.enable();
    $('map').classList.remove('drawing');
    vertices[0]?.setIcon(vertexIcon(false));
    flipped = false;
    redraw();
    analyse(true);
    const c = poly.getBounds().getCenter();
    pick(c.lat, c.lng, 'roof');
    $('map-hint').textContent = 'Roof measured and applied to the model. Drag corners to adjust, or choose flat/pitched below.';
    setButtons();
  }

  function clearShape() {
    vertices.forEach(v => map.removeLayer(v));
    vertices = []; pts = []; geom = null;
    redraw();
    $('roof-result').hidden = true;
    setButtons();
  }

  function clearAll() {
    drawing = false;
    map?.doubleClickZoom.enable();
    $('map').classList.remove('drawing');
    clearShape();
    $('map-hint').textContent = 'Tap the map to set the location, or press Draw roof and tap each corner of the roof.';
  }

  // ── Roof analysis → model ──────────────────────────────────────────────
  function analyse(announce = false) {
    if (pts.length < 3) return;
    const s = getState();
    geom = roofGeometry(pts.map(p => ({ lat: p.lat, lng: p.lng })), s.lat);
    const type = roofType();
    $('flip-row').hidden = type !== 'pitched';
    let area = geom.area, orient, facingText;
    if (type === 'pitched') {
      orient = flipped ? geom.altFacing : geom.facing;
      area = geom.area / Math.cos(s.pitch * Math.PI / 180); // drawn outline is the horizontal projection
      facingText = azimuthLabel(orient);
    } else {
      orient = s.lat >= 0 ? 0 : 180; // racks on a flat roof can face the equator
      facingText = `${azimuthLabel(orient)} (racks)`;
    }
    $('roof-result').hidden = false;
    $('rr-area').textContent = fmt(area, area < 100 ? 1 : 0);
    $('rr-plan').textContent = fmt(geom.area, geom.area < 100 ? 1 : 0);
    $('rr-perim').textContent = fmt(geom.perimeter, 1);
    $('rr-edge').textContent = `${fmt(geom.longest.length, 1)} m · ${compassName(geom.longest.bearing)}–${compassName((geom.longest.bearing + 180) % 360)}`;
    $('rr-facing').textContent = facingText;
    $('rr-note').textContent = type === 'pitched'
      ? `Sloped area = plan area ÷ cos(${s.pitch}° tilt). Panels follow the roof slope. If the panels go on the other side of the ridge, use “Other side”.`
      : 'Flat roof: panels go on tilted racks facing the sun. Leave gaps between rows to avoid shading; 30–50% coverage is typical.';
    onRoof({ area, orient, type, announce });
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
  $('btn-flip').addEventListener('click', () => { flipped = !flipped; analyse(true); });
  document.querySelectorAll('input[name="rooftype"]').forEach(r => r.addEventListener('change', () => analyse(true)));

  return {
    show: ensureMap,
    setView,
    refresh: () => { if (geom && !drawing) analyse(false); }, // e.g. tilt changed → sloped area changes
    googleUrl: (lat, lon) => `https://www.google.com/maps/@${lat.toFixed(6)},${lon.toFixed(6)},19z/data=!3m1!1e3`,
    bearingOf: az => azimuthToBearing(az),
  };
}
