// Visor BIM 4D · Oficinas Las Bambas · Piso 18
// Fuente propia: geometría exportada de los RVT v2 (Revit 2026) + puente 4D v6.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = (id) => document.getElementById(id);
const V = 'b9';
const params = new URLSearchParams(location.search);
const fmt = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat('es-PE');
const DAY = 864e5;

export const STATES = {
  INSTALADO: { label: 'Instalado', color: '#2e9e5b' },
  EN_INSTALACION: { label: 'En instalación', color: '#d99a1e' },
  SUMINISTRO: { label: 'Suministro / fabricación', color: '#8a5cd6' },
  PENDIENTE: { label: 'Pendiente', color: '#c9cdd4' },
  EXISTENTE: { label: 'Existente / no se programa', color: '#7b8088' },
};
const PHASES = { SUMINISTRO: 'Suministro', FABRICACION: 'Fabricación', INSTALACION: 'Instalación', PRUEBA: 'Prueba', ACABADO: 'Acabado' };
const METHODS = {
  BRIDGE: 'Puente 4D v6 (regla de coordinación por disciplina, categoría y tipo)',
  CONEXION: 'Heredado del tramo conectado (conexión MEP en Revit)',
  REGLA_VISOR: 'Regla de coordinación del visor — propuesta pendiente de validar',
  CONDICION_4D: 'Condición 4D del modelo semántico v2',
  FASE_REVIT: 'Fase de Revit', CRITERIO: 'Criterio de coordinación',
};

// ------------------------------------------------------------------ estado
const S = {
  project: null, schedule: null, tasks: new Map(), disc: new Map(), elems: [], byUid: new Map(),
  cut: null, colorMode: params.get('color') || '4d', pending: params.get('pend') || 'ghost',
  opacity: 1, xray: false, cutOn: false, cutT: 0.62, ceilings: false, upper: false, edges: !matchMedia('(pointer:coarse)').matches,
  filter: { cat: '', sys: '', link: '' }, hidden: new Set(), isolate: null, selected: null, taskSel: null,
  mode: 'orbit', bounds: new THREE.Box3(), floorY: 65, listeners: {},
};
export const BIM = S;
window.BIM = S;
const emit = (ev, d) => (S.listeners[ev] || []).forEach((f) => f(d));
S.on = (ev, f) => { (S.listeners[ev] = S.listeners[ev] || []).push(f); };

// ------------------------------------------------------------------ escena
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
renderer.xr.enabled = true;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 3000);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500);
let activeCam = camera;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.maxPolarAngle = Math.PI * 0.497; controls.screenSpacePanning = true;
const hemi = new THREE.HemisphereLight(0xf4f7ff, 0x3a3f47, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 80, 40); scene.add(sun);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45); fill.position.set(-40, 30, -20); scene.add(fill);
const modelRoot = new THREE.Group(); modelRoot.name = 'modelo'; scene.add(modelRoot);
const helpers = new THREE.Group(); scene.add(helpers);
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
S.three = { THREE, renderer, scene, camera, controls, modelRoot, helpers, clipPlane };

const matSolid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: [clipPlane] });
const matGhost = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true,
  opacity: 0.12, depthWrite: false, clippingPlanes: [clipPlane] });
const matEdge = new THREE.LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.55, clippingPlanes: [clipPlane] });
S.materials = { matSolid, matGhost, matEdge };

let needsRender = true;
const invalidate = () => { needsRender = true; };
S.invalidate = invalidate;
controls.addEventListener('change', invalidate);
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  if (renderer.xr.isPresenting) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const a = w / h, s = ortho.top;
  ortho.left = -s * a; ortho.right = s * a; ortho.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe(view);

// ------------------------------------------------------------------ utilidades de fechas
const toDay = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
const fromDay = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const fmtDate = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
S.fmtDate = fmtDate;

export function stateOf(e, cut = S.cut) {
  if (e.st === 'EXISTENTE' || e.st === 'NO_APLICA' || !e.links.length) return 'EXISTENTE';
  if (e.fIns && e.fIns <= cut) return 'INSTALADO';
  if (e.sIns && e.sIns <= cut) return 'EN_INSTALACION';
  if (e.sPre && e.sPre <= cut) return 'SUMINISTRO';
  return 'PENDIENTE';
}
S.stateOf = stateOf;

// ------------------------------------------------------------------ carga
async function fetchProgress(url, onBytes) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' · ' + url);
  if (!r.body || !onBytes) return r.arrayBuffer();
  const reader = r.body.getReader(); const chunks = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length); }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
async function gunzip(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  return ds.arrayBuffer();
}
const hex = (h) => new THREE.Color(h);
const C_ST = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [k, hex(v.color)]));
const C_SEL = new THREE.Color('#33b5ff');

async function loadDiscipline(d, lvl, onBytes) {
  const [head, bin] = await Promise.all([
    fetch('./data/' + lvl + '/' + d.d + '.json?v=' + V).then((r) => r.json()),
    fetchProgress('./data/' + lvl + '/' + d.d + '.bin?v=' + V, onBytes).then(gunzip),
  ]);
  const nv = head.nv, ni = head.ni;
  let o = 0;
  const pos = new Uint16Array(bin, o, nv * 3); o += nv * 6;
  const nor = new Int8Array(bin, o, nv * 3); o += nv * 3;
  const real = new Uint8Array(bin, o, nv * 3); o += nv * 3; o += head.pad;
  const idx = new Uint32Array(bin.slice(o, o + ni * 4));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  const col = new Uint8Array(nv * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(ni), 1));
  g.boundingSphere = null;
  const mesh = new THREE.Mesh(g, [matSolid, matGhost]);
  mesh.position.set(head.lo[0], head.lo[1], head.lo[2]);
  mesh.scale.setScalar(head.scale);
  mesh.name = d.d;
  mesh.frustumCulled = false;
  // geometría fija para selección (BVH)
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', g.getAttribute('position'));
  pg.setIndex(new THREE.BufferAttribute(idx, 1));
  const pick = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.copy(mesh.position); pick.scale.copy(mesh.scale); pick.userData.disc = d.d;
  const D = { ...d, head, mesh, pick, idx, real, col, elems: head.elements, visible: true, opacity: 1, edges: null };
  head.elements.forEach((e, k) => { e.k = k; e.D = D; S.byUid.set(e.uid, e); S.elems.push(e); });
  D.triStart = head.elements.map((e) => e.i[0] / 3);
  modelRoot.add(mesh); helpers.add(pick);
  S.disc.set(d.d, D);
  return D;
}

