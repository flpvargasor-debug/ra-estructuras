// RA Estructuras — visor WebXR offline para superponer estructura proyectada sobre existente.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';

const APP_VERSION = '12';
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
  if (cap.on) capStop();
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

// ---------------------------------------------------------------- FOTO 360
// La foto se proyecta en una esfera (equirectangular 2:1) o en un cilindro (panorama en franja) centrados en la posición
// de la cámara; el modelo se dibuja desde ese mismo punto, así que queda fijo sobre la foto.
const stereo = new StereoEffect(renderer);
const pano = { on: false, vr: false, gyro: false, mesh: null, tex: null, file: null, aspect: 2,
  yaw: 0, pitch: 0, fov: 70, devQ: null, gyroOff: new THREE.Quaternion() };
const panoHolder = new THREE.Group(); scene.add(panoHolder);
const P_R = 800; // radio de la esfera de la foto [m]

function panoCalib() {
  return { x: +$('pX').value || 0, y: +$('pY').value || 0, z: +$('pZ').value || 0,
           h: +$('pH').value || 0, p: +$('pP').value || 0, r: +$('pR').value || 0 };
}
function panoApply() {
  const c = panoCalib();
  // ejes SketchUp (X, Y, Z arriba) -> escena (x, y arriba, -z)
  panoHolder.position.set(c.x, c.z, -c.y);
  panoHolder.rotation.set(c.p * DEG, c.h * DEG, c.r * DEG, 'YXZ');
  camera.position.copy(panoHolder.position);
  if (pano.file) DB.set('pano', { name: pano.file.name, buffer: pano.file.buffer, calib: c });
}
async function panoLoad(file, calib) {
  const blob = new Blob([file.buffer]);
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height, aspect = w / h;
  // límite de textura del equipo: se reduce si hace falta
  const max = renderer.capabilities.maxTextureSize;
  // se pasa siempre por un canvas (con ImageBitmap three.js no invierte el eje vertical)
  const sc = Math.min(1, max / w);
  const src = document.createElement('canvas'); src.width = Math.round(w * sc); src.height = Math.round(h * sc);
  src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height); bmp.close && bmp.close();
  if (pano.tex) pano.tex.dispose();
  pano.tex = new THREE.Texture(src); pano.tex.colorSpace = THREE.SRGBColorSpace; pano.tex.needsUpdate = true;
  pano.tex.generateMipmaps = false; pano.tex.minFilter = THREE.LinearFilter;
  if (pano.mesh) { panoHolder.remove(pano.mesh); pano.mesh.geometry.dispose(); }
  let geo, kind, vfov;
  if (aspect <= 2.2) {                          // esfera completa (equirectangular)
    geo = new THREE.SphereGeometry(P_R, 96, 48); kind = 'esfera completa'; vfov = 180 / (aspect / 2);
    if (aspect < 1.9) { const ang = Math.min(Math.PI, (2 * Math.PI) / aspect); geo = new THREE.SphereGeometry(P_R, 96, 48, 0, Math.PI * 2, Math.PI / 2 - ang / 2, ang); }
  } else {                                      // franja (panorama cilíndrico)
    const H = 2 * Math.PI * P_R / aspect;
    geo = new THREE.CylinderGeometry(P_R, P_R, H, 180, 1, true);
    vfov = 2 * Math.atan(Math.PI / aspect) / DEG; kind = 'franja horizontal';
  }
  geo.scale(-1, 1, 1);                          // se ve desde adentro
  pano.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: pano.tex, depthWrite: false, depthTest: false }));
  pano.mesh.renderOrder = -100; pano.mesh.frustumCulled = false;
  panoHolder.add(pano.mesh);
  pano.file = file; pano.aspect = aspect;
  $('panoInfo').textContent = `${file.name} · ${w}×${h} px · ${kind} · cobertura vertical ≈ ${Math.round(Math.min(180, vfov))}°`;
  if (calib) for (const k of ['x', 'y', 'z', 'h', 'p', 'r']) $('p' + k.toUpperCase()).value = calib[k];
  panoApply();
  if (aspect > 2.2 && vfov < 50) msg(`La foto cubre solo unos ${Math.round(vfov)}° en vertical: aléjate de la estructura al tomarla o sostén el celular en vertical para cubrir más.`, 'warn');
}
function panoEnter() {
  pano.on = true; document.body.classList.add('pano');
  $('panoPanel').style.display = 'flex';
  controls.enabled = false; grid.visible = false; scene.background = new THREE.Color(0x000000);
  camera.far = Math.max(camera.far, P_R * 2); camera.near = 0.05; camera.fov = pano.fov; camera.updateProjectionMatrix();
  panoHolder.visible = true;
  panoApply();
  // vista inicial: mirando hacia el punto A
  const t = new THREE.Vector3(0, camera.position.y, 0).sub(camera.position);
  pano.yaw = Math.atan2(-t.x, -t.z); pano.pitch = 0;
}
function panoExit() {
  pano.on = false; setPanoVR(false); setGyro(false); document.body.classList.remove('pano');
  $('panoPanel').style.display = 'none';
  controls.enabled = true; grid.visible = true; scene.background = previewBg; panoHolder.visible = false;
  camera.fov = 55; setModel && state.box && (() => { const b = state.box, r = Math.max(b.getSize(new THREE.Vector3()).length(), 2), c = b.getCenter(new THREE.Vector3());
    camera.near = r / 500; camera.far = r * 50; controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(0.7, 0.55, 0.9).multiplyScalar(r)); })();
  camera.updateProjectionMatrix();
}
function panoUpdate() {
  if (pano.gyro && pano.devQ) {
    camera.quaternion.copy(pano.gyroOff).multiply(pano.devQ);
  } else {
    camera.quaternion.setFromEuler(new THREE.Euler(pano.pitch, pano.yaw, 0, 'YXZ'));
  }
}
// mirar alrededor: arrastrar (1 dedo) y acercar (2 dedos / rueda)
{
  const el = renderer.domElement; const pts = new Map(); let pinch0 = 0, fov0 = 70;
  el.addEventListener('pointerdown', (e) => { if (!pano.on) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); fov0 = camera.fov; } });
  el.addEventListener('pointermove', (e) => {
    if (!pano.on || !pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1 && !pano.gyro) {
      const k = camera.fov * DEG / el.clientHeight;
      pano.yaw += dx * k; pano.pitch = Math.max(-1.5, Math.min(1.5, pano.pitch + dy * k));
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) { camera.fov = Math.max(15, Math.min(100, fov0 * pinch0 / d)); pano.fov = camera.fov; camera.updateProjectionMatrix(); }
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { if (!pano.on) return; e.preventDefault();
    camera.fov = Math.max(15, Math.min(100, camera.fov * (e.deltaY > 0 ? 1.08 : 0.93))); pano.fov = camera.fov; camera.updateProjectionMatrix(); }, { passive: false });
}
// giroscopio (orientación del teléfono)
const _zee = new THREE.Vector3(0, 0, 1), _qDev = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function onDevOri(e) {
  if (e.alpha == null) return;
  const orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * DEG;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, 'YXZ'));
  q.multiply(_qDev).multiply(new THREE.Quaternion().setFromAxisAngle(_zee, -orient));
  if (!pano.devQ) { // primera lectura: se conserva la dirección de vista actual
    const yawDev = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    pano.gyroOff.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pano.yaw - yawDev);
  }
  pano.devQ = q;
}
async function setGyro(on) {
  if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') on = false; } catch { on = false; }
  }
  pano.gyro = on; pano.devQ = null;
  if (on) addEventListener('deviceorientation', onDevOri); else {
    removeEventListener('deviceorientation', onDevOri);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); pano.yaw = e.y; pano.pitch = e.x;
  }
  $('pGyro').textContent = on ? 'Giroscopio: sí' : 'Giroscopio: no';
}
function setPanoVR(on) {
  pano.vr = on; document.body.classList.toggle('panovr', on);
  if (on) {
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); } catch {}
    if (!pano.gyro) setGyro(true);
  } else {
    try { document.fullscreenElement && document.exitFullscreen(); } catch {}
    renderer.setScissorTest(false);
  }
  setTimeout(resize, 300);
}
renderer.domElement.addEventListener('click', () => { if (pano.vr) setPanoVR(false); });

