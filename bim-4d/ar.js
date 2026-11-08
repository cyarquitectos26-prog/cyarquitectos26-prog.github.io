// AR en obra: WebXR (Android/ARCore) con colocación por geolocalización + brújula, ajuste fino y controles;
// iPhone/iPad: AR Quick Look (USDZ generado con lo que se ve, escala fija 1:1).
import { anchorOf, latLonToENU, enuToLatLon, earthUrl } from './geo.js?v=2.1.2';
import { STATES } from './app.js?v=2.1.2';

const $ = (id) => document.getElementById(id);
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const quickLook = (() => { const a = document.createElement('a'); return !!(a.relList && a.relList.supports && a.relList.supports('ar')); })();
let S, THREE;
let xrOk = null;

const st = {
  session: null, base: null, viewerSpace: null, hit: null, lastHit: null, view: null, proj: null,
  mode: 'locate', A: null, R: null, theta: 0, yOff: 0, adjust: false, info: true,
  heading: [], gps: null, gpsWatch: null, compassFn: null, compass: null, placedWith: null, reticle: null,
  saved: null, sheet: null,
};

export async function openAR(app) {
  S = app; THREE = S.three.THREE;
  if (xrOk === null) xrOk = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
  const dlg = $('dlg-ar'), body = $('ar-intro'), foot = $('ar-foot');
  const g = S.georef;
  const geoTxt = g ? 'Ubicación guardada (' + g.src + '): ' + g.lat.toFixed(6) + ', ' + g.lon.toFixed(6) + ' · rotación ' + (+g.rot).toFixed(1) + '°.'
    : 'El modelo todavía no tiene ubicación geográfica.';
  let html = '<ol class="steps">';
  if (xrOk) {
    html += g
      ? '<li>Al iniciar, el celular usa el <b>GPS y la brújula</b> para poner el modelo en su lugar real a escala 1:1.</li><li>Apunta al piso y muévete despacio unos segundos: cuando se detecte el piso, el modelo aparece solo.</li><li>Si no coincide del todo, pulsa <b>Ajustar</b>, muévelo con un dedo y gíralo con dos; luego <b>Guardar ajuste</b> para que los demás lo vean igual.</li>'
      : '<li>Apunta al piso y toca la pantalla donde quieras el centro del piso 18.</li><li>Gíralo con dos dedos hasta que coincida con la obra. Para que aparezca solo, guarda la ubicación en el mapa.</li>';
    html += '<li>Dentro del AR: <b>Capas</b> para elegir especialidades, <b>4D</b> para la fecha y <b>Vista</b> para opacidad, corte y colores. Toca un elemento para ver su ficha.</li></ol>';
  } else if (isIOS || quickLook) {
    html += '<li>Se prepara lo que ves ahora (especialidades, colores 4D, opacidad y corte) con la misma geometría del visor y se abre en AR Quick Look a escala fija 1:1.</li><li>Apunta al piso, toca para colocarlo y gíralo con dos dedos hasta que coincida.</li></ol>'
      + '<div class="note warn">En iPhone/iPad Safari no permite AR web con GPS: la colocación es manual. En Android con Chrome el modelo se ubica solo.</div>';
  } else {
    html += '<li>Este equipo no tiene cámara AR. Abre el visor en tu celular o tablet escaneando el QR.</li></ol>';
  }
  html += '<div class="note' + (g ? '' : ' warn') + '">' + geoTxt + (g ? ' <a href="' + earthUrl(g) + '" target="_blank" rel="noopener">Ver en Google Earth</a>' : '') + '</div>';
  html += '<p class="small muted">Precisión: el GPS de un celular suele tener entre 3 y 10 m al aire libre y más dentro de edificios, y la brújula puede desviarse cerca de estructuras metálicas. Por eso el ajuste fino y «Guardar ajuste» quedan siempre a mano.</p><p id="ar-msg" class="note warn" hidden></p>';
  body.innerHTML = html;
  foot.innerHTML = '';
  const mk = (txt, cls, fn) => { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; b.onclick = fn; foot.appendChild(b); return b; };
  mk('Ubicar en el mapa', '', async () => { dlg.close(); const m = await import('./geo.js?v=2.1.2'); m.openMapEditor(S); });
  if (xrOk) mk('Iniciar AR', 'primary', () => startXR());
  else if (isIOS || quickLook) { const b = mk('Preparar modelo', 'primary', () => prepareQuickLook(b)); }
  else mk('Mostrar QR', 'primary', () => { dlg.close(); $('btn-share').click(); });
  dlg.showModal();
  if (xrOk) startSensors();
}

