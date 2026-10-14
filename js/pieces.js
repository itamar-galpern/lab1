// Space Chess fleet: procedural 3D models of the six ships, built from lathe profiles plus a few
// extras (fins, rings, saucers). Every model stands on a hover pedestal with a glowing team ring.
//
// buildPiece(type, side) returns a THREE.Group whose userData.tick(t) animates its moving parts.

import * as THREE from 'three';

export const TEAM = [
  { body: 0xd9a441, trim: 0x4a2f10, glow: 0xffa83a, visor: 0xffcf73 }, // Solar
  { body: 0x46c4cf, trim: 0x0d3445, glow: 0x4ff6ff, visor: 0x9ffcff }, // Nebula
];

const cache = [null, null];

function materials(side) {
  if (cache[side]) return cache[side];
  const c = TEAM[side];
  cache[side] = {
    body: new THREE.MeshPhysicalMaterial({ color: c.body, metalness: 0.8, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.75 }),
    trim: new THREE.MeshStandardMaterial({ color: c.trim, metalness: 0.7, roughness: 0.4, envMapIntensity: 0.6 }),
    glow: new THREE.MeshStandardMaterial({ color: c.glow, emissive: c.glow, emissiveIntensity: 2.6, roughness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x050812, metalness: 0.1, roughness: 0.04, clearcoat: 1, emissive: c.visor, emissiveIntensity: 0.45 }),
  };
  return cache[side];
}

// Soft round glow used for thruster light, halos and sparks.
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const lathe = (pts, mat, seg = 40) =>
  new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);

function ring(r, tube, mat, y = 0, seg = 48) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}

function sphere(r, mat, x = 0, y = 0, z = 0, w = 24, h = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat);
  m.position.set(x, y, z);
  return m;
}

// The hover pedestal every ship stands on.
function pedestal(m, r) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [r, 0], [r, 0.035], [r * 0.93, 0.06], [r * 0.8, 0.09], [r * 0.66, 0.13], [0, 0.13]], m.trim));
  g.add(ring(r * 0.97, 0.016, m.glow, 0.035));
  return g;
}

// ---------- the six ships ----------

// Astronaut (pawn): a little suited figure with a glowing visor and a backpack.
function astronaut(m) {
  const g = new THREE.Group();
  g.add(pedestal(m, 0.25));
  g.add(lathe([[0.17, 0.12], [0.15, 0.2], [0.13, 0.28], [0.15, 0.36], [0.155, 0.41], [0.1, 0.45], [0, 0.46]], m.body));
  g.add(ring(0.135, 0.014, m.trim, 0.28));
  g.add(sphere(0.125, m.body, 0, 0.55, 0));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.28, Math.PI * 0.42), m.glass);
  visor.position.set(0, 0.55, 0.03);
  g.add(visor);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.08), m.trim);
  pack.position.set(0, 0.36, -0.14);
  g.add(pack);
  g.add(sphere(0.022, m.glow, 0, 0.37, 0.145, 10, 8));
  g.add(sphere(0.02, m.glow, 0, 0.69, 0, 10, 8)); // antenna tip
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06), m.trim);
  ant.position.y = 0.66;
  g.add(ant);
  return g;
}

// Rocket (knight): a finned rocket with a porthole. Its exhaust flame lights up when it jumps.
function rocket(m, side) {
  const g = new THREE.Group();
  g.add(pedestal(m, 0.29));
  const body = new THREE.Group();
  body.add(lathe([[0, 0.14], [0.12, 0.14], [0.155, 0.2], [0.165, 0.34], [0.155, 0.5], [0.13, 0.62], [0.085, 0.74], [0.035, 0.83], [0, 0.86]], m.body));
  body.add(ring(0.158, 0.014, m.trim, 0.25));
  body.add(ring(0.128, 0.013, m.glow, 0.62));
  const port = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), m.glass);
  port.position.set(0, 0.45, 0.161);
  body.add(port);
  const portRim = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 8, 24), m.glow);
  portRim.position.copy(port.position);
  body.add(portRim);
  const shape = new THREE.Shape();
  shape.moveTo(0.13, 0.14); shape.lineTo(0.3, 0.12); shape.lineTo(0.29, 0.19); shape.lineTo(0.15, 0.36); shape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
  finGeo.translate(0, 0, -0.011);
  for (let k = 0; k < 3; k++) {
    const fin = new THREE.Mesh(finGeo, m.trim);
    fin.rotation.y = (k / 3) * Math.PI * 2 + Math.PI / 2;
    body.add(fin);
  }
  g.add(body);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.32, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: TEAM[side].glow, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.rotation.x = Math.PI;
  flame.position.y = -0.02;
  flame.scale.setScalar(0.001);
  g.add(flame);
  g.userData.flame = flame;
  g.userData.tick = t => {
    if (flame.scale.y > 0.01) flame.scale.y = flame.userData.on * (0.85 + 0.25 * Math.sin(t * 40));
  };
  flame.userData.on = 0;
  return g;
}

