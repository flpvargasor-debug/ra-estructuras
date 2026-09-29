// RA Estructuras — visor WebXR offline para superponer estructura proyectada sobre existente.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const $ = (id) => document.getElementById(id);
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
  opProj: 0.85, opExist: 0.35, showExist: true, edgesOnly: false,
};
const msgs = $('msgs');
function msg(text, kind = '') {
  const d = document.createElement('div'); d.className = 'msg ' + kind; d.textContent = text; msgs.appendChild(d);
}
function clearMsgs() { msgs.innerHTML = ''; }

// ---------------------------------------------------------------- persistencia (IndexedDB, opcional)
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
  async get(k) {
    try { const db = await this.open(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
    catch { return undefined; }
  },
  async set(k, v) {
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

const existMat = new THREE.MeshBasicMaterial({ color: 0x7fc4e8, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
const edgeMat = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9 });

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
        const c = m.clone(); c.transparent = true; c.opacity = state.opProj; c.side = THREE.DoubleSide; return c;
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
  existMat.opacity = state.opExist; existMat.visible = state.showExist && !state.edgesOnly;
  existMat.needsUpdate = true;
  edgeMat.visible = state.showExist;
  for (const m of state.projMeshes) {
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) { mt.opacity = state.opProj; mt.transparent = state.opProj < 1; }
  }
  for (const m of state.existMeshes) m.visible = state.showExist;
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
    msg(why + ' La vista 3D sí funciona para revisar el modelo.', 'warn');
  }
}

$('btnAR').onclick = async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors'],
      domOverlay: { root: $('ar') },
    });
    startAR(session);
  } catch (err) {
    console.error(err); msg('No se pudo iniciar la RA: ' + (err.message || err), 'err');
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
}
function endAR() {
  hitSource = null; xrSession = null; anchor = null;
  $('ar').classList.remove('on');
  scene.background = previewBg; grid.visible = true;
  reticle.visible = markA.visible = abLine.visible = false;
  anchorGroup.matrix.identity(); ar.yaw = ar.dx = ar.dy = ar.dz = 0; updatePlacer();
  modelRoot.visible = true; originMarker.visible = true;
  resize();
}
$('arExit').onclick = () => xrSession && xrSession.end();
// que los toques en la interfaz no se interpreten como gestos de RA
$('ar').addEventListener('beforexrselect', (e) => e.preventDefault());

function resetPlacement() {
  ar.phase = 'A'; ar.A = ar.B = null; ar.yaw = ar.dx = ar.dy = ar.dz = 0;
  if (anchor) { try { anchor.delete(); } catch {} anchor = null; }
  anchorGroup.matrix.identity(); updatePlacer();
  modelRoot.visible = false; originMarker.visible = false;
  markA.visible = abLine.visible = false;
  show('arPlace', true); show('arAdjust', false); show('arSetA', true); show('arSetB', false); show('arQuick', true);
  arStatus('Apunta la cruz al <b>punto A</b> real (origen del modelo) y toca <b>Fijar A</b>.', 'Mueve el celular lento apuntando al piso hasta que aparezca el círculo.');
}

function hitPos() { return lastHit ? new THREE.Vector3().setFromMatrixPosition(lastHit.matrix) : null; }

$('arSetA').onclick = () => {
  const p = hitPos(); if (!p) return;
  ar.A = p; ar.hitA = lastHit.result;
  markA.position.copy(p); markA.visible = true;
  ar.phase = 'B';
  show('arSetA', false); show('arSetB', true); show('arQuick', true);
  arStatus('A fijado. Ahora apunta al <b>punto B</b> (sobre el eje +X del modelo) y toca <b>Fijar B</b>.', 'O toca "Colocar solo en A" para orientarlo a mano.');
};
$('arSetB').onclick = () => {
  const p = hitPos(); if (!p || !ar.A) return;
  const d = p.clone().sub(ar.A); d.y = 0;
  if (d.length() < 0.3) { arStatus('B está muy cerca de A (&lt; 30 cm).', 'Aléjate: la orientación es más precisa con puntos separados varios metros.'); return; }
  ar.B = p;
  place(Math.atan2(-d.z, d.x));
  const meas = d.length();
  const ab = parseFloat($('optAB').value);
  let sub = `Distancia medida A–B: ${meas.toFixed(2)} m`;
  if (ab > 0) sub += ` · modelo ${ab.toFixed(2)} m · diferencia ${((meas - ab) * 100).toFixed(0)} cm`;
  arStatus('Modelo calzado con A y B. Afina si hace falta.', sub);
};
$('arQuick').onclick = () => {
  if (!ar.A) { const p = hitPos(); if (!p) return; ar.A = p; ar.hitA = lastHit.result; }
  // eje +X del modelo perpendicular a la dirección de la mirada
  const cam = renderer.xr.getCamera(); const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
  place(Math.atan2(-fwd.z, fwd.x) - Math.PI / 2);
  arStatus('Modelo colocado en A. Gíralo con los botones hasta que calce.', 'Tip: usa la estructura existente (celeste) como referencia.');
};