$('btnPano').onclick = async () => {
  if (pano.file) return panoEnter();
  const saved = await DB.get('pano');
  if (saved && saved.buffer) { await panoLoad(saved, saved.calib); return panoEnter(); }
  $('panoFile').click();
};
$('pChange').onclick = () => $('panoFile').click();
$('panoFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  try { await panoLoad({ name: f.name, buffer: await f.arrayBuffer() }); panoEnter(); }
  catch (err) { msg('No se pudo abrir la foto: ' + (err.message || err), 'err'); }
};
$('pExit').onclick = panoExit;
$('pDownload').onclick = () => { if (pano.file) downloadBlob(new Blob([pano.file.buffer], { type: 'image/jpeg' }), pano.file.name); };
for (const id of ['pX', 'pY', 'pZ', 'pH', 'pP', 'pR']) $(id).addEventListener('input', panoApply);
for (const b of document.querySelectorAll('[data-ph]')) b.onclick = () => { $('pH').value = (+$('pH').value + +b.dataset.ph).toFixed(1); panoApply(); };
$('pOp').oninput = (e) => { state.opProj = +e.target.value; applyVisual(); };
$('pExist').onclick = () => { state.existMode = { ref: 'occ', occ: 'off', off: 'ref' }[state.existMode];
  $('pExist').textContent = { ref: 'Existente: referencia', occ: 'Existente: oclusión', off: 'Existente: oculta' }[state.existMode]; applyVisual(); };