function buildEdges(D) {
  // aristas de rasgo (> 35°) sólo para elementos de geometría simple: realza muros, cielos, ductos y bandejas
  const pos = D.mesh.geometry.getAttribute('position').array;
  const segs = [];
  const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
  for (const e of D.elems) {
    const nt = e.i[1] / 3;
    if (nt > 900 || nt < 2) continue;
    const map = new Map();
    const fn = [];
    for (let t = 0; t < nt; t++) {
      const b = e.i[0] + t * 3;
      const ia = D.idx[b], ib = D.idx[b + 1], ic = D.idx[b + 2];
      const ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
      const ux = pos[ib * 3] - ax, uy = pos[ib * 3 + 1] - ay, uz = pos[ib * 3 + 2] - az;
      const vx = pos[ic * 3] - ax, vy = pos[ic * 3 + 1] - ay, vz = pos[ic * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; fn.push(nx, ny, nz);
      const vk = (i) => (pos[i * 3] * 65536 + pos[i * 3 + 1]) * 65536 + pos[i * 3 + 2];
      const ids = [ia, ib, ic].map(vk);
      for (let s = 0; s < 3; s++) {
        const p = ids[s], q = ids[(s + 1) % 3];
        const k2 = p < q ? p + '|' + q : q + '|' + p;
        const m = map.get(k2);
        if (m) m.push(t); else map.set(k2, [t, [ia, ib, ic][s], [ia, ib, ic][(s + 1) % 3]]);
      }
    }
    for (const v of map.values()) {
      const t0 = v[0];
      if (v.length === 3) { segs.push(v[1], v[2]); continue; }
      const t1 = v[3];
      const d = fn[t0 * 3] * fn[t1 * 3] + fn[t0 * 3 + 1] * fn[t1 * 3 + 1] + fn[t0 * 3 + 2] * fn[t1 * 3 + 2];
      if (Math.abs(d) < 0.82) segs.push(v[1], v[2]);
    }
    e.edge = [0, 0];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', D.mesh.geometry.getAttribute('position'));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(segs), 1));
  const lines = new THREE.LineSegments(g, matEdge);
  lines.position.copy(D.mesh.position); lines.scale.copy(D.mesh.scale); lines.frustumCulled = false; lines.renderOrder = 2;
  D.edges = lines; modelRoot.add(lines);
}

// ------------------------------------------------------------------ visibilidad y color
function passesFilter(e) {
  const f = S.filter;
  if (!e.D.visible) return false;
  if (S.hidden.has(e.uid)) return false;
  if (S.isolate && !S.isolate.has(e.uid)) return false;
  if (!S.ceilings && e.bic === 'OST_Ceilings') return false;
  if (!S.upper && e.upper) return false;
  if (f.cat && e.cat !== f.cat) return false;
  if (f.sys && e.sysType !== f.sys && e.sys !== f.sys) return false;
  if (f.link) {
    if (f.link === 'EXIST') { if (!(e.st || !e.links.length)) return false; }
    else if (e.m4d !== f.link) return false;
  }
  return true;
}
S.passesFilter = passesFilter;

const counts = {};
export function refresh() {
  const cut = S.cut;
  for (const k in STATES) counts[k] = 0;
  const tmp = { r: 0, g: 0, b: 0 };
  for (const D of S.disc.values()) {
    const g = D.mesh.geometry, col = D.col, real = D.real;
    const index = g.index.array;
    let solidN = 0;
    const ghostList = [];
    const dcol = hex(D.color);
    for (const e of D.elems) {
      e.state = stateOf(e, cut);
      const vis = passesFilter(e);
      e.vis = vis;
      if (vis) counts[e.state]++;
      const [v0, vn] = e.v;
      // color
      let c = null, useReal = false;
      if (S.selected === e) c = C_SEL;
      else if (S.colorMode === '4d') c = C_ST[e.state];
      else if (S.colorMode === 'disc') c = dcol;
      else useReal = true;
      if (useReal) col.set(real.subarray(v0 * 3, (v0 + vn) * 3), v0 * 3);
      else {
        c.getRGB(tmp, THREE.SRGBColorSpace);
        const r = Math.round(tmp.r * 255), gg = Math.round(tmp.g * 255), b = Math.round(tmp.b * 255);
        for (let i = v0 * 3, n = (v0 + vn) * 3; i < n; i += 3) { col[i] = r; col[i + 1] = gg; col[i + 2] = b; }
      }
      if (!vis) continue;
      const ghost = S.xray || (S.colorMode === '4d' && e.state === 'PENDIENTE' && S.pending === 'ghost') || e.bic === 'OST_PipeInsulations';
      if (S.colorMode === '4d' && e.state === 'PENDIENTE' && S.pending === 'hide' && S.selected !== e) continue;
      const [i0, n] = e.i;
      if (ghost && S.selected !== e) ghostList.push(e);
      else { index.set(D.idx.subarray(i0, i0 + n), solidN); solidN += n; }
    }
    let gN = solidN;
    for (const e of ghostList) { index.set(D.idx.subarray(e.i[0], e.i[0] + e.i[1]), gN); gN += e.i[1]; }
    g.clearGroups(); g.addGroup(0, solidN, 0); g.addGroup(solidN, gN - solidN, 1);
    g.setDrawRange(0, gN);
    g.index.needsUpdate = true; g.attributes.color.needsUpdate = true;
    D.mesh.visible = D.visible && gN > 0;
    if (D.edges) D.edges.visible = S.edges && D.visible && !S.xray && S.opacity > 0.6;
  }
  const op = S.opacity;
  matSolid.transparent = op < 1; matSolid.opacity = op; matSolid.depthWrite = op >= 1;
  matGhost.opacity = S.xray ? 0.16 : 0.1;
  updateLegend();
  emit('refresh');
  invalidate();
}
S.refresh = refresh;
// los colores de Uint8 se usan tal cual en espacio sRGB: el atributo normalizado se interpreta lineal; compensamos en el material
matSolid.onBeforeCompile = matGhost.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = pow(diffuseColor.rgb, vec3(2.2));');
};

function updateLegend() {
  const html = Object.entries(STATES).map(([k, v]) => '<span><i style="background:' + v.color + '"></i>' + v.label + '<b>' + fmtInt.format(counts[k] || 0) + '</b></span>').join('');
  if (S.colorMode === '4d') { $('legend').innerHTML = html; $('legend-float').innerHTML = html; }
  else if (S.colorMode === 'disc') {
    const h2 = [...S.disc.values()].map((D) => '<span><i style="background:' + D.color + '"></i>' + D.name + '</span>').join('');
    $('legend').innerHTML = h2; $('legend-float').innerHTML = h2;
  } else { $('legend').innerHTML = '<span class="muted">Colores de los materiales de Revit</span>'; $('legend-float').innerHTML = ''; }
}

// ------------------------------------------------------------------ corte horizontal
function applyCut() {
  if (!S.cutOn) { clipPlane.constant = 1e6; invalidate(); return; }
  const y0 = S.floorY - 0.2, y1 = S.bounds.max.y;
  clipPlane.constant = y0 + (y1 - y0) * S.cutT;
  invalidate();
}
S.setCut = (on, t) => { S.cutOn = on; if (t != null) S.cutT = t; $('cut-on').checked = on; $('cut').disabled = !on; $('cut').value = Math.round(S.cutT * 100); applyCut(); };

// ------------------------------------------------------------------ cámara
function fit(box = S.bounds, iso = true) {
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.z) * 0.62 + 4;
  controls.target.copy(c);
  if (iso) camera.position.set(c.x + r * 0.75, c.y + r * 0.85, c.z + r * 0.95);
  else camera.position.set(c.x, c.y + r * 1.4, c.z + 0.01);
  camera.near = 0.05; camera.far = r * 20; camera.updateProjectionMatrix();
  controls.update(); invalidate();
}
S.fit = fit;
function flyTo(target, dist = 6) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, dist);
  controls.update(); invalidate();
}

