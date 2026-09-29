// RA Estructuras — visor WebXR offline para superponer estructura proyectada sobre existente.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const APP_VERSION = '10';
const $ = (id) => document.getElementById(id) || document.createElement('div'); // tolerante a un index.html desactualizado
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- escena
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.xr.enabled = true;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
camera.position.set(12, 10, 14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(20, 40, 25);
scene.add(sun);

const previewBg = new THREE.Color(0x101820);
scene.background = previewBg;
const grid = new THREE.GridHelper(40, 40, 0x3a4d60, 0x223140);
scene.add(grid);

// Jerarquía: anchorGroup (pose del ancla) -> placer (giro/desplazamiento) -> model
const anchorGroup = new THREE.Group(); anchorGroup.matrixAutoUpdate = false;
const placer = new THREE.Group();
const modelRoot = new THREE.Group();
anchorGroup.add(placer); placer.add(modelRoot);
scene.add(anchorGroup);

// marcador de origen A + eje +X
const originMarker = new THREE.Group();
{
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe5534b, depthTest: false }));
  s.renderOrder = 10;
  const ax = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2, 0xe5534b, 0.35, 0.18);
  ax.traverse(o => { if (o.material) { o.material.depthTest = false; o.renderOrder = 10; } });
  originMarker.add(s, ax);
}
placer.add(originMarker);

// ---------------------------------------------------------------- estado
const state = {
  files: [],            // [{name, buffer:ArrayBuffer}]
  name: '',
  existMeshes: [], projMeshes: [], edges: [],
  opProj: 0.85, opExist: 0.35, existMode: 'ref', edgesOnly: false, depthWanted: true, useAnchor: true, hideOnLost: true,
};
const msgs = $('msgs');
function msg(text, kind = '') {
  const d = document.createElement('div'); d.className = 'msg ' + kind; d.textContent = text; msgs.appendChild(d);
}
function clearMsgs() { msgs.innerHTML = ''; }

// ---------------------------------------------------------------- persistencia (IndexedDB, opcional)
const withTimeout = (pr, ms, fb) => Promise.race([pr, new Promise(r => setTimeout(() => r(fb), ms))]);
const DB = {
  open() {
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('ra-estructuras', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  },
  get(k) { return withTimeout(this._get(k), 2500, undefined); },
  set(k, v) { return withTimeout(this._set(k, v), 4000, undefined); },
  async _get(k) {
    try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
    catch { return undefined; }
  },
  async _set(k, v) {
    try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); }
    catch { /* sin almacenamiento: se ignora */ }
  },
};
function saveOpts() {
  DB.set('opts', { units: $('optUnits').value, up: $('optUp').value, key: $('optKey').value, ab: $('optAB').value });
}

// ---------------------------------------------------------------- carga de modelos
const ext = (n) => n.split('.').pop().toLowerCase();
const base = (u) => decodeURIComponent(u.split(/[\\/]/).pop().split('?')[0]).toLowerCase();

async function loadFiles(files) {
  const main = ['glb', 'gltf', 'dae', 'obj'].map(e => files.find(f => ext(f.name) === e)).find(Boolean);
  if (!main) throw new Error('No se encontró un archivo .glb, .gltf, .dae u .obj entre los seleccionados.');

  // Recursos auxiliares (texturas, .bin, .mtl) mediante URLs blob
  const blobs = new Map();
  for (const f of files) blobs.set(f.name.toLowerCase(), URL.createObjectURL(new Blob([f.buffer])));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    return blobs.get(base(url)) || url;
  });
  const text = (f) => new TextDecoder().decode(f.buffer);
  let obj;
  const e = ext(main.name);
  if (e === 'glb' || e === 'gltf') {
    const g = await new Promise((res, rej) => new GLTFLoader(manager).parse(e === 'glb' ? main.buffer : text(main), '', res, rej));
    obj = g.scene;
  } else if (e === 'dae') {
    const c = new ColladaLoader(manager).parse(text(main), '');
    if (!c || !c.scene) throw new Error('No se pudo leer el archivo Collada.');
    obj = c.scene; // ColladaLoader ya aplica unidades y eje Z-arriba del archivo
  } else {
    const loader = new OBJLoader(manager);
    const mtl = files.find(f => ext(f.name) === 'mtl');
    if (mtl) {
      const m = new MTLLoader(manager).parse(text(mtl), '');
      m.preload(); loader.setMaterials(m);
    }
    obj = loader.parse(text(main));
    const k = parseFloat($('optUnits').value) || 1;
    obj.scale.setScalar(k);
    if ($('optUp').value === 'z') obj.rotation.x = -Math.PI / 2;
  }
  return { obj, name: main.name };
}

function isExisting(o, key) {
  const re = new RegExp(key || 'EXIST', 'i');
  for (let p = o; p && p !== modelRoot; p = p.parent) if (p.name && re.test(p.name)) return true;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  return mats.some(m => m && m.name && re.test(m.name));
}

