/* ar.js · Realidad aumentada en obra para el visor BIM 4D
   Android (Chrome + ARCore): WebXR con deteccion de piso, escala 1:1 fija, alineacion por dos
   puntos A-B (como el marcador del video), arrastre y giro con los dedos, transparencia, corte y 4D.
   iPhone/iPad: exporta lo visible a USDZ y lo abre en AR Quick Look con escala fija 1:1.
   Se carga ANTES del bundle del visor para enlazarse con su renderer de three.js. */

const AR = { session: null };
const ctx = { renderer: null, scene: null, camera: null, loop: null };

(function hookThree() {
  let hub = window.__THREE_DEVTOOLS__;
  if (!hub) { hub = new EventTarget(); window.__THREE_DEVTOOLS__ = hub; }
  hub.addEventListener('observe', function (e) {
    const o = e.detail;
    if (!o || !o.isWebGLRenderer || ctx.renderer) return;
    ctx.renderer = o;
    const setLoop = o.setAnimationLoop.bind(o);
    o.setAnimationLoop = function (cb) { ctx.loop = cb; setLoop(cb ? master : null); };
    const render = o.render.bind(o);
    o.render = function (scene, camera) {
      if (!AR.session && scene && scene.isScene) { ctx.scene = scene; ctx.camera = camera; }
      return render(scene, camera);
    };
  });
  function master(time, frame) {
    if (AR.session && frame) {
      try { arFrame(time, frame); } catch (err) { console.error('[AR]', err); }
      return;
    }
    if (ctx.loop) ctx.loop(time, frame);
  }
})();

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const T3 = {};
const refs = { A: null, B: null };
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const quickLook = (function () { const a = document.createElement('a'); return !!(a.relList && a.relList.supports && a.relList.supports('ar')); })();
const params = new URLSearchParams(location.search);
const COLORS = { A: 0xff3b30, B: 0x0a84ff, white: 0xffffff };
let xrSupport = null;

function isModelMesh(m) {
  return !!(m && m.isMesh && m.geometry && m.geometry.index && m.geometry.attributes && m.geometry.attributes.color);
}
function sceneParts() {
  const s = ctx.scene;
  if (!s) return null;
  let grid = null, group = null, ring = null;
  for (const c of s.children) {
    if (c.type === 'GridHelper') grid = c;
    else if (c.isMesh && c.geometry && c.geometry.type === 'RingGeometry' && !c.userData.arx) ring = c;
    else if (c.isGroup && !group && c.children.some(isModelMesh)) group = c;
  }
  return { grid: grid, group: group, ring: ring };
}
function ctors() {
  if (T3.Vector3) return T3;
  const p = sceneParts();
  if (!p || !p.ring || !p.grid || !ctx.camera) return null;
  T3.Vector3 = ctx.scene.position.constructor;
  T3.Matrix4 = ctx.scene.matrix.constructor;
  T3.Object3D = Object.getPrototypeOf(ctx.scene.constructor.prototype).constructor;
  T3.Mesh = p.ring.constructor;
  T3.RingGeometry = p.ring.geometry.constructor;
  T3.BasicMaterial = p.ring.material.constructor;
  T3.BufferGeometry = Object.getPrototypeOf(p.ring.geometry.constructor.prototype).constructor;
  T3.LineSegments = Object.getPrototypeOf(p.grid.constructor.prototype).constructor;
  T3.LineMaterial = p.grid.material.constructor;
  T3.Float32Attr = p.grid.geometry.attributes.position.constructor;
  T3.Camera = ctx.camera.constructor;
  return T3;
}
function floorY() { const p = sceneParts(); return p && p.grid ? p.grid.position.y + 0.1 : 0; }
function modelCenter() { const p = sceneParts(); return p && p.grid ? { x: p.grid.position.x, z: p.grid.position.z } : { x: 0, z: 0 }; }
function modelReady() { const p = sceneParts(); return !!(p && p.group && p.grid && p.ring && ctx.camera && ctx.renderer); }
function redraw() {
  if (AR.session || !ctx.renderer || !ctx.scene || !ctx.camera) return;
  requestAnimationFrame(function () { try { ctx.renderer.render(ctx.scene, ctx.camera); } catch (e) { /* sin efecto */ } });
}
function fmtCm(m) { return Math.round(m * 100) + ' cm'; }
function fmtInt(n) { return new Intl.NumberFormat('es-PE').format(n); }
function fmtDate(v) { if (!v) return ''; const p = v.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : v; }
function round3(v) { return Math.round(v * 1000) / 1000; }
function poke(id, prop, value, types) {
  const el = $(id);
  if (!el) return;
  el[prop] = value;
  for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
}
function checkXR() {
  if (!xrSupport) {
    xrSupport = navigator.xr && navigator.xr.isSessionSupported
      ? navigator.xr.isSessionSupported('immersive-ar').catch(function () { return false; })
      : Promise.resolve(false);
  }
  return xrSupport;
}

/* ---------- puntos de referencia A y B ---------- */
function refKey() {
  const code = ($('project-code') && $('project-code').textContent) || 'proyecto';
  const lv = ($('level') && $('level').value) || '';
  return 'bim4d.ar.ref.' + code + '.' + lv;
}
function loadRefs() {
  refs.A = null; refs.B = null;
  try {
    const v = JSON.parse(localStorage.getItem(refKey()) || 'null');
    if (v && v.A && v.B) { refs.A = v.A; refs.B = v.B; }
  } catch (e) { /* almacenamiento no disponible */ }
  updateMarkers();
  renderRefs();
}
function saveRefs() {
  try {
    if (refs.A && refs.B) localStorage.setItem(refKey(), JSON.stringify({ A: refs.A, B: refs.B }));
    else localStorage.removeItem(refKey());
  } catch (e) { /* almacenamiento no disponible */ }
}
function parsePair(s) {
  if (!s) return null;
  const p = s.split(',').map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? { x: p[0], z: p[1] } : null;
}