// ------------------------------------------------------------------ sensores
function startSensors() {
  if (navigator.geolocation && st.gpsWatch === null) {
    st.gpsWatch = navigator.geolocation.watchPosition((p) => {
      const c = p.coords;
      if (!st.gps || c.accuracy <= st.gps.acc * 1.5 || Date.now() - st.gps.t > 8000) st.gps = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: Date.now() };
      updateStatus();
    }, () => updateStatus(), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  if (!st.compassFn) {
    st.compassFn = (ev) => {
      if (ev.alpha == null) return;
      if (ev.type === 'deviceorientation' && !ev.absolute && ev.webkitCompassHeading == null) return;
      const a = rad(ev.alpha), b = rad(ev.beta || 0), c = rad(ev.gamma || 0);
      const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(c), sG = Math.sin(c);
      // dirección de la cámara trasera (-Z del dispositivo) en el marco Este-Norte-Arriba
      const vx = -(cA * sG + cG * sA * sB), vy = -(sA * sG - cA * cG * sB), vz = -cB * cG;
      if (Math.abs(vz) > 0.8) return; // celular casi horizontal: rumbo inestable
      st.compass = { h: Math.atan2(vx, vy), t: performance.now() };
    };
    addEventListener('deviceorientationabsolute', st.compassFn, true);
    addEventListener('deviceorientation', st.compassFn, true);
  }
}
function stopSensors() {
  if (st.gpsWatch !== null) { navigator.geolocation.clearWatch(st.gpsWatch); st.gpsWatch = null; }
  if (st.compassFn) { removeEventListener('deviceorientationabsolute', st.compassFn, true); removeEventListener('deviceorientation', st.compassFn, true); st.compassFn = null; }
}
function headingStats() {
  const h = st.heading.slice(-60);
  if (h.length < 8) return null;
  let sx = 0, sy = 0; for (const v of h) { sx += Math.cos(v); sy += Math.sin(v); }
  const m = Math.atan2(sy, sx), Rl = Math.hypot(sx, sy) / h.length;
  return { mean: m, sd: deg(Math.sqrt(Math.max(0, -2 * Math.log(Math.max(Rl, 1e-6))))), n: h.length };
}

// ------------------------------------------------------------------ interfaz AR
function buildUI() {
  const ui = $('ar-ui');
  ui.innerHTML =
    '<div id="ar-touch"></div>'
    + '<div class="ar-top ui"><div id="ar-hint">Iniciando cámara…</div><button class="ar-btn" id="ar-exit">Salir</button></div>'
    + '<div class="ar-side ui">'
    + '<button class="ar-btn round" id="ar-b-layers" title="Especialidades"><svg class="icon"><use href="#i-layers"/></svg></button>'
    + '<button class="ar-btn round" id="ar-b-4d" title="Fecha 4D"><svg class="icon"><use href="#i-clock"/></svg></button>'
    + '<button class="ar-btn round" id="ar-b-view" title="Vista">◐</button>'
    + '<button class="ar-btn round" id="ar-b-adjust" title="Ajustar posición">✥</button>'
    + '</div>'
    + '<div id="ar-card" class="ui"></div>'
    + '<div class="ar-bottom ui"><div class="ar-actions" id="ar-actions"></div>'
    + '<div class="ar-quick" id="ar-quick"><label>Corte<input type="range" id="ar-q-cut" min="0" max="100"></label><label>Transparencia<input type="range" id="ar-q-op" min="0" max="90"></label></div>'
    + '<div class="ar-sheet" id="ar-s-layers"><h3>Especialidades</h3><div class="ar-chips" id="ar-disc"></div></div>'
    + '<div class="ar-sheet" id="ar-s-4d"><h3>Simulación 4D</h3><div class="row"><b id="ar-date"></b><button class="ar-btn" id="ar-play">▶ Reproducir</button><button class="ar-btn" id="ar-today">Hoy</button></div><input type="range" id="ar-time"><div class="ar-legend" id="ar-legend"></div></div>'
    + '<div class="ar-sheet" id="ar-s-view"><h3>Vista</h3>'
    + '<div class="row"><label>Opacidad</label><output id="ar-op-o"></output></div><input type="range" id="ar-op" min="10" max="100">'
    + '<div class="row"><label><input type="checkbox" id="ar-cut-on"> Corte horizontal</label><output id="ar-cut-o"></output></div><input type="range" id="ar-cut" min="0" max="100">'
    + '<div class="row"><label><input type="checkbox" id="ar-edges"> Realzar aristas</label></div>'
    + '<h3>Colorear por</h3><div class="ar-chips" id="ar-color"><button data-v="4d">Estado 4D</button><button data-v="disc">Especialidad</button><button data-v="real">Materiales</button></div>'
    + '<h3>Pendientes a la fecha</h3><div class="ar-chips" id="ar-pend"><button data-v="ghost">Fantasma</button><button data-v="hide">Ocultos</button><button data-v="solid">Visibles</button></div></div>'
    + '<div class="ar-sheet" id="ar-s-adjust"><h3>Ajuste fino</h3><p class="small" style="margin:0 0 8px;opacity:.85">Arrastra con un dedo para mover y gira con dos. También puedes usar los botones.</p>'
    + '<div class="ar-chips"><button data-rot="-5">⟲ 5°</button><button data-rot="-1">⟲ 1°</button><button data-rot="1">1° ⟳</button><button data-rot="5">5° ⟳</button></div>'
    + '<div class="ar-chips" style="margin-top:6px"><button data-mv="f">↑ 10 cm</button><button data-mv="b">↓ 10 cm</button><button data-mv="l">← 10 cm</button><button data-mv="r">10 cm →</button><button data-h="0.02">▲ 2 cm</button><button data-h="-0.02">▼ 2 cm</button></div>'
    + '<div class="ar-actions" style="margin-top:10px"><button class="ar-btn primary" id="ar-save">Guardar ajuste como ubicación</button><button class="ar-btn" id="ar-replace">Recolocar</button></div></div>'
    + '<div class="ar-status" id="ar-status"></div></div>';
  ui.querySelectorAll('.ui').forEach((el) => el.addEventListener('beforexrselect', (e) => e.preventDefault()));
  $('ar-exit').onclick = () => st.session && st.session.end();
  const sheets = { layers: 'ar-s-layers', '4d': 'ar-s-4d', view: 'ar-s-view', adjust: 'ar-s-adjust' };
  for (const k in sheets) $('ar-b-' + k).onclick = () => toggleSheet(k === st.sheet ? null : k);
  function toggleSheet(k) {
    st.sheet = k;
    for (const kk in sheets) { $(sheets[kk]).classList.toggle('on', kk === k); $('ar-b-' + kk).classList.toggle('on', kk === k); }
    st.adjust = k === 'adjust';
    if (k) $('ar-card').classList.remove('on');
    $('ar-quick').classList.toggle('on', !k && st.mode === 'placed');
  }
  st.toggleSheet = toggleSheet;
  // especialidades
  const disc = $('ar-disc'); disc.innerHTML = '';
  for (const D of S.disc.values()) {
    const b = document.createElement('button'); b.innerHTML = '<i style="background:' + D.color + '"></i>' + D.name;
    b.setAttribute('aria-pressed', String(D.visible));
    b.onclick = () => { S.setDiscVisible(D.d, !D.visible); b.setAttribute('aria-pressed', String(D.visible)); };
    disc.appendChild(b);
  }
  const all = document.createElement('button'); all.textContent = 'Todas';
  all.onclick = () => { for (const D of S.disc.values()) D.visible = true; S.syncLayerButtons(); S.refresh(); disc.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'true')); };
  disc.appendChild(all);
  // 4D
  const t = $('ar-time'), main = $('time');
  t.min = main.min; t.max = main.max; t.value = main.value;
  t.oninput = () => { main.value = t.value; main.dispatchEvent(new Event('input')); };
  $('ar-play').onclick = () => { S.togglePlay(); };
  $('ar-today').onclick = () => $('today').click();
  // vista
  $('ar-op').value = Math.round(S.opacity * 100); $('ar-op-o').textContent = Math.round(S.opacity * 100) + ' %';
  $('ar-op').oninput = (e) => { S.setOpacity(+e.target.value / 100); $('ar-op-o').textContent = e.target.value + ' %'; };
  $('ar-cut-on').checked = S.cutOn; $('ar-cut').value = Math.round(S.cutT * 100);
  $('ar-cut-on').onchange = (e) => S.setCut(e.target.checked);
  $('ar-cut').oninput = (e) => { S.setCut(true, +e.target.value / 100); $('ar-cut-on').checked = true; };
  $('ar-edges').checked = S.edges;
  $('ar-edges').onchange = (e) => { S.edges = e.target.checked; $('edges').checked = S.edges; S.refresh(); };
  const syncSeg = () => {
    $('ar-color').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.colorMode)));
    $('ar-pend').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.pending)));
  };
  $('ar-color').querySelectorAll('button').forEach((b) => b.onclick = () => { S.setColorMode(b.dataset.v); syncSeg(); });
  $('ar-pend').querySelectorAll('button').forEach((b) => b.onclick = () => { S.pending = b.dataset.v; $('pending-mode').value = S.pending; S.refresh(); syncSeg(); });
  syncSeg();
  // ajuste
  ui.querySelectorAll('[data-rot]').forEach((b) => b.onclick = () => { if (!st.R) return; st.theta += rad(+b.dataset.rot); applyPose(); });
  ui.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { if (!st.R) return; st.yOff += +b.dataset.h; applyPose(); });
  ui.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
    if (!st.R || !st.view) return;
    const fx = -st.view[8], fz = -st.view[10], l = Math.hypot(fx, fz) || 1; const ux = fx / l, uz = fz / l;
    const d = 0.1, k = b.dataset.mv;
    const v = k === 'f' ? [ux, uz] : k === 'b' ? [-ux, -uz] : k === 'l' ? [uz, -ux] : [-uz, ux];
    st.R.x += v[0] * d; st.R.z += v[1] * d; applyPose();
  });
  $('ar-save').onclick = saveAdjust;
  // barra rápida (como en el video): corte y transparencia siempre a mano
  $('ar-q-cut').value = S.cutOn ? Math.round(S.cutT * 100) : 100;
  $('ar-q-cut').oninput = (e) => { const v = +e.target.value; S.setCut(v < 100, v / 100); $('ar-cut-on').checked = v < 100; $('ar-cut').value = v; };
  $('ar-q-op').value = Math.round((1 - S.opacity) * 100);
  $('ar-q-op').oninput = (e) => { const o = 1 - (+e.target.value) / 100; S.setOpacity(o); $('ar-op').value = Math.round(o * 100); $('ar-op-o').textContent = Math.round(o * 100) + ' %'; };
  $('ar-replace').onclick = () => setMode(S.georef ? 'locate' : 'manual');
  wireGestures($('ar-touch'));
  if (!st.hooked) {
    st.hooked = true;
    S.on('cut', () => { if (!st.session) return; $('ar-time').value = $('time').value; $('ar-date').textContent = S.fmtDate(S.cut); legend(); });
    S.on('refresh', () => { if (st.session) legend(); });
  }
}
function legend() {
  const c = {}; for (const k in STATES) c[k] = 0;
  for (const e of S.elems) if (e.vis) c[e.state]++;
  $('ar-legend').innerHTML = Object.entries(STATES).map(([k, v]) => '<span><i style="background:' + v.color + '"></i>' + v.label + ' ' + c[k] + '</span>').join('');
}
function hint(h, sub) { $('ar-hint').innerHTML = h + (sub ? '<small>' + sub + '</small>' : ''); }
function updateStatus() {
  const box = $('ar-status'); if (!box) return;
  const parts = [];
  if (S.georef) {
    parts.push(st.gps ? 'GPS ±' + Math.round(st.gps.acc) + ' m' : 'GPS buscando…');
    const hs = headingStats(); parts.push(hs ? 'Brújula ±' + Math.max(1, Math.round(hs.sd)) + '°' : (st.compass ? 'Brújula calibrando…' : 'Brújula no disponible'));
  }
  parts.push('Corte ' + S.fmtDate(S.cut));
  if (st.placedWith) parts.push(st.placedWith);
  box.innerHTML = parts.map((p) => '<span>' + p + '</span>').join('');
}
function actions(list) {
  const box = $('ar-actions'); box.innerHTML = '';
  for (const [txt, fn, cls] of list) { const b = document.createElement('button'); b.className = 'ar-btn ' + (cls || ''); b.textContent = txt; b.onclick = fn; box.appendChild(b); }
}