// ---- Oclusión por profundidad real (API Depth Sensing de WebXR, si el equipo la ofrece)
// Cada fragmento del modelo se descarta si está más lejos que lo que mide la cámara en ese píxel.
const occ = {
  uDepthTex: { value: null }, uUvT: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1, 1) },
  uProj: { value: new THREE.Vector2(-1, -0.2) }, uDepthOn: { value: 0 }, uMargin: { value: 0.10 },
};
const OCC_GLSL = `
uniform sampler2D uDepthTex; uniform mat4 uUvT; uniform vec2 uRes; uniform vec2 uProj; uniform float uDepthOn; uniform float uMargin;
void occlusionTest() {
  if (uDepthOn < 0.5) return;
  vec2 nv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);   // coords. de vista normalizadas (origen arriba-izq.)
  vec2 duv = (uUvT * vec4(nv, 0.0, 1.0)).xy;
  if (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) return;
  float real = texture(uDepthTex, duv).r;                                    // metros
  if (real <= 0.0) return;                                                   // sin dato: no ocultar
  float zn = gl_FragCoord.z * 2.0 - 1.0;
  float d = uProj.y / (zn + uProj.x);                                        // profundidad del modelo en metros
  if (d > real * 1.03 + uMargin) discard;
}`;
function addOcclusion(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, occ);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + OCC_GLSL)
      .replace('void main() {', 'void main() {\n  occlusionTest();');
  };
  mat.customProgramCacheKey = () => 'occ1';
  return mat;
}
const existMat = new THREE.MeshBasicMaterial({ color: 0x7fc4e8, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
const edgeMat = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9 });
// Modo "oclusión": la estructura existente del modelo es invisible pero tapa lo proyectado que queda detrás.
const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
addOcclusion(existMat); addOcclusion(edgeMat);

function setModel(obj, name) {
  modelRoot.clear();
  state.existMeshes = []; state.projMeshes = []; state.edges = [];
  const wrap = new THREE.Group(); wrap.add(obj); modelRoot.add(wrap);
  modelRoot.updateMatrixWorld(true);

  const key = $('optKey').value.trim() || 'EXIST';
  let tris = 0;
  obj.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry; if (!g.attributes.normal) g.computeVertexNormals(); tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (isExisting(o, key)) {
      o.material = existMat; o.renderOrder = 1; state.existMeshes.push(o);
    } else {
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
        const c = m.clone(); c.transparent = true; c.opacity = state.opProj; c.side = THREE.DoubleSide; return addOcclusion(c);
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      o.renderOrder = 2; state.projMeshes.push(o);
    }
  });
  // aristas de la estructura existente (ayudan a calzar)
  if (tris < 400000) for (const m of state.existMeshes) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edgeMat);
    l.renderOrder = 3; m.add(l); state.edges.push(l);
  }

  // info
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  state.name = name; state.box = box;
  const f = (v) => v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  $('modelInfo').innerHTML = `<b>${name}</b><br>Tamaño: ${f(size.x)} × ${f(size.z)} m en planta, ${f(size.y)} m de alto · ` +
    `${state.projMeshes.length} objeto(s) proyectados, ${state.existMeshes.length} existentes · ${Math.round(tris).toLocaleString('es-CL')} triángulos`;
  clearMsgs();
  if (!state.existMeshes.length) msg(`No hay objetos cuyo grupo o material contenga "${key}". Todo se muestra como proyectado; el calce se hará solo con los puntos A y B.`, 'warn');
  if (size.length() > 500) msg('El modelo es muy grande (>500 m). Revisa las unidades de exportación.', 'warn');
  if (size.length() < 0.5) msg('El modelo es muy pequeño (<0,5 m). Revisa las unidades (quizás está en mm o cm).', 'warn');
  if (ctr.length() > 100) msg('El origen (0,0,0) está a más de 100 m del modelo (¿coordenadas georreferenciadas?). Usa "Mover origen a esquina" o ajusta el origen en el modelo.', 'warn');
  if (tris > 1500000) msg('Modelo pesado: puede ir lento en el celular. Simplifica la geometría si es posible.', 'warn');

  // encuadre de vista previa
  const r = Math.max(size.length(), 2);
  controls.target.copy(ctr); camera.position.copy(ctr).add(new THREE.Vector3(0.7, 0.55, 0.9).multiplyScalar(r));
  camera.near = r / 500; camera.far = r * 50; camera.updateProjectionMatrix();
  grid.scale.setScalar(Math.max(1, r / 30));
  applyVisual();
}

async function openFiles(fileList, persist = true) {
  try {
    $('modelInfo').textContent = 'Leyendo modelo…';
    const files = fileList;
    const { obj, name } = await loadFiles(files);
    state.files = files;
    setModel(obj, name);
    if (persist) await DB.set('files', files);
  } catch (err) {
    console.error(err);
    $('modelInfo').textContent = 'No se pudo cargar el modelo.';
    clearMsgs(); msg(String(err.message || err), 'err');
  }
}