let markerRoot = null;
const markers = {};
function makeMarker(color, size) {
  const t = ctors();
  const g = new t.Object3D();
  const mat = new t.BasicMaterial({ color: color, side: 2, depthTest: false, transparent: true, opacity: 0.95 });
  const ring = new t.Mesh(new t.RingGeometry(0.16 * size, 0.24 * size, 40).rotateX(-Math.PI / 2), mat);
  const dot = new t.Mesh(new t.RingGeometry(0, 0.045 * size, 20).rotateX(-Math.PI / 2), mat);
  const lg = new t.BufferGeometry();
  lg.setAttribute('position', new t.Float32Attr([0, 0, 0, 0, 2.6, 0], 3));
  const pole = new t.LineSegments(lg, new t.LineMaterial({ color: color, depthTest: false, transparent: true }));
  ring.renderOrder = dot.renderOrder = pole.renderOrder = 30;
  ring.userData.arx = dot.userData.arx = true;
  g.add(ring, dot, pole);
  return g;
}
function updateMarkers() {
  const t = ctors();
  if (!t) return;
  if (!markerRoot) {
    markerRoot = new t.Object3D();
    markerRoot.visible = false;
    markers.A = makeMarker(COLORS.A, 1);
    markers.B = makeMarker(COLORS.B, 1);
    markerRoot.add(markers.A, markers.B);
  }
  if (markerRoot.parent !== ctx.scene) ctx.scene.add(markerRoot);
  const f = floorY();
  for (const k of ['A', 'B']) {
    markers[k].visible = !!refs[k];
    if (refs[k]) markers[k].position.set(refs[k].x, f + 0.01, refs[k].z);
  }
  redraw();
}
function showRefMarkers(on) {
  updateMarkers();
  if (markerRoot) { markerRoot.visible = on; redraw(); }
}

/* ---------- seleccion de puntos en el modelo 3D ---------- */
const pick = { step: null, down: null };
function raycastModel(cx, cy) {
  const t = ctors();
  const parts = sceneParts();
  if (!t || !parts || !parts.group) return null;
  const cam = ctx.camera;
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  const nx = (cx - rect.left) / rect.width * 2 - 1;
  const ny = 1 - (cy - rect.top) / rect.height * 2;
  cam.updateMatrixWorld();
  const o = new t.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const d = new t.Vector3(nx, ny, 0.5).unproject(cam).sub(o).normalize();
  const inv = new t.Matrix4();
  const lo = new t.Vector3(), ld = new t.Vector3(), hp = new t.Vector3();
  let best = Infinity, out = null;
  for (const mesh of parts.group.children) {
    if (!isModelMesh(mesh) || !mesh.visible) continue;
    const g = mesh.geometry, idx = g.index.array, pos = g.attributes.position.array;
    const n = Math.min(g.drawRange.count, idx.length);
    mesh.updateMatrixWorld();
    inv.copy(mesh.matrixWorld).invert();
    lo.copy(o).applyMatrix4(inv);
    ld.copy(d).transformDirection(inv);
    const ox = lo.x, oy = lo.y, oz = lo.z, dx = ld.x, dy = ld.y, dz = ld.z;
    const planes = mesh.material.clippingPlanes || [];
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const id = 1 / det;
      const tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2];
      const u = (tx * px + ty * py + tz * pz) * id;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * id;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (dist <= 0.01 || dist >= best) continue;
      hp.set(ox + dx * dist, oy + dy * dist, oz + dz * dist).applyMatrix4(mesh.matrixWorld);
      if (planes.some(function (pl) { return pl.distanceToPoint(hp) < 0; })) continue;
      best = dist;
      out = { x: hp.x, y: hp.y, z: hp.z };
    }
  }
  return out;
}
function banner(text, showCancel) {
  let b = $('arx-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'arx-banner';
    b.innerHTML = '<span id="arx-banner-text"></span><button id="arx-banner-cancel" type="button">Cancelar</button>';
    document.body.appendChild(b);
    $('arx-banner-cancel').addEventListener('click', function () { stopPicking(true); });
  }
  if (text === null) { b.hidden = true; return; }
  b.hidden = false;
  $('arx-banner-text').textContent = text;
  $('arx-banner-cancel').hidden = !showCancel;
}
function startPicking() {
  const dlg = $('arx-dialog');
  if (dlg.open) dlg.close();
  pick.step = 'A';
  pick.prev = { A: refs.A, B: refs.B };
  refs.A = null; refs.B = null;
  showRefMarkers(true);
  banner('Toca en el modelo el punto A (rojo): p. ej. la esquina de una columna o un cruce de ejes que exista en obra.', true);
}
function stopPicking(cancelled) {
  if (cancelled && pick.prev) { refs.A = pick.prev.A; refs.B = pick.prev.B; }
  pick.step = null; pick.prev = null;
  banner(null);
  updateMarkers();
  openDialog();
}
window.addEventListener('pointerdown', function (e) {
  if (pick.step && ctx.renderer && e.target === ctx.renderer.domElement) pick.down = [e.clientX, e.clientY];
}, true);
window.addEventListener('pointerup', function (e) {
  if (!pick.step || !ctx.renderer || e.target !== ctx.renderer.domElement) return;
  const d = pick.down;
  pick.down = null;
  if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6) return;
  e.stopPropagation();
  e.preventDefault();
  const p = raycastModel(e.clientX, e.clientY);
  if (!p) { banner('Ahí no hay ningún elemento. Toca una columna, muro o losa visible (punto ' + pick.step + ').', true); return; }
  refs[pick.step] = { x: round3(p.x), z: round3(p.z) };
  updateMarkers();
  if (pick.step === 'A') {
    pick.step = 'B';
    banner('Ahora toca el punto B (azul), lo más lejos posible de A (idealmente más de 5 m).', true);
    return;
  }
  const dist = Math.hypot(refs.A.x - refs.B.x, refs.A.z - refs.B.z);
  if (dist < 1) {
    refs.B = null;
    updateMarkers();
    banner('B está a ' + fmtCm(dist) + ' de A. Elige un punto B más alejado.', true);
    return;
  }
  pick.prev = null;
  saveRefs();
  stopPicking(false);
}, true);