// ------------------------------------------------------------------ modos de vista
const keys = new Set();
let walkLook = null;
const joy = { x: 0, y: 0, id: null };
function setMode(m) {
  S.mode = m;
  document.querySelectorAll('.hud.tl [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('joystick').style.display = m === 'walk' && matchMedia('(pointer:coarse)').matches ? 'block' : 'none';
  if (m === 'plan') {
    activeCam = ortho;
    const c = S.bounds.getCenter(new THREE.Vector3()), s = S.bounds.getSize(new THREE.Vector3());
    const a = view.clientWidth / view.clientHeight; const half = Math.max(s.z, s.x / a) * 0.55;
    ortho.top = half; ortho.bottom = -half; ortho.left = -half * a; ortho.right = half * a;
    ortho.position.set(c.x, S.bounds.max.y + 50, c.z); ortho.up.set(0, 0, -1); ortho.lookAt(c.x, 0, c.z); ortho.zoom = 1; ortho.updateProjectionMatrix();
    controls.object = ortho; controls.target.set(c.x, S.floorY, c.z); controls.enableRotate = false; controls.update();
    S.setCut(true, 0.38);
    tip('Planta con corte a 1,5 m. Arrastra para desplazar y pellizca o usa la rueda para acercar.');
  } else {
    activeCam = camera; controls.object = camera; controls.enableRotate = true;
    if (m === 'walk') {
      controls.enabled = false;
      const c = S.bounds.getCenter(new THREE.Vector3());
      camera.position.set(c.x, S.floorY + 1.6, c.z); camera.rotation.set(0, 0, 0, 'YXZ');
      camera.near = 0.05; camera.updateProjectionMatrix();
      S.setCut(false);
      tip(matchMedia('(pointer:coarse)').matches ? 'Usa el círculo para caminar y arrastra para mirar.' : 'Camina con W A S D o flechas y arrastra para mirar.');
    } else { controls.enabled = true; if (S.prevMode === 'walk' || S.prevMode === 'plan') fit(); if (S.prevMode === 'plan') S.setCut(false); }
  }
  S.prevMode = m;
  invalidate();
}
S.setMode = setMode;
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
renderer.domElement.addEventListener('pointerdown', (e) => { if (S.mode === 'walk') { walkLook = [e.clientX, e.clientY]; renderer.domElement.setPointerCapture(e.pointerId); } });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (S.mode !== 'walk' || !walkLook) return;
  camera.rotation.order = 'YXZ';
  camera.rotation.y -= (e.clientX - walkLook[0]) * 0.0042;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (e.clientY - walkLook[1]) * 0.0042, -1.45, 1.45);
  walkLook = [e.clientX, e.clientY]; invalidate();
});
renderer.domElement.addEventListener('pointerup', () => { walkLook = null; });
const jEl = $('joystick');
jEl.addEventListener('pointerdown', (e) => { joy.id = e.pointerId; jEl.setPointerCapture(e.pointerId); moveJoy(e); });
jEl.addEventListener('pointermove', (e) => { if (joy.id === e.pointerId) moveJoy(e); });
jEl.addEventListener('pointerup', () => { joy.id = null; joy.x = joy.y = 0; jEl.firstElementChild.style.transform = ''; });
function moveJoy(e) {
  const r = jEl.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  joy.x = x; joy.y = y; jEl.firstElementChild.style.transform = 'translate(' + x * 36 + 'px,' + y * 36 + 'px)';
}

// ------------------------------------------------------------------ bucle
const clock = new THREE.Clock();
let frameHook = null;
S.setFrameHook = (f) => { frameHook = f; };
renderer.setAnimationLoop((t, frame) => {
  if (frame && frameHook) { frameHook(t, frame); return; }
  const dt = Math.min(0.05, clock.getDelta());
  if (S.mode === 'walk') {
    const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y;
    const side = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x;
    if (Math.abs(fwd) > 0.02 || Math.abs(side) > 0.02) {
      const dir = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      camera.position.addScaledVector(dir, fwd * 2.2 * dt).addScaledVector(right, side * 2.2 * dt);
      invalidate();
    }
  } else if (controls.enabled) controls.update();
  if (needsRender) { needsRender = false; renderer.render(scene, activeCam); }
});