async function loadDemo() {
  const buf = await (await fetch('demo.glb')).arrayBuffer();
  await openFiles([{ name: 'ejemplo.glb', buffer: buf }], false);
  DB.set('files', null);
}

$('btnOpen').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const fl = [...e.target.files];
  if (!fl.length) return;
  const files = await Promise.all(fl.map(async f => ({ name: f.name, buffer: await f.arrayBuffer() })));
  e.target.value = '';
  openFiles(files);
};
$('btnDemo').onclick = loadDemo;
$('btnReload').onclick = () => { saveOpts(); state.files.length ? openFiles(state.files, false) : loadDemo(); };
$('btnOrigin').onclick = () => {
  const w = modelRoot.children[0]; if (!w) return;
  const b = new THREE.Box3().setFromObject(w);
  // esquina: mín X, mín altura, máx Z (= mín Y en ejes SketchUp)
  w.position.sub(new THREE.Vector3(b.min.x, b.min.y, b.max.z));
  modelRoot.updateMatrixWorld(true);
  clearMsgs(); msg('Origen movido a la esquina mínima de la caja envolvente. Recuerda que ahora el punto A es esa esquina.', '');
};
for (const id of ['optUnits', 'optUp', 'optKey', 'optAB']) $(id).addEventListener('change', saveOpts);

// ---------------------------------------------------------------- visual
function applyVisual() {
  const mode = state.existMode; // 'ref' referencia · 'occ' oclusión · 'off' oculta
  existMat.opacity = state.opExist; existMat.visible = !state.edgesOnly; existMat.needsUpdate = true;
  edgeMat.visible = mode === 'ref';
  for (const m of state.existMeshes) {
    m.material = mode === 'occ' ? occluderMat : existMat;
    m.renderOrder = mode === 'occ' ? -1 : 1;
    m.visible = mode !== 'off';
  }
  for (const m of state.projMeshes) {
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) { mt.opacity = state.opProj; mt.transparent = state.opProj < 1; }
  }
}

// ---------------------------------------------------------------- vista previa
function resize() {
  if (renderer.xr.isPresenting) return;
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); new ResizeObserver(resize).observe(view);

// ---------------------------------------------------------------- RA (WebXR)
let xrSession = null, refSpace = null, hitSource = null, lastHit = null, anchor = null;
const ar = { phase: 'A', A: null, B: null, yaw: 0, dx: 0, dy: 0, dz: 0, step: 0.01 };

const reticle = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf07a1a }));
  reticle.add(ring, dot);
}
reticle.matrixAutoUpdate = false; reticle.visible = false;
const markA = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe5534b }));
const abLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe5534b }));
markA.visible = abLine.visible = false;
scene.add(reticle, markA, abLine);

function arStatus(main, sub = '') { $('arStatus').innerHTML = main + (sub ? `<small>${sub}</small>` : ''); }
const show = (id, on) => $(id).classList.toggle('hide', !on);

async function checkXR() {
  let ok = false;
  try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { ok = false; }
  $('btnAR').disabled = !ok;
  if (!ok) {
    const why = !window.isSecureContext ? 'La página no está en HTTPS; la RA requiere una dirección segura.'
      : 'Este navegador o equipo no ofrece RA WebXR. En Android usa Chrome y verifica que estén instalados los "Servicios de Google Play para RA".';
    $('btnAR').textContent = 'RA no disponible aquí';
    $('xrMsg').innerHTML = ''; const d = document.createElement('div'); d.className = 'msg warn'; d.textContent = why + ' La vista 3D sí funciona para revisar el modelo.'; $('xrMsg').appendChild(d);
  }
}

$('btnAR').onclick = async () => {
  try {
    const wantDepth = !!$('optDepth').checked;
    const opts = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'anchors'], domOverlay: { root: $('ar') } };
    if ($('optVR').checked) opts.optionalFeatures.push('camera-access');
    if (wantDepth) {
      opts.optionalFeatures.push('depth-sensing');
      opts.depthSensing = { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] };
    }
    const session = await navigator.xr.requestSession('immersive-ar', opts);
    try { await startAR(session); } catch (e) { try { await session.end(); } catch {} throw e; }
  } catch (err) {
    console.error(err);
    const t = String(err && (err.name + ': ' + err.message) || err);
    msg('[v' + APP_VERSION + '] No se pudo iniciar la RA (' + t + '). Cierra Chrome por completo (desde apps recientes) y vuelve a abrir la app; si persiste, reinicia el teléfono.', 'err');
  }
};

async function startAR(session) {
  xrSession = session;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  refSpace = await session.requestReferenceSpace('local');
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });
  scene.background = null; grid.visible = false;
  $('ar').classList.add('on');
  resetPlacement();
  session.addEventListener('end', endAR);
  session.addEventListener('select', onScreenTap);
  // Chrome lanza un error al leer depthUsage si la sesión no tiene profundidad: se trata como "no disponible".
  try { state.depthAvail = !!session.depthUsage; } catch { state.depthAvail = false; }
  updDepthBtn();
}
function endAR() {
  occ.uDepthOn.value = 0;
  setStereo(false); vr.binding = null;
  hitSource = null; xrSession = null; anchor = null;
  $('ar').classList.remove('on');
  scene.background = previewBg; grid.visible = true;
  reticle.visible = markA.visible = abLine.visible = false;
  anchorGroup.matrix.identity(); ar.yaw = ar.dx = ar.dy = ar.dz = 0; updatePlacer();
  modelRoot.visible = true; originMarker.visible = true;
  resize();
}

