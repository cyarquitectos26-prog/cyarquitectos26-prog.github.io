// Georreferenciación del modelo: conversión modelo <-> lat/lon y editor en mapa satelital.
const R = 6378137;
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
const $ = (id) => document.getElementById(id);

// Punto de anclaje del modelo (centro de planta, coordenadas del visor: X este de proyecto, Z sur de proyecto)
export function anchorOf(S) {
  if (S.project.anchor) return { x: S.project.anchor[0], z: S.project.anchor[1] };
  const c = S.bounds.getCenter(new S.three.THREE.Vector3());
  return { x: c.x, z: c.z };
}
// modelo -> desplazamiento ENU (m) respecto al ancla, con rotación θ = rumbo del norte de proyecto
export function modelToENU(S, x, z, rotDeg) {
  const a = anchorOf(S), t = rad(rotDeg);
  const px = x - a.x, py = -(z - a.z);
  return { e: px * Math.cos(t) + py * Math.sin(t), n: -px * Math.sin(t) + py * Math.cos(t) };
}
export function enuToLatLon(lat0, lon0, e, n) {
  return { lat: lat0 + deg(n / R), lon: lon0 + deg(e / (R * Math.cos(rad(lat0)))) };
}
export function latLonToENU(lat0, lon0, lat, lon) {
  return { e: rad(lon - lon0) * R * Math.cos(rad(lat0)), n: rad(lat - lat0) * R };
}
export function modelToLatLon(S, x, z, g) {
  const v = modelToENU(S, x, z, g.rot);
  return enuToLatLon(g.lat, g.lon, v.e, v.n);
}
export function earthUrl(g) {
  return 'https://earth.google.com/web/@' + g.lat.toFixed(7) + ',' + g.lon.toFixed(7) + ',120a,260d,35y,' + ((+g.rot) % 360).toFixed(1) + 'h,45t,0r';
}

let L = null;
async function loadLeaflet() {
  if (L) return L;
  if (!document.getElementById('leaflet-css')) {
    const l = document.createElement('link'); l.id = 'leaflet-css'; l.rel = 'stylesheet';
    l.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
  }
  L = await import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
  return L;
}

// contorno de la planta: ambientes + caja del modelo + flecha de norte de proyecto
function outlines(S) {
  const b = S.bounds, out = [];
  out.push({ kind: 'box', pts: [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]] });
  for (const r of S.project.rooms || []) if (r.poly && r.poly.length > 2) out.push({ kind: 'room', name: r.name, pts: r.poly });
  return out;
}

let map = null, layer = null, moveM = null, rotM = null, g = null;
export async function openMapEditor(S) {
  const dlg = $('dlg-map');
  dlg.showModal();
  const st = $('geo-status');
  try { await loadLeaflet(); } catch (e) { st.hidden = false; st.className = 'note warn'; st.textContent = 'No se pudo cargar el mapa (sin conexión).'; return; }
  g = S.georef ? { ...S.georef } : null;
  if (!map) {
    map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 21 });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' });
    const lab = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21, opacity: 0.9 });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21, attribution: '© OpenStreetMap' });
    sat.addTo(map); lab.addTo(map);
    L.control.layers({ 'Satélite': sat, 'Calles': osm }, { 'Nombres': lab }, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.on('click', (ev) => { if (!g) { g = { lat: ev.latlng.lat, lon: ev.latlng.lng, rot: 0 }; draw(S, true); } });
    S.__map = map;
  }
  setTimeout(() => map.invalidateSize(), 60);
  if (g) { map.setView([g.lat, g.lon], 19); }
  else { map.setView([-12.0915, -77.0283], 13); st.hidden = false; st.className = 'note'; st.textContent = 'Busca la dirección del edificio o toca el mapa para colocar la planta del piso 18 y luego ajústala.'; }
  draw(S, false);
  const sync = () => { $('geo-lat').value = g ? g.lat.toFixed(7) : ''; $('geo-lon').value = g ? g.lon.toFixed(7) : ''; $('geo-rot').value = g ? (+g.rot).toFixed(1) : '';
    const a = $('geo-earth'); if (g) { a.href = earthUrl(g); a.style.pointerEvents = ''; a.style.opacity = 1; } else { a.removeAttribute('href'); a.style.opacity = 0.4; } };
  sync(); draw.sync = sync;
  ['geo-lat', 'geo-lon', 'geo-rot'].forEach((id) => { $(id).onchange = () => {
    const la = parseFloat($('geo-lat').value), lo = parseFloat($('geo-lon').value), ro = parseFloat($('geo-rot').value) || 0;
    if (Number.isFinite(la) && Number.isFinite(lo)) { g = { lat: la, lon: lo, rot: ro }; draw(S, true); }
  }; });
  $('geo-search').onclick = async () => {
    const qv = $('geo-q').value.trim(); if (!qv) return;
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=' + encodeURIComponent(qv));
      const j = await r.json();
      if (!j.length) { st.hidden = false; st.className = 'note warn'; st.textContent = 'No se encontró esa dirección.'; return; }
      const la = +j[0].lat, lo = +j[0].lon; map.setView([la, lo], 19);
      if (!g) g = { lat: la, lon: lo, rot: 0 }; else { g.lat = la; g.lon = lo; }
      st.hidden = false; st.className = 'note'; st.textContent = j[0].display_name; draw(S, true);
    } catch { st.hidden = false; st.className = 'note warn'; st.textContent = 'La búsqueda no está disponible ahora.'; }
  };
  $('geo-q').onkeydown = (e) => { if (e.key === 'Enter') $('geo-search').click(); };
  $('geo-here').onclick = () => {
    if (!navigator.geolocation) return;
    st.hidden = false; st.className = 'note'; st.textContent = 'Obteniendo tu ubicación…';
    navigator.geolocation.getCurrentPosition((p) => {
      const la = p.coords.latitude, lo = p.coords.longitude;
      map.setView([la, lo], 19);
      if (!g) g = { lat: la, lon: lo, rot: 0 }; else { g.lat = la; g.lon = lo; }
      st.textContent = 'Ubicación GPS con precisión de ±' + Math.round(p.coords.accuracy) + ' m.'; draw(S, true);
    }, (err) => { st.className = 'note warn'; st.textContent = 'No se pudo obtener la ubicación: ' + err.message; }, { enableHighAccuracy: true, timeout: 15000 });
  };
  $('geo-save').onclick = () => {
    if (!g) { st.hidden = false; st.className = 'note warn'; st.textContent = 'Primero coloca la planta en el mapa.'; return; }
    S.saveGeo(g); dlg.close(); S.tip('Ubicación guardada. Comparte el QR para que en obra el modelo aparezca ya ubicado.', 5200);
  };
  $('geo-clear').onclick = () => { g = null; S.saveGeo(null); draw(S, false); sync(); };
}