$('pGyro').onclick = () => setGyro(!pano.gyro);
$('pVR').onclick = () => setPanoVR(true);
$('pShot').onclick = () => {
  panoUpdate(); renderer.render(scene, camera);
  renderer.domElement.toBlob((b) => {
    if (!b) return msg('No se pudo generar la imagen.', 'err');
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = `foto360_${(pano.file && pano.file.name || 'vista').replace(/\.[^.]+$/, '')}_${Date.now()}.png`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
};

// ---------------------------------------------------------------- CAPTURA 360 (esfera completa pintada con la cámara)
// En cada cuadro se proyecta la imagen de la cámara sobre una textura equirectangular usando la orientación que
// entrega la RA. Cada píxel se queda con el cuadro donde quedó más centrado (menos distorsión y mejor unión).
const cap = { on: false, paused: false, rtA: null, rtB: null, W: 0, H: 0, frameN: 0, lastQ: null, lastT: 0,
  posSum: new THREE.Vector3(), posN: 0, modelRot: new THREE.Matrix4(), modelInv: new THREE.Matrix4(), placed: false,
  lastCov: 0, covT: 0, sphere: null, binding: null };
const capMat = new THREE.ShaderMaterial({
  uniforms: { uCam: { value: vr.camTex }, uPrev: { value: null }, uM: { value: new THREE.Matrix3() }, uP: { value: new THREE.Matrix4() }, uFlip: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `precision highp float;
    uniform sampler2D uCam; uniform sampler2D uPrev; uniform mat3 uM; uniform mat4 uP; uniform float uFlip; varying vec2 vUv;
    void main(){
      vec4 prev = texture2D(uPrev, vUv);
      float phi = vUv.x * 6.28318530718, th = (1.0 - vUv.y) * 3.14159265359;
      vec3 d = vec3(cos(phi) * sin(th), cos(th), sin(phi) * sin(th));   // dirección en el sistema del modelo
      vec3 v = uM * d;                                                   // dirección en el sistema de la cámara
      if (v.z > -0.05) { gl_FragColor = prev; return; }
      vec4 c = uP * vec4(v, 1.0); vec2 ndc = c.xy / c.w;
      if (abs(ndc.x) > 0.97 || abs(ndc.y) > 0.97) { gl_FragColor = prev; return; }
      float w = max(1.0 - max(abs(ndc.x), abs(ndc.y)), 0.004);          // "centralidad" del píxel en el cuadro
      if (w <= prev.a + 0.01) { gl_FragColor = prev; return; }
      vec2 uv = ndc * 0.5 + 0.5; if (uFlip > 0.5) uv.y = 1.0 - uv.y;
      gl_FragColor = vec4(texture2D(uCam, uv).rgb, w);
    }`,
  depthTest: false, depthWrite: false, blending: THREE.NoBlending,
});
const capScene = new THREE.Scene(); { const q = quad(); q.material = capMat; capScene.add(q); }
// vista previa: la esfera pintada alrededor del usuario (semitransparente; lo que falta se ve como cámara en vivo)
const capPrevMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main(){ vec4 c = texture2D(tex, vUv); if (c.a < 0.003) discard; gl_FragColor = vec4(c.rgb, 0.6); }',
  transparent: true, depthWrite: false, depthTest: false,
});
// lectura de cobertura (textura pequeña)
const covRT = new THREE.WebGLRenderTarget(128, 64);
const covMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor = vec4(step(0.003, texture2D(tex, vUv).a)); }',
  depthTest: false, depthWrite: false, blending: THREE.NoBlending });