// Los toques sobre los paneles no generan "select" de RA; un toque en cualquier otra parte de la pantalla fija el punto.
for (const el of document.querySelectorAll('#ar .top, #ar .bottom')) el.addEventListener('beforexrselect', (e) => e.preventDefault());
function onScreenTap() {
  if (vr.on) return setStereo(false);           // en modo gafas, un toque (o el botón del visor) vuelve al modo normal
  if (ar.phase === 'A') fixA(); else if (ar.phase === 'B') fixB();
}
// Botones de la capa RA: se atienden al levantar el dedo (más fiable que "click" dentro de la sesión RA).
let lastTap = 0; // compartido: evita que el "click" que sigue al toque caiga en otro botón que aparece en el mismo lugar
function tap(el, fn) {
  const run = (e) => { const n = performance.now(); if (n - lastTap < 350) return; lastTap = n; e.preventDefault(); e.stopPropagation(); fn(e); };
  el.addEventListener('pointerup', run); el.addEventListener('click', run);
}

function resetPlacement() {
  placer.visible = true;
  ar.phase = 'A'; ar.A = ar.B = null; ar.yaw = ar.dx = ar.dy = ar.dz = 0;
  if (anchor) { try { anchor.delete(); } catch {} anchor = null; }
  anchorGroup.matrix.identity(); updatePlacer();
  modelRoot.visible = false; originMarker.visible = false;
  markA.visible = abLine.visible = false;
  show('arPlace', true); show('arAdjust', false); show('arSetA', true); show('arSetB', false); show('arQuick', true);
  arStatus('Apunta la cruz al <b>punto A</b> real (origen del modelo) y toca <b>Fijar A</b> o la pantalla.', 'Mueve el celular lento apuntando al piso hasta que aparezca el círculo.');
}

let goodHit = null; // último punto válido y su instante
function hitPos() {
  if (!goodHit || performance.now() - goodHit.t > 1500) return null;
  return new THREE.Vector3().setFromMatrixPosition(goodHit.matrix);
}
function noSurface() {
  arStatus('Aún no se detecta el piso en la cruz.', 'Mueve el celular lento, de lado a lado, apuntando a una superficie con textura y buena luz.');
  navigator.vibrate && navigator.vibrate(60);
}

function fixA() {
  const p = hitPos(); if (!p) return noSurface();
  ar.A = p; navigator.vibrate && navigator.vibrate(30);
  markA.position.copy(p); markA.visible = true;
  ar.phase = 'B';
  show('arSetA', false); show('arSetB', true); show('arQuick', true);
  arStatus('A fijado. Ahora apunta al <b>punto B</b> (sobre el eje +X del modelo) y toca <b>Fijar B</b>.', 'O toca "Colocar solo en A" para orientarlo a mano.');
}
function fixB() {
  const p = hitPos(); if (!ar.A) return; if (!p) return noSurface();
  const d = p.clone().sub(ar.A); d.y = 0;
  if (d.length() < 0.3) { arStatus('B está muy cerca de A (&lt; 30 cm).', 'Aléjate: la orientación es más precisa con puntos separados varios metros.'); return; }
  ar.B = p;
  place(Math.atan2(-d.z, d.x));
  const meas = d.length();
  const ab = parseFloat($('optAB').value);
  let sub = `Distancia medida A–B: ${meas.toFixed(2)} m`;
  if (ab > 0) sub += ` · modelo ${ab.toFixed(2)} m · diferencia ${((meas - ab) * 100).toFixed(0)} cm`;
  arStatus('Modelo calzado con A y B. Afina si hace falta.', sub);
  navigator.vibrate && navigator.vibrate(30);
}
tap($('arSetA'), fixA);
tap($('arSetB'), fixB);
tap($('arQuick'), () => {
  if (!ar.A) { const p = hitPos(); if (!p) return noSurface(); ar.A = p; }
  // eje +X del modelo perpendicular a la dirección de la mirada
  const cam = renderer.xr.getCamera(); const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  place(Math.atan2(-fwd.z, fwd.x) - Math.PI / 2);
  arStatus('Modelo colocado en A. Gíralo con los botones hasta que calce.', 'Tip: usa la estructura existente (celeste) como referencia.');
});