function draw(S, center) {
  if (!map) return;
  if (layer) { layer.remove(); layer = null; }
  if (moveM) { moveM.remove(); moveM = null; }
  if (rotM) { rotM.remove(); rotM = null; }
  if (!g) { if (draw.sync) draw.sync(); return; }
  layer = L.layerGroup().addTo(map);
  for (const o of outlines(S)) {
    const ll = o.pts.map(([x, z]) => { const p = modelToLatLon(S, x, z, g); return [p.lat, p.lon]; });
    L.polygon(ll, o.kind === 'box'
      ? { color: '#3d8bfd', weight: 3, fillColor: '#3d8bfd', fillOpacity: 0.12, interactive: false }
      : { color: '#ffffff', weight: 1.2, fillOpacity: 0.05, interactive: false }).addTo(layer);
  }
  const a = anchorOf(S), b = S.bounds;
  const reach = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.6;
  const north = modelToLatLon(S, a.x, a.z - reach, g);
  L.polyline([[g.lat, g.lon], [north.lat, north.lon]], { color: '#fff', weight: 2, dashArray: '6 6', interactive: false }).addTo(layer);
  moveM = L.marker([g.lat, g.lon], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="move-handle" title="Mover"></div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
  rotM = L.marker([north.lat, north.lon], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="rot-handle" title="Girar"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
  moveM.on('drag', (ev) => { g.lat = ev.latlng.lat; g.lon = ev.latlng.lng; redrawSoon(S); });
  rotM.on('drag', (ev) => {
    const v = latLonToENU(g.lat, g.lon, ev.latlng.lat, ev.latlng.lng);
    g.rot = ((deg(Math.atan2(v.e, v.n)) % 360) + 360) % 360; redrawSoon(S, true);
  });
  rotM.on('dragend', () => draw(S, false));
  if (center) map.setView([g.lat, g.lon], Math.max(map.getZoom(), 18));
  if (draw.sync) draw.sync();
}
let pend = 0;
function redrawSoon(S, keepRot) {
  cancelAnimationFrame(pend);
  pend = requestAnimationFrame(() => {
    // redibuja contornos sin recrear el marcador que se está arrastrando
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    for (const o of outlines(S)) {
      const ll = o.pts.map(([x, z]) => { const p = modelToLatLon(S, x, z, g); return [p.lat, p.lon]; });
      L.polygon(ll, o.kind === 'box' ? { color: '#3d8bfd', weight: 3, fillColor: '#3d8bfd', fillOpacity: 0.12, interactive: false } : { color: '#fff', weight: 1.2, fillOpacity: 0.05, interactive: false }).addTo(layer);
    }
    { const a = anchorOf(S), b = S.bounds; const reach = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.6; const n = modelToLatLon(S, a.x, a.z - reach, g);
      L.polyline([[g.lat, g.lon], [n.lat, n.lon]], { color: '#fff', weight: 2, dashArray: '6 6', interactive: false }).addTo(layer); }
    if (!keepRot && rotM) {
      const a = anchorOf(S), b = S.bounds; const reach = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.6;
      const n = modelToLatLon(S, a.x, a.z - reach, g); rotM.setLatLng([n.lat, n.lon]);
    }
    if (draw.sync) draw.sync();
  });
}