const covScene = new THREE.Scene(); { const q = quad(); q.material = covMat; covScene.add(q); }

function capStart() {
  let ok = false;
  try { ok = !!(xrSession && xrSession.enabledFeatures && xrSession.enabledFeatures.includes('camera-access')); } catch { ok = false; }
  if (!ok) { arStatus('Captura 360 no disponible.', $('optVR').checked ? 'Tu equipo no entrega la imagen de la cámara a la app.' : 'Activa "Permitir modo gafas VR" en Opciones y vuelve a iniciar la RA.'); return; }
  if (vr.on) setStereo(false);
  const W = parseInt($('optCapRes').value) || 4096, H = W / 2;
  const mk = () => new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  if (!cap.rtA || cap.W !== W) { cap.rtA && cap.rtA.dispose(); cap.rtB && cap.rtB.dispose(); cap.rtA = mk(); cap.rtB = mk(); cap.W = W; cap.H = H; }
  capClear();
  // sistema de referencia: el del modelo si está calzado (así la foto queda calzada sola); si no, el de la RA
  cap.placed = ar.phase === 'done';
  placer.updateMatrixWorld(true);
  if (cap.placed) { cap.modelRot.extractRotation(placer.matrixWorld); cap.modelInv.copy(placer.matrixWorld).invert(); }
  else { cap.modelRot.identity(); cap.modelInv.identity(); }
  if (!cap.sphere) {
    const g = new THREE.SphereGeometry(6, 64, 32); g.scale(-1, 1, 1);
    cap.sphere = new THREE.Mesh(g, capPrevMat); cap.sphere.renderOrder = 50; cap.sphere.frustumCulled = false; scene.add(cap.sphere);
  }
  cap.sphere.visible = true;
  cap.on = true; cap.paused = false; cap.lastQ = null;
  modelRoot.visible = false; originMarker.visible = false; reticle.visible = false;
  $('capPause').textContent = 'Pausar';
  show('arPlace', false); show('arAdjust', false); show('arCapPanel', true);
  arStatus('Captura 360: gira lento en tu lugar', 'Gira el teléfono sobre sí mismo (no con el brazo estirado). Cubre también arriba y abajo. Lo capturado se ve en color.');
}
function capClear() {
  const prevT = renderer.getRenderTarget(), xrOn = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setClearColor(0x000000, 0);
  for (const rt of [cap.rtA, cap.rtB]) { renderer.setRenderTarget(rt); renderer.clear(true, false, false); }
  renderer.setRenderTarget(prevT); renderer.xr.enabled = xrOn;
  cap.posSum.set(0, 0, 0); cap.posN = 0; cap.lastCov = 0;
  capPrevMat.uniforms.tex.value = cap.rtA.texture;
}
function capStop() {
  cap.on = false; if (cap.sphere) cap.sphere.visible = false;
  show('arCapPanel', false);
  if (ar.phase === 'done') { modelRoot.visible = true; originMarker.visible = true; show('arAdjust', true); }
  else { show('arPlace', true); }
}
const _vq = new THREE.Quaternion();
function capPaint(frame, force) {
  if (cap.paused) return;
  const pose = frame.getViewerPose(refSpace); if (!pose || pose.emulatedPosition) return;
  const view = pose.views[0]; if (!view.camera) return;
  // no pintar si el teléfono gira rápido (imagen movida)
  const now = performance.now();
  const vm = new THREE.Matrix4().fromArray(view.transform.matrix);
  _vq.setFromRotationMatrix(vm);
  if (force) { /* prueba */ } else if (cap.lastQ) {
    const speed = cap.lastQ.angleTo(_vq) / Math.max(1e-3, (now - cap.lastT) / 1000) / DEG;
    cap.lastQ.copy(_vq); cap.lastT = now;
    if (speed > 45) return;
  } else { cap.lastQ = _vq.clone(); cap.lastT = now; return; }
  if (!force && (cap.frameN++ % 2) === 1) return;   // cada 2 cuadros (rendimiento)
  if (!cap.binding) cap.binding = new XRWebGLBinding(xrSession, renderer.getContext());
  const glTex = cap.binding.getCameraImage(view.camera); if (!glTex) return;
  renderer.properties.get(vr.camTex).__webglTexture = glTex;
  // matriz: dirección del modelo -> dirección de la cámara
  const viewRotInv = new THREE.Matrix4().extractRotation(vm).invert();
  const M4 = new THREE.Matrix4().multiplyMatrices(viewRotInv, cap.modelRot);
  capMat.uniforms.uM.value.setFromMatrix4(M4);
  capMat.uniforms.uP.value.fromArray(view.projectionMatrix);
  capMat.uniforms.uFlip.value = $('optVRFlip').checked ? 1 : 0;
  capMat.uniforms.uCam.value = vr.camTex;
  capMat.uniforms.uPrev.value = cap.rtA.texture;
  const prevT = renderer.getRenderTarget();
  renderer.xr.enabled = false;
  renderer.setRenderTarget(cap.rtB); renderer.render(capScene, orthoCam);
  [cap.rtA, cap.rtB] = [cap.rtB, cap.rtA];
  capPrevMat.uniforms.tex.value = cap.rtA.texture;
  // cobertura cada ~1 s
  if (now - cap.covT > 1000) {
    cap.covT = now; covMat.uniforms.tex.value = cap.rtA.texture;
    renderer.setRenderTarget(covRT); renderer.render(covScene, orthoCam);
    const px = new Uint8Array(128 * 64 * 4); renderer.readRenderTargetPixels(covRT, 0, 0, 128, 64, px);
    let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 127) n++;
    // ponderado por área (las filas cerca de los polos pesan menos)
    let covW = 0, totW = 0;
    for (let r = 0; r < 64; r++) { const wr = Math.sin((r + 0.5) / 64 * Math.PI); for (let c2 = 0; c2 < 128; c2++) { totW += wr; if (px[(r * 128 + c2) * 4] > 127) covW += wr; } }
    cap.lastCov = covW / totW;
    arStatus(`Captura 360: ${Math.round(cap.lastCov * 100)}% cubierto`, cap.lastCov < 0.9 ? 'Sigue girando; incluye el cielo y el piso.' : 'Casi completa. Toca "Terminar y guardar".');
  }
  renderer.setRenderTarget(prevT); renderer.xr.enabled = true;
  // posición de la cámara (promedio) y esfera de vista previa centrada en el usuario
  const wp = new THREE.Vector3().setFromMatrixPosition(vm);
  cap.posSum.add(wp); cap.posN++;
  cap.sphere.position.copy(wp);
  cap.sphere.quaternion.setFromRotationMatrix(cap.modelRot);
}
async function capFinish() {
  if (!cap.rtA) return;
  cap.paused = true;
  arStatus('Guardando foto 360…', 'Un momento.');
  await new Promise(r => setTimeout(r, 50));
  const W = cap.W, H = cap.H;
  const px = new Uint8Array(W * H * 4);
  const xrOn = renderer.xr.enabled; renderer.xr.enabled = false;
  renderer.readRenderTargetPixels(cap.rtA, 0, 0, W, H, px);
  renderer.xr.enabled = xrOn;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {           // WebGL lee de abajo hacia arriba: se invierten las filas
    const src = (H - 1 - y) * W * 4, dst = y * W * 4;
    for (let i = 0; i < W * 4; i += 4) { img.data[dst + i] = px[src + i]; img.data[dst + i + 1] = px[src + i + 1]; img.data[dst + i + 2] = px[src + i + 2]; img.data[dst + i + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
  const name = `foto360_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jpg`;
  // calibración: posición promedio de la cámara en ejes del modelo (X, Y, Z arriba)
  let calib = { x: 0, y: 0, z: 1.5, h: 0, p: 0, r: 0 };
  if (cap.posN) {
    const pm = cap.posSum.clone().multiplyScalar(1 / cap.posN).applyMatrix4(cap.modelInv);
    calib = { x: +pm.x.toFixed(3), y: +(-pm.z).toFixed(3), z: +pm.y.toFixed(3), h: 0, p: 0, r: 0 };
  }
  const file = { name, buffer: await blob.arrayBuffer() };
  await DB.set('pano', { name, buffer: file.buffer, calib });
  pano.file = null;
  try { await panoLoad(file, calib); } catch (e) { console.error(e); }
  downloadBlob(blob, name);
  capStop();
  arStatus(`Foto 360 guardada (${Math.round(cap.lastCov * 100)}% cubierto).`,
    cap.placed ? 'Quedó calzada con el modelo. Sal de la RA y toca "Foto 360" para verla.' : 'El modelo no estaba calzado: al verla tendrás que ajustar el rumbo y la posición a mano.');
}
function downloadBlob(blob, name) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); } catch {}
}
tap($('arCap'), capStart);
tap($('capPause'), () => { cap.paused = !cap.paused; cap.lastQ = null; $('capPause').textContent = cap.paused ? 'Reanudar' : 'Pausar'; });
tap($('capReset'), () => { capClear(); arStatus('Captura reiniciada.', 'Vuelve a girar lentamente.'); });
tap($('capDone'), () => { capFinish().catch(e => { console.error(e); arStatus('No se pudo guardar la foto 360.', String(e.message || e)); }); });
tap($('capCancel'), () => { capStop(); arStatus('Captura cancelada.'); });