/* ---------- dialogo principal ---------- */
const CSS = [
  '#arx-dialog{width:min(580px,94vw);max-height:92vh;overflow:auto;border:1px solid #111;border-radius:6px;padding:1.1rem 1.2rem}',
  '#arx-dialog::backdrop{background:rgba(0,0,0,.45)}',
  '#arx-dialog h2{margin-bottom:.6rem}',
  '#arx-dialog h3{font-size:.98rem;margin:1rem 0 .35rem}',
  '#arx-dialog ol{margin:.3rem 0 0;padding-left:1.2rem}',
  '#arx-dialog li{margin:.2rem 0}',
  '.arx-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.45rem}',
  '.arx-note{color:#555;font-size:.88rem;margin-top:.35rem}',
  '.arx-mono{font-variant-numeric:tabular-nums}',
  '.arx-refs{font-variant-numeric:tabular-nums;font-size:.9rem;margin:.35rem 0}',
  '.arx-dot{display:inline-block;width:.72em;height:.72em;border-radius:50%;margin-right:.3em;vertical-align:-.06em}',
  '#arx-status{margin-top:.6rem;font-weight:600}',
  '#arx-status:empty{display:none}',
  '#arx-ql img{display:block;border-radius:6px}',
  '#arx-qrbox summary{cursor:pointer;font-weight:650;margin-top:.9rem}',
  '#arx-qr{display:block;margin:.5rem 0;max-width:220px}',
  '#arx-qr[hidden]{display:none}',
  '#arx-link{word-break:break-all;font-size:.82rem}',
  '#arx-banner{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:60;background:#111;color:#fff;padding:.55rem .8rem;border-radius:6px;display:flex;gap:.7rem;align-items:center;width:max-content;max-width:94vw;box-shadow:0 6px 20px rgba(0,0,0,.3)}',
  '#arx-banner[hidden]{display:none}',
  '#arx-banner button{min-height:34px;padding:.3rem .6rem;flex:none}',
  '#arx-overlay{position:fixed;inset:0;z-index:2147483000;display:none;color:#fff;font:15px/1.35 system-ui,sans-serif;-webkit-user-select:none;user-select:none;background:transparent}',
  '#arx-overlay.on{display:block}',
  '#arx-touch{position:absolute;inset:0;touch-action:none}',
  '.arx-top{position:absolute;left:0;right:0;top:0;display:flex;gap:.5rem;align-items:flex-start;padding:max(10px,env(safe-area-inset-top)) 10px 10px}',
  '#arx-hint{flex:1;background:rgba(0,0,0,.62);padding:.55rem .7rem;border-radius:6px}',
  '.arx-ui button{min-height:44px;padding:.4rem .75rem;border-radius:6px;border:1px solid rgba(255,255,255,.55);background:rgba(0,0,0,.55);color:#fff;font-weight:650}',
  '.arx-ui button.primary,.arx-ui button[aria-pressed=true]{background:#fff;color:#111;border-color:#fff}',
  '.arx-ui button[hidden]{display:none}',
  '.arx-bottom{position:absolute;left:0;right:0;bottom:0;padding:8px 10px max(10px,env(safe-area-inset-bottom))}',
  '.arx-actions{display:flex;gap:.45rem;flex-wrap:wrap;margin-bottom:.5rem}',
  '.arx-sheet{background:rgba(0,0,0,.62);border-radius:8px;padding:.45rem .7rem}',
  '.arx-sheet summary{cursor:pointer;font-weight:650;min-height:30px;display:flex;align-items:center}',
  '.arx-sheet label,.arx-line{display:flex;align-items:center;gap:.5rem;margin:.35rem 0}',
  '.arx-sheet input[type=range]{flex:1;min-width:80px;accent-color:#fff}',
  '.arx-sheet button{min-height:36px;padding:.2rem .55rem}',
  '.arx-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.3rem}',
  '.arx-chips button[aria-pressed=false]{opacity:.5;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.55)}'
].join('\n');

const QL_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48">' +
  '<rect width="240" height="48" rx="6" fill="#111"/>' +
  '<text x="120" y="30" font-family="system-ui,-apple-system,sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">Abrir en AR (1:1)</text></svg>');

