// BREACHLINE — the map: "Foundry Yard", an original industrial yard.
// Three lanes (north, mid, south) join the Vanguard spawn in the west to
// the Sentinel spawn in the east, with a bomb site at each northern and
// southern corner. Geometry, colliders, waypoints and spawns are all
// derived from the same box list, so what you see is what you collide
// with and what the bots navigate.
import * as THREE from 'three';
import { makeBox } from './collision.js';

// Palette: dusk over a working yard — warm concrete, teal steel,
// amber lamps, rusted crates.
export const PALETTE = {
  sky: 0x2a3550,
  fog: 0x3a4258,
  ground: 0x8a7f6d,
  concrete: 0x9a938a,
  concreteDark: 0x6e675e,
  steel: 0x3d6b6e,
  steelDark: 0x2c4a4d,
  rust: 0xa35c2e,
  amber: 0xffb648,
  crate: 0x7d6a4a,
  crateDark: 0x5e4f36,
  vanguard: 0x4f8f5a,
  sentinel: 0xb05a3c,
};

// Wall and crate boxes: [x0, z0, x1, z1, height, materialKey].
// The yard is 60 x 48 metres; x runs west(-) to east(+), z north(-)
// to south(+). Vanguard spawn west, Sentinel spawn east.
const WALLS = [
  // Perimeter.
  [-30, -24, 30, -22.6, 4.5, 'concreteDark'],
  [-30, 22.6, 30, 24, 4.5, 'concreteDark'],
  [-30, -24, -28.6, 24, 4.5, 'concreteDark'],
  [28.6, -24, 30, 24, 4.5, 'concreteDark'],
  // North lane walls: a long container row with gaps.
  [-22, -18.5, -10, -17.2, 3.2, 'steel'],
  [-6, -18.5, 6, -17.2, 3.2, 'steelDark'],
  [10, -18.5, 22, -17.2, 3.2, 'steel'],
  // South lane walls.
  [-22, 17.2, -10, 18.5, 3.2, 'steelDark'],
  [-6, 17.2, 6, 18.5, 3.2, 'steel'],
  [10, 17.2, 22, 18.5, 3.2, 'steelDark'],
  // Mid structure: the foundry hall, two door gaps.
  [-4, -8, -2.4, -1.2, 4.2, 'concrete'],
  [-4, 1.2, -2.4, 8, 4.2, 'concrete'],
  [2.4, -8, 4, -1.2, 4.2, 'concrete'],
  [2.4, 1.2, 4, 8, 4.2, 'concrete'],
  [-4, -8, 4, -6.6, 4.2, 'concrete'],
  [-4, 6.6, 4, 8, 4.2, 'concrete'],
  // A site (north-west) cover blocks.
  [-24, -14, -20, -12.6, 2.6, 'crate'],
  [-16, -20, -14.6, -16, 2.6, 'crateDark'],
  [-20, -10, -18.6, -6, 1.4, 'crate'],
  // B site (south-east) cover blocks.
  [20, 12.6, 24, 14, 2.6, 'crateDark'],
  [14.6, 16, 16, 20, 2.6, 'crate'],
  [18.6, 6, 20, 10, 1.4, 'crate'],
  // Mid-lane crates and corner cover.
  [-9, -2, -7.6, -0.6, 1.4, 'crate'],
  [7.6, 0.6, 9, 2, 1.4, 'crateDark'],
  [-13, 9, -11.6, 10.4, 1.4, 'crate'],
  [11.6, -10.4, 13, -9, 1.4, 'crateDark'],
  [-26, -5, -24.6, -3.6, 1.4, 'crate'],
  [24.6, 3.6, 26, 5, 1.4, 'crateDark'],
  // Spawn blockers (keep spawns readable, force lane choice).
  [-26, -1, -24.6, 1, 2.2, 'steel'],
  [24.6, -1, 26, 1, 2.2, 'steel'],
];

export const SITES = {
  A: { x0: -26, z0: -22, x1: -12, z1: -10, label: 'A' },
  B: { x0: 12, z0: 10, x1: 26, z1: 22, label: 'B' },
};

export const SPAWNS = {
  vanguard: [
    { x: -27, z: -4 }, { x: -27, z: -1.5 }, { x: -27, z: 1.5 },
    { x: -27, z: 4 }, { x: -25.5, z: 0 },
  ],
  sentinel: [
    { x: 27, z: -4 }, { x: 27, z: -1.5 }, { x: 27, z: 1.5 },
    { x: 27, z: 4 }, { x: 25.5, z: 0 },
  ],
};