// ------------------------------------------------------------------ sesión WebXR
async function startXR() {
  const dlg = $('dlg-ar'); if (dlg.open) dlg.close();
  buildUI();
  const ui = $('ar-ui'); ui.classList.add('on');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'light-estimation'], domOverlay: { root: ui } });
  } catch (err) {
    ui.classList.remove('on'); await openAR(S); const m = $('ar-msg'); m.hidden = false; m.textContent = 'No se pudo abrir la cámara AR: ' + err.message; return;
  }
  const r = S.three.renderer, cam = S.three.camera;
  st.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), near: cam.near, far: cam.far, edges: S.edges, mode: S.mode, target: S.three.controls.target.clone() };
  if (S.mode !== 'orbit') S.setMode('orbit');
  cam.near = 0.03; cam.far = 400;
  st.session = session; st.heading = []; st.R = null; st.A = null; st.yOff = 0; st.lastHit = null; st.placedWith = null;
  session.addEventListener('end', onEnd, { once: true });
  session.addEventListener('select', onSelect);
  r.xr.setReferenceSpaceType('local');
  r.xr.setReferenceSpace(null);
  S.three.modelRoot.visible = false;
  makeReticle();
  S.setFrameHook(frame);
  // misma nitidez que en la web: búfer a la resolución nativa de la pantalla y sin foveación
  try { const nf = XRWebGLLayer.getNativeFramebufferScaleFactor(session); r.xr.setFramebufferScaleFactor(Math.min(Math.max(nf || 1, 1), 2)); } catch { /* */ }
  try { r.xr.setFoveation(0); } catch { /* */ }
  try {
    await r.xr.setSession(session);
    st.base = r.xr.getReferenceSpace();
    st.viewerSpace = await session.requestReferenceSpace('viewer');
    st.hit = await session.requestHitTestSource({ space: st.viewerSpace });
  } catch (err) { console.error(err); session.end(); return; }
  startSensors();
  if (S.georef) setMode('locate'); else setMode('manual');
  updateStatus(); legend();
  $('ar-date').textContent = S.fmtDate(S.cut);
}
function onEnd() {
  const r = S.three.renderer, cam = S.three.camera;
  S.setFrameHook(null);
  try { st.hit && st.hit.cancel(); } catch { /* */ }
  st.hit = null; st.base = null; st.session = null;
  r.xr.setReferenceSpace(null);
  if (st.reticle) { S.three.scene.remove(st.reticle); st.reticle = null; }
  S.three.modelRoot.visible = true;
  const sv = st.saved;
  cam.position.copy(sv.pos); cam.quaternion.copy(sv.quat); cam.near = sv.near; cam.far = sv.far; cam.updateProjectionMatrix();
  S.three.controls.target.copy(sv.target); S.three.controls.update();
  $('edges').checked = S.edges; S.refresh();
  $('ar-ui').classList.remove('on'); $('ar-ui').innerHTML = '';
  stopSensors();
  setTimeout(() => { window.dispatchEvent(new Event('resize')); S.invalidate(); }, 100);
}
function makeReticle() {
  const g = new THREE.RingGeometry(0.12, 0.16, 40).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
  m.renderOrder = 50; m.matrixAutoUpdate = false; m.visible = false;
  st.reticle = m; S.three.scene.add(m);
}