function place(yaw) {
  trk.lost = false; placer.visible = true;
  ar.yaw = yaw; ar.dx = ar.dy = ar.dz = 0; ar.phase = 'done';
  // ancla (si el equipo lo permite) para reducir la deriva
  const base = new THREE.Matrix4().makeTranslation(ar.A.x, ar.A.y, ar.A.z);
  anchorGroup.matrix.copy(base); ar.baseFix = base.clone();
  if (anchor) { try { anchor.delete(); } catch {} anchor = null; }
  ar.anchorAtFix = null; ar.wantAnchor = true; // se crea en el próximo cuadro
  updatePlacer();
  modelRoot.visible = true; originMarker.visible = true;
  markA.visible = false; abLine.visible = false;
  show('arPlace', false); show('arAdjust', true);
}

function updatePlacer() {
  placer.rotation.set(0, ar.yaw, 0);
  // desplazamientos en ejes del modelo
  const off = new THREE.Vector3(ar.dx, ar.dy, ar.dz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ar.yaw);
  placer.position.copy(off);
}

tap($('arRedo'), resetPlacement);
tap($('arExit'), () => xrSession && xrSession.end());
for (const b of document.querySelectorAll('[data-rot]')) tap(b, () => { ar.yaw += parseFloat(b.dataset.rot) * DEG; updatePlacer(); adjInfo(); });
for (const b of document.querySelectorAll('[data-mv]')) tap(b, () => {
  const s = ar.step, k = b.dataset.mv;
  if (k === 'x+') ar.dx += s; if (k === 'x-') ar.dx -= s;
  if (k === 'z+') ar.dz -= s; if (k === 'z-') ar.dz += s;   // Y del modelo (SketchUp) = −Z en glTF
  if (k === 'y+') ar.dy += s; if (k === 'y-') ar.dy -= s;
  updatePlacer(); adjInfo();
});
const steps = [0.01, 0.05, 0.10, 0.001];
tap($('stepBtn'), () => { ar.step = steps[(steps.indexOf(ar.step) + 1) % steps.length]; $('stepLbl').textContent = ar.step >= 0.01 ? `${Math.round(ar.step * 100)} cm` : '1 mm'; });
tap($('resetAdj'), () => { ar.dx = ar.dy = ar.dz = 0; updatePlacer(); adjInfo(); });
function adjInfo() {
  arStatus('Ajuste fino', `ΔX ${(ar.dx * 100).toFixed(1)} cm · ΔY ${(-ar.dz * 100).toFixed(1)} cm · ΔZ ${(ar.dy * 100).toFixed(1)} cm · giro ${(ar.yaw / DEG).toFixed(1)}°`);
}
const tabs = { tabRot: 'pRot', tabMove: 'pMove', tabView: 'pView' };
for (const [t, p] of Object.entries(tabs)) tap($(t), () => {
  for (const [t2, p2] of Object.entries(tabs)) { $(t2).classList.toggle('act', t2 === t); show(p2, p2 === p); }
});
$('opProj').oninput = (e) => { state.opProj = +e.target.value; applyVisual(); };
$('opExist').oninput = (e) => { state.opExist = +e.target.value; applyVisual(); };
const modeNames = { ref: 'Existente: referencia', occ: 'Existente: oclusión', off: 'Existente: oculta' };
tap($('tgExist'), () => {
  state.existMode = { ref: 'occ', occ: 'off', off: 'ref' }[state.existMode];
  $('tgExist').textContent = modeNames[state.existMode]; applyVisual();
  if (state.existMode === 'occ') arStatus('Modo oclusión', 'La estructura existente del modelo queda invisible, pero tapa lo proyectado que está detrás de ella. Requiere un buen calce.');
});
function updDepthBtn() {
  const b = $('tgDepth');
  if (!state.depthAvail) { b.textContent = 'Profundidad: no disponible'; b.disabled = true; return; }
  b.disabled = false; b.textContent = state.depthWanted ? 'Profundidad cámara: sí' : 'Profundidad cámara: no';
}
tap($('tgAnchor'), () => {
  state.useAnchor = !state.useAnchor;
  $('tgAnchor').textContent = state.useAnchor ? 'Ancla: sí' : 'Ancla: no';
  if (!state.useAnchor && ar.baseFix) anchorGroup.matrix.copy(ar.baseFix); // vuelve a la posición fijada, sin correcciones
});
tap($('tgDepth'), () => { if (!state.depthAvail) return; state.depthWanted = !state.depthWanted; updDepthBtn(); });
tap($('tgEdges'), () => { state.edgesOnly = !state.edgesOnly; $('tgEdges').textContent = state.edgesOnly ? 'Caras + aristas' : 'Solo aristas'; applyVisual(); });