// ---------------------------------------------------------------- bucle
const tmpM = new THREE.Matrix4();
let loopErr = false;
renderer.setAnimationLoop((t, frame) => {
  try { tick(frame); } catch (err) {
    console.error(err);
    if (!loopErr) { loopErr = true; state.depthWanted = false; occ.uDepthOn.value = 0; arStatus('Se produjo un error y desactivé la profundidad.', String(err.message || err)); }
  }
  if (!frame && pano.on && pano.vr) { stereo.setEyeSeparation((parseFloat($('optIPD').value) || 64) / 1000); stereo.render(scene, camera); return; }
  if (cap.on && frame) {
    try { capPaint(frame); } catch (err) { console.error(err); capStop(); arStatus('Error en la captura 360.', String(err.message || err)); }
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
  } else if (pano.on) {
    panoUpdate();
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
window.__ra = { capPaint, capFinish, capTestInit: (W) => { const mk = () => new THREE.WebGLRenderTarget(W, W / 2, { depthBuffer: false }); cap.rtA = mk(); cap.rtB = mk(); cap.W = W; cap.H = W / 2; capClear(); cap.modelRot.identity(); cap.modelInv.identity(); cap.placed = true; const g = new THREE.SphereGeometry(6, 32, 16); g.scale(-1, 1, 1); cap.sphere = new THREE.Mesh(g, capPrevMat); cap.sphere.visible = false; scene.add(cap.sphere); }, cap, capMat, capScene, orthoCam, vr, pano, panoLoad, panoEnter, panoExit, testStereo: (sess, frame) => { const prev = xrSession, prevRef = refSpace; xrSession = sess; try { return renderStereo(frame); } finally { xrSession = prev; refSpace = prevRef; vr.binding = null; } }, state, scene, modelRoot, ar, placer, resetPlacement, occ, THREE, camera, renderer, applyVisual, fakeHit: (x, y, z) => { goodHit = { matrix: new THREE.Matrix4().makeTranslation(x, y, z), t: performance.now() }; } };