const MODES = {
  locate: 'Apunta al piso y muévete despacio: el modelo aparecerá en su ubicación real.',
  manual: 'Apunta al piso y toca la pantalla para colocar el centro del piso 18 a escala 1:1.',
};
function setMode(m) {
  st.mode = m;
  const placing = m !== 'placed';
  if (placing) { S.three.renderer.xr.setReferenceSpace(null); st.R = null; if (m === 'locate') st.heading = []; S.three.modelRoot.visible = false; }
  else S.three.modelRoot.visible = true;
  if (m === 'locate') { hint(MODES.locate, 'Sostén el celular vertical, con la cámara hacia adelante.'); actions([['Colocar por GPS ahora', () => placeByGeo(true), 'primary'], ['Colocar a mano', () => setMode('manual')]]); }
  else if (m === 'manual') { hint(MODES.manual, S.georef ? '' : 'Consejo: guarda la ubicación en el mapa para que el modelo aparezca solo.'); actions([['Colocar aquí', () => onSelect(), 'primary']].concat(S.georef ? [['Usar GPS', () => setMode('locate')]] : [])); }
  else { hint('Modelo a escala 1:1. Camina para recorrerlo.', 'Toca un elemento para ver su ficha. ✥ para ajustar la posición.'); actions([]); }
  const q = $('ar-quick'); if (q) q.classList.toggle('on', m === 'placed' && !st.sheet);
  updateStatus();
}