// Comet (bishop): a slender spire carrying a blazing nucleus with a swept tail.
function comet(m, side) {
  const g = new THREE.Group();
  g.add(pedestal(m, 0.27));
  g.add(lathe([[0, 0.13], [0.15, 0.13], [0.12, 0.2], [0.085, 0.34], [0.068, 0.5], [0.1, 0.58], [0.125, 0.62], [0.06, 0.66], [0, 0.66]], m.body));
  g.add(ring(0.1, 0.014, m.trim, 0.58));
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), m.glow);
  head.position.y = 0.8;
  g.add(head);
  const tailMat = new THREE.MeshBasicMaterial({ color: TEAM[side].glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const tails = new THREE.Group();
  tails.position.y = 0.8;
  [[0, 0.42, 0.075], [0.5, 0.32, 0.05], [-0.5, 0.3, 0.05]].forEach(([yaw, len, r]) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, len, 12, 1, true), tailMat);
    c.position.set(0, 0.06, -len / 2);
    c.rotation.x = -Math.PI / 2 - 0.35;
    const holder = new THREE.Group();
    holder.rotation.y = yaw;
    holder.add(c);
    tails.add(holder);
  });
  g.add(tails);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: TEAM[side].glow, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.55);
  halo.position.y = 0.8;
  g.add(halo);
  g.userData.tick = t => { head.rotation.y = t * 0.8; head.rotation.x = t * 0.5; };
  return g;
}

// Station (rook): a crenellated tower wearing a rotating habitat ring.
function station(m) {
  const g = new THREE.Group();
  g.add(pedestal(m, 0.3));
  g.add(lathe([[0, 0.13], [0.21, 0.13], [0.19, 0.2], [0.165, 0.25], [0.165, 0.55], [0.21, 0.6], [0.225, 0.69], [0.2, 0.71], [0, 0.71]], m.body));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.075), m.body);
    b.position.set(Math.cos(a) * 0.18, 0.745, Math.sin(a) * 0.18);
    b.rotation.y = -a;
    g.add(b);
  }
  const hab = new THREE.Group();
  hab.position.y = 0.42;
  hab.add(ring(0.3, 0.026, m.trim));
  for (let k = 0; k < 4; k++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6), m.trim);
    spoke.rotation.z = Math.PI / 2;
    spoke.rotation.y = (k / 4) * Math.PI;
    hab.add(spoke);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    hab.add(sphere(0.018, m.glow, Math.cos(a) * 0.3, 0.026, Math.sin(a) * 0.3, 8, 6));
  }
  g.add(hab);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18), m.trim);
  ant.position.y = 0.8;
  g.add(ant);
  g.add(sphere(0.026, m.glow, 0, 0.9, 0, 10, 8));
  g.userData.tick = t => { hab.rotation.y = t * 0.6; };
  return g;
}

// Flagship (queen): a tall hull crowned with a spinning saucer ringed by lights.
function flagship(m) {
  const g = new THREE.Group();
  g.add(pedestal(m, 0.31));
  g.add(lathe([[0, 0.13], [0.2, 0.13], [0.16, 0.22], [0.11, 0.4], [0.088, 0.6], [0.12, 0.71], [0.15, 0.77], [0, 0.78]], m.body));
  g.add(ring(0.1, 0.015, m.glow, 0.5));
  const saucer = new THREE.Group();
  saucer.position.y = 0.86;
  const disc = sphere(0.28, m.body, 0, 0, 0, 40, 20);
  disc.scale.y = 0.24;
  saucer.add(disc);
  saucer.add(ring(0.27, 0.012, m.trim, 0));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    saucer.add(sphere(0.019, m.glow, Math.cos(a) * 0.245, 0.012, Math.sin(a) * 0.245, 8, 6));
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.glass);
  dome.position.y = 0.04;
  saucer.add(dome);
  g.add(saucer);
  g.add(sphere(0.03, m.glow, 0, 1.03, 0, 10, 8));
  g.userData.tick = t => { saucer.rotation.y = t * 0.9; };
  return g;
}

// Commander (king): the tallest ship, an energy core inside a spinning gyroscope, topped by a cross.
function commander(m) {
  const g = new THREE.Group();
  g.add(pedestal(m, 0.32));
  g.add(lathe([[0, 0.13], [0.21, 0.13], [0.17, 0.22], [0.12, 0.42], [0.1, 0.62], [0.14, 0.74], [0.17, 0.8], [0.12, 0.84], [0, 0.84]], m.body));
  g.add(ring(0.112, 0.014, m.trim, 0.45));
  g.add(sphere(0.1, m.glow, 0, 0.97, 0));
  const gyroA = ring(0.18, 0.016, m.body, 0);
  const gyroB = ring(0.15, 0.014, m.trim, 0);
  const gyro = new THREE.Group();
  gyro.position.y = 0.97;
  gyro.add(gyroA, gyroB);
  g.add(gyro);
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035), m.body);
  v.position.y = 1.2;
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.035), m.body);
  h.position.y = 1.22;
  g.add(v, h);
  g.userData.tick = t => {
    gyroA.rotation.x = Math.PI / 2 + t * 1.1;
    gyroA.rotation.y = t * 0.4;
    gyroB.rotation.x = Math.PI / 2 - t * 0.8;
    gyroB.rotation.z = t * 0.9;
  };
  return g;
}

const BUILDERS = { P: astronaut, N: rocket, B: comet, R: station, Q: flagship, K: commander };
export const HEIGHT = { P: 0.7, N: 0.86, B: 0.92, R: 0.92, Q: 1.06, K: 1.28 };

export function buildPiece(type, side) {
  const m = materials(side);
  const root = new THREE.Group();
  const model = BUILDERS[type](m, side);
  model.position.y = 0.05; // ships float just above their pedestal glow
  // Nebula faces the other way, so its details (portholes, visors) look toward Solar.
  if (side === 1) model.rotation.y = Math.PI;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Hover glow on the tile under the ship (flat, so it can't wash over anything in front of it).
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ map: glowTexture(), color: TEAM[side].glow, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.012;
  root.add(model, glow);
  root.userData = { type, side, model, flame: model.userData.flame, tick: model.userData.tick || (() => {}) };
  return root;
}
