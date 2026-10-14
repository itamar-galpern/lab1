// Space Chess 3D world (three.js): the nebula sky, planets and asteroid belt, the floating station
// board with its black holes, wormhole portals and orbit seam, the fleet, picking, highlights, move
// animations and effects. The app talks to it only through the object createScene() returns.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPiece, glowTexture, TEAM } from './pieces.js';
import { BLACK_HOLES, WORMHOLES, FILES } from './rules.js';

const LIGHT = '#eedcb5', DARK = '#1c3f72';
const VIOLET = new THREE.Color(0xb07cff), CYAN = new THREE.Color(0x4ff0ff);
const TOP = 0.05;                       // height of the tile surface
const cx = x => x - 3.5;                // world x of file x (0 = a)
const cz = y => y - 3.5;                // world z of row y (0 = rank 8)
const sqPos = (i, h = TOP) => new THREE.Vector3(cx(i % 8), h, cz(i >> 3));
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const easeOut = k => 1 - (1 - k) ** 3;
const smooth = (a, b, v) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
const hot = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // brighter than white, so bloom picks it up

// ---------- painted textures ----------

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// A board tile: base colour, faint brushed grain, an inset panel line and corner brackets.
function tileTexture(base, line) {
  return canvasTexture(256, 256, (g, w) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, w);
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rnd(0.01, 0.04)})`;
      g.fillRect(rnd(0, w), rnd(0, w), rnd(8, 40), 1);
    }
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.strokeRect(18, 18, w - 36, w - 36);
    g.lineWidth = 6;
    const c = 34, m = 10;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, w - m, 1, -1], [w - m, w - m, -1, -1]]) {
      g.beginPath();
      g.moveTo(x + dx * c, y); g.lineTo(x, y); g.lineTo(x, y + dy * c);
      g.stroke();
    }
  });
}

function labelTexture(text, color = 'rgba(243,227,195,0.85)') {
  return canvasTexture(64, 64, (g, w) => {
    g.fillStyle = color;
    g.font = '30px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, w / 2 + 2);
  });
}

// Banded gas giant: wavy stripes with a few storms, softened with a blur.
function gasTexture(colors) {
  return canvasTexture(1024, 512, (g, w, h) => {
    let y = 0;
    while (y < h) {
      const bh = rnd(6, 34);
      g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      g.globalAlpha = rnd(0.55, 1);
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.012 + y) * 4);
      for (let x = w; x >= 0; x -= 16) g.lineTo(x, y + bh + Math.sin(x * 0.01 + y * 2) * 5);
      g.fill();
      y += bh * rnd(0.6, 0.95);
    }
    g.globalAlpha = 1;
    for (let k = 0; k < 7; k++) {
      g.fillStyle = colors[k % colors.length];
      g.beginPath();
      g.ellipse(rnd(0, w), rnd(h * 0.2, h * 0.8), rnd(14, 40), rnd(6, 14), 0, 0, Math.PI * 2);
      g.fill();
    }
    g.filter = 'blur(3px)';
    g.drawImage(g.canvas, 0, 0);
    g.filter = 'none';
  });
}

function rockyTexture(base, spots) {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 260; k++) {
      g.fillStyle = spots[k % spots.length];
      g.globalAlpha = rnd(0.08, 0.35);
      g.beginPath();
      g.arc(rnd(0, w), rnd(0, h), rnd(2, 26), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

function ringTexture(colors) {
  return canvasTexture(512, 8, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const k = x / w;
      const a = (0.25 + 0.75 * Math.abs(Math.sin(k * 41) * Math.sin(k * 13 + 1))) * Math.sin(k * Math.PI) ** 0.6;
      g.fillStyle = colors[Math.floor(k * colors.length * 3) % colors.length];
      g.globalAlpha = a;
      g.fillRect(x, 0, 1, h);
    }
  });
}

// ---------- shaders ----------

const NOISE = `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

const UV_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

// Painted nebula sky, rendered once into a cube map.
function bakeSky(renderer) {
  const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(1, 100, rt);
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float band = 1.0 - abs(dot(d, normalize(vec3(0.3, 1.0, 0.2))));
        vec3 col = mix(vec3(0.004, 0.008, 0.03), vec3(0.015, 0.045, 0.13), pow(band, 2.5));
        float n1 = fbm(d * 2.1);
        float n2 = fbm(d * 4.2 + vec3(n1 * 1.6));
        float cloud = smoothstep(0.42, 0.86, n2) * (0.25 + 0.75 * pow(band, 1.3));
        vec3 neb = mix(vec3(0.02, 0.32, 0.42), vec3(0.28, 0.1, 0.5), smoothstep(0.35, 0.68, n1));
        neb = mix(neb, vec3(0.85, 0.38, 0.12), smoothstep(0.6, 0.8, fbm(d * 3.0 + 7.0)) * 0.75);
        col += neb * cloud * 0.75;
        col *= 1.0 - 0.6 * smoothstep(0.55, 0.78, fbm(d * 6.5 + 3.0)) * band;
        vec3 sp = d * 380.0, id = floor(sp);
        float h = hash(id);
        float star = step(0.9975, h) * smoothstep(0.55, 0.0, length(fract(sp) - 0.5));
        col += star * mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.6), hash(id + 3.0)) * (0.3 + 0.9 * hash(id + 5.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })));
  cam.update(renderer, s);
  return rt.texture;
}