function frame(time, xframe) {
  const r = S.three.renderer;
  if (st.base) {
    const vp = xframe.getViewerPose(st.base);
    if (vp && vp.views.length) {
      st.view = Float32Array.from(vp.views[0].transform.matrix); st.proj = Float32Array.from(vp.views[0].projectionMatrix);
      // muestra de rumbo: δ = rumbo de brújula − rumbo XR de la cámara
      if (st.compass && performance.now() - st.compass.t < 300) {
        const fx = -st.view[8], fz = -st.view[10], fy = -st.view[9];
        if (Math.abs(fy) < 0.8) { st.heading.push(wrapPi(st.compass.h - Math.atan2(fx, -fz))); if (st.heading.length > 240) st.heading.shift(); }
      }
    }
    if (st.hit) {
      const hits = xframe.getHitTestResults(st.hit);
      const pb = hits.length ? hits[0].getPose(st.base) : null;
      if (pb && pb.transform.matrix[5] > 0.85) { // superficie horizontal
        const p = pb.transform.position; st.lastHit = { x: p.x, y: p.y, z: p.z, t: time };
        const pw = hits[0].getPose(r.xr.getReferenceSpace()); if (pw) st.reticle.matrix.fromArray(pw.transform.matrix);
      } else if (!pb) st.lastHit = null;
      st.reticle.visible = !!st.lastHit && st.mode !== 'placed';
      st.reticle.material.opacity = st.mode === 'locate' ? 0.6 : 1;
    }
    if (st.mode === 'locate') {
      const hs = headingStats();
      if (time - (st.lastStatus || 0) > 600) { st.lastStatus = time; updateStatus(); }
      if (st.lastHit && st.gps && st.gps.acc < 60 && hs && hs.n >= 24 && hs.sd < 12) placeByGeo(false);
    }
  }
  r.render(S.three.scene, S.three.camera);
}

function placeByGeo(force) {
  const g = S.georef, hs = headingStats();
  if (!g) { setMode('manual'); return; }
  if (!st.view) return;
  if (!st.gps) { hint('Esperando señal GPS…', 'Si estás bajo techo puede tardar; también puedes colocar a mano.'); return; }
  if (!hs) { hint('Calibrando la brújula…', 'Mueve el celular en forma de ocho y vuelve a apuntar al frente.'); return; }
  const floorY = st.lastHit ? st.lastHit.y : st.view[13] - 1.45;
  const delta = hs.mean;
  const v = latLonToENU(st.gps.lat, st.gps.lon, g.lat, g.lon); // ancla respecto al celular (m)
  const c = Math.cos(delta), s = Math.sin(delta);
  const px = st.view[12], pz = st.view[14];
  const a = anchorOf(S);
  st.A = { x: a.x, y: S.floorY, z: a.z };
  st.R = { x: px + (v.e * c - v.n * s), y: floorY, z: pz - (v.e * s + v.n * c) };
  st.theta = delta - rad(+g.rot);
  st.ref = { delta, gps: { ...st.gps }, p: { x: px, z: pz } };
  st.yOff = 0;
  st.placedWith = 'Ubicado por GPS ±' + Math.round(st.gps.acc) + ' m · brújula ±' + Math.max(1, Math.round(hs.sd)) + '°';
  setMode('placed'); applyPose();
  if (Math.hypot(v.e, v.n) > 250) hint('Estás a ' + Math.round(Math.hypot(v.e, v.n)) + ' m del edificio.', 'El modelo está en su lugar real, pero lejos de ti. Revisa la ubicación en el mapa.');
  else hint('Modelo ubicado por GPS a escala 1:1.', 'Si no coincide, pulsa ✥ y ajústalo; luego «Guardar ajuste».');
  if (!force && navigator.vibrate) navigator.vibrate(30);
}

function onSelect(ev) {
  if (!st.session) return;
  if (st.mode === 'placed') { if (!st.adjust) inspect(ev); return; }
  const h = st.lastHit;
  if (!h) { hint('Aún no se detecta el piso.', 'Mueve el celular despacio apuntando al suelo.'); return; }
  if (st.mode === 'locate') { placeByGeo(true); return; }
  const a = anchorOf(S);
  st.A = { x: a.x, y: S.floorY, z: a.z };
  st.R = { x: h.x, y: h.y, z: h.z };
  const fx = -st.view[8], fz = -st.view[10];
  st.theta = -Math.atan2(fx, -fz); // el norte de proyecto apunta hacia donde mira la cámara
  st.yOff = 0; st.placedWith = 'Colocado a mano'; st.ref = null;
  setMode('placed'); applyPose();
  st.toggleSheet('adjust');
  hint('Modelo colocado. Gíralo con dos dedos hasta que coincida con la obra.', 'Cuando esté bien, «Guardar ajuste» para ubicarlo en el mapa.');
}
function applyPose() {
  if (!st.base || !st.R || !st.A) return;
  const ct = Math.cos(st.theta), sn = Math.sin(st.theta);
  const ax = st.A.x * ct + st.A.z * sn, az = -st.A.x * sn + st.A.z * ct;
  const pos = { x: st.R.x - ax, y: st.R.y + st.yOff - st.A.y, z: st.R.z - az };
  const rot = { x: 0, y: Math.sin(st.theta / 2), z: 0, w: Math.cos(st.theta / 2) };
  S.three.renderer.xr.setReferenceSpace(st.base.getOffsetReferenceSpace(new XRRigidTransform(pos, rot)));
}
// Guarda la posición ajustada como georreferencia (lat, lon, rotación) para compartirla
function saveAdjust() {
  if (!st.R) return;
  let gps = st.gps, delta = null, p = null;
  if (st.ref) { delta = st.ref.delta; gps = st.ref.gps; p = st.ref.p; }
  else { const hs = headingStats(); if (hs) delta = hs.mean; p = st.view ? { x: st.view[12], z: st.view[14] } : null; }
  if (!gps || delta == null || !p) { hint('Para guardar hace falta GPS y brújula.', 'Activa la ubicación del celular y vuelve a intentarlo.'); startSensors(); return; }
  const X = st.R.x - p.x, Z = st.R.z - p.z, c = Math.cos(delta), s = Math.sin(delta);
  const e = c * X - s * Z, n = -s * X - c * Z;
  const ll = enuToLatLon(gps.lat, gps.lon, e, n);
  let rot = deg(delta - st.theta); rot = ((rot % 360) + 360) % 360;
  S.saveGeo({ lat: ll.lat, lon: ll.lon, rot });
  st.placedWith = 'Ajuste guardado';
  updateStatus();
  hint('Ubicación guardada.', 'Comparte el QR desde el visor para que otros vean el modelo ya ubicado.');
}

