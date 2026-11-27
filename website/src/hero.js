import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The Coedit symbol is two 40-unit-wide arcs with round ends (frontend/public/brand/coedit-symbol.svg).
// Radius 82, centres 12 units above and below the middle of its 256 viewBox, each spanning 130 degrees.
const ARCS = [
  { y: 12, from: 115 },
  { y: -12, from: -65 },
];
const PAGE = '#FAFBFC', INK = '#0B0E13';
const TINTS = {
  light: { attenuation: '#aebccb', distance: 210, color: '#ffffff' },
  dark: { attenuation: '#394454', distance: 105, color: '#eef1f6' },
};

const hero = document.querySelector('.hero');
const canvas = document.querySelector('.glass');
const title = document.querySelector('.hero-title');
const mark = document.querySelector('.mark');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function start() {
  await document.fonts.load('700 100px Plex');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAGE);
  const camera = new THREE.PerspectiveCamera(24, 1, 10, 20000);
  scene.environment = studio(renderer);

  // The headline is drawn inside the scene so the glass can bend it.
  const wordCanvas = document.createElement('canvas');
  const wordTex = new THREE.CanvasTexture(wordCanvas);
  wordTex.colorSpace = THREE.SRGBColorSpace;
  wordTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const word = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: wordTex, toneMapped: false }),
  );
  scene.add(word);

  const glass = new THREE.MeshPhysicalMaterial({
    transmission: 1, roughness: 0.035, metalness: 0, ior: 1.5, thickness: 40,
    dispersion: 3, clearcoat: 1, clearcoatRoughness: 0.04,
    envMapIntensity: 1.15, specularIntensity: 1,
  });
  const logo = new THREE.Group();
  const sweepAngle = THREE.MathUtils.degToRad(130);
  for (const arc of ARCS) {
    const body = new THREE.TorusGeometry(82, 20, 96, 192, sweepAngle);
    const cap = () => new THREE.SphereGeometry(20, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2);
    const head = cap().rotateX(Math.PI).translate(82, 0, 0);
    const tail = cap().translate(82, 0, 0).rotateZ(sweepAngle);
    const geo = mergeGeometries([body, head, tail]);
    geo.rotateZ(THREE.MathUtils.degToRad(arc.from)).translate(0, arc.y, 0);
    logo.add(new THREE.Mesh(geo, glass));
  }
  scene.add(logo);

  // One directional key light from the upper left.
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(-600, 700, 600);
  scene.add(key);
  const sweep = new THREE.DirectionalLight('#ffffff', 0);
  scene.add(sweep);

  let baseY = 0, size = 1;
  function layout() {
    const w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); // 1 unit = 1 CSS px at z=0
    camera.position.set(0, 0, dist);
    camera.updateProjectionMatrix();

    const hr = hero.getBoundingClientRect(), tr = title.querySelector('svg').getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    wordCanvas.width = Math.round(tr.width * dpr);
    wordCanvas.height = Math.round(tr.height * dpr);
    const c = wordCanvas.getContext('2d');
    c.fillStyle = PAGE;
    c.fillRect(0, 0, wordCanvas.width, wordCanvas.height);
    // Same geometry as the SVG viewBox "0 -76 300 98".
    c.scale(wordCanvas.width / 300, wordCanvas.height / 98);
    c.translate(0, 76);
    c.font = '700 100px Plex';
    c.fillStyle = INK;
    const natural = c.measureText('Coedit').width;
    c.scale(300 / natural, 1);
    c.fillText('Coedit', 0, 0);
    wordTex.dispose();
    wordTex.needsUpdate = true;

    const depth = 140, k = (dist + depth) / dist;
    word.position.set((tr.left - hr.left + tr.width / 2 - w / 2) * k, (h / 2 - (tr.top - hr.top + tr.height / 2)) * k, -depth);
    word.scale.set(tr.width * k, tr.height * k, 1);

    const mr = mark.getBoundingClientRect();
    size = mr.width / 214; // the symbol spans about 214 of its 256 units
    logo.scale.setScalar(size);
    baseY = h / 2 - (mr.top - hr.top + mr.height / 2);
    glass.thickness = 46 * size;
    setTint(tint);
  }

  let tint = 'light';
  function setTint(name) {
    tint = name;
    const t = TINTS[name];
    glass.color.set(t.color);
    glass.attenuationColor.set(t.attenuation);
    glass.attenuationDistance = t.distance * size;
  }

  // The only motion: a slow float, and one light sweep shortly after load.
  function draw(ms) {
    const t = reduced ? 0 : ms / 1000;
    const phase = (t / 9) * Math.PI * 2;
    logo.position.set(0, baseY + Math.sin(phase) * 7, 0);
    logo.rotation.set(-0.12 + Math.sin(phase) * 0.035, -0.34 + Math.cos(phase) * 0.09, 0);
    const s = reduced ? 1 : THREE.MathUtils.clamp((t - 0.8) / 2.2, 0, 1);
    const e = s * s * (3 - 2 * s);
    sweep.intensity = s > 0 && s < 1 ? Math.sin(s * Math.PI) * 7 : 0;
    sweep.position.set(-900 + 1800 * e, 200, 420);
    scene.environmentRotation.y = reduced ? 0 : Math.sin(e * Math.PI) * 0.9;
    renderer.render(scene, camera);
  }

  let visible = true, began = null;
  const frame = (now) => { began ??= now; draw(now - began); };
  const run = () => {
    if (reduced) { draw(0); return; }
    renderer.setAnimationLoop(visible ? frame : null);
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(hero);
  new ResizeObserver(() => { layout(); if (reduced) draw(0); }).observe(hero);
  addEventListener('coedit-theme', (e) => { setTint(e.detail); if (reduced) draw(0); });
  canvas.addEventListener('webglcontextlost', () => document.documentElement.classList.remove('has-glass'));

  layout();
  draw(0);
  document.documentElement.classList.add('has-glass');
  run();
}

// A small studio: softboxes on a grey room, used only for reflections on the glass.
function studio(renderer) {
  const room = new THREE.Scene();
  room.background = new THREE.Color('#8d96a3');
  const panel = (w, h, pos, level) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(level, level, level), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  panel(5, 7, [-6, 5, 5], 9);     // key softbox, upper left
  panel(1.2, 9, [7, 1, 2], 4);    // thin strip, right edge
  panel(10, 2, [0, 8, -1], 3);    // top
  panel(14, 5, [0, -7, 0], 0.12); // dark floor
  panel(2.2, 12, [-8, 0, -3], 0.05);
  panel(2.2, 12, [8, -1, -4], 0.05);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(room, 0.02).texture;
  pmrem.dispose();
  return tex;
}

start().catch((err) => console.warn('Glass logo unavailable, showing the flat mark.', err));