function buildUI() {
  if ($('arx-dialog')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const dlg = document.createElement('dialog');
  dlg.id = 'arx-dialog';
  dlg.innerHTML =
    '<h2>Realidad aumentada en obra</h2>' +
    '<p>Recorre <b id="arx-level"></b> a escala 1:1 con la cámara del celular o tablet: el modelo queda fijo en su sitio real mientras caminas.</p>' +
    '<ol class="arx-note">' +
    '<li>(Recomendado) Marca dos puntos A y B en el modelo que puedas ubicar en obra: esquinas de columnas o cruces de ejes.</li>' +
    '<li>En obra, pulsa <b>Iniciar AR</b>, apunta al piso y toca A y luego B en su lugar real: el modelo queda alineado.</li>' +
    '<li>Camina para recorrerlo. Usa transparencia, corte y la fecha 4D para comparar con lo construido.</li>' +
    '</ol>' +
    '<h3>Puntos de referencia</h3>' +
    '<div id="arx-refs" class="arx-refs"></div>' +
    '<div class="arx-row"><button id="arx-pick" type="button">Elegir A y B en el modelo</button>' +
    '<button id="arx-clear" type="button">Borrar puntos</button></div>' +
    '<h3>Cámara</h3>' +
    '<p id="arx-device" class="arx-note"></p>' +
    '<div class="arx-row">' +
    '<button id="arx-start" class="primary" type="button" hidden>Iniciar AR con la cámara</button>' +
    '<button id="arx-usdz" class="primary" type="button" hidden>Preparar modelo para AR</button>' +
    '<a id="arx-ql" rel="ar" hidden><img alt="Abrir en AR" width="240" height="48" src="' + QL_IMG + '"></a>' +
    '</div>' +
    '<p id="arx-status" role="status"></p>' +
    '<details id="arx-qrbox"><summary>QR para abrir en el celular o pegar en obra</summary>' +
    '<canvas id="arx-qr" aria-label="Código QR de realidad aumentada"></canvas>' +
    '<a id="arx-link" target="_blank" rel="noopener"></a>' +
    '<div class="arx-row"><button id="arx-copy" type="button">Copiar enlace</button></div>' +
    '<p class="arx-note">Escanéalo con el celular: abre este piso, la fecha de corte y los puntos A-B directamente en modo AR. Puedes imprimirlo y pegarlo en obra junto al punto A, como el marcador del video.</p>' +
    '</details>' +
    '<form method="dialog" class="arx-row"><button type="submit">Cerrar</button></form>';
  document.body.appendChild(dlg);
  dlg.addEventListener('close', function () { if (!pick.step && !AR.session) showRefMarkers(false); });
  $('arx-pick').addEventListener('click', startPicking);
  $('arx-clear').addEventListener('click', function () { refs.A = null; refs.B = null; saveRefs(); updateMarkers(); renderRefs(); drawQR(); });
  $('arx-start').addEventListener('click', startWebXR);
  $('arx-usdz').addEventListener('click', prepareQuickLook);
  $('arx-qrbox').addEventListener('toggle', function () { if ($('arx-qrbox').open) drawQR(); });
  $('arx-copy').addEventListener('click', function () {
    const url = arLink();
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { say('Enlace copiado.'); }, function () { say(url); });
    else say(url);
  });
}
function say(text) { const s = $('arx-status'); if (s) s.textContent = text || ''; }
function renderRefs() {
  const el = $('arx-refs');
  if (!el) return;
  const dot = function (k) { return '<span class="arx-dot" style="background:' + (k === 'A' ? '#ff3b30' : '#0a84ff') + '"></span>'; };
  if (refs.A && refs.B) {
    const d = Math.hypot(refs.A.x - refs.B.x, refs.A.z - refs.B.z);
    el.innerHTML = dot('A') + 'A (' + refs.A.x.toFixed(2) + ', ' + refs.A.z.toFixed(2) + ') · ' +
      dot('B') + 'B (' + refs.B.x.toFixed(2) + ', ' + refs.B.z.toFixed(2) + ') · distancia ' + d.toFixed(2) + ' m';
  } else {
    el.textContent = 'Sin puntos: el modelo se colocará donde toques y podrás girarlo y moverlo con los dedos.';
  }
  const c = $('arx-clear');
  if (c) c.hidden = !(refs.A && refs.B);
}
function arLink() {
  const u = new URL(location.href);
  const q = new URLSearchParams();
  const lv = $('level') && $('level').value;
  if (lv) q.set('piso', lv);
  const f = $('date') && $('date').value;
  if (f) q.set('fecha', f);
  q.set('modo', 'ar');
  if (refs.A && refs.B) { q.set('refA', refs.A.x + ',' + refs.A.z); q.set('refB', refs.B.x + ',' + refs.B.z); }
  u.search = q.toString();
  u.hash = '';
  return u.href;
}
async function drawQR() {
  const box = $('arx-qrbox');
  if (!box || !box.open) return;
  const url = arLink();
  $('arx-link').href = url;
  $('arx-link').textContent = url;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
    const QR = mod.default && mod.default.toCanvas ? mod.default : mod;
    await QR.toCanvas($('arx-qr'), url, { width: 220, margin: 2 });
    $('arx-qr').hidden = false;
  } catch (e) {
    $('arx-qr').hidden = true;
  }
}
async function openDialog() {
  buildUI();
  const dlg = $('arx-dialog');
  const lvSel = $('level');
  $('arx-level').textContent = lvSel && lvSel.selectedOptions[0] ? lvSel.selectedOptions[0].textContent : 'el piso';
  renderRefs();
  say('');
  $('arx-ql').hidden = true;
  if (!dlg.open) dlg.showModal();
  showRefMarkers(true);
  const ready = modelReady();
  const xr = await checkXR();
  const start = $('arx-start'), usdz = $('arx-usdz'), dev = $('arx-device');
  start.hidden = !xr;
  usdz.hidden = xr || !(isIOS || quickLook);
  start.disabled = usdz.disabled = !ready;
  $('arx-pick').disabled = !ready;
  if (xr) dev.textContent = 'Este equipo admite AR con seguimiento del entorno (WebXR + ARCore). Se pedirá permiso para usar la cámara.';
  else if (isIOS || quickLook) dev.textContent = 'iPhone/iPad: se prepara lo que ves ahora (piso, disciplinas, colores 4D, transparencia y corte) y se abre en AR Quick Look a escala fija 1:1. Si no abre, usa Safari.';
  else dev.textContent = 'Este equipo no tiene cámara AR. Abre esta página en tu celular o tablet: en Android con Chrome (Servicios de Google Play para RA) o en iPhone/iPad con Safari. Usa el QR de abajo.';
  if (!ready) say('Espera a que cargue el modelo…');
  const box = $('arx-qrbox');
  if (!xr && !isIOS && !quickLook) box.open = true;
  drawQR();
}

/* ---------- sesion WebXR (Android) ---------- */
const st = {
  mode: 'place', A: null, R: null, theta: 0, thetaBase: 0, yOff: 0, locked: false,
  base: null, hitSource: null, lastHit: null, view: null, proj: null, tapA: null,
  saved: null, group: null, reticle: null, taps: [], cam: null
};