// Waypoint graph. Bots walk edges; each node knows its neighbours.
// Routes are planned by breadth-first search over this graph.
export const WAYPOINTS = [
  // Vanguard spawn and exits.
  { x: -26, z: 0, n: [1, 2, 3] },
  { x: -22, z: -8, n: [0, 4, 6] },
  { x: -22, z: 0, n: [0, 5, 6] },
  { x: -22, z: 8, n: [0, 5, 7] },
  // North lane to A.
  { x: -14, z: -14, n: [1, 8, 9] },
  { x: -14, z: 0, n: [2, 3, 10] },
  { x: -10, z: -6, n: [1, 2, 10, 11] },
  { x: -14, z: 14, n: [3, 9, 12] },
  { x: -19, z: -16, n: [4, 13] }, // A site
  { x: -8, z: -13, n: [4, 7, 14] },
  { x: -6, z: 0, n: [5, 6, 15] },
  { x: -6, z: -6, n: [6, 10, 16] },
  { x: -8, z: 13, n: [7, 17] },
  { x: -24, z: -19, n: [8] }, // A corner hold
  { x: 0, z: -13, n: [9, 16, 18] },
  { x: 0, z: 0, n: [10, 19] }, // mid doors
  { x: 0, z: -6, n: [11, 14, 15, 20] },
  { x: 0, z: 13, n: [12, 21] },
  { x: 8, z: -13, n: [14, 22, 23] },
  { x: 6, z: 0, n: [15, 20, 24] },
  { x: 6, z: -6, n: [16, 19, 22] },
  { x: 8, z: 13, n: [17, 24, 25] },
  { x: 14, z: -14, n: [18, 20, 26] },
  { x: 14, z: -6, n: [18, 27] },
  { x: 14, z: 0, n: [19, 21, 27] },
  { x: 19, z: 16, n: [21, 28] }, // B site
  { x: 22, z: -8, n: [22, 29] },
  { x: 22, z: 0, n: [23, 24, 29] },
  { x: 24, z: 19, n: [25] }, // B corner hold
  { x: 26, z: 0, n: [26, 27] }, // Sentinel spawn
];

export function planRoute(fromIndex, toIndex) {
  // Breadth-first search over WAYPOINTS; returns node indices.
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [fromIndex];
  prev[fromIndex] = fromIndex;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toIndex) break;
    for (const nb of WAYPOINTS[cur].n) {
      if (prev[nb] === -1) { prev[nb] = cur; queue.push(nb); }
    }
  }
  if (prev[toIndex] === -1) return [fromIndex];
  const path = [];
  let cur = toIndex;
  while (cur !== fromIndex) { path.push(cur); cur = prev[cur]; }
  path.push(fromIndex);
  path.reverse();
  return path;
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x, dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// --- Procedural textures (canvas-drawn, no external assets) ---
function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeTextures() {
  const ground = canvasTexture(256, (g, s) => {
    g.fillStyle = '#8a7f6d'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 900; i++) g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    g.strokeStyle = 'rgba(40,36,30,0.55)'; g.lineWidth = 3;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.strokeStyle = 'rgba(40,36,30,0.25)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  });
  ground.repeat.set(15, 12);
  const panel = canvasTexture(256, (g, s) => {
    g.fillStyle = '#9a938a'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let i = 0; i < 500; i++) g.fillRect(Math.random() * s, Math.random() * s, 3, 2);
    g.strokeStyle = 'rgba(50,46,40,0.6)'; g.lineWidth = 4;
    for (let y = 0; y <= s; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
    g.strokeStyle = 'rgba(50,46,40,0.35)'; g.lineWidth = 2;
    for (let x = 0; x <= s; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
  });
  const hazard = canvasTexture(128, (g, s) => {
    g.fillStyle = '#7d6a4a'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c9a13b';
    for (let i = -s; i < s * 2; i += 32) {
      g.beginPath();
      g.moveTo(i, s); g.lineTo(i + 16, s); g.lineTo(i + 16 + s, 0); g.lineTo(i + s, 0);
      g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, s, 10); g.fillRect(0, s - 10, s, 10);
  });
  return { ground, panel, hazard };
}

export function buildWorld(scene) {
  const textures = makeTextures();
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: textures.ground, roughness: 0.95 }),
    concrete: new THREE.MeshStandardMaterial({ map: textures.panel, roughness: 0.9 }),
    concreteDark: new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.55, metalness: 0.5 }),
    steelDark: new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.6, metalness: 0.5 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.8, metalness: 0.3 }),
    crate: new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.85 }),
    crateDark: new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 0.85 }),
  };

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 45, 110);

  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x4a4238, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(-30, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  // Amber site lamps.
  for (const site of [SITES.A, SITES.B]) {
    const cx = (site.x0 + site.x1) / 2, cz = (site.z0 + site.z1) / 2;
    const lamp = new THREE.PointLight(PALETTE.amber, 60, 22, 1.8);
    lamp.position.set(cx, 5.2, cz);
    scene.add(lamp);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8),
      mats.steelDark,
    );
    pole.position.set(cx, 2.6, cz);
    scene.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
    );
    bulb.position.set(cx, 5.2, cz);
    scene.add(bulb);
  }

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 52), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Walls and crates from the shared box list.
  const colliders = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [x0, z0, x1, z1, h, key] of WALLS) {
    const mesh = new THREE.Mesh(boxGeo, mats[key]);
    mesh.scale.set(x1 - x0, h, z1 - z0);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // A thin cap strip on crates for readability.
    if (key === 'crate' || key === 'crateDark') {
      const cap = new THREE.Mesh(boxGeo, mats.rust);
      cap.scale.set(x1 - x0 + 0.06, 0.08, z1 - z0 + 0.06);
      cap.position.set((x0 + x1) / 2, h + 0.04, (z0 + z1) / 2);
      scene.add(cap);
    }
    colliders.push(makeBox(x0, z0, x1, z1, 0, h));
  }

  // Site markings: glowing floor rectangles with a letter decal.
  for (const site of [SITES.A, SITES.B]) {
    const w = site.x1 - site.x0, d = site.z1 - site.z0;
    const cx = (site.x0 + site.x1) / 2, cz = (site.z0 + site.z1) / 2;
    const tex = canvasTexture(256, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.strokeStyle = 'rgba(255,182,72,0.95)'; g.lineWidth = 10;
      g.strokeRect(8, 8, s - 16, s - 16);
      g.fillStyle = 'rgba(255,182,72,0.95)';
      g.font = 'bold 150px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(site.label, s / 2, s / 2 + 8);
    });
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(cx, 0.03, cz);
    scene.add(decal);
  }

  // Distant skyline silhouettes so the horizon is not empty.
  const silMat = new THREE.MeshBasicMaterial({ color: 0x232c40 });
  const rng = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 62 + rng() * 18;
    const h = 8 + rng() * 20;
    const sil = new THREE.Mesh(boxGeo, silMat);
    sil.scale.set(6 + rng() * 8, h, 6 + rng() * 8);
    sil.position.set(Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r);
    scene.add(sil);
  }

  return { colliders, textures, mats };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Fighter meshes -------------------------------------------------