// ------------------------------------------------------------------ selección
const ray = new THREE.Raycaster(); ray.firstHitOnly = false;
function triToElem(D, tri) {
  const a = D.triStart; let lo = 0, hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= tri) lo = m; else hi = m - 1; }
  return D.elems[lo];
}
function ensureBVH(D) { if (!D.pick.geometry.boundsTree) D.pick.geometry.computeBoundsTree({ maxLeafTris: 12, indirect: true }); }
export function pickAt(ndc, cam = activeCam, rayOverride = null) {
  for (const D of S.disc.values()) if (D.visible) ensureBVH(D);
  if (rayOverride) ray.set(rayOverride.origin, rayOverride.direction); else ray.setFromCamera(ndc, cam);
  const picks = [...S.disc.values()].filter((D) => D.visible).map((D) => D.pick);
  const hits = ray.intersectObjects(picks, false);
  let ghost = null;
  for (const h of hits) {
    if (S.cutOn && clipPlane.distanceToPoint(h.point) < 0) continue;
    const D = S.disc.get(h.object.userData.disc);
    const e = triToElem(D, h.faceIndex);
    if (!e || !e.vis) continue;
    const isGhost = S.xray || e.bic === 'OST_PipeInsulations' || (S.colorMode === '4d' && e.state === 'PENDIENTE');
    if (S.colorMode === '4d' && e.state === 'PENDIENTE' && S.pending === 'hide') continue;
    if (isGhost) { if (!ghost) ghost = { e, point: h.point, dist: h.distance }; continue; }
    return { e, point: h.point, dist: h.distance };
  }
  return ghost;
}
S.pickAt = pickAt;
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2);
  const h = pickAt(ndc);
  if (measuring) { measurePoint(h, e); return; }
  select(h ? h.e : null);
});
export function select(e, fly = false) {
  S.selected = e || null;
  refresh();
  renderInfo();
  if (e && fly) {
    const bb = e.bb; flyTo(new THREE.Vector3((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2), Math.max(4, Math.hypot(bb[3] - bb[0], bb[5] - bb[2]) * 1.6));
  }
  if (e && matchMedia('(max-width:860px)').matches) openPanel('p-info');
  emit('select', e);
}
S.select = select;

// ------------------------------------------------------------------ medición
let measuring = false, mPts = [];
const mLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x33b5ff, depthTest: false }));
mLine.renderOrder = 10; helpers.add(mLine);
function measurePoint(h) {
  if (!h) return;
  mPts.push(h.point.clone()); if (mPts.length > 2) mPts = [h.point.clone()];
  mLine.geometry.setFromPoints(mPts);
  const lab = $('measure-label');
  if (mPts.length === 2) {
    const d = mPts[0].distanceTo(mPts[1]);
    const dy = Math.abs(mPts[0].y - mPts[1].y);
    const mid = mPts[0].clone().add(mPts[1]).multiplyScalar(0.5).project(activeCam);
    const r = renderer.domElement.getBoundingClientRect();
    lab.style.left = ((mid.x + 1) / 2 * r.width) + 'px'; lab.style.top = ((1 - mid.y) / 2 * r.height) + 'px';
    lab.textContent = fmt.format(d) + ' m · Δz ' + fmt.format(dy) + ' m'; lab.style.display = 'block';
  } else lab.style.display = 'none';
  invalidate();
}
$('t-measure').addEventListener('click', () => {
  measuring = !measuring; $('t-measure').setAttribute('aria-pressed', String(measuring));
  mPts = []; mLine.geometry.setFromPoints([]); $('measure-label').style.display = 'none';
  tip(measuring ? 'Medición: toca dos puntos del modelo.' : ''); invalidate();
});