function starField(count = 2600) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const size = new Float32Array(count), phase = new Float32Array(count);
  const tints = [[0.75, 0.85, 1], [1, 1, 1], [1, 0.85, 0.6], [0.7, 1, 1]];
  const v = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    v.randomDirection().multiplyScalar(rnd(650, 900));
    pos.set([v.x, v.y, v.z], k * 3);
    col.set(tints[k % 4], k * 3);
    size[k] = Math.random() < 0.04 ? rnd(5, 9) : rnd(1.5, 3.6);
    phase[k] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      attribute float aSize; attribute float aPhase; attribute vec3 aColor;
      uniform float uTime; uniform float uScale;
      varying vec3 vColor; varying float vTw;
      void main() {
        vColor = aColor;
        vTw = 0.6 + 0.4 * sin(uTime * (0.7 + aPhase * 2.0) + aPhase * 40.0);
        gl_PointSize = aSize * uScale * vTw;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d); a *= a;
        gl_FragColor = vec4(vColor * a * (0.6 + vTw), a);
      }`,
  });
  return new THREE.Points(geo, mat);
}

const fresnel = (color, power, intensity) => new THREE.ShaderMaterial({
  ...additive,
  uniforms: { uColor: { value: new THREE.Color(color) }, uP: { value: power }, uI: { value: intensity } },
  vertexShader: `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uP; uniform float uI; varying vec3 vN; varying vec3 vV;
    void main() { float f = pow(1.0 - abs(dot(vN, vV)), uP); gl_FragColor = vec4(uColor * f * uI, f); }`,
});

// ---------- the scene ----------

export async function createScene(container, { onSquareClick = () => {}, onHover = () => {}, onFx = () => {} } = {}) {
  await Promise.race([document.fonts.load('20px "Press Start 2P"'), new Promise(r => setTimeout(r, 1500))]).catch(() => {});

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = bakeSky(renderer);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2500);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.8,
    minDistance: 7, maxDistance: 32, minPolarAngle: 0.12, maxPolarAngle: 1.36, enabled: false,
  });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.45, 1.0);
  composer.addPass(bloom);
  const vignette = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 p = vUv - 0.5;
        float v = smoothstep(0.85, 0.25, length(p * vec2(1.0, 0.85)));
        float grain = fract(sin(dot(vUv * 913.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        gl_FragColor = vec4(c.rgb * mix(0.55, 1.0, v) + grain * 0.012, c.a);
      }`,
  });
  composer.addPass(vignette);
  composer.addPass(new OutputPass());

  // ----- lights -----
  scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0b1430, 0.45));
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.0);
  sun.position.set(7, 13, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8a6cff, 1.1);
  rim.position.set(-8, 5, -9);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x4ff0ff, 0.45);
  fill.position.set(-9, 4, 5);
  scene.add(fill);
  const flashLight = new THREE.PointLight(0xffffff, 0, 6, 2);
  scene.add(flashLight);

  // ----- deep space -----
  const stars = starField();
  scene.add(stars);

  const planets = new THREE.Group();
  scene.add(planets);
  {
    const giant = new THREE.Group();
    giant.position.set(-75, -170, -300);
    const body = new THREE.Mesh(new THREE.SphereGeometry(56, 64, 32), new THREE.MeshStandardMaterial({
      map: gasTexture(['#1b5e6e', '#2f8a93', '#63c3bd', '#174a63', '#9ad9d0', '#24707e']), roughness: 1, metalness: 0,
    }));
    body.rotation.z = 0.35;
    giant.add(body);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(59, 64, 32), fresnel(0x6ff0ff, 2.2, 1.6));
    giant.add(atmo);
    const ringGeo = new THREE.RingGeometry(75, 126, 160, 1);
    const p = ringGeo.attributes.position, uv = ringGeo.attributes.uv;
    for (let k = 0; k < p.count; k++) uv.setXY(k, (Math.hypot(p.getX(k), p.getY(k)) - 75) / 51, 0.5);
    const ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      map: ringTexture(['#f5b342', '#f3e1bd', '#c97a2b', '#ffd27a']), transparent: true, side: THREE.DoubleSide, opacity: 0.9, depthWrite: false,
    }));
    ringMesh.rotation.x = Math.PI / 2 - 0.42;
    ringMesh.rotation.y = 0.28;
    giant.add(ringMesh);
    giant.userData.spin = body;
    planets.add(giant);

    const red = new THREE.Group();
    red.position.set(120, -70, 230);
    red.add(new THREE.Mesh(new THREE.SphereGeometry(16, 48, 24), new THREE.MeshStandardMaterial({
      map: rockyTexture('#b5532d', ['#7a2e17', '#e08a4f', '#5a1f10']), roughness: 0.95,
    })));
    red.add(new THREE.Mesh(new THREE.SphereGeometry(16.8, 48, 24), fresnel(0xff8a4a, 2.5, 1.4)));
    planets.add(red);

    const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16), new THREE.MeshStandardMaterial({
      map: rockyTexture('#8d8a9a', ['#5c5968', '#b8b4c4']), roughness: 1,
    }));
    moon.position.set(-60, 55, 170);
    planets.add(moon);

    const glow = glowTexture();
    const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: hot(0xfff1d0, 4), ...additive }));
    sunCore.scale.setScalar(70);
    const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(0xffa040).multiplyScalar(0.8), ...additive }));
    sunHalo.scale.setScalar(380);
    for (const s of [sunHalo, sunCore]) { s.position.set(420, 260, 330); planets.add(s); }
  }

  // Asteroid belt circling far below the board.
  const belt = new THREE.Group();
  {
    const n = 260;
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6f6876, roughness: 0.95, flatShading: true }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = rnd(55, 90);
      e.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      const s = rnd(0.25, 1.4) * (Math.random() < 0.08 ? 2.4 : 1);
      m.compose(new THREE.Vector3(Math.cos(a) * r, rnd(-18, -8), Math.sin(a) * r), q.setFromEuler(e), new THREE.Vector3(s, s * rnd(0.6, 1), s));
      rocks.setMatrixAt(k, m);
    }
    belt.add(rocks);
  }
  scene.add(belt);

  // ----- the station deck (board) -----
  const deck = new THREE.Group();
  scene.add(deck);
  const animated = []; // { tick(t, dt) }

  {
    const shape = new THREE.Shape();
    const S = 4.75, R = 0.45;
    shape.moveTo(-S + R, -S);
    shape.lineTo(S - R, -S); shape.quadraticCurveTo(S, -S, S, -S + R);
    shape.lineTo(S, S - R); shape.quadraticCurveTo(S, S, S - R, S);
    shape.lineTo(-S + R, S); shape.quadraticCurveTo(-S, S, -S, S - R);
    shape.lineTo(-S, -S + R); shape.quadraticCurveTo(-S, -S, -S + R, -S);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3 });
    geo.rotateX(Math.PI / 2);
    const slab = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x121a33, metalness: 0.8, roughness: 0.32, envMapIntensity: 0.7 }));
    slab.position.y = -0.04;
    slab.receiveShadow = true;
    deck.add(slab);

    // Glowing trim: Solar's edge gold, Nebula's teal, and the orbit seam (left and right) cyan.
    const trim = (w, color, x, z, rotY) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.05), new THREE.MeshBasicMaterial({ color: hot(color, 2.2) }));
      m.position.set(x, 0.0, z);
      m.rotation.y = rotY;
      deck.add(m);
      return m;
    };
    trim(8.3, 0xffa83a, 0, 4.2, 0);
    trim(8.3, 0x3cc8d0, 0, -4.2, 0);
    const seamL = trim(8.3, 0x4ff0ff, -4.2, 0, Math.PI / 2);
    const seamR = trim(8.3, 0x4ff0ff, 4.2, 0, Math.PI / 2);
    animated.push({ tick: t => { const k = 1.6 + 0.8 * Math.sin(t * 2.2); seamL.material.color.setHex(0x4ff0ff).multiplyScalar(k); seamR.material.color.copy(seamL.material.color); } });

    // Coordinates on the rim, readable from both sides.
    const lab = (text, x, z, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(text), transparent: true, depthWrite: false }));
      m.rotation.set(-Math.PI / 2, 0, rot);
      m.position.set(x, 0.005, z);
      deck.add(m);
    };
    for (let k = 0; k < 8; k++) {
      lab(FILES[k], cx(k), 4.48, 0);
      lab(FILES[k], cx(k), -4.48, Math.PI);
      lab(String(8 - k), -4.48, cz(k), 0);
      lab(String(8 - k), 4.48, cz(k), Math.PI);
    }

    // Hover thrusters under the deck.
    const glow = glowTexture();
    const plumeMat = new THREE.ShaderMaterial({
      ...additive, side: THREE.DoubleSide,
      vertexShader: UV_VERT,
      fragmentShader: `varying vec2 vUv; void main() { float a = pow(vUv.y, 2.0) * 0.8; gl_FragColor = vec4(vec3(0.31, 0.94, 1.0) * a * 2.0, a); }`,
    });
    for (const [x, z] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.35, 24), new THREE.MeshStandardMaterial({ color: 0x1a2440, metalness: 0.8, roughness: 0.3 }));
      pod.position.set(x, -0.62, z);
      deck.add(pod);
      const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24), new THREE.MeshBasicMaterial({ color: hot(0x4ff0ff, 3) }));
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(x, -0.8, z);
      deck.add(nozzle);
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.8, 24, 1, true), plumeMat);
      plume.rotation.x = Math.PI;
      plume.position.set(x, -1.7, z);
      deck.add(plume);
      animated.push({ tick: t => { plume.scale.y = 1 + 0.12 * Math.sin(t * 13 + x * 3 + z); } });
    }
    // A soft glow pool under the deck, lying flat so it never washes over the board.
    const under = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshBasicMaterial({ map: glow, color: new THREE.Color(0x3a6cff).multiplyScalar(0.9), ...additive }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -1.1;
    deck.add(under);
  }

  // ----- tiles, overlays and markers -----
  const holeSet = new Set(BLACK_HOLES);
  const twin = new Map();
  for (const [a, b] of WORMHOLES) { twin.set(a, b); twin.set(b, a); }

  const tileMats = {
    light: new THREE.MeshPhysicalMaterial({ map: tileTexture(LIGHT, 'rgba(28,63,114,0.28)'), roughness: 0.6, metalness: 0.1, envMapIntensity: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    dark: new THREE.MeshPhysicalMaterial({ map: tileTexture(DARK, 'rgba(120,200,255,0.3)'), roughness: 0.25, metalness: 0.55, envMapIntensity: 0.75, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
    portal: new THREE.MeshStandardMaterial({ map: tileTexture('#170c34', 'rgba(198,155,255,0.55)'), roughness: 0.3, metalness: 0.6, envMapIntensity: 0.5 }),
  };
  const tileGeo = new THREE.BoxGeometry(0.95, 0.1, 0.95);
  const pickables = [];
  const overlays = [];
  const markers = [];
  const dotGeo = new THREE.CircleGeometry(0.13, 32);
  const ringGeo = new THREE.RingGeometry(0.33, 0.42, 48);

  for (let i = 0; i < 64; i++) {
    const x = i % 8, y = i >> 3;
    if (holeSet.has(i)) {
      const pick = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), new THREE.MeshBasicMaterial({ visible: false }));
      pick.rotation.x = -Math.PI / 2;
      pick.position.copy(sqPos(i, 0.035));
      pick.userData.sq = i;
      deck.add(pick);
      pickables.push(pick);
      overlays.push(null);
      markers.push(null);
      continue;
    }
    const tile = new THREE.Mesh(tileGeo, twin.has(i) ? tileMats.portal : (x + y) % 2 ? tileMats.dark : tileMats.light);
    tile.position.set(cx(x), 0, cz(y));
    tile.receiveShadow = true;
    tile.userData.sq = i;
    deck.add(tile);
    pickables.push(tile);

    const ov = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, color: 0xffffff }));
    ov.rotation.x = -Math.PI / 2;
    ov.position.copy(sqPos(i, TOP + 0.003));
    ov.renderOrder = 2;
    deck.add(ov);
    overlays.push(ov);

    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: hot(0xbff8ff, 2), ...additive, opacity: 0.9 }));
    const rng = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hot(0xff5a4a, 2.4), ...additive, opacity: 0.95 }));
    for (const m of [dot, rng]) {
      m.rotation.x = -Math.PI / 2;
      m.position.copy(sqPos(i, TOP + 0.006));
      m.visible = false;
      m.renderOrder = 3;
      deck.add(m);
    }
    markers.push({ dot, ring: rng });
  }

  // ----- black holes -----
  for (const i of BLACK_HOLES) {
    const g = new THREE.Group();
    g.position.copy(sqPos(i, 0));
    deck.add(g);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.5, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: UV_VERT,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float swirl = 0.5 + 0.5 * sin(a * 3.0 + 7.0 * log(r + 0.04) - uTime * 2.6);
          float swirl2 = 0.5 + 0.5 * sin(a * 5.0 + 11.0 * log(r + 0.04) - uTime * 3.7);
          float disk = smoothstep(1.0, 0.6, r) * smoothstep(0.24, 0.4, r);
          vec3 col = mix(vec3(0.45, 0.12, 0.85), vec3(1.0, 0.5, 1.0), swirl);
          col = mix(col, vec3(1.0, 0.62, 0.25), smoothstep(0.7, 0.32, r) * swirl2);
          float glow = disk * (0.45 + 0.9 * swirl * (0.55 + 0.45 * swirl2));
          float core = smoothstep(0.34, 0.25, r);
          vec3 c = col * glow * 1.9;
          float alpha = clamp(glow + core + smoothstep(1.0, 0.75, r) * 0.65, 0.0, 1.0);
          gl_FragColor = vec4(c * (1.0 - core), alpha);
        }`,
    }));
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = 0.032;
    disk.renderOrder = 1;
    g.add(disk);
    const horizon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    horizon.position.y = 0.06;
    g.add(horizon);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 16), fresnel(0xc69bff, 1.5, 3.4));
    lens.position.y = 0.06;
    g.add(lens);
    // A faint polar jet streaming up out of the hole.
    const jetMat = new THREE.ShaderMaterial({
      ...additive, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: UV_VERT,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main() {
          float a = pow(1.0 - vUv.y, 1.4) * (0.22 + 0.12 * sin(vUv.y * 30.0 - uTime * 9.0)) * smoothstep(0.0, 0.08, vUv.y);
          gl_FragColor = vec4(vec3(0.75, 0.45, 1.0) * a * 1.6, a);
        }`,
    });
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.11, 1.1, 24, 1, true), jetMat);
    jet.position.y = 0.6;
    g.add(jet);
    animated.push({ tick: t => { jetMat.uniforms.uTime.value = t; } });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: hot(0xb07cff, 1.8) }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.02;
    g.add(halo);
    // Debris spiralling in, animated entirely on the GPU.
    const n = 70;
    const ph = new Float32Array(n), sp = new Float32Array(n), r0 = new Float32Array(n);
    for (let k = 0; k < n; k++) { ph[k] = Math.random(); sp[k] = rnd(0.18, 0.45); r0[k] = rnd(0.32, 0.62); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    pg.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
    pg.setAttribute('aR', new THREE.BufferAttribute(r0, 1));
    const pm = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
      vertexShader: `
        attribute float aPhase; attribute float aSpeed; attribute float aR;
        uniform float uTime; uniform float uPx; varying float vA;
        void main() {
          float t = fract(uTime * aSpeed + aPhase);
          float r = mix(aR, 0.06, t * t);
          float ang = aPhase * 6.2831 + t * 7.5;
          vec3 p = vec3(cos(ang) * r, 0.03 + 0.25 * (1.0 - t) * (aR - 0.3), sin(ang) * r);
          vA = smoothstep(0.0, 0.15, t) * (1.0 - t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 60.0 * (1.0 - 0.6 * t) * uPx / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
          gl_FragColor = vec4(mix(vec3(1.0, 0.6, 0.25), vec3(0.8, 0.45, 1.0), vA) * a * 2.4, a);
        }`,
    });
    g.add(new THREE.Points(pg, pm));
    animated.push({ tick: t => { disk.material.uniforms.uTime.value = t; pm.uniforms.uTime.value = t; } });
  }

  // ----- wormhole portals and the link between them -----
  const portalMats = [];
  for (const i of twin.keys()) {
    const g = new THREE.Group();
    g.position.copy(sqPos(i, TOP));
    deck.add(g);
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(0.44, 48), new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
      vertexShader: UV_VERT,
      fragmentShader: `
        uniform float uTime; uniform float uOn; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float s = 0.5 + 0.5 * sin(a * 4.0 - r * 11.0 + uTime * 4.0);
          vec3 c = mix(vec3(0.55, 0.22, 1.0), vec3(0.05, 0.8, 1.0), s);
          float al = smoothstep(1.0, 0.3, r) * (0.2 + 0.6 * s) * (0.6 + 0.4 * uOn);
          gl_FragColor = vec4(c * al * (0.75 + 0.9 * uOn), al);
        }`,
    }));
    swirl.rotation.x = -Math.PI / 2;
    swirl.position.y = 0.004;
    swirl.renderOrder = 2;
    g.add(swirl);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
      vertexShader: UV_VERT,
      fragmentShader: `
        uniform float uTime; uniform float uOn; varying vec2 vUv;
        void main() {
          float w = 0.5 + 0.5 * sin(vUv.x * 6.2831 * 3.0 - uTime * 3.0);
          gl_FragColor = vec4(mix(vec3(0.62, 0.3, 1.0), vec3(0.1, 0.85, 1.0), w) * (1.15 + 1.1 * uOn), 1.0);
        }`,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.03, 10, 72), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    // Sparks rising out of the portal.
    const n = 30;
    const ph = new Float32Array(n);
    for (let k = 0; k < n; k++) ph[k] = Math.random();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const pm = new THREE.ShaderMaterial({
      ...additive,
      uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
      vertexShader: `
        attribute float aPhase; uniform float uTime; uniform float uPx; varying float vA; varying float vK;
        void main() {
          float t = fract(uTime * 0.35 + aPhase);
          float ang = aPhase * 40.0 + t * 5.0;
          float r = 0.38 * (1.0 - 0.5 * t);
          vec3 p = vec3(cos(ang) * r, t * 1.1, sin(ang) * r);
          vA = smoothstep(0.0, 0.1, t) * (1.0 - t); vK = aPhase;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 45.0 * uPx / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying float vK;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
          gl_FragColor = vec4(mix(vec3(0.69, 0.49, 1.0), vec3(0.31, 0.94, 1.0), vK) * a * 2.5, a);
        }`,
    });
    g.add(new THREE.Points(pg, pm));
    portalMats.push(swirl.material, ringMat, pm);
  }
  const [wa, wb] = WORMHOLES[0];
  const linkCurve = new THREE.QuadraticBezierCurve3(sqPos(wa, 0.1), new THREE.Vector3(0, 3.4, 0), sqPos(wb, 0.1));
  const linkMat = new THREE.ShaderMaterial({
    ...additive,
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: `
      uniform float uTime; uniform float uOn; varying vec2 vUv;
      void main() {
        float d = fract(vUv.x * 16.0 - uTime * 1.8);
        float dash = smoothstep(0.0, 0.2, d) * smoothstep(0.75, 0.45, d);
        float fade = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
        float a = fade * (0.1 + 0.9 * uOn) * (0.3 + 0.7 * dash);
        gl_FragColor = vec4(mix(vec3(0.69, 0.49, 1.0), vec3(0.31, 0.94, 1.0), vUv.x) * a * 2.4, a);
      }`,
  });
  deck.add(new THREE.Mesh(new THREE.TubeGeometry(linkCurve, 80, 0.03, 8, false), linkMat));
  let portalOn = 0, portalTarget = 0;

  // ----- orbit seam curtains on the left and right edges -----
  const seamMat = new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: `
      uniform float uTime; uniform float uFlash; varying vec2 vUv;
      void main() {
        float fall = pow(1.0 - vUv.y, 2.2);
        float bands = 0.5 + 0.5 * sin(vUv.x * 70.0 - uTime * 2.0);
        float scan = 0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 4.0);
        float a = fall * (0.16 + 0.16 * bands * scan) + fall * uFlash;
        gl_FragColor = vec4(vec3(0.31, 0.94, 1.0) * a * 2.4, a);
      }`,
  });
  for (const x of [-4.08, 4.08]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 0.55), seamMat);
    c.rotation.y = Math.PI / 2;
    c.position.set(x, TOP + 0.27, 0);
    deck.add(c);
  }
  let seamFlash = 0;

  // ----- selection beam -----
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.5, 40, 1, true), new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x9ff4ff) } },
    vertexShader: UV_VERT,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        float a = pow(1.0 - vUv.y, 1.5) * (0.5 + 0.2 * sin(vUv.y * 22.0 - uTime * 5.0));
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
  }));
  beam.visible = false;
  deck.add(beam);

  // ----- fleet -----
  const piecesGroup = new THREE.Group();
  deck.add(piecesGroup);
  const pieceAt = new Map(); // square -> piece root

  function addPiece(type, side, i) {
    const obj = buildPiece(type, side);
    obj.position.copy(sqPos(i));
    obj.userData.sq = i;
    piecesGroup.add(obj);
    pieceAt.set(i, obj);
    return obj;
  }

  function removePiece(obj) {
    piecesGroup.remove(obj);
    obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  // Make the 3D fleet match a board (array of 64: null | { type, side }).
  function setBoard(board) {
    for (const [i, obj] of [...pieceAt]) {
      const want = board[i];
      if (!want || want.type !== obj.userData.type || want.side !== obj.userData.side) { removePiece(obj); pieceAt.delete(i); }
    }
    board.forEach((want, i) => {
      if (!want) return;
      const obj = pieceAt.get(i) || addPiece(want.type, want.side, i);
      obj.position.copy(sqPos(i));
      obj.scale.setScalar(1);
      obj.rotation.set(0, 0, 0);
      obj.userData.sq = i;
    });
  }

  // ----- highlights -----
  let hl = { selected: -1, targets: [], last: null, check: -1 };
  let hover = -1;

  function paintOverlays() {
    overlays.forEach((ov, i) => {
      if (!ov) return;
      const m = ov.material;
      if (i === hl.check) { m.color.setHex(0xff3b3b); m.opacity = 0.5; }
      else if (i === hl.selected) { m.color.setHex(0x7ff6ff); m.opacity = 0.42; }
      else if (hl.last && (i === hl.last.from || i === hl.last.to)) { m.color.setHex(0xffc24a); m.opacity = 0.34; }
      else if (i === hover) { m.color.setHex(0xffffff); m.opacity = 0.14; }
      else m.opacity = 0;
    });
  }

  function setHighlights(h) {
    hl = { selected: -1, targets: [], last: null, check: -1, ...h };
    markers.forEach(mk => { if (mk) { mk.dot.visible = false; mk.ring.visible = false; } });
    for (const t of hl.targets) {
      const mk = markers[t.to];
      if (!mk) continue;
      const show = t.cap ? mk.ring : mk.dot;
      show.visible = true;
      show.material.color.copy(t.warp ? hot(0xc69bff, 2.6) : t.cap ? hot(0xff5a4a, 2.4) : hot(0xbff8ff, 2));
    }
    beam.visible = hl.selected >= 0;
    if (beam.visible) beam.position.copy(sqPos(hl.selected, TOP + 0.75));
    portalTarget = hl.targets.some(t => t.warp) || twin.has(hl.selected) ? 1 : 0;
    paintOverlays();
  }

  // ----- tweens and effects -----
  const tweens = new Set();
  const tween = (ms, fn) => new Promise(res => tweens.add({ t0: performance.now(), ms, fn, res }));
  const fx = new THREE.Group();
  scene.add(fx);
  const particles = [];

  function burst(pos, color, { count = 70, speed = 2.4, life = 0.9, size = 0.12, up = 0.8, drag = 0.94 } = {}) {
    const p = new Float32Array(count * 3), v = new Float32Array(count * 3);
    const d = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      p.set([pos.x, pos.y, pos.z], k * 3);
      d.randomDirection().multiplyScalar(speed * rnd(0.25, 1));
      v.set([d.x, d.y + up * Math.random(), d.z], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: hot(color, 2.6), size, ...additive }));
    fx.add(pts);
    particles.push({ obj: pts, v, age: 0, life, drag });
  }

  function debris(pos, side, count = 12) {
    const mat = new THREE.MeshStandardMaterial({ color: TEAM[side].body, metalness: 0.8, roughness: 0.3, transparent: true });
    const geo = new THREE.TetrahedronGeometry(0.06);
    for (let k = 0; k < count; k++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(rnd(1, 2.8));
      v.y = Math.abs(v.y) + 0.8;
      fx.add(m);
      particles.push({ obj: m, v: v.toArray(), age: 0, life: rnd(0.8, 1.3), drag: 0.97, spin: rnd(4, 10) });
    }
  }

  function shockwave(pos, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: hot(color, 1.3), ...additive, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).setY(TOP + 0.05);
    fx.add(m);
    tween(550, k => {
      m.scale.setScalar(0.15 + easeOut(k) * 1.15);
      m.material.opacity = 1 - k;
      if (k >= 1) { fx.remove(m); m.geometry.dispose(); }
    });
  }

  function flash(pos, color, peak = 9) {
    flashLight.color.setHex(color);
    flashLight.position.copy(pos).setY(pos.y + 0.6);
    tween(420, k => { flashLight.intensity = peak * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85); });
  }

  function explode(victim) {
    const pos = victim.position.clone().setY(0.45);
    const side = victim.userData.side;
    burst(pos, TEAM[side].glow, { count: 90 });
    burst(pos, 0xffffff, { count: 30, speed: 1.4, life: 0.5, size: 0.09 });
    debris(pos, side);
    shockwave(pos, TEAM[side].glow);
    flash(pos, TEAM[side].glow);
    onFx('boom');
    tween(160, k => victim.scale.setScalar(Math.max(0.001, 1 - k))).then(() => removePiece(victim));
  }

  function updateParticles(dt) {
    for (let k = particles.length - 1; k >= 0; k--) {
      const p = particles[k];
      p.age += dt;
      const f = Math.pow(p.drag, dt * 60);
      if (p.obj.isPoints) {
        const a = p.obj.geometry.attributes.position;
        for (let j = 0; j < a.count; j++) {
          p.v[j * 3] *= f; p.v[j * 3 + 1] *= f; p.v[j * 3 + 2] *= f;
          a.setXYZ(j, a.getX(j) + p.v[j * 3] * dt, a.getY(j) + p.v[j * 3 + 1] * dt, a.getZ(j) + p.v[j * 3 + 2] * dt);
        }
        a.needsUpdate = true;
        p.obj.material.opacity = Math.max(0, 1 - p.age / p.life);
      } else {
        p.v[0] *= f; p.v[1] = p.v[1] * f - 1.5 * dt; p.v[2] *= f;
        p.obj.position.x += p.v[0] * dt; p.obj.position.y += p.v[1] * dt; p.obj.position.z += p.v[2] * dt;
        p.obj.rotation.x += p.spin * dt; p.obj.rotation.y += p.spin * dt * 0.7;
        p.obj.material.opacity = Math.max(0, 1 - p.age / p.life);
      }
      if (p.age >= p.life) {
        fx.remove(p.obj);
        if (p.obj.isPoints) { p.obj.geometry.dispose(); p.obj.material.dispose(); }
        particles.splice(k, 1);
      }
    }
  }

  // ----- move animation -----
  let busy = false;

  function travel(obj, from, vx, vy, { jump = false, victim = null } = {}) {
    const fx0 = from % 8, fy0 = from >> 3;
    const dist = Math.hypot(vx, vy);
    const ms = jump ? 680 : Math.min(820, 280 + dist * 80);
    const wraps = fx0 + vx < 0 || fx0 + vx > 7;
    let hit = false, crossed = false;
    const flame = obj.userData.flame;
    if (jump && flame) { flame.userData.on = 1; flame.scale.set(1, 1, 1); }
    return tween(ms, k => {
      const e = ease(k);
      const u = fx0 + vx * e;
      const xw = (((u + 0.5) % 8) + 8) % 8 - 0.5;
      let s = 1;
      if (wraps) {
        s = smooth(0, 0.6, Math.min(xw + 0.5, 7.5 - xw));
        if (!crossed && (u < -0.5 || u > 7.5)) {
          crossed = true;
          seamFlash = 1;
          const edge = new THREE.Vector3(u < 0 ? -4.1 : 4.1, 0.4, cz(fy0 + vy * e));
          burst(edge, 0x4ff0ff, { count: 40, speed: 1.2, life: 0.6, size: 0.1, up: 0.2 });
          burst(edge.clone().setX(-edge.x), 0x4ff0ff, { count: 40, speed: 1.2, life: 0.6, size: 0.1, up: 0.2 });
          onFx('wrap');
        }
      }
      const lift = jump ? Math.sin(Math.PI * k) * 1.35 : Math.sin(Math.PI * k) * 0.2;
      obj.position.set(cx(xw), TOP + lift, cz(fy0 + vy * e));
      obj.scale.setScalar(Math.max(0.001, s));
      if (victim && !hit && k >= (jump ? 0.86 : 0.78)) { hit = true; explode(victim); }
      if (k >= 1 && flame) { flame.userData.on = 0; flame.scale.setScalar(0.001); }
    });
  }

  async function warp(obj, from, to, victim) {
    portalOn = 1.6;
    onFx('warp');
    const a = sqPos(from), b = sqPos(to);
    await tween(340, k => {
      const e = ease(k);
      obj.scale.setScalar(Math.max(0.001, 1 - e));
      obj.rotation.y = e * 7;
      obj.position.set(a.x, TOP + e * 0.5, a.z);
    });
    burst(a.clone().setY(0.4), 0xb07cff, { count: 50, speed: 1.5, life: 0.7 });
    if (victim) explode(victim);
    await tween(160, () => {});
    await tween(420, k => {
      const e = easeOut(k);
      obj.scale.setScalar(Math.max(0.001, e));
      obj.rotation.y = 7 + e * (Math.PI * 2 - 7 % (Math.PI * 2));
      obj.position.set(b.x, TOP + (1 - e) * 0.5, b.z);
    });
    obj.rotation.y = 0;
    burst(b.clone().setY(0.4), 0x4ff0ff, { count: 50, speed: 1.5, life: 0.7 });
  }

  async function promote(obj, i, type, side) {
    removePiece(obj);
    pieceAt.delete(i);
    const np = addPiece(type, side, i);
    const pos = sqPos(i, 0.5);
    burst(pos, 0xffffff, { count: 60, speed: 1.8, life: 0.8 });
    burst(pos, TEAM[side].glow, { count: 60, speed: 2.4, life: 1 });
    flash(pos, TEAM[side].glow, 7);
    onFx('promote');
    await tween(420, k => np.scale.setScalar(Math.max(0.001, k < 0.7 ? (k / 0.7) * 1.2 : 1.2 - ((k - 0.7) / 0.3) * 0.2)));
  }

  // Plays a move (engine Move object), then makes the fleet match `boardAfter`.
  async function animateMove(mv, boardAfter) {
    busy = true;
    try {
      const obj = pieceAt.get(mv.from);
      if (!obj) return;
      const victimSq = mv.cap ? (mv.capSq >= 0 ? mv.capSq : mv.to) : -1;
      const victim = victimSq >= 0 ? pieceAt.get(victimSq) : null;
      pieceAt.delete(mv.from);
      if (victim) pieceAt.delete(victimSq);
      const jobs = [];
      if (mv.kind === 'warp') jobs.push(warp(obj, mv.from, mv.to, victim));
      else jobs.push(travel(obj, mv.from, mv.vx, mv.vy, { jump: mv.piece === 'N', victim }));
      if (mv.kind === 'castle' && mv.rookFrom >= 0) {
        const rook = pieceAt.get(mv.rookFrom);
        if (rook) {
          pieceAt.delete(mv.rookFrom);
          jobs.push(travel(rook, mv.rookFrom, (mv.rookTo % 8) - (mv.rookFrom % 8), 0));
          rook.userData.sq = mv.rookTo;
          pieceAt.set(mv.rookTo, rook);
        }
      }
      await Promise.all(jobs);
      obj.userData.sq = mv.to;
      pieceAt.set(mv.to, obj);
      if (mv.promo) await promote(obj, mv.to, mv.promo, obj.userData.side);
    } finally {
      setBoard(boardAfter);
      busy = false;
    }
  }

  // Fireworks over the board in the winner's colour.
  function celebrate(side) {
    const colors = side === null ? [0xffffff, 0xb07cff] : [TEAM[side].glow, 0xffffff, TEAM[side].body];
    let n = 0;
    const id = setInterval(() => {
      const pos = new THREE.Vector3(rnd(-4, 4), rnd(2.5, 5), rnd(-4, 4));
      burst(pos, colors[n % colors.length], { count: 110, speed: 3.2, life: 1.5, size: 0.14, up: 0, drag: 0.95 });
      if (++n > 14) clearInterval(id);
    }, 330);
  }

  // ----- camera -----
  let mode = 'menu';
  let menuAz = 0.6;
  const look = new THREE.Vector3(0, 1.6, 0);
  let flight = null;
  let insets = { right: 0, bottom: 0 };
  let viewSide = 0;

  function gameView(side) {
    // The camera's horizontal field of view spans the full canvas height, but the board must fit
    // in the width the HUD leaves free (the view offset centres it there).
    const W = container.clientWidth, H = Math.max(1, container.clientHeight);
    const aspect = Math.max(0.3, (W - insets.right) / H);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const portrait = aspect < 0.9;
    const radius = Math.max(portrait ? 11 : 12.2, (portrait ? 5.7 : 5.3) / (tanH * aspect));
    controls.maxDistance = Math.max(32, radius * 1.4);
    return new THREE.Spherical(radius, portrait ? 0.62 : 0.8, side === 1 ? Math.PI : 0);
  }

  function fly(to, target, ms = 1500) {
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(look));
    const t0 = look.clone();
    let dTheta = to.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    flight = true;
    return tween(ms, k => {
      const e = ease(k);
      look.lerpVectors(t0, target, e);
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(from.radius, to.radius, e),
        THREE.MathUtils.lerp(from.phi, to.phi, e),
        from.theta + dTheta * e,
      );
      camera.position.setFromSpherical(s).add(look);
      camera.lookAt(look);
      if (k >= 1) flight = null;
    });
  }

  async function setMode(m, side = 0) {
    mode = m;
    viewSide = side;
    if (m === 'game') {
      controls.enabled = false;
      await fly(gameView(side), new THREE.Vector3(0, 0, 0));
      controls.target.set(0, 0, 0);
      controls.enabled = mode === 'game';
    } else {
      controls.enabled = false;
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(look));
      menuAz = s.theta;
      await fly(new THREE.Spherical(17, 1.12, menuAz), new THREE.Vector3(0, 1.6, 0), 1200);
    }
  }

  function resetView(side = viewSide) {
    viewSide = side;
    if (mode !== 'game') return Promise.resolve();
    controls.enabled = false;
    look.copy(controls.target);
    return fly(gameView(side), new THREE.Vector3(0, 0, 0), 900).then(() => { controls.enabled = mode === 'game'; });
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    // Keep the board centred in the space the HUD leaves free.
    camera.setViewOffset(w, h, insets.right / 2, insets.bottom / 2, w, h);
    camera.updateProjectionMatrix();
    stars.material.uniforms.uScale.value = renderer.getPixelRatio();
  }
  addEventListener('resize', resize);
  function setInsets(v) { insets = { right: 0, bottom: 0, ...v }; resize(); }

  // ----- picking -----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([piecesGroup, ...pickables], true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.sq === undefined) o = o.parent;
      if (o) return o.userData.sq;
    }
    return -1;
  }

  let down = null, hoverReq = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || mode !== 'game') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved < 7) {
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) onSquareClick(i);
    }
  });
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') hoverReq = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerleave', () => { hoverReq = { x: -1e5, y: -1e5 }; });

  // ----- main loop -----
  const clock = new THREE.Clock();
  let t = 0;
  camera.position.set(0, 40, 80);
  camera.lookAt(look);

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;
    const now = performance.now();
    for (const tw of [...tweens]) {
      const k = Math.min(1, (now - tw.t0) / tw.ms);
      tw.fn(k);
      if (k >= 1) { tweens.delete(tw); tw.res(); }
    }
    stars.material.uniforms.uTime.value = t;
    vignette.uniforms.uTime.value = t % 10;
    for (const a of animated) a.tick(t, dt);
    planets.children[0].userData.spin.rotation.y += dt * 0.01;
    belt.rotation.y += dt * 0.012;
    deck.position.y = Math.sin(t * 0.7) * 0.05;
    piecesGroup.children.forEach(o => o.userData.tick(t));

    // Selected ship hovers, check square pulses, markers breathe.
    for (const [i, o] of pieceAt) if (!busy) o.position.y = i === hl.selected ? TOP + 0.15 + Math.sin(t * 4.5) * 0.05 : TOP;
    if (hl.check >= 0 && overlays[hl.check]) overlays[hl.check].material.opacity = 0.35 + 0.25 * Math.sin(t * 7);
    const pulse = 1 + 0.12 * Math.sin(t * 5);
    for (const tg of hl.targets) { const mk = markers[tg.to]; if (mk) { mk.dot.scale.setScalar(pulse); mk.ring.scale.setScalar(pulse); } }
    beam.material.uniforms.uTime.value = t;

    portalOn += (Math.max(portalTarget, 0) - portalOn) * Math.min(1, dt * 3);
    for (const m of portalMats) { m.uniforms.uTime.value = t; if (m.uniforms.uOn) m.uniforms.uOn.value = Math.min(1, portalOn); }
    linkMat.uniforms.uTime.value = t;
    linkMat.uniforms.uOn.value = Math.min(1, portalOn);
    seamFlash = Math.max(0, seamFlash - dt * 1.4);
    seamMat.uniforms.uTime.value = t;
    seamMat.uniforms.uFlash.value = seamFlash;
    updateParticles(dt);

    if (hoverReq && mode === 'game') {
      const i = pick(hoverReq.x, hoverReq.y);
      if (i !== hover) {
        hover = i;
        paintOverlays();
        canvas.style.cursor = i >= 0 ? 'pointer' : '';
      }
      onHover(i, hoverReq.x, hoverReq.y);
      hoverReq = null;
    }

    if (mode === 'menu' && !flight) {
      menuAz += dt * 0.06;
      camera.position.setFromSpherical(new THREE.Spherical(17, 1.12, menuAz)).add(look);
      camera.lookAt(look);
    } else if (controls.enabled) controls.update();

    composer.render();
    requestAnimationFrame(frame);
  }

  resize();
  const far = new THREE.Vector3(0, -60, 0);
  burst(far, 0xffffff, { count: 2, life: 0.05 });
  debris(far, 0, 1);
  shockwave(far, 0xffffff);
  // Hidden things (move markers, the selection beam) are skipped by compile(), so show them for it.
  const hidden = [beam, ...markers.flatMap(mk => (mk ? [mk.dot, mk.ring] : []))];
  hidden.forEach(o => { o.visible = true; });
  renderer.compile(scene, camera);
  hidden.forEach(o => { o.visible = false; });
  requestAnimationFrame(frame);
  fly(new THREE.Spherical(17, 1.12, menuAz), look.clone(), 2600);

  return {
    setBoard,
    setHighlights,
    animateMove,
    celebrate,
    setMode,
    resetView,
    setInsets,
    clearHover() { hover = -1; paintOverlays(); },
    project(i) {
      const v = sqPos(i).applyMatrix4(deck.matrixWorld).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    },
    get busy() { return busy; },
  };
}

// Portraits of every ship for the menus and HUD: { 0: { K: dataURL, ... }, 1: { ... } }.
export function renderPortraits(size = 160) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  sc.add(new THREE.HemisphereLight(0x9fd8ff, 0x0b1430, 1.1));
  const key = new THREE.DirectionalLight(0xffe2b0, 2.6);
  key.position.set(-3, 5, 4);
  sc.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const out = [{}, {}];
  for (const side of [0, 1]) {
    for (const t of ['K', 'Q', 'R', 'B', 'N', 'P']) {
      const g = buildPiece(t, side);
      g.rotation.y = side === 1 ? Math.PI - 0.4 : -0.4;
      sc.add(g);
      const h = new THREE.Box3().setFromObject(g).max.y;
      cam.position.set(0, h * 0.62 + 0.25, h * 1.25 + 0.85);
      cam.lookAt(0, h * 0.48, 0);
      g.userData.tick(1.3);
      r.render(sc, cam);
      out[side][t] = r.domElement.toDataURL('image/png');
      sc.remove(g);
    }
  }
  pm.dispose();
  r.dispose();
  r.forceContextLoss?.();
  return out;
}
