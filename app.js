/* ── 360° Panorama Viewer — app.js ────────────────────────── */
'use strict';

const PROXY = 'https://corsproxy.io/?';

/* ── State ────────────────────────────────────────────────── */
let camera, scene, renderer, mesh, animId;
let autoRotate  = false;
let isDragging  = false;
let prevX = 0, prevY = 0;
let rotX  = 0, rotY  = 0;
let velX  = 0, velY  = 0;       // for smooth damping
let currentFOV  = 75;
let rotSpeed    = 0.002;
let invertY     = false;
let useDamping  = true;
let pinchDist   = null;          // for pinch-to-zoom

/* ── DOM refs ─────────────────────────────────────────────── */
const mount       = document.getElementById('three-mount');
const placeholder = document.getElementById('placeholder');
const loadingEl   = document.getElementById('loading-overlay');
const errorEl     = document.getElementById('error-overlay');
const sceneLabel  = document.getElementById('scene-label');
const urlInput    = document.getElementById('url-input');
const fovSlider   = document.getElementById('fov-slider');
const fovVal      = document.getElementById('fov-val');
const speedSlider = document.getElementById('speed-slider');
const speedVal    = document.getElementById('speed-val');
const progBar     = document.getElementById('prog-bar');
const loadMsg     = document.getElementById('load-msg');
const btnAuto     = document.getElementById('btn-auto');

/* ── Three.js init ────────────────────────────────────────── */
function initThree() {
  const w = mount.clientWidth  || 800;
  const h = mount.clientHeight || 450;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 2000);
  camera.position.set(0, 0, 0.01);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  mount.appendChild(renderer.domElement);

  // Resize observer
  new ResizeObserver(() => {
    const nw = mount.clientWidth, nh = mount.clientHeight;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  }).observe(mount);

  attachControls();
  animate();
}

/* ── Render loop ──────────────────────────────────────────── */
function animate() {
  animId = requestAnimationFrame(animate);

  if (autoRotate && !isDragging) {
    rotY += rotSpeed;
  }

  // Damping
  if (useDamping && !isDragging) {
    velX *= 0.88;
    velY *= 0.88;
    rotX += velX;
    rotY += velY;
  }

  rotX = Math.max(-Math.PI / 2.05, Math.min(Math.PI / 2.05, rotX));

  if (mesh) {
    mesh.rotation.x = rotX;
    mesh.rotation.y = rotY;
  }

  renderer.render(scene, camera);
}

/* ── Controls ─────────────────────────────────────────────── */
function attachControls() {
  const el = renderer.domElement;

  /* Mouse */
  el.addEventListener('mousedown', e => {
    isDragging = true;
    prevX = e.clientX; prevY = e.clientY;
    velX = 0; velY = 0;
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX; prevY = e.clientY;
    const dir = invertY ? -1 : 1;
    if (useDamping) {
      velY = -dx * 0.003;
      velX = -dy * 0.003 * dir;
    } else {
      rotY -= dx * 0.003;
      rotX -= dy * 0.003 * dir;
    }
  });

  /* Scroll / wheel zoom */
  el.addEventListener('wheel', e => {
    e.preventDefault();
    setFOV(Math.max(20, Math.min(120, currentFOV + e.deltaY * 0.05)));
  }, { passive: false });

  /* Touch drag */
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      prevX = e.touches[0].clientX;
      prevY = e.touches[0].clientY;
      velX = 0; velY = 0;
      pinchDist = null;
    } else if (e.touches.length === 2) {
      isDragging = false;
      pinchDist = getTouchDist(e.touches);
    }
  }, { passive: true });

  window.addEventListener('touchend', e => {
    if (e.touches.length === 0) { isDragging = false; pinchDist = null; }
  });

  window.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - prevX;
      const dy = e.touches[0].clientY - prevY;
      prevX = e.touches[0].clientX;
      prevY = e.touches[0].clientY;
      const dir = invertY ? -1 : 1;
      if (useDamping) {
        velY = -dx * 0.003;
        velX = -dy * 0.003 * dir;
      } else {
        rotY -= dx * 0.003;
        rotX -= dy * 0.003 * dir;
      }
    } else if (e.touches.length === 2 && pinchDist !== null) {
      const newDist = getTouchDist(e.touches);
      const delta = pinchDist - newDist;
      setFOV(Math.max(20, Math.min(120, currentFOV + delta * 0.1)));
      pinchDist = newDist;
    }
  }, { passive: true });
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ── Load panorama from URL ───────────────────────────────── */
function loadURL(url, label, useProxy) {
  const finalURL = useProxy ? PROXY + encodeURIComponent(url) : url;
  loadTexture(finalURL, label || extractName(url));
}

function loadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  loadTexture(url, name);
}

function loadTexture(url, label) {
  placeholder.style.display = 'none';
  loadingEl.style.display   = 'flex';
  errorEl.style.display     = 'none';
  progBar.style.width       = '0%';
  loadMsg.textContent       = 'Loading…';
  sceneLabel.textContent    = (label || 'Panorama').slice(0, 38);

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
    mesh = null;
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  loader.load(
    url,
    tex => {
      tex.encoding = THREE.sRGBEncoding;
      const geo = new THREE.SphereGeometry(500, 64, 32);
      geo.scale(-1, 1, 1);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
      scene.add(mesh);
      loadingEl.style.display = 'none';

      if (document.getElementById('auto-on-load').checked) {
        autoRotate = true;
        btnAuto.classList.add('active');
      }
    },
    xhr => {
      if (xhr.total) {
        const pct = Math.round(xhr.loaded / xhr.total * 100);
        progBar.style.width = pct + '%';
        loadMsg.textContent = 'Loading… ' + pct + '%';
      }
    },
    () => {
      loadingEl.style.display = 'none';
      errorEl.style.display   = 'flex';
      sceneLabel.textContent  = 'Failed to load';
    }
  );
}

function extractName(url) {
  try {
    return decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/_/g, ' ');
  } catch { return 'Panorama'; }
}

/* ── FOV ──────────────────────────────────────────────────── */
function setFOV(v) {
  currentFOV = Math.round(v);
  if (camera) { camera.fov = currentFOV; camera.updateProjectionMatrix(); }
  fovSlider.value = currentFOV;
  fovVal.textContent = currentFOV + '°';
}
window.setFOV = setFOV;     // called from inline HTML onclick

/* ── Tab switching ────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('pane-' + tab.dataset.tab).classList.add('active');
  });
});

/* ── URL tab ──────────────────────────────────────────────── */
document.getElementById('load-url-btn').addEventListener('click', () => {
  const u = urlInput.value.trim();
  if (u) loadURL(u, null, false);
});
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('load-url-btn').click();
});

/* ── Upload tab ───────────────────────────────────────────── */
const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click',  () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadBlob(f, f.name);
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (f) loadBlob(f, f.name);
});

/* ── Sample cards ─────────────────────────────────────────── */
document.querySelectorAll('.s-card').forEach(card => {
  card.addEventListener('click', () => {
    const url  = card.dataset.url;
    const name = card.dataset.name;
    document.querySelectorAll('.tab')[0].click();   // switch to URL tab view
    loadURL(url, name, true);                        // load via proxy
  });
});

/* ── Viewer control buttons ───────────────────────────────── */
btnAuto.addEventListener('click', () => {
  autoRotate = !autoRotate;
  btnAuto.classList.toggle('active', autoRotate);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  rotX = 0; rotY = 0; velX = 0; velY = 0;
  setFOV(75);
});

document.getElementById('btn-fs').addEventListener('click', () => {
  const wrap = document.getElementById('viewer-wrap');
  if (!document.fullscreenElement) {
    wrap.requestFullscreen && wrap.requestFullscreen();
  } else {
    document.exitFullscreen && document.exitFullscreen();
  }
});

document.getElementById('err-dismiss').addEventListener('click', () => {
  errorEl.style.display = 'none';
});

/* ── Settings ─────────────────────────────────────────────── */
fovSlider.addEventListener('input', () => setFOV(parseInt(fovSlider.value)));

speedSlider.addEventListener('input', () => {
  const v = parseInt(speedSlider.value);
  speedVal.textContent = v;
  rotSpeed = v * 0.0005;
});

document.getElementById('invert-y').addEventListener('change', e => {
  invertY = e.target.checked;
});

document.getElementById('auto-on-load').addEventListener('change', () => {});

document.getElementById('damping-check').addEventListener('change', e => {
  useDamping = e.target.checked;
  if (!useDamping) { velX = 0; velY = 0; }
});

/* ── Boot ─────────────────────────────────────────────────── */
initThree();