// selección por toque dentro del AR
function inspect(ev) {
  let ray = null;
  if (ev && ev.frame && ev.inputSource) {
    const pose = ev.frame.getPose(ev.inputSource.targetRaySpace, S.three.renderer.xr.getReferenceSpace());
    if (pose) {
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const o = new THREE.Vector3().setFromMatrixPosition(m);
      const d = new THREE.Vector3(0, 0, -1).transformDirection(m);
      ray = { origin: o, direction: d };
    }
  }
  if (!ray) return;
  const h = S.pickAt(null, null, ray);
  const card = $('ar-card');
  if (!h) { S.select(null); card.classList.remove('on'); return; }
  const e = h.e; S.select(e);
  const stt = STATES[e.state];
  const lk = e.links.filter((l) => l.p === 'INSTALACION').map((l) => S.tasks.get(l.t)?.name).filter(Boolean);
  card.innerHTML = '<b>' + (e.fam || e.cat) + '</b><div class="small" style="opacity:.8">' + (e.type || '') + ' · ' + e.D.name + '</div>'
    + '<div class="ar-legend"><span><i style="background:' + stt.color + '"></i>' + stt.label + ' al ' + S.fmtDate(S.cut) + '</span></div>'
    + (e.sIns ? '<div class="small" style="margin-top:4px">Instalación: ' + S.fmtDate(e.sIns) + ' → ' + S.fmtDate(e.fIns) + '</div>' : '<div class="small" style="margin-top:4px">' + (e.note || 'No se programa') + '</div>')
    + (lk.length ? '<div class="small" style="opacity:.8;margin-top:2px">' + lk.slice(0, 2).join(' · ') + '</div>' : '');
  card.classList.add('on');
}