// ------------------------------------------------------------------ inspector
function taskName(uid) { const t = S.tasks.get(uid); return t ? t.name : 'Tarea ' + uid; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderInfo() {
  const e = S.selected, box = $('info');
  if (!e) { box.innerHTML = '<p class="empty">Toca un elemento del modelo para ver su ficha, su estado al corte y sus actividades del cronograma.</p>'; return; }
  const st = STATES[e.state];
  const rows = [
    ['Especialidad', e.D.name], ['Categoría', e.cat], ['Familia', e.fam], ['Tipo', e.type], ['Nivel', e.lvl],
    ['Sistema', e.sys], ['Tipo de sistema', e.sysType], ['Tamaño', e.size],
    ['Longitud', e.len != null ? fmt.format(e.len) + ' m' : null], ['Área', e.area != null ? fmt.format(e.area) + ' m²' : null],
    ['Volumen', e.vol != null ? fmt.format(e.vol) + ' m³' : null], ['Materiales', e.mats && e.mats.join(', ')],
    ['Marca', e.mark], ['Comentarios', e.comments], ['ID Revit', e.id],
  ].filter((r) => r[1] != null && r[1] !== '');
  const drrp = e.drrp ? Object.entries(e.drrp).map(([k, v]) => [k.replace('DRRP_', ''), v]) : [];
  const links = e.links.map((l) => '<div class="lk"><div class="ph ph-' + l.p + '">' + (PHASES[l.p] || l.p) + ' · ' + ({ A: 'confianza alta', M: 'confianza media', B: 'confianza baja' }[l.c] || '') + '</div>'
    + '<div class="nm">' + esc(taskName(l.t)) + '</div><div class="dt">' + fmtDate(l.s) + ' → ' + fmtDate(l.f) + ' · UID ' + l.t + (l.r ? ' · ' + esc(l.r) : '') + '</div></div>').join('');
  box.innerHTML =
    '<section class="sec"><p class="el-title">' + esc(e.fam || e.cat) + '</p><div class="muted">' + esc(e.type || '') + '</div>'
    + '<div class="chips"><span class="chip"><i style="background:' + e.D.color + '"></i>' + esc(e.D.d) + '</span><span class="chip">' + esc(e.cat) + '</span></div>'
    + '<div class="state-big"><i style="background:' + st.color + '"></i><div><b>' + st.label + '</b><span class="small muted">al ' + fmtDate(S.cut) + '</span></div></div>'
    + (e.sIns ? '<dl class="kv"><dt>Inicio 4D</dt><dd>' + fmtDate(e.s4d) + '</dd><dt>Instalación</dt><dd>' + fmtDate(e.sIns) + ' → ' + fmtDate(e.fIns) + '</dd><dt>Cierre total</dt><dd>' + fmtDate(e.fAll) + '</dd></dl>' : '')
    + (e.note ? '<div class="note' + (e.m4d === 'REGLA_VISOR' ? ' warn' : '') + '">' + esc(e.note) + '</div>' : '')
    + '<div class="btns"><button id="b-iso">Aislar</button><button id="b-hide">Ocultar</button><button id="b-fly">Acercar</button><button id="b-showall" class="ghost">Mostrar todo</button></div></section>'
    + '<section class="sec"><h2>Actividades del cronograma <span class="muted">' + e.links.length + '</span></h2><div class="links">' + (links || '<p class="muted small">Sin actividades: el elemento existe y no se ejecuta en esta obra.</p>') + '</div>'
    + '<p class="method">Vínculo: ' + esc(METHODS[e.m4d] || e.m4d) + '</p></section>'
    + '<section class="sec"><h2>Propiedades</h2><dl class="kv">' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>'
    + (drrp.length ? '<h2 style="margin-top:12px">Control de obra (DRRP)</h2><dl class="kv">' + drrp.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' : '')
    + '<p class="small muted" style="word-break:break-all">UniqueId: ' + esc(e.uid) + '</p></section>'
    + '<section class="sec"><h2>Observaciones de obra <button class="ghost small" id="b-obs-exp">Exportar CSV</button></h2><div id="obs-box"></div></section>';
  $('b-iso').onclick = () => { S.isolate = new Set([e.uid]); refresh(); tip('Elemento aislado. «Mostrar todo» restablece la vista.'); };
  $('b-hide').onclick = () => { S.hidden.add(e.uid); select(null); };
  $('b-fly').onclick = () => select(e, true);
  $('b-showall').onclick = showAll;
  $('b-obs-exp').onclick = exportObs;
  renderObs(e);
}
function showAll() { S.hidden.clear(); S.isolate = null; S.taskSel = null; document.querySelectorAll('.act.sel').forEach((x) => x.classList.remove('sel')); refresh(); }
S.showAll = showAll;


// ------------------------------------------------------------------ observaciones de campo (se guardan en este equipo)
const OBS = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('bim4d-obs', 1);
      r.onupgradeneeded = () => { const os = r.result.createObjectStore('obs', { keyPath: 'id' }); os.createIndex('uid', 'uid'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error);
    });
  },
  async all() { const db = await this.open(); return new Promise((res) => { const q = db.transaction('obs').objectStore('obs').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); },
  async of(uid) { return (await this.all()).filter((o) => o.uid === uid).sort((a, b) => (a.at < b.at ? 1 : -1)); },
  async put(o) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('obs', 'readwrite'); t.objectStore('obs').put(o); t.oncomplete = () => res(); }); },
  async del(id) { const db = await this.open(); return new Promise((res) => { const t = db.transaction('obs', 'readwrite'); t.objectStore('obs').delete(id); t.oncomplete = () => res(); }); },
};
S.obs = OBS;
async function renderObs(e) {
  const box = $('obs-box'); if (!box) return;
  let list = [];
  try { list = await OBS.of(e.uid); } catch { box.innerHTML = '<p class="small muted">Este navegador no permite guardar observaciones.</p>'; return; }
  box.innerHTML = (list.length ? list.map((o) => '<div class="lk"><div class="ph">' + esc(o.status) + ' · ' + esc(o.at.slice(0, 16).replace('T', ' ')) + '</div><div class="nm">' + esc(o.text) + '</div>'
      + '<div class="dt">' + esc(o.who || '') + (o.task ? ' · ' + esc(taskName(o.task)) : '') + '</div>' + (o.photo ? '<img src="' + o.photo + '" alt="Foto" style="max-width:100%;border-radius:6px;margin-top:6px">' : '')
      + '<div class="btns" style="margin:6px 0 0"><button class="ghost small" data-del="' + o.id + '">Eliminar</button></div></div>').join('') : '<p class="small muted">Sin observaciones para este elemento.</p>')
    + '<details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:650">+ Nueva observación</summary>'
    + '<label class="field"><span>Observación</span><textarea id="o-text" rows="3" style="width:100%;background:var(--panel-2);color:var(--ink);border:1px solid var(--line-2);border-radius:7px;padding:6px"></textarea></label>'
    + '<label class="field"><span>Responsable</span><input id="o-who" type="text"></label>'
    + '<label class="field"><span>Estado</span><select id="o-status"><option>Pendiente</option><option>En revisión</option><option>Cerrada</option></select></label>'
    + '<label class="field"><span>Actividad</span><select id="o-task"><option value="">Sin actividad</option>' + e.links.map((l) => '<option value="' + l.t + '">' + esc(taskName(l.t)) + '</option>').join('') + '</select></label>'
    + '<label class="field"><span>Foto</span><input id="o-photo" type="file" accept="image/*" capture="environment"></label>'
    + '<button class="primary" id="o-save">Guardar observación</button></details>';
  box.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await OBS.del(b.dataset.del); renderObs(e); });
  $('o-save').onclick = async () => {
    const text = $('o-text').value.trim(); if (!text) { tip('Escribe la observación.'); return; }
    let photo = null; const f = $('o-photo').files[0];
    if (f) photo = await shrinkPhoto(f);
    await OBS.put({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid: e.uid, elementId: e.id, disc: e.D.d, cat: e.cat, fam: e.fam, type: e.type,
      text, who: $('o-who').value.trim(), status: $('o-status').value, task: $('o-task').value ? +$('o-task').value : null, photo, at: new Date().toISOString(), cut: S.cut });
    tip('Observación guardada en este equipo.'); renderObs(e);
  };
}
function shrinkPhoto(file) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8)); };
    img.onerror = () => res(null); img.src = url;
  });
}
async function exportObs() {
  const list = await OBS.all();
  if (!list.length) { tip('Aún no hay observaciones registradas en este equipo.'); return; }
  const head = ['Fecha', 'Estado', 'Observación', 'Responsable', 'Especialidad', 'Categoría', 'Familia', 'Tipo', 'ID Revit', 'UniqueId', 'Actividad', 'Fecha de corte', 'Con foto'];
  const rows = list.map((o) => [o.at, o.status, o.text, o.who, o.disc, o.cat, o.fam, o.type, o.elementId, o.uid, o.task ? taskName(o.task) : '', o.cut, o.photo ? 'Sí' : 'No']);
  const csv = '﻿' + [head, ...rows].map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'observaciones_piso18_' + S.cut + '.csv'; a.click();
}