function buildOverlay() {
  let ov = $('arx-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'arx-overlay';
  ov.innerHTML =
    '<div id="arx-touch"></div>' +
    '<div class="arx-top arx-ui"><div id="arx-hint"></div><button id="arx-exit" type="button">Salir</button></div>' +
    '<div class="arx-bottom arx-ui">' +
    '<div class="arx-actions">' +
    '<button id="arx-mark" class="primary" type="button">Colocar aquí</button>' +
    '<button id="arx-quick" type="button">Colocación rápida</button>' +
    '<button id="arx-align" type="button">Alinear con A y B</button>' +
    '<button id="arx-replace" type="button">Recolocar</button>' +
    '<button id="arx-lock" type="button" aria-pressed="false">Bloquear</button>' +
    '</div>' +
    '<details class="arx-sheet"><summary>Controles del modelo</summary>' +
    '<label>Transparencia <input id="arx-opacity" type="range" min="10" max="100"></label>' +
    '<label><input id="arx-cut" type="checkbox"> Corte <input id="arx-cuth" type="range" min="0" max="100"></label>' +
    '<label>4D <span id="arx-date" class="arx-mono"></span><input id="arx-time" type="range" min="0" max="1" step="1"></label>' +
    '<label>Giro <input id="arx-rot" type="range" min="-180" max="180" step="0.5"><button type="button" data-rot="-1">−1°</button><button type="button" data-rot="1">+1°</button></label>' +
    '<div class="arx-line">Altura <button type="button" data-h="-0.02">▼ 2 cm</button><button type="button" data-h="0.02">▲ 2 cm</button><span id="arx-hval" class="arx-mono">0 cm</span></div>' +
    '<div id="arx-disc" class="arx-chips"></div>' +
    '</details>' +
    '</div>';
  document.body.appendChild(ov);
  ov.querySelectorAll('.arx-ui').forEach(function (el) { el.addEventListener('beforexrselect', function (e) { e.preventDefault(); }); });
  $('arx-exit').addEventListener('click', function () { if (AR.session) AR.session.end(); });
  $('arx-mark').addEventListener('click', function () { onSelect(); });
  $('arx-quick').addEventListener('click', function () { setMode('place'); });
  $('arx-align').addEventListener('click', function () { setMode('pickA'); });
  $('arx-replace').addEventListener('click', function () { setMode(refs.A && refs.B ? 'pickA' : 'place'); });
  $('arx-lock').addEventListener('click', function () { setLocked(!st.locked); });
  $('arx-opacity').addEventListener('input', function (e) { poke('opacity', 'value', e.target.value, ['input', 'change']); });
  $('arx-cut').addEventListener('change', function (e) { poke('sectionEnabled', 'checked', e.target.checked, ['input', 'change']); });
  $('arx-cuth').addEventListener('input', function (e) { poke('section', 'value', e.target.value, ['input', 'change']); });
  $('arx-time').addEventListener('input', function (e) { poke('timeline', 'value', e.target.value, ['input']); showDate(); });
  $('arx-rot').addEventListener('input', function (e) {
    if (!st.R) return;
    st.theta = st.thetaBase + Number(e.target.value) * Math.PI / 180;
    applyPose();
  });
  ov.querySelectorAll('[data-rot]').forEach(function (b) {
    b.addEventListener('click', function () { if (!st.R) return; st.theta += Number(b.dataset.rot) * Math.PI / 180; applyPose(); });
  });
  ov.querySelectorAll('[data-h]').forEach(function (b) {
    b.addEventListener('click', function () { if (!st.R) return; st.yOff += Number(b.dataset.h); applyPose(); });
  });
  wireGestures($('arx-touch'));
  return ov;
}
function showDate() { const d = $('date'); $('arx-date').textContent = d ? fmtDate(d.value) : ''; }
function syncOverlay() {
  const o = $('opacity');
  if (o) $('arx-opacity').value = o.value;
  const se = $('sectionEnabled'), s = $('section');
  $('arx-cut').checked = !!(se && se.checked);
  if (s) $('arx-cuth').value = s.value;
  const tl = $('timeline'), x = $('arx-time');
  if (tl) { x.min = tl.min; x.max = tl.max; x.value = tl.value; }
  showDate();
  const box = $('arx-disc');
  box.textContent = '';
  document.querySelectorAll('#disciplines label').forEach(function (row) {
    const input = row.querySelector('input[type=checkbox]');
    if (!input || input.disabled) return;
    const name = input.getAttribute('aria-label') || row.textContent.trim();
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.setAttribute('aria-pressed', String(input.checked));
    b.addEventListener('click', function () {
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      b.setAttribute('aria-pressed', String(input.checked));
    });
    box.appendChild(b);
  });
}
function hint(text) { const h = $('arx-hint'); if (h) h.textContent = text; }
function setLocked(on) {
  st.locked = on;
  const b = $('arx-lock');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Posición bloqueada' : 'Bloquear';
}

function makeReticle() {
  const t = ctors();
  const g = new t.Object3D();
  g.matrixAutoUpdate = false;
  const mat = new t.BasicMaterial({ color: COLORS.white, side: 2 });
  const ring = new t.Mesh(new t.RingGeometry(0.11, 0.15, 40).rotateX(-Math.PI / 2), mat);
  const dot = new t.Mesh(new t.RingGeometry(0, 0.025, 16).rotateX(-Math.PI / 2), mat);
  ring.userData.arx = dot.userData.arx = true;
  g.add(ring, dot);
  g.userData.mat = mat;
  g.visible = false;
  return g;
}

async function startWebXR() {
  const t = ctors();
  const parts = sceneParts();
  if (!t || !parts || !parts.group) { say('Espera a que cargue el modelo.'); return; }
  const dlg = $('arx-dialog');
  if (dlg && dlg.open) dlg.close();
  const ov = buildOverlay();
  ov.classList.add('on');
  hint('Iniciando la cámara…');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: ov }
    });
  } catch (err) {
    ov.classList.remove('on');
    openDialog();
    say('No se pudo abrir la cámara AR: ' + (err && err.message ? err.message : err));
    return;
  }
  const r = ctx.renderer, scene = ctx.scene;
  st.group = parts.group;
  st.saved = { background: scene.background, grid: parts.grid.visible };
  st.cam = st.cam || new t.Camera(50, 1, 0.03, 1000);
  st.R = null; st.A = null; st.lastHit = null; st.view = null; st.proj = null; st.yOff = 0;
  setLocked(false);
  if ($('explode') && $('explode').getAttribute('aria-pressed') === 'true') $('explode').click();
  scene.background = null;
  parts.grid.visible = false;
  st.group.visible = false;
  st.reticle = makeReticle();
  scene.add(st.reticle);
  AR.session = session;
  session.addEventListener('end', onEnd, { once: true });
  session.addEventListener('select', onSelect);
  try {
    r.xr.setReferenceSpace(null);
    await r.xr.setSession(session);
    st.base = r.xr.getReferenceSpace();
    const viewer = await session.requestReferenceSpace('viewer');
    st.hitSource = await session.requestHitTestSource({ space: viewer });
  } catch (err) {
    console.error('[AR]', err);
    session.end().catch(function () {});
    return;
  }
  syncOverlay();
  setMode(refs.A && refs.B ? 'pickA' : 'place');
}

function onEnd() {
  const r = ctx.renderer;
  try { if (st.hitSource) st.hitSource.cancel(); } catch (e) { /* ya cancelado */ }
  st.hitSource = null; st.base = null;
  try { r.xr.setReferenceSpace(null); } catch (e) { /* sin efecto */ }
  const parts = sceneParts();
  ctx.scene.background = st.saved ? st.saved.background : ctx.scene.background;
  if (parts && parts.grid && st.saved) parts.grid.visible = st.saved.grid;
  if (st.group) st.group.visible = true;
  if (st.reticle) { ctx.scene.remove(st.reticle); st.reticle = null; }
  clearTaps();
  AR.session = null;
  const ov = $('arx-overlay');
  if (ov) ov.classList.remove('on');
  showRefMarkers(false);
  setTimeout(redraw, 80);
}