// gestos: un dedo mueve sobre el piso, dos dedos giran (escala bloqueada 1:1)
function floorPoint(cx, cy) {
  if (!st.view || !st.proj || !st.R) return null;
  const inv = new THREE.Matrix4().fromArray(st.proj).invert(), wm = new THREE.Matrix4().fromArray(st.view);
  const o = new THREE.Vector3().setFromMatrixPosition(wm);
  const d = new THREE.Vector3(cx / innerWidth * 2 - 1, 1 - cy / innerHeight * 2, 0.5).applyMatrix4(inv).applyMatrix4(wm).sub(o);
  if (Math.abs(d.y) < 1e-6) return null;
  const k = (st.R.y + st.yOff - o.y) / d.y; if (k <= 0 || k > 200) return null;
  return { x: o.x + d.x * k, z: o.z + d.z * k };
}
function wireGestures(el) {
  const ptrs = new Map(); let drag = null, twist = null;
  const ang = () => { const p = [...ptrs.values()]; return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x); };
  const reset = () => { drag = null; twist = null; if (ptrs.size === 1) { const p = ptrs.values().next().value; drag = floorPoint(p.x, p.y); } if (ptrs.size === 2) twist = ang(); };
  el.addEventListener('pointerdown', (e) => { if (st.mode !== 'placed' || !st.adjust) return; try { el.setPointerCapture(e.pointerId); } catch { /* */ } ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); reset(); });
  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !st.adjust) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1 && drag) { const p = floorPoint(e.clientX, e.clientY); if (p) { st.R.x += p.x - drag.x; st.R.z += p.z - drag.z; drag = p; applyPose(); } }
    else if (ptrs.size === 2) { const a = ang(); if (twist !== null) { st.theta -= wrapPi(a - twist); applyPose(); } twist = a; }
  });
  const up = (e) => { if (ptrs.delete(e.pointerId)) reset(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------------ iPhone / iPad: USDZ para AR Quick Look
// Misma geometría que el visor web: sin simplificar ni redondear (precisión 1 mm), normales de Revit,
// colores y transparencias del estado actual. Se escribe por bloques de bytes para no crear cadenas gigantes.
function crc32(u8, c = 0xffffffff) {
  let t = crc32.t; if (!t) { t = crc32.t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let k = i; for (let j = 0; j < 8; j++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; t[i] = k >>> 0; } }
  for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return c;
}
function usdzBlob(name, chunks) {
  let crc = 0xffffffff, size = 0; for (const ch of chunks) { crc = crc32(ch, crc); size += ch.length; }
  crc = (crc ^ 0xffffffff) >>> 0;
  const nb = new TextEncoder().encode(name), head = 30 + nb.length;
  let pad = (64 - (head % 64)) % 64; if (pad > 0 && pad < 4) pad += 64;
  const lh = new Uint8Array(head + pad), lv = new DataView(lh.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true);
  lv.setUint32(18, size, true); lv.setUint32(22, size, true); lv.setUint16(26, nb.length, true); lv.setUint16(28, pad, true); lh.set(nb, 30);
  if (pad) { lv.setUint16(head, 0x1986, true); lv.setUint16(head + 2, pad - 4, true); }
  const cd = new Uint8Array(46 + nb.length), cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
  cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, nb.length, true); cd.set(nb, 46);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, lh.length + size, true);
  return new Blob([lh, ...chunks, cd, end], { type: 'model/vnd.usdz+zip' });
}
// escritor ASCII por bloques
class Out {
  constructor() { this.chunks = []; this.b = new Uint8Array(1 << 23); this.p = 0; }
  need(n) { if (this.p + n > this.b.length) { this.chunks.push(this.b.subarray(0, this.p)); this.b = new Uint8Array(Math.max(1 << 23, n)); this.p = 0; } }
  s(t) { this.need(t.length); for (let i = 0; i < t.length; i++) this.b[this.p++] = t.charCodeAt(i) & 0x7f; }
  bytes(u) { this.need(u.length); this.b.set(u, this.p); this.p += u.length; }
  i(n) {
    this.need(12); const b = this.b;
    if (n < 0) { b[this.p++] = 45; n = -n; }
    if (n < 10) { b[this.p++] = 48 + n; return; }
    const s0 = this.p; while (n > 0) { b[this.p++] = 48 + (n % 10); n = (n / 10) | 0; }
    for (let a = s0, z = this.p - 1; a < z; a++, z--) { const t = b[a]; b[a] = b[z]; b[z] = t; }
  }
  done() { this.chunks.push(this.b.subarray(0, this.p)); return this.chunks; }
}
// componentes de normal (int8/127) con dos decimales, precalculados
const NLUT = (() => { const enc = new TextEncoder(), t = []; for (let n = -128; n < 128; n++) { const v = Math.round(Math.max(-1, n / 127) * 100) / 100; t.push(enc.encode(String(v))); } return t; })();
export function buildUSDZ(app = S) {
  S = app;
  const f = S.floorY, yMax = Math.min(f + 6, S.cutOn ? S.three.clipPlane.constant : Infinity);
  const items = [];
  for (const D of S.disc.values()) {
    if (!D.mesh.visible) continue;
    const g = D.mesh.geometry, n = g.drawRange.count, solidN = g.groups[0] ? g.groups[0].count : n;
    const pos = g.attributes.position.array, lo = D.head.lo, sc = D.head.scale;
    const W = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { W[i] = lo[0] + pos[i] * sc; W[i + 1] = lo[1] + pos[i + 1] * sc; W[i + 2] = lo[2] + pos[i + 2] * sc; }
    items.push({ D, idx: g.index.array, n, solidN, W, col: D.col, nor: g.attributes.normal.array });
  }
  // dentro de la franja del piso; fuera lo que queda por completo bajo el nivel de piso terminado (no se ve en obra)
  const keep = (W, a, b, c) => {
    const ya = W[a * 3 + 1], yb = W[b * 3 + 1], yc = W[c * 3 + 1];
    if (Math.max(ya, yb, yc) < f - 0.01) return false;
    const cy = (ya + yb + yc) / 3; return cy > f - 0.3 && cy < yMax;
  };
  const op2 = (x) => Math.round(x * 100) / 100;
  const ghostOp = Math.max(0.05, op2(S.materials.matGhost.opacity)), solidOp = op2(S.opacity);
  // 1) triángulos por material (color + opacidad), en arreglos tipados
  const groups = new Map(); let total = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let pass = 0; pass < 2; pass++) {
    items.forEach((it, ii) => {
      for (let t = 0; t < it.n; t += 3) {
        const a = it.idx[t], b = it.idx[t + 1], c = it.idx[t + 2];
        if (!keep(it.W, a, b, c)) continue;
        const op = t >= it.solidN ? ghostOp : solidOp;
        const key = ((it.col[a * 3] << 16) | (it.col[a * 3 + 1] << 8) | it.col[a * 3 + 2]) + '|' + op;
        let gr = groups.get(key);
        if (pass === 0) {
          if (!gr) { gr = { key, op, rgb: [it.col[a * 3], it.col[a * 3 + 1], it.col[a * 3 + 2]], n: 0 }; groups.set(key, gr); }
          gr.n++; total++;
          for (const v of [a, b, c]) { const x = it.W[v * 3], z = it.W[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        } else {
          if (!gr.tri) { gr.tri = new Uint32Array(gr.n * 3); gr.src = new Uint8Array(gr.n); gr.k = 0; }
          const q = gr.k * 3; gr.src[gr.k] = ii; gr.tri[q] = a; gr.tri[q + 1] = b; gr.tri[q + 2] = c; gr.k++;
        }
      }
    });
    if (pass === 0) {
      if (!total) throw new Error('No hay elementos visibles para exportar.');
      if (total > 3500000) throw new Error('Hay ' + total.toLocaleString('es-PE') + ' triángulos visibles: es demasiado para AR Quick Look. Oculta alguna especialidad o activa el corte.');
    }
  }
  const ox = (x0 + x1) / 2, oz = (z0 + z1) / 2;
  const lin = (v) => { v /= 255; return Math.round((v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)) * 10000) / 10000; };
  // 2) USDA en milímetros (enteros) bajo un Xform con escala 0,001
  const o = new Out();
  o.s('#usda 1.0\n(\n    defaultPrim = "Obra"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n\ndef Xform "Obra" (\n    kind = "component"\n)\n{\n'
    + '    double3 xformOp:scale = (0.001, 0.001, 0.001)\n    uniform token[] xformOpOrder = ["xformOp:scale"]\n\n    def Scope "Materiales"\n    {\n');
  const gl = [...groups.values()];
  gl.forEach((g, gi) => {
    g.i = gi;
    o.s('        def Material "M' + gi + '"\n        {\n            token outputs:surface.connect = </Obra/Materiales/M' + gi + '/S.outputs:surface>\n            def Shader "S"\n            {\n'
      + '                uniform token info:id = "UsdPreviewSurface"\n                color3f inputs:diffuseColor = (' + lin(g.rgb[0]) + ', ' + lin(g.rgb[1]) + ', ' + lin(g.rgb[2]) + ')\n'
      + '                float inputs:roughness = ' + (g.op < 1 ? 0.9 : 0.82) + '\n                float inputs:metallic = 0\n                float inputs:opacity = ' + g.op + '\n                token outputs:surface\n            }\n        }\n');
  });
  o.s('    }\n');
  const MAXV = 9999; let meshes = 0;
  const local = new Map();
  for (const g of gl) {
    let k = 0;
    while (k < g.n) {
      // un trozo con hasta 9 999 vértices: índices de 4 cifras como máximo
      local.clear(); const verts = []; const ind = [];
      while (k < g.n && local.size <= MAXV - 3) {
        const ii = g.src[k];
        for (let j = 0; j < 3; j++) {
          const v = g.tri[k * 3 + j], key = ii * 16777216 + v;
          let id = local.get(key);
          if (id === undefined) { id = local.size; local.set(key, id); verts.push(ii, v); }
          ind.push(id);
        }
        k++;
      }
      const nt = ind.length / 3;
      o.s('\n    def Mesh "G' + g.i + '_' + (meshes++) + '" (\n        prepend apiSchemas = ["MaterialBindingAPI"]\n    )\n    {\n        uniform bool doubleSided = 1\n        int[] faceVertexCounts = [');
      for (let t = 0; t < nt; t++) o.s(t ? ',3' : '3');
      o.s(']\n        int[] faceVertexIndices = [');
      for (let t = 0; t < ind.length; t++) { if (t) o.s(','); o.i(ind[t]); }
      o.s(']\n        rel material:binding = </Obra/Materiales/M' + g.i + '>\n        normal3f[] normals = [');
      for (let q = 0; q < verts.length; q += 2) {
        const it = items[verts[q]], v = verts[q + 1], N = it.nor;
        o.s(q ? ',(' : '('); o.bytes(NLUT[N[v * 3] + 128]); o.s(','); o.bytes(NLUT[N[v * 3 + 1] + 128]); o.s(','); o.bytes(NLUT[N[v * 3 + 2] + 128]); o.s(')');
      }
      o.s('] (\n            interpolation = "vertex"\n        )\n        point3f[] points = [');
      for (let q = 0; q < verts.length; q += 2) {
        const W = items[verts[q]].W, v = verts[q + 1];
        o.s(q ? ',(' : '('); o.i(Math.round((W[v * 3] - ox) * 1000)); o.s(','); o.i(Math.round(Math.max(0, W[v * 3 + 1] - f) * 1000)); o.s(','); o.i(Math.round((W[v * 3 + 2] - oz) * 1000)); o.s(')');
      }
      o.s(']\n        uniform token subdivisionScheme = "none"\n    }\n');
    }
  }
  o.s('}\n');
  return { blob: usdzBlob('obra.usda', o.done()), triangles: total, meshes, size: [x1 - x0, z1 - z0] };
}
let qlURL = null;
async function prepareQuickLook(btn) {
  btn.disabled = true; const m = $('ar-msg'); m.hidden = false; m.className = 'note'; m.textContent = 'Preparando el modelo en calidad completa…';
  await new Promise((r) => setTimeout(r, 50));
  try {
    const res = buildUSDZ(S);
    if (qlURL) URL.revokeObjectURL(qlURL);
    qlURL = URL.createObjectURL(res.blob);
    const a = document.createElement('a'); a.rel = 'ar'; a.href = qlURL + '#allowsContentScaling=0';
    const img = document.createElement('img'); img.alt = 'Abrir en AR'; img.width = 240; img.height = 48;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48"><rect width="240" height="48" rx="24" fill="#0b0b0b"/><text x="120" y="30" font-family="system-ui,-apple-system" font-size="16" font-weight="600" fill="#fff" text-anchor="middle">Abrir en AR · escala 1:1</text></svg>');
    a.appendChild(img);
    m.innerHTML = 'Listo, con la misma geometría que el visor web: ' + res.triangles.toLocaleString('es-PE') + ' triángulos · ' + (res.blob.size / 1048576).toFixed(0) + ' MB. Toca el botón y apunta al piso; un modelo grande puede tardar unos segundos en abrir.<br>';
    m.appendChild(a);
  } catch (e) { m.className = 'note warn'; m.textContent = e.message; }
  btn.disabled = false;
}