// ------------------------------------------------------------------ línea de tiempo
let t0, t1, playing = null;
function setCut(dateStr, fromSlider = false) {
  S.cut = dateStr;
  const d = toDay(dateStr);
  if (!fromSlider) $('time').value = String(d - t0);
  $('cut-date').textContent = fmtDate(dateStr);
  const wk = Math.floor((d - t0) / 7) + 1;
  $('cut-week').textContent = 'Fecha de corte · semana ' + wk + ' de obra' + (dateStr === todayStr() ? ' · hoy' : '');
  $('cut-input').value = dateStr;
  refresh(); renderActs(); if (S.selected) renderInfo();
  emit('cut', dateStr);
}
S.setCutDate = setCut;
function initTimeline() {
  const used = S.schedule.tasks.filter((t) => t.used);
  t0 = toDay(used.reduce((a, t) => (t.s < a ? t.s : a), '9999'));
  t1 = toDay(used.reduce((a, t) => (t.f > a ? t.f : a), '0000'));
  const el = $('time'); el.min = '0'; el.max = String(t1 - t0);
  $('cut-input').min = fromDay(t0); $('cut-input').max = fromDay(t1);
  const ticks = []; for (let i = 0; i <= 4; i++) ticks.push('<span>' + fmtDate(fromDay(t0 + Math.round((t1 - t0) * i / 4))).slice(0, 5) + '</span>');
  $('ticks').innerHTML = ticks.join('');
  el.addEventListener('input', () => setCut(fromDay(t0 + +el.value), true));
  $('cut-input').addEventListener('change', (e) => { if (e.target.value) setCut(e.target.value); });
  $('today').addEventListener('click', () => setCut(clampDate(todayStr())));
  $('play').addEventListener('click', togglePlay);
  const f = params.get('fecha');
  setCut(clampDate(f && /^\d{4}-\d\d-\d\d$/.test(f) ? f : todayStr()));
}
const clampDate = (s) => fromDay(Math.max(t0, Math.min(t1, toDay(s))));
function togglePlay() {
  if (playing) { clearInterval(playing); playing = null; $('play').innerHTML = '<svg class="icon"><use href="#i-play"/></svg>'; return; }
  if (toDay(S.cut) >= t1) setCut(fromDay(t0));
  $('play').innerHTML = '<svg class="icon"><use href="#i-pause"/></svg>';
  playing = setInterval(() => { const d = toDay(S.cut) + 2; if (d > t1) { togglePlay(); return; } setCut(fromDay(d)); }, 160);
}
S.togglePlay = togglePlay;

function renderActs() {
  const box = $('acts'); if (!box.classList.contains('open') && !box.dataset.force) return;
  const used = S.schedule.tasks.filter((t) => t.used).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  const span = t1 - t0, cut = S.cut;
  box.innerHTML = used.map((t) => {
    const a = (toDay(t.s) - t0) / span * 100, w = Math.max(0.6, (toDay(t.f) - toDay(t.s) + 1) / span * 100);
    const cls = t.f <= cut ? 'done' : t.s <= cut ? 'now' : '';
    return '<div class="act ' + cls + (S.taskSel === t.uid ? ' sel' : '') + '" data-uid="' + t.uid + '"><div><span class="wbs">' + t.wbs + '</span>' + esc(t.name) + '</div>'
      + '<div class="bar-g"><i style="left:' + a + '%;width:' + w + '%"></i><b style="left:' + ((toDay(cut) - t0) / span * 100) + '%"></b></div><div class="small muted mono">' + (S.taskCounts.get(t.uid) || 0) + ' el.</div></div>';
  }).join('');
  box.querySelectorAll('.act').forEach((r) => r.addEventListener('click', () => {
    const uid = +r.dataset.uid;
    if (S.taskSel === uid) { showAll(); renderActs(); return; }
    S.taskSel = uid; S.isolate = new Set(S.elems.filter((e) => e.links.some((l) => l.t === uid)).map((e) => e.uid));
    refresh(); renderActs(); tip(taskName(uid) + ': ' + S.isolate.size + ' elementos aislados');
  }));
}
$('acts-toggle').addEventListener('click', () => {
  const b = $('acts'); const on = !b.classList.contains('open'); b.classList.toggle('open', on);
  $('acts-toggle').setAttribute('aria-expanded', String(on)); renderActs();
});