function arFrame(time, frame) {
  const r = ctx.renderer;
  if (st.base) {
    const vp = frame.getViewerPose(st.base);
    if (vp && vp.views.length) {
      st.view = Float32Array.from(vp.views[0].transform.matrix);
      st.proj = Float32Array.from(vp.views[0].projectionMatrix);
    }
    if (st.hitSource && st.reticle) {
      const hits = frame.getHitTestResults(st.hitSource);
      const pb = hits.length ? hits[0].getPose(st.base) : null;
      if (pb) {
        const p = pb.transform.position;
        st.lastHit = { x: p.x, y: p.y, z: p.z };
        const pw = hits[0].getPose(r.xr.getReferenceSpace());
        if (pw) st.reticle.matrix.fromArray(pw.transform.matrix);
      } else {
        st.lastHit = null;
      }
      st.reticle.visible = !!st.lastHit && st.mode !== 'placed';
    }
  }
  r.render(ctx.scene, st.cam);
}

function cameraHeading() {
  if (!st.view) return 0;
  return Math.atan2(-st.view[8], -st.view[10]);
}
function applyPose() {
  if (!st.base || !st.R || !st.A) return;
  const ct = Math.cos(st.theta), sn = Math.sin(st.theta);
  const ax = st.A.x * ct + st.A.z * sn;
  const az = -st.A.x * sn + st.A.z * ct;
  const pos = { x: st.R.x - ax, y: st.R.y + st.yOff - st.A.y, z: st.R.z - az };
  const rot = { x: 0, y: Math.sin(st.theta / 2), z: 0, w: Math.cos(st.theta / 2) };
  ctx.renderer.xr.setReferenceSpace(st.base.getOffsetReferenceSpace(new XRRigidTransform(pos, rot)));
  let deg = (st.theta - st.thetaBase) * 180 / Math.PI;
  deg = ((deg + 180) % 360 + 360) % 360 - 180;
  const rs = $('arx-rot');
  if (rs) rs.value = deg.toFixed(1);
  const hv = $('arx-hval');
  if (hv) hv.textContent = (st.yOff >= 0 ? '+' : '') + Math.round(st.yOff * 100) + ' cm';
}

const MODE_TEXT = {
  place: 'Apunta al piso y muévete despacio. Cuando aparezca el anillo, toca la pantalla para colocar el modelo a escala 1:1.',
  placeA: 'Apunta al piso y toca el lugar real del punto A (rojo). Luego gira el modelo con dos dedos o con el control Giro.',
  pickA: 'Alineación: apunta al piso y toca el lugar real del punto A (rojo).',
  pickB: 'Ahora toca el lugar real del punto B (azul).',
  placed: 'Modelo a escala 1:1. Camina para recorrerlo. Arrastra con un dedo para moverlo y gira con dos dedos.'
};
function setMode(m, text) {
  st.mode = m;
  const placing = m !== 'placed';
  if (placing) {
    ctx.renderer.xr.setReferenceSpace(null);
    clearTaps();
    if (m === 'pickB' && st.tapA) showTap('A', st.tapA);
  }
  if (st.group) st.group.visible = !placing;
  showRefMarkers(!placing && !!(refs.A && refs.B));
  if (st.reticle) {
    st.reticle.userData.mat.color.setHex(m === 'pickA' ? COLORS.A : m === 'pickB' ? COLORS.B : COLORS.white);
  }
  const hasRefs = !!(refs.A && refs.B);
  hint(text || (m === 'place' && refs.A ? MODE_TEXT.placeA : MODE_TEXT[m]));
  $('arx-mark').hidden = !placing;
  $('arx-mark').textContent = m === 'pickA' ? 'Marcar A aquí' : m === 'pickB' ? 'Marcar B aquí' : 'Colocar aquí';
  $('arx-quick').hidden = !(m === 'pickA' || m === 'pickB');
  $('arx-align').hidden = !(m === 'placed' && hasRefs);
  $('arx-replace').hidden = m !== 'placed';
  $('arx-lock').hidden = m !== 'placed';
}
function onSelect() {
  if (!AR.session) return;
  if (st.mode === 'placed') return;
  const h = st.lastHit;
  if (!h) { hint('Aún no se detecta el piso. Mueve el celular despacio apuntando al suelo.'); return; }
  if (st.mode === 'place') {
    const c = refs.A ? refs.A : modelCenter();
    st.A = { x: c.x, y: floorY(), z: c.z };
    st.R = { x: h.x, y: h.y, z: h.z };
    st.thetaBase = cameraHeading() - Math.PI;
    st.theta = st.thetaBase;
    st.yOff = 0;
    setLocked(false);
    setMode('placed');
    applyPose();
  } else if (st.mode === 'pickA') {
    st.tapA = h;
    setMode('pickB');
  } else if (st.mode === 'pickB') {
    alignTwoPoints(st.tapA, h);
  }
}
function alignTwoPoints(ra, rb) {
  const A = refs.A, B = refs.B;
  const dmx = B.x - A.x, dmz = B.z - A.z, drx = rb.x - ra.x, drz = rb.z - ra.z;
  const lm = Math.hypot(dmx, dmz), lr = Math.hypot(drx, drz);
  if (lr < 0.3) { hint('B quedó muy cerca de A (' + fmtCm(lr) + '). Toca de nuevo el punto B real.'); return; }
  st.thetaBase = Math.atan2(drx, drz) - Math.atan2(dmx, dmz);
  st.theta = st.thetaBase;
  st.A = { x: (A.x + B.x) / 2, y: floorY(), z: (A.z + B.z) / 2 };
  st.R = { x: (ra.x + rb.x) / 2, y: (ra.y + rb.y) / 2, z: (ra.z + rb.z) / 2 };
  st.yOff = 0;
  const diff = Math.abs(lr - lm);
  setMode('placed', 'Alineado con A y B a escala 1:1. Diferencia entre distancias: ' + fmtCm(diff) +
    (diff > 0.25 ? '. Es alta: revisa los puntos y pulsa «Alinear con A y B».' : '. Camina para recorrerlo.'));
  setLocked(true);
  applyPose();
}
function showTap(k, h) {
  const m = makeMarker(COLORS[k], 0.8);
  m.position.set(h.x, h.y + 0.005, h.z);
  ctx.scene.add(m);
  st.taps.push(m);
}
function clearTaps() {
  for (const m of st.taps) ctx.scene.remove(m);
  st.taps = [];
}