// ---------------------------------------------------------------- profundidad por cuadro
let depthTex = null, depthBuf = null;
function updateDepth(frame) {
  occ.uDepthOn.value = 0;
  if (!state.depthAvail || !state.depthWanted || !frame.getDepthInformation) return;
  const vp = frame.getViewerPose(refSpace); if (!vp || !vp.views.length) return;
  const view = vp.views[0];
  let di = null; try { di = frame.getDepthInformation(view); } catch { state.depthWanted = false; updDepthBtn(); return; }
  if (!di || !di.width) return;
  const n = di.width * di.height;
  if (!depthTex || depthTex.image.width !== di.width || depthTex.image.height !== di.height) {
    depthBuf = new Float32Array(n);
    depthTex = new THREE.DataTexture(depthBuf, di.width, di.height, THREE.RedFormat, THREE.FloatType);
    depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
    occ.uDepthTex.value = depthTex;
  }
  const k = di.rawValueToMeters;
  let fmt = 'luminance-alpha'; try { fmt = xrSession.depthDataFormat; } catch {}
  const src = fmt === 'float32' ? new Float32Array(di.data) : new Uint16Array(di.data);
  for (let i = 0; i < n; i++) depthBuf[i] = src[i] * k;
  depthTex.needsUpdate = true;
  occ.uUvT.value.fromArray(di.normDepthBufferFromNormView.matrix);
  const P = view.projectionMatrix; occ.uProj.value.set(P[10], P[14]);
  const bl = xrSession.renderState.baseLayer;
  const xrT = renderer.getRenderTarget();
  if (xrT) occ.uRes.value.set(xrT.width, xrT.height);
  else if (bl) { const v = bl.getViewport(view); occ.uRes.value.set(v.width, v.height); }
  occ.uDepthOn.value = 1;
}