// A stylised soldier built from boxes and a sphere head, team-tinted.
// The head mesh sits at eye height so headshots read visually.
let soldierGeos = null;
export function buildSoldierMesh(teamColor) {
  if (!soldierGeos) soldierGeos = makeSoldierGeos();
  const geos = soldierGeos;
  const mat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.9 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(geos.torso, mat);
  torso.position.y = 1.18;
  torso.castShadow = true;
  const head = new THREE.Mesh(geos.head, new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.7 }));
  head.position.y = 1.62;
  head.castShadow = true;
  const helmet = new THREE.Mesh(geos.helmet, dark);
  helmet.position.y = 1.68;
  const visor = new THREE.Mesh(geos.visor, new THREE.MeshBasicMaterial({ color: 0x11131a }));
  visor.position.set(0, 1.63, 0.13);
  const legL = new THREE.Mesh(geos.leg, dark);
  legL.position.set(-0.13, 0.45, 0);
  const legR = new THREE.Mesh(geos.leg, dark);
  legR.position.set(0.13, 0.45, 0);
  const armL = new THREE.Mesh(geos.arm, mat);
  armL.position.set(-0.32, 1.22, 0.1);
  armL.rotation.x = -1.1;
  const armR = new THREE.Mesh(geos.arm, mat);
  armR.position.set(0.32, 1.22, 0.1);
  armR.rotation.x = -1.1;
  const gun = new THREE.Mesh(geos.gun, dark);
  gun.position.set(0.18, 1.28, 0.42);
  group.add(torso, head, helmet, visor, legL, legR, armL, armR, gun);
  group.userData.parts = { torso, head, legL, legR, armL, armR, gun };
  return group;
}

function makeSoldierGeos() {
  return {
    torso: new THREE.BoxGeometry(0.52, 0.62, 0.3),
    head: new THREE.SphereGeometry(0.17, 14, 12),
    helmet: new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    visor: new THREE.BoxGeometry(0.24, 0.07, 0.05),
    leg: new THREE.BoxGeometry(0.18, 0.9, 0.2),
    arm: new THREE.BoxGeometry(0.13, 0.55, 0.13),
    gun: new THREE.BoxGeometry(0.09, 0.12, 0.62),
  };
}

// Charge (bomb) mesh: a dark case with a blinking amber lamp.
export function buildChargeMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.26, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.6, metalness: 0.4 }),
  );
  body.position.y = 0.13;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  );
  lamp.position.set(0.14, 0.3, 0);
  group.add(body, lamp);
  group.userData.lamp = lamp;
  return group;
}