/* gestos: un dedo mueve sobre el piso, dos dedos giran (escala bloqueada 1:1) */
function floorPoint(cx, cy) {
  if (!st.view || !st.proj || !st.R) return null;
  const t = T3;
  const inv = new t.Matrix4().fromArray(st.proj).invert();
  const wm = new t.Matrix4().fromArray(st.view);
  const nx = cx / window.innerWidth * 2 - 1, ny = 1 - cy / window.innerHeight * 2;
  const o = new t.Vector3().setFromMatrixPosition(wm);
  const d = new t.Vector3(nx, ny, 0.5).applyMatrix4(inv).applyMatrix4(wm).sub(o);
  if (Math.abs(d.y) < 1e-6) return null;
  const k = (st.R.y + st.yOff - o.y) / d.y;
  if (k <= 0 || k > 200) return null;
  return { x: o.x + d.x * k, z: o.z + d.z * k };
}
function wireGestures(el) {
  const ptrs = new Map();
  let drag = null, twist = null;
  const angle = function () {
    const p = Array.from(ptrs.values());
    return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
  };
  const reset = function () {
    drag = null; twist = null;
    if (ptrs.size === 1) { const p = ptrs.values().next().value; drag = floorPoint(p.x, p.y); }
    if (ptrs.size === 2) twist = angle();
  };
  el.addEventListener('pointerdown', function (e) {
    if (st.mode !== 'placed' || st.locked) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    reset();
  });
  el.addEventListener('pointermove', function (e) {
    if (!ptrs.has(e.pointerId) || st.mode !== 'placed' || st.locked) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1 && drag) {
      const p = floorPoint(e.clientX, e.clientY);
      if (p) { st.R.x += p.x - drag.x; st.R.z += p.z - drag.z; drag = p; applyPose(); }
    } else if (ptrs.size === 2) {
      const a = angle();
      if (twist !== null) {
        let d = a - twist;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        st.theta -= d;
        applyPose();
      }
      twist = a;
    }
  });
  const up = function (e) { if (ptrs.delete(e.pointerId)) reset(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/* ---------- iPhone / iPad: USDZ para AR Quick Look ---------- */
let qlURL = null;
function sectionCut() {
  const se = $('sectionEnabled');
  if (!se || !se.checked) return Infinity;
  const parts = sceneParts();
  for (const m of parts.group.children) {
    const pl = m.material && m.material.clippingPlanes;
    if (pl && pl.length) return pl[0].constant;
  }
  return Infinity;
}
function crc32(u8) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function usdzBlob(name, data) {
  const nameB = new TextEncoder().encode(name);
  const crc = crc32(data);
  const head = 30 + nameB.length;
  let pad = (64 - (head % 64)) % 64;
  if (pad > 0 && pad < 4) pad += 64;
  const lh = new Uint8Array(head + pad);
  const lv = new DataView(lh.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
  lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameB.length, true); lv.setUint16(28, pad, true);
  lh.set(nameB, 30);
  if (pad) { lv.setUint16(head, 0x1986, true); lv.setUint16(head + 2, pad - 4, true); }
  const cd = new Uint8Array(46 + nameB.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true);
  cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameB.length, true);
  cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
  cv.setUint32(38, 0, true); cv.setUint32(42, 0, true);
  cd.set(nameB, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true); ev.setUint32(16, lh.length + data.length, true);
  return new Blob([lh, data, cd, end], { type: 'model/vnd.usdz+zip' });
}
function buildUSDZ() {
  const parts = sceneParts();
  if (!parts || !parts.group) throw new Error('Espera a que cargue el modelo.');
  const meshes = parts.group.children.filter(function (m) { return isModelMesh(m) && m.visible && m.geometry.drawRange.count > 0; });
  if (!meshes.length) throw new Error('No hay elementos visibles para exportar.');
  const f = floorY();
  const o = refs.A || modelCenter();
  const cut = sectionCut();
  const keyIndex = new Map();
  const groups = [];
  const tri = [];
  let total = 0;
  meshes.forEach(function (mesh, mi) {
    const g = mesh.geometry, idx = g.index.array, col = g.attributes.color.array, pos = g.attributes.position.array;
    const n = Math.floor(Math.min(g.drawRange.count, idx.length) / 3);
    mesh.updateMatrixWorld();
    const ty = mesh.matrixWorld.elements[13];
    const op = Math.round(Math.min(1, Math.max(0.05, mesh.material.opacity == null ? 1 : mesh.material.opacity)) * 20);
    const tg = new Int32Array(n);
    for (let t = 0; t < n; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      if (cut !== Infinity && (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3 + ty > cut) { tg[t] = -1; continue; }
      const key = ((Math.round(col[a * 3] * 31) * 32 + Math.round(col[a * 3 + 1] * 31)) * 32 + Math.round(col[a * 3 + 2] * 31)) * 32 + op;
      let gi = keyIndex.get(key);
      if (gi === undefined) {
        gi = groups.length;
        keyIndex.set(key, gi);
        groups.push({ color: [col[a * 3], col[a * 3 + 1], col[a * 3 + 2]], opacity: op / 20, count: 0, fill: 0, list: null });
      }
      groups[gi].count++;
      tg[t] = gi;
      total++;
    }
    tri[mi] = tg;
  });
  if (!total) throw new Error('El corte deja el modelo vacío.');
  if (total > 3000000) throw new Error('El modelo visible es demasiado pesado (' + fmtInt(total) + ' triángulos). Oculta disciplinas o activa el corte.');
  for (const g of groups) g.list = new Uint32Array(g.count * 2);
  tri.forEach(function (tg, mi) {
    for (let t = 0; t < tg.length; t++) {
      const gi = tg[t];
      if (gi < 0) continue;
      const g = groups[gi];
      g.list[g.fill++] = mi;
      g.list[g.fill++] = t;
    }
  });
  const stamp = meshes.map(function (m) { return new Int32Array(m.geometry.attributes.position.count); });
  const remap = meshes.map(function (m) { return new Int32Array(m.geometry.attributes.position.count); });
  const q3 = function (v) { return Math.round(v * 1000) / 1000; };
  const q2 = function (v) { return Math.round(v * 100) / 100; };
  const out = [];
  out.push('#usda 1.0\n(\n    customLayerData = {\n        string creator = "BIM 4D AR"\n    }\n    defaultPrim = "Obra"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n\n');
  out.push('def Xform "Obra" (\n    kind = "component"\n)\n{\n    def Scope "Materiales"\n    {\n');
  groups.forEach(function (g, gi) {
    out.push('        def Material "M' + gi + '"\n        {\n' +
      '            token outputs:surface.connect = </Obra/Materiales/M' + gi + '/Superficie.outputs:surface>\n' +
      '            def Shader "Superficie"\n            {\n' +
      '                uniform token info:id = "UsdPreviewSurface"\n' +
      '                color3f inputs:diffuseColor = (' + q3(g.color[0]) + ', ' + q3(g.color[1]) + ', ' + q3(g.color[2]) + ')\n' +
      '                float inputs:metallic = 0\n                float inputs:roughness = 0.85\n' +
      '                float inputs:opacity = ' + g.opacity + '\n                token outputs:surface\n            }\n        }\n');
  });
  out.push('    }\n');
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  groups.forEach(function (g, gi) {
    const pts = [], nrm = [], ind = [];
    let nv = 0;
    const gmn = [Infinity, Infinity, Infinity], gmx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < g.list.length; k += 2) {
      const mi = g.list[k], t = g.list[k + 1];
      const mesh = meshes[mi], geo = mesh.geometry, idx = geo.index.array, pos = geo.attributes.position.array;
      const nor = geo.attributes.normal ? geo.attributes.normal.array : null;
      const e = mesh.matrixWorld.elements;
      const sm = stamp[mi], rm = remap[mi];
      for (let c = 0; c < 3; c++) {
        const v = idx[t * 3 + c];
        if (sm[v] !== gi + 1) {
          sm[v] = gi + 1;
          rm[v] = nv++;
          const x = q3(pos[v * 3] + e[12] - o.x), y = q3(pos[v * 3 + 1] + e[13] - f), z = q3(pos[v * 3 + 2] + e[14] - o.z);
          if (x < gmn[0]) gmn[0] = x; if (y < gmn[1]) gmn[1] = y; if (z < gmn[2]) gmn[2] = z;
          if (x > gmx[0]) gmx[0] = x; if (y > gmx[1]) gmx[1] = y; if (z > gmx[2]) gmx[2] = z;
          pts.push('(' + x + ', ' + y + ', ' + z + ')');
          nrm.push(nor ? '(' + q2(nor[v * 3]) + ', ' + q2(nor[v * 3 + 1]) + ', ' + q2(nor[v * 3 + 2]) + ')' : '(0, 1, 0)');
        }
        ind.push(rm[v]);
      }
    }
    for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], gmn[a]); mx[a] = Math.max(mx[a], gmx[a]); }
    out.push('\n    def Mesh "G' + gi + '" (\n        prepend apiSchemas = ["MaterialBindingAPI"]\n    )\n    {\n' +
      '        uniform bool doubleSided = 1\n' +
      '        float3[] extent = [(' + gmn.join(', ') + '), (' + gmx.join(', ') + ')]\n' +
      '        int[] faceVertexCounts = [' + new Array(ind.length / 3).fill('3').join(', ') + ']\n' +
      '        int[] faceVertexIndices = [' + ind.join(', ') + ']\n' +
      '        rel material:binding = </Obra/Materiales/M' + gi + '>\n' +
      '        normal3f[] normals = [' + nrm.join(', ') + '] (\n            interpolation = "vertex"\n        )\n' +
      '        point3f[] points = [' + pts.join(', ') + ']\n' +
      '        uniform token subdivisionScheme = "none"\n    }\n');
    g.list = null;
  });
  out.push('}\n');
  const data = new TextEncoder().encode(out.join(''));
  return { blob: usdzBlob('obra.usda', data), triangles: total, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}