// ------------------------------------------------------------------ paneles y controles
function tip(msg, ms = 3800) { const t = $('tip'); if (!msg) { t.classList.remove('on'); return; } t.textContent = msg; t.classList.add('on'); clearTimeout(tip.h); tip.h = setTimeout(() => t.classList.remove('on'), ms); }
S.tip = tip;
function openPanel(id) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('open', p.id === id && !p.classList.contains('open')));
}
document.querySelectorAll('.tabs-m [data-tab]').forEach((b) => b.addEventListener('click', () => {
  const id = b.dataset.tab;
  if (id === 'acts') { document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open')); $('acts-toggle').click(); return; }
  openPanel(id);
}));
document.querySelectorAll('#color-mode button').forEach((b) => b.addEventListener('click', () => setColorMode(b.dataset.v)));
function setColorMode(v) { S.colorMode = v; document.querySelectorAll('#color-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v))); refresh(); }
S.setColorMode = setColorMode;
$('pending-mode').value = S.pending;
$('pending-mode').addEventListener('change', (e) => { S.pending = e.target.value; refresh(); });
$('opacity').addEventListener('input', (e) => { S.opacity = +e.target.value / 100; $('opacity-o').textContent = e.target.value + ' %'; refresh(); });
S.setOpacity = (o) => { S.opacity = o; $('opacity').value = Math.round(o * 100); $('opacity-o').textContent = Math.round(o * 100) + ' %'; refresh(); };
$('cut-on').addEventListener('change', (e) => S.setCut(e.target.checked));
$('cut').addEventListener('input', (e) => S.setCut(true, +e.target.value / 100));
$('xray').addEventListener('change', (e) => { S.xray = e.target.checked; refresh(); });
$('ceil').addEventListener('change', (e) => { S.ceilings = e.target.checked; refresh(); });
$('upper').addEventListener('change', (e) => { S.upper = e.target.checked; refresh(); });
S.setCeilings = (v) => { S.ceilings = v; $('ceil').checked = v; refresh(); };
S.setUpper = (v) => { S.upper = v; $('upper').checked = v; refresh(); };
$('edges').addEventListener('change', (e) => { S.edges = e.target.checked; refresh(); });
$('f-cat').addEventListener('change', (e) => { S.filter.cat = e.target.value; refresh(); });
$('f-sys').addEventListener('change', (e) => { S.filter.sys = e.target.value; refresh(); });
$('f-link').addEventListener('change', (e) => { S.filter.link = e.target.value; refresh(); });
$('f-reset').addEventListener('click', () => { S.filter = { cat: '', sys: '', link: '' }; $('f-cat').value = $('f-sys').value = $('f-link').value = ''; showAll(); });
document.querySelectorAll('.hud.tl [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('t-fit').addEventListener('click', () => { if (S.mode === 'plan') setMode('plan'); else { if (S.mode === 'walk') setMode('orbit'); fit(); } });
$('t-full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
$('rooms').addEventListener('change', (e) => {
  const r = S.project.rooms[+e.target.value]; if (!r) return;
  if (S.mode === 'walk') { camera.position.set(r.p[0], S.floorY + 1.6, r.p[2]); invalidate(); }
  else { setMode('orbit'); flyTo(new THREE.Vector3(r.p[0], S.floorY + 1, r.p[2]), 9); }
  tip(r.name + (r.num ? ' · ' + r.num : '') + ' · ' + fmt.format(r.area) + ' m²');
});
document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

function buildLayers() {
  const box = $('disc-list');
  box.innerHTML = '';
  for (const D of S.disc.values()) {
    const row = document.createElement('div'); row.className = 'disc';
    row.innerHTML = '<span class="dot" style="background:' + D.color + '"></span><span>' + D.name + ' <span class="n">' + fmtInt.format(D.elems.length) + '</span></span>'
      + '<button class="ghost" data-solo title="Ver sólo esta especialidad">Solo</button><button data-eye aria-pressed="true" title="Mostrar u ocultar">Visible</button>';
    row.querySelector('[data-eye]').onclick = (ev) => { D.visible = !D.visible; ev.target.setAttribute('aria-pressed', String(D.visible)); ev.target.textContent = D.visible ? 'Visible' : 'Oculto'; refresh(); emit('layers'); };
    row.querySelector('[data-solo]').onclick = () => { for (const X of S.disc.values()) X.visible = X === D; syncLayerButtons(); refresh(); emit('layers'); };
    box.appendChild(row);
  }
  $('disc-all').onclick = () => { for (const X of S.disc.values()) X.visible = true; syncLayerButtons(); refresh(); emit('layers'); };
  const cats = [...new Set(S.elems.map((e) => e.cat))].sort((a, b) => a.localeCompare(b, 'es'));
  $('f-cat').innerHTML = '<option value="">Todas</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const sys = [...new Set(S.elems.map((e) => e.sysType || e.sys).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  $('f-sys').innerHTML = '<option value="">Todos</option>' + sys.map((c) => '<option>' + esc(c) + '</option>').join('');
  $('rooms').innerHTML = '<option value="">Ir a un ambiente…</option>' + S.project.rooms.map((r, i) => '<option value="' + i + '">' + esc(r.name) + (r.num ? ' · ' + esc(r.num) : '') + '</option>').join('');
}
function syncLayerButtons() {
  const rows = $('disc-list').children; let i = 0;
  for (const D of S.disc.values()) { const b = rows[i++].querySelector('[data-eye]'); b.setAttribute('aria-pressed', String(D.visible)); b.textContent = D.visible ? 'Visible' : 'Oculto'; }
}
S.syncLayerButtons = syncLayerButtons;
S.setDiscVisible = (d, v) => { const D = S.disc.get(d); if (D) { D.visible = v; syncLayerButtons(); refresh(); } };

// búsqueda
const q = $('q'), res = $('results');
q.addEventListener('input', () => {
  const s = q.value.trim().toLowerCase();
  if (s.length < 2) { res.classList.remove('on'); return; }
  const out = [];
  for (const e of S.elems) {
    const hay = (e.id + ' ' + (e.fam || '') + ' ' + (e.type || '') + ' ' + (e.sys || '') + ' ' + (e.sysType || '') + ' ' + e.cat + ' ' + (e.mark || '')).toLowerCase();
    if (hay.includes(s)) { out.push(e); if (out.length > 40) break; }
  }
  const rooms = S.project.rooms.map((r, i) => [r, i]).filter(([r]) => (r.name + ' ' + (r.num || '')).toLowerCase().includes(s)).slice(0, 8);
  res.innerHTML = rooms.map(([r, i]) => '<button data-room="' + i + '">' + esc(r.name) + '<small>Ambiente · ' + fmt.format(r.area) + ' m²</small></button>').join('')
    + out.map((e) => '<button data-uid="' + e.uid + '">' + esc(e.fam || e.cat) + ' · ' + esc(e.type || '') + '<small>' + e.D.d + ' · ' + esc(e.cat) + ' · ID ' + e.id + '</small></button>').join('')
    || '<p class="muted small" style="padding:10px">Sin resultados</p>';
  res.classList.add('on');
  res.querySelectorAll('[data-uid]').forEach((b) => b.onclick = () => { res.classList.remove('on'); select(S.byUid.get(b.dataset.uid), true); });
  res.querySelectorAll('[data-room]').forEach((b) => b.onclick = () => { res.classList.remove('on'); $('rooms').value = b.dataset.room; $('rooms').dispatchEvent(new Event('change')); });
});
q.addEventListener('blur', () => setTimeout(() => res.classList.remove('on'), 200));

// ------------------------------------------------------------------ compartir / ubicación / AR
S.georef = null;
function readGeo() {
  const g = params.get('geo');
  if (g) { const p = g.split(',').map(Number); if (p.length >= 3 && p.every(Number.isFinite)) return { lat: p[0], lon: p[1], rot: p[2], src: 'enlace' }; }
  try { const s = JSON.parse(localStorage.getItem('bim4d.geo.' + S.project.id) || 'null'); if (s) return { ...s, src: 'este equipo' }; } catch { /* sin almacenamiento */ }
  if (S.project.geo) return { ...S.project.geo, src: 'proyecto' };
  return null;
}
S.saveGeo = (g) => {
  S.georef = g ? { lat: g.lat, lon: g.lon, rot: g.rot, src: 'este equipo' } : null;
  try { if (g) localStorage.setItem('bim4d.geo.' + S.project.id, JSON.stringify({ lat: g.lat, lon: g.lon, rot: g.rot })); else localStorage.removeItem('bim4d.geo.' + S.project.id); } catch { /* */ }
  emit('geo', S.georef);
};
S.shareUrl = (ar) => {
  const u = new URL(location.href.split('?')[0]);
  const p = new URLSearchParams();
  p.set('piso', S.project.level); p.set('fecha', S.cut);
  if (S.colorMode !== '4d') p.set('color', S.colorMode);
  if (S.georef) p.set('geo', [S.georef.lat.toFixed(7), S.georef.lon.toFixed(7), (+S.georef.rot).toFixed(2)].join(','));
  if (ar) p.set('modo', 'ar');
  u.search = p.toString(); return u.href;
};
async function drawQR(canvas, text) {
  const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
  const QR = mod.default && mod.default.toCanvas ? mod.default : mod;
  await QR.toCanvas(canvas, text, { width: 236, margin: 2, errorCorrectionLevel: 'M' });
}
S.drawQR = drawQR;
async function openShare() {
  const dlg = $('dlg-share'); const upd = async () => {
    const url = S.shareUrl($('share-ar').checked); $('share-link').textContent = url;
    $('share-geo').innerHTML = S.georef ? 'Incluye la ubicación guardada: ' + S.georef.lat.toFixed(6) + ', ' + S.georef.lon.toFixed(6) + ' · rotación ' + (+S.georef.rot).toFixed(1) + '°'
      : 'Aún no hay ubicación geográfica. Usa <b>Ubicación</b> para ponerla en el mapa; así el modelo aparecerá ubicado al escanear.';
    try { await drawQR($('qr'), url); } catch { /* sin red */ }
  };
  $('share-ar').onchange = upd; await upd(); dlg.showModal();
}
$('btn-share').addEventListener('click', openShare);
$('share-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('share-link').textContent); tip('Enlace copiado'); } catch { tip('No se pudo copiar'); } });
$('share-print').addEventListener('click', () => {
  const url = $('qr').toDataURL('image/png');
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write('<!doctype html><title>Marcador AR · Piso 18</title><body style="font:16px system-ui;text-align:center;padding:30px"><h2>Oficinas Las Bambas · Piso 18</h2><p>Escanea para ver el modelo BIM 4D en realidad aumentada</p><img src="' + url + '" style="width:9cm;height:9cm"><p style="font-size:12px;color:#555">Fecha de corte ' + fmtDate(S.cut) + '</p><script>setTimeout(()=>print(),300)<\/script></body>');
  w.document.close();
});
$('btn-map').addEventListener('click', async () => { const m = await import('./geo.js?v=' + V); m.openMapEditor(S); });
const openAR = async () => { const m = await import('./ar.js?v=' + V); m.openAR(S); };
$('btn-ar').addEventListener('click', openAR);
$('btn-ar-m').addEventListener('click', openAR);

// ------------------------------------------------------------------ arranque
async function main() {
  const msg = $('load-msg'), bar = $('load-bar');
  try {
    const [project, schedule] = await Promise.all([fetch('./data/project.json?v=' + V).then((r) => r.json()), fetch('./data/schedule.json?v=' + V).then((r) => r.json())]);
    S.project = project; S.schedule = schedule; S.floorY = project.floorY;
    for (const t of schedule.tasks) S.tasks.set(t.uid, t);
    $('lvl-name').textContent = project.levelName;
    const total = project.disciplines.reduce((a, d) => a + d.gz, 0); let got = 0;
    msg.textContent = 'Descargando ' + project.disciplines.length + ' especialidades (' + (total / 1048576).toFixed(0) + ' MB)';
    await Promise.all(project.disciplines.map((d) => loadDiscipline(d, project.level, (n) => { got += n; bar.style.width = Math.min(100, got / total * 100) + '%'; })));
    // ordenar especialidades como en el proyecto
    const order = project.disciplines.map((d) => d.d); S.disc = new Map(order.map((k) => [k, S.disc.get(k)]));
    for (const D of S.disc.values()) { D.mesh.updateMatrixWorld(true); D.pick.updateMatrixWorld(true); D.mesh.geometry.computeBoundingBox(); S.bounds.union(D.mesh.geometry.boundingBox.clone().applyMatrix4(D.mesh.matrixWorld)); }
    for (const e of S.elems) e.upper = (e.bic === 'OST_Floors' || e.bic === 'OST_Roofs') && e.bb[1] > S.floorY + 2;
    // caja de trabajo: franja del piso
    S.bounds.min.y = Math.max(S.bounds.min.y, S.floorY - 1.5); S.bounds.max.y = Math.min(S.bounds.max.y, S.floorY + 5);
    S.taskCounts = new Map(); for (const e of S.elems) for (const l of e.links) S.taskCounts.set(l.t, (S.taskCounts.get(l.t) || 0) + 1);
    S.georef = readGeo();
    $('edges').checked = S.edges;
    buildLayers();
    if (params.get('color')) setColorMode(params.get('color'));
    initTimeline();
    fit();
    $('loading').remove();
    const q = project.qa || {};
    const cnt = { BRIDGE: 0, CONEXION: 0, REGLA_VISOR: 0, EXIST: 0, SIN: 0 };
    for (const e of S.elems) { if (e.st || !e.links.length) cnt[e.links.length ? 'SIN' : 'EXIST']++; else cnt[e.m4d in cnt ? e.m4d : 'SIN']++; }
    $('qa-box').innerHTML = '<h2>Calidad del vínculo 4D</h2>'
      + '<dl class="kv"><dt>Puente 4D v6</dt><dd>' + fmtInt.format(cnt.BRIDGE) + '</dd><dt>Por conexión MEP</dt><dd>' + fmtInt.format(cnt.CONEXION) + '</dd>'
      + '<dt>Regla del visor</dt><dd>' + fmtInt.format(cnt.REGLA_VISOR) + ' <span class="muted">(propuesta)</span></dd><dt>Existentes</dt><dd>' + fmtInt.format(cnt.EXIST) + '</dd>'
      + '<dt>Sin fecha</dt><dd><b>' + fmtInt.format(cnt.SIN) + '</b></dd></dl>'
      + '<p class="small muted">Fuente: ' + esc(project.source) + ' · generado ' + esc((project.generated || '').slice(0, 16).replace('T', ' ')) + ' UTC. Sin DWG importados ni geometría «Light Source» de luminarias.</p>';
    // tareas pesadas en segundo plano: BVH para selección y aristas
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
    if (!matchMedia('(pointer:coarse)').matches) for (const D of S.disc.values()) idle(() => { ensureBVH(D); invalidate(); });
    idle(() => { for (const D of S.disc.values()) if (D.d !== 'DATA') buildEdges(D); refresh(); });
    emit('ready');
    if (params.get('modo') === 'ar') openAR();
    else if (params.get('modo') === 'recorrido') setMode('walk');
    else if (params.get('modo') === 'planta') setMode('plan');
  } catch (err) {
    console.error(err);
    msg.textContent = 'No se pudo cargar el modelo: ' + err.message; bar.style.background = 'var(--warn)';
  }
}
main();