// ---------------------------------------------------------------- modo gafas VR (pantalla dividida)
// Se dibuja la imagen de la cámara + el modelo dos veces (ojo izq./der.) en una textura y luego se muestra a pantalla completa.
const vr = { on: false, binding: null, rt: null, camTex: new THREE.Texture(), eye: new THREE.PerspectiveCamera(), warned: false };
vr.eye.matrixAutoUpdate = false;
const bgMat = new THREE.ShaderMaterial({
  uniforms: { uCam: { value: vr.camTex }, uU: { value: new THREE.Vector2(0.25, 0.75) }, uV: { value: new THREE.Vector2(0, 1) }, uFlip: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D uCam; uniform vec2 uU; uniform vec2 uV; uniform float uFlip; varying vec2 vUv;
    void main(){ float v = mix(uV.x, uV.y, vUv.y); vec2 uv = vec2(mix(uU.x, uU.y, vUv.x), uFlip > 0.5 ? 1.0 - v : v);
      gl_FragColor = vec4(texture2D(uCam, uv).rgb, 1.0); }`,
  depthTest: false, depthWrite: false,
});
const quad = () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); m.frustumCulled = false; return m; };
const bgScene = new THREE.Scene(); { const q = quad(); q.material = bgMat; bgScene.add(q); }
const outMat = new THREE.ShaderMaterial({
  uniforms: { uTex: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(uTex, vUv); }',
  depthTest: false, depthWrite: false,
});
const outScene = new THREE.Scene(); { const q = quad(); q.material = outMat; outScene.add(q); }
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function setStereo(on) {
  if (on && !xrSession) return;
  vr.on = on;
  $('ar').classList.toggle('vr', on);
  if (on) {
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch {}
    reticle.visible = false;
  } else {
    arStatus('Modo normal', 'Para volver a las gafas toca "Gafas VR".');
  }
}
tap($('arVR'), () => {
  let ok = false;
  try { ok = !!(xrSession && xrSession.enabledFeatures && xrSession.enabledFeatures.includes('camera-access')); } catch { ok = false; }
  if (!ok) {
    arStatus('Modo gafas no disponible en esta sesión.', $('optVR').checked
      ? 'Tu equipo no entrega la imagen de la cámara a la app (función "camera-access").'
      : 'Activa "Permitir modo gafas VR" en Opciones y vuelve a iniciar la RA.');
    return;
  }
  setStereo(true);
});

function renderStereo(frame) {
  const gl = renderer.getContext();
  if (!vr.binding) vr.binding = new XRWebGLBinding(xrSession, gl);
  const pose = frame.getViewerPose(refSpace); if (!pose) return false;
  const view = pose.views[0];
  if (!view.camera) { if (!vr.warned) { vr.warned = true; arStatus('Sin imagen de cámara para el modo gafas.'); } return false; }
  const glTex = vr.binding.getCameraImage(view.camera); if (!glTex) return false;
  renderer.properties.get(vr.camTex).__webglTexture = glTex;   // textura de la cámara (válida solo en este cuadro)

  // tamaño del búfer de RA: con "capas" WebXR no existe baseLayer, así que se toma del destino de dibujo de three.js
  const xrT = renderer.getRenderTarget();
  const bl = xrSession.renderState.baseLayer;
  const W = xrT ? xrT.width : (bl ? bl.framebufferWidth : renderer.getContext().drawingBufferWidth);
  const H = xrT ? xrT.height : (bl ? bl.framebufferHeight : renderer.getContext().drawingBufferHeight);
  if (!vr.rt || vr.rt.width !== W || vr.rt.height !== H) {
    if (vr.rt) vr.rt.dispose();
    vr.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    outMat.uniforms.uTex.value = vr.rt.texture;
  }
  const xrTarget = renderer.getRenderTarget();
  const ipd = (parseFloat($('optIPD').value) || 64) / 1000;
  const zoom = Math.max(1, parseFloat($('optVRZoom').value) || 1);
  bgMat.uniforms.uFlip.value = $('optVRFlip').checked ? 1 : 0;

  // proyección por ojo: misma cámara, con la mitad central del campo horizontal (coincide con el recorte de la imagen)
  const P = new THREE.Matrix4().fromArray(view.projectionMatrix);
  P.elements[0] *= 2 * zoom; P.elements[8] *= 2; P.elements[5] *= zoom;
  const half = 0.25 / zoom;
  bgMat.uniforms.uU.value.set(0.5 - half, 0.5 + half);
  const vy = 0.5 / zoom; // recorte vertical cuando hay zoom
  bgMat.uniforms.uV.value.set(0.5 - vy, 0.5 + vy);
  const head = new THREE.Matrix4().fromArray(view.transform.matrix);

  renderer.xr.enabled = false;
  const autoClear = renderer.autoClear; renderer.autoClear = false;
  const reticleVis = reticle.visible; reticle.visible = false;
  renderer.setClearColor(0x000000, 1);
  for (let e = 0; e < 2; e++) {
    const x = e === 0 ? 0 : Math.floor(W / 2);
    const w = Math.floor(W / 2) - 4;   // pequeña franja negra al centro
    vr.rt.viewport.set(e === 0 ? 0 : x + 4, 0, w, H); vr.rt.scissor.copy(vr.rt.viewport); vr.rt.scissorTest = true;
    renderer.setRenderTarget(vr.rt);
    renderer.clear(true, true, true);
    // fondo: imagen de la cámara recortada
    renderer.render(bgScene, orthoCam);
    renderer.clearDepth();
    // modelo desde cada ojo
    const off = new THREE.Matrix4().makeTranslation((e === 0 ? -1 : 1) * ipd / 2, 0, 0);
    vr.eye.matrixWorld.multiplyMatrices(head, off);
    vr.eye.matrixWorldInverse.copy(vr.eye.matrixWorld).invert();
    vr.eye.projectionMatrix.copy(P); vr.eye.projectionMatrixInverse.copy(P).invert();
    renderer.render(scene, vr.eye);
  }
  vr.rt.scissorTest = false;
  reticle.visible = reticleVis;
  renderer.autoClear = autoClear;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(xrTarget);
  renderer.xr.enabled = true;
  renderer.render(outScene, orthoCam);   // compone a pantalla completa (tapa la imagen de cámara del sistema)
  return true;
}

// ---------------------------------------------------------------- estabilidad
// Las correcciones del ancla se filtran: saltos mínimos (ruido) se ignoran; correcciones reales se aplican suavemente.
const _p0 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _s0 = new THREE.Vector3();
const _p1 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _s1 = new THREE.Vector3();
function smoothAnchor(target) {
  anchorGroup.matrix.decompose(_p0, _q0, _s0);
  target.decompose(_p1, _q1, _s1);
  const d = _p0.distanceTo(_p1), ang = _q0.angleTo(_q1);
  if (d > 1.0) { anchorGroup.matrix.copy(target); return; }            // salto grande: relocalización, se acepta de una vez
  if (d < 0.015 && ang < 0.4 * DEG) return;                            // ruido: se ignora (modelo quieto)
  _p0.lerp(_p1, 0.12); _q0.slerp(_q1, 0.12);
  anchorGroup.matrix.compose(_p0, _q0, _s0);
}
// Si el teléfono pierde el seguimiento (cámara tapada, poca textura, movimiento brusco), se oculta el modelo en vez de dejarlo "flotar".
const trk = { lost: false, since: 0 };
function trackingCheck(frame) {
  if (ar.phase !== 'done') return;
  let lost = false;
  try { const vp = frame.getViewerPose(refSpace); lost = !vp || vp.emulatedPosition; } catch { lost = false; }
  const now = performance.now();
  if (lost && !trk.lost) { trk.lost = true; trk.since = now; }
  if (!lost && trk.lost) {
    trk.lost = false; placer.visible = true;
    if (!vr.on) arStatus('Seguimiento recuperado.', 'Si el modelo quedó corrido, usa Recalzar.');
  }
  if (trk.lost && now - trk.since > 250 && placer.visible) {
    placer.visible = !state.hideOnLost;
    if (!vr.on) arStatus('⚠ Seguimiento perdido', 'No tapes la cámara. Apunta a zonas con textura y buena luz, y muévete lento.');
  }
}

// ---------------------------------------------------------------- bucle
const tmpM = new THREE.Matrix4();
let loopErr = false;
renderer.setAnimationLoop((t, frame) => {
  try { tick(frame); } catch (err) {
    console.error(err);
    if (!loopErr) { loopErr = true; state.depthWanted = false; occ.uDepthOn.value = 0; arStatus('Se produjo un error y desactivé la profundidad.', String(err.message || err)); }
  }
  if (vr.on && frame) {
    try { if (renderStereo(frame)) return; } catch (err) { console.error(err); setStereo(false); arStatus('No se pudo dibujar el modo gafas.', String(err.message || err)); }
  }
  renderer.render(scene, camera);
});
function tick(frame) {
  if (frame && hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) {
      const pose = hits[0].getPose(refSpace);
      lastHit = { matrix: new THREE.Matrix4().fromArray(pose.transform.matrix) };
      goodHit = { matrix: lastHit.matrix, t: performance.now() };
      reticle.matrix.copy(lastHit.matrix);
      reticle.visible = ar.phase !== 'done';
      $('ar').classList.remove('nosurf');
      if (ar.phase === 'B' && ar.A) {
        const p = hitPos();
        abLine.geometry.setFromPoints([ar.A, p]); abLine.visible = true;
        const d = Math.hypot(p.x - ar.A.x, p.z - ar.A.z);
        $('arStatus').querySelector('small') && ($('arStatus').querySelector('small').textContent = `Distancia A → cruz: ${d.toFixed(2)} m`);
      }
    } else {
      lastHit = null; reticle.visible = false;
      $('ar').classList.add('nosurf');
    }
    if (ar.wantAnchor && ar.baseFix) {
      ar.wantAnchor = false;
      if (frame.createAnchor && window.XRRigidTransform) {
        const p = new THREE.Vector3().setFromMatrixPosition(ar.baseFix);
        try { frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }), refSpace).then(a => { anchor = a; ar.anchorAtFix = null; }, () => {}); } catch { /* sin anclas */ }
      }
    }
    updateDepth(frame);
    // seguimiento del ancla: aplica la corrección de deriva sobre la pose fijada
    if (anchor && state.useAnchor && frame.trackedAnchors && frame.trackedAnchors.has(anchor)) {
      const ap = frame.getPose(anchor.anchorSpace, refSpace);
      if (ap) {
        const now = tmpM.fromArray(ap.transform.matrix);
        if (!ar.anchorAtFix) ar.anchorAtFix = now.clone().invert().multiply(ar.baseFix); // relación ancla→A
        smoothAnchor(new THREE.Matrix4().multiplyMatrices(now, ar.anchorAtFix));
      }
    }
    trackingCheck(frame);
  } else {
    controls.update();
  }
}

// ---------------------------------------------------------------- estado de red / service worker
function net() { const b = $('netBadge'); b.textContent = navigator.onLine ? 'en línea' : 'sin conexión'; b.classList.toggle('on', true); }
addEventListener('online', net); addEventListener('offline', net); net();
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}

// ---------------------------------------------------------------- errores visibles en pantalla
addEventListener('error', (e) => msg('Error: ' + (e.message || e.error), 'err'));
addEventListener('unhandledrejection', (e) => msg('Error: ' + ((e.reason && e.reason.message) || e.reason), 'err'));

// ---------------------------------------------------------------- restablecer (borra modelo guardado y caché)
async function resetApp() {
  try { await withTimeout(new Promise((res) => { const r = indexedDB.deleteDatabase('ra-estructuras'); r.onsuccess = r.onerror = r.onblocked = res; }), 3000); } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch {}
  location.replace(location.pathname);
}
$('btnReset').onclick = resetApp;

// ---------------------------------------------------------------- inicio
(async () => {
  resize();
  const hv = document.documentElement.dataset.v;
  $('netBadge').title = 'v' + APP_VERSION;
  if (hv !== APP_VERSION) msg(`Archivos de versiones distintas (index.html v${hv || '?'}, app.js v${APP_VERSION}). Sube los 3 archivos juntos a GitHub, espera 2 minutos y recarga.`, 'warn');
  if (new URLSearchParams(location.search).has('reset')) return resetApp();
  checkXR();
  const o = await DB.get('opts');
  if (o) { $('optUnits').value = o.units || '1'; $('optUp').value = o.up || 'z'; $('optKey').value = o.key || 'EXIST'; $('optAB').value = o.ab || ''; }
  // Si la vez anterior la app se cerró mientras abría el modelo guardado, no se reintenta (evita quedar bloqueada).
  const crashed = await DB.get('loading');
  const saved = await DB.get('files');
  if (saved && saved.length && !crashed) {
    await DB.set('loading', true);
    await openFiles(saved, false);
    await DB.set('loading', false);
  } else {
    await loadDemo();
    if (crashed) { await DB.set('loading', false); msg('La última vez la app se cerró al abrir el modelo guardado, así que esta vez cargué el ejemplo. Si el modelo es muy pesado, simplifícalo antes de volver a abrirlo.', 'warn'); }
  }
})();

// acceso para pruebas
window.__ra = { testStereo: (sess, frame) => { const prev = xrSession, prevRef = refSpace; xrSession = sess; try { return renderStereo(frame); } finally { xrSession = prev; refSpace = prevRef; vr.binding = null; } }, state, scene, modelRoot, ar, placer, resetPlacement, occ, THREE, camera, renderer, applyVisual, fakeHit: (x, y, z) => { goodHit = { matrix: new THREE.Matrix4().makeTranslation(x, y, z), t: performance.now() }; } };