async function prepareQuickLook() {
  const btn = $('arx-usdz');
  btn.disabled = true;
  $('arx-ql').hidden = true;
  say('Preparando el modelo para AR…');
  await new Promise(function (r) { setTimeout(r, 40); });
  try {
    const res = buildUSDZ();
    if (qlURL) URL.revokeObjectURL(qlURL);
    qlURL = URL.createObjectURL(res.blob);
    $('arx-ql').href = qlURL + '#allowsContentScaling=0';
    $('arx-ql').hidden = false;
    say('Listo: ' + fmtInt(res.triangles) + ' triángulos · ' + (res.blob.size / 1048576).toFixed(1) + ' MB · ' +
      res.size[0].toFixed(1) + ' × ' + res.size[2].toFixed(1) + ' m. Toca «Abrir en AR», apunta al piso y camina dentro del modelo.');
  } catch (e) {
    say(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- arranque ---------- */
function init() {
  const arBtn = $('ar');
  if (arBtn) { arBtn.textContent = 'AR en obra'; arBtn.title = 'Ver el modelo con la cámara del celular o tablet, a escala 1:1'; }
  document.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('#ar') : null;
    if (!b || !ctx.renderer) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openDialog();
  }, true);
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'level') setTimeout(loadRefs, 60);
  }, true);
  let tries = 0;
  const wait = setInterval(function () {
    if (modelReady()) {
      clearInterval(wait);
      const a = parsePair(params.get('refA')), b = parsePair(params.get('refB'));
      if (a && b) { refs.A = a; refs.B = b; saveRefs(); updateMarkers(); } else loadRefs();
      if (params.get('modo') === 'ar') openDialog();
    } else if (++tries > 360) clearInterval(wait);
  }, 500);
  setInterval(function () { if (markerRoot && markerRoot.visible && !AR.session) updateMarkers(); }, 1500);
  checkXR();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.__bimAR = { ctx: ctx, refs: refs, buildUSDZ: buildUSDZ, openDialog: openDialog, raycastModel: raycastModel };