async function place(yaw) {
  ar.yaw = yaw; ar.dx = ar.dy = ar.dz = 0; ar.phase = 'done';
  // ancla (si el equipo lo permite) para reducir la deriva
  const base = new THREE.Matrix4().makeTranslation(ar.A.x, ar.A.y, ar.A.z);
  anchorGroup.matrix.copy(base); ar.baseFix = base.clone();
  if (ar.hitA && ar.hitA.createAnchor) {
    try {
      anchor = await ar.hitA.createAnchor();
    } catch { anchor = null; }
  }
  if (anchor) ar.anchorAtFix = null; // se captura en el primer cuadro
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

$('arRedo').onclick = resetPlacement;
for (const b of document.querySelectorAll('[data-rot]')) b.onclick = () => { ar.yaw += parseFloat(b.dataset.rot) * DEG; updatePlacer(); };
for (const b of document.querySelectorAll('[data-mv]')) b.onclick = () => {
  const s = ar.step, k = b.dataset.mv;
  if (k === 'x+') ar.dx += s; if (k === 'x-') ar.dx -= s;
  if (k === 'z+') ar.dz -= s; if (k === 'z-') ar.dz += s;   // Y del modelo (SketchUp) = −Z en glTF
  if (k === 'y+') ar.dy += s; if (k === 'y-') ar.dy -= s;
  updatePlacer(); adjInfo();
};
const steps = [0.01, 0.05, 0.10, 0.001];
$('stepBtn').onclick = () => { ar.step = steps[(steps.indexOf(ar.step) + 1) % steps.length]; $('stepLbl').textContent = ar.step >= 0.01 ? `${Math.round(ar.step * 100)} cm` : '1 mm'; };
$('resetAdj').onclick = () => { ar.dx = ar.dy = ar.dz = 0; updatePlacer(); adjInfo(); };
function adjInfo() {
  arStatus('Ajuste fino', `ΔX ${(ar.dx * 100).toFixed(1)} cm · ΔY ${(-ar.dz * 100).toFixed(1)} cm · Δaltura ${(ar.dy * 100).toFixed(1)} cm · giro ${(ar.yaw / DEG).toFixed(1)}°`);
}
const tabs = { tabRot: 'pRot', tabMove: 'pMove', tabView: 'pView' };
for (const [t, p] of Object.entries(tabs)) $(t).onclick = () => {
  for (const [t2, p2] of Object.entries(tabs)) { $(t2).classList.toggle('act', t2 === t); show(p2, p2 === p); }
};
$('opProj').oninput = (e) => { state.opProj = +e.target.value; applyVisual(); };
$('opExist').oninput = (e) => { state.opExist = +e.target.value; applyVisual(); };
$('tgExist').onclick = () => { state.showExist = !state.showExist; $('tgExist').textContent = state.showExist ? 'Ocultar existente' : 'Mostrar existente'; applyVisual(); };
$('tgEdges').onclick = () => { state.edgesOnly = !state.edgesOnly; $('tgEdges').textContent = state.edgesOnly ? 'Caras + aristas' : 'Solo aristas'; applyVisual(); };

// ---------------------------------------------------------------- bucle
const tmpM = new THREE.Matrix4();
renderer.setAnimationLoop((t, frame) => {
  if (frame && hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) {
      const pose = hits[0].getPose(refSpace);
      lastHit = { matrix: new THREE.Matrix4().fromArray(pose.transform.matrix), result: hits[0] };
      reticle.matrix.copy(lastHit.matrix);
      reticle.visible = ar.phase !== 'done';
      $('arSetA').disabled = $('arSetB').disabled = $('arQuick').disabled = false;
      if (ar.phase === 'B' && ar.A) {
        const p = hitPos();
        abLine.geometry.setFromPoints([ar.A, p]); abLine.visible = true;
        const d = Math.hypot(p.x - ar.A.x, p.z - ar.A.z);
        $('arStatus').querySelector('small') && ($('arStatus').querySelector('small').textContent = `Distancia A → cruz: ${d.toFixed(2)} m`);
      }
    } else {
      lastHit = null; reticle.visible = false;
      $('arSetA').disabled = $('arSetB').disabled = $('arQuick').disabled = true;
    }
    // seguimiento del ancla: aplica la corrección de deriva sobre la pose fijada
    if (anchor && frame.trackedAnchors && frame.trackedAnchors.has(anchor)) {
      const ap = frame.getPose(anchor.anchorSpace, refSpace);
      if (ap) {
        const now = tmpM.fromArray(ap.transform.matrix);
        if (!ar.anchorAtFix) ar.anchorAtFix = now.clone().invert().multiply(ar.baseFix); // relación ancla→A
        anchorGroup.matrix.multiplyMatrices(now, ar.anchorAtFix);
      }
    }
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- estado de red / service worker
function net() { const b = $('netBadge'); b.textContent = navigator.onLine ? 'en línea' : 'sin conexión'; b.classList.toggle('on', true); }
addEventListener('online', net); addEventListener('offline', net); net();
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
}

// ---------------------------------------------------------------- inicio
(async () => {
  resize();
  const o = await DB.get('opts');
  if (o) { $('optUnits').value = o.units || '1'; $('optUp').value = o.up || 'z'; $('optKey').value = o.key || 'EXIST'; $('optAB').value = o.ab || ''; }
  const saved = await DB.get('files');
  if (saved && saved.length) await openFiles(saved, false); else await loadDemo();
  await checkXR();
})();

// acceso para pruebas
window.__ra = { state, scene, modelRoot };
