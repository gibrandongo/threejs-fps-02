// BREACHLINE — boot and the game loop. The simulation runs on a
// fixed 60 Hz step, decoupled from rendering; rendering only reads
// state and syncs meshes. This module wires input, simulation,
// effects and HUD together and owns no match rules itself.
import * as THREE from 'three';
import { SIM_DT, WEAPONS } from './config.js';
import { state, playerOf } from './state.js';
import { buildWorld, buildSoldierMesh, buildChargeMesh, PALETTE } from './world.js';
import { Input } from './input.js';
import { stepPlayer, eyeHeight, eyePos, speed2D, activeWeaponKey } from './player.js';
import { tryFire, startReload, finishReload, switchSlot, throwGrenade, stepGrenades, buildViewmodel } from './weapons.js';
import { stepBots } from './bots.js';
import { startMatch, stepRounds, buyItem } from './rounds.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { ensureAudio, setMuted } from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // menu | combat | buy | plant — deterministic demo hook for captures
const demoMode = SHOT !== null && SHOT !== 'menu';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = buildWorld(scene);
const effects = new Effects(scene);
const hud = new Hud();
const input = new Input(canvas, state);
const viewmodel = buildViewmodel(camera);
const chargeMesh = buildChargeMesh();
scene.add(chargeMesh);

hud.initMinimap(world.colliders);

// Grenade meshes, created on throw events, removed on detonation.
const grenadeMeshes = new Map();
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.5, metalness: 0.4 });

let fighterMeshes = new Map();
let started = false;
let paused = false;
let accumulator = 0;
let lastNow = performance.now();
let fovCurrent = 75;
let attractAngle = 0;

function buildFighterMeshes() {
  for (const m of fighterMeshes.values()) scene.remove(m);
  fighterMeshes = new Map();
  for (const f of state.fighters) {
    if (f.isPlayer) continue;
    const mesh = buildSoldierMesh(f.team === 'vanguard' ? PALETTE.vanguard : PALETTE.sentinel);
    scene.add(mesh);
    fighterMeshes.set(f.id, mesh);
  }
}

function syncFighterMeshes() {
  for (const f of state.fighters) {
    if (f.isPlayer) continue;
    const mesh = fighterMeshes.get(f.id);
    if (!mesh) continue;
    mesh.position.set(f.pos.x, f.pos.y, f.pos.z);
    mesh.rotation.y = f.yaw + Math.PI;
    const parts = mesh.userData.parts;
    if (f.alive) {
      mesh.rotation.x = 0;
      mesh.visible = true;
      // Walk cycle: legs swing with horizontal speed.
      const sp = speed2D(f);
      const phase = state.time * 9 * Math.min(1, sp / 4);
      const swing = Math.min(0.6, sp * 0.12) * Math.sin(phase);
      parts.legL.rotation.x = swing;
      parts.legR.rotation.x = -swing;
      parts.torso.position.y = 1.18 - (f.crouched ? 0.28 : 0);
      parts.head.position.y = 1.62 - (f.crouched ? 0.28 : 0);
    } else {
      // Fall flat, face up, and stay for the round.
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.y = f.yaw + Math.PI;
      mesh.position.y = 0.15;
    }
  }
  // Charge mesh follows its state.
  if (state.bomb.state === 'carried') {
    const carrier = state.fighters[state.bomb.carrierId];
    if (carrier && !carrier.isPlayer) {
      chargeMesh.visible = true;
      chargeMesh.position.set(carrier.pos.x, 0.9, carrier.pos.z);
    } else {
      chargeMesh.visible = false;
    }
  } else if (state.bomb.state === 'dropped' || state.bomb.state === 'planted') {
    chargeMesh.visible = true;
    chargeMesh.position.set(state.bomb.pos.x, 0, state.bomb.pos.z);
  } else {
    chargeMesh.visible = false;
  }
  // Blink the lamp faster as the planted timer runs down.
  const lamp = chargeMesh.userData.lamp;
  if (state.bomb.state === 'planted') {
    const rate = state.bomb.timer > 20 ? 2 : state.bomb.timer > 10 ? 4 : 8;
    lamp.visible = Math.sin(state.time * rate * Math.PI) > -0.2;
  } else {
    lamp.visible = true;
  }
}

function syncGrenadeMeshes() {
  for (const g of state.grenades) {
    let mesh = grenadeMeshes.get(g);
    if (!mesh) {
      mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
      scene.add(mesh);
      grenadeMeshes.set(g, mesh);
    }
    mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    mesh.rotation.x += 0.2;
  }
  for (const [g, mesh] of grenadeMeshes) {
    if (!state.grenades.includes(g)) {
      scene.remove(mesh);
      grenadeMeshes.delete(g);
    }
  }
}

function drainEvents() {
  for (const ev of state.events) {
    if (ev.kind === 'hitmarker') hud.onHitmarker(ev.head);
    if (ev.kind === 'roundStart') buildFighterMeshes();
  }
  state.events.length = 0;
}

// --- Fixed-step simulation ------------------------------------------
function simulate(dt) {
  state.time += dt;
  const p = playerOf(state);
  stepRounds(state, effects, dt);

  if (state.phase === 'live' || state.phase === 'freeze') {
    // Timers tick for every fighter.
    for (const f of state.fighters) {
      if (f.fireCooldown > 0) f.fireCooldown -= dt;
      if (f.reloading > 0) {
        f.reloading -= dt;
        if (f.reloading <= 0) finishReload(f);
      }
    }
    if (state.phase === 'live') {
      // Player.
      if (p.alive) {
        const inp = state.input;
        stepPlayer(p, inp, world.colliders, dt);
        p.aiming = input.aimDown && WEAPONS[activeWeaponKey(p)].scoped;
        if (inp.slotKey === -2) switchSlot(p, p.activeSlot === 0 ? 1 : 0);
        else if (inp.slotKey >= 0) switchSlot(p, inp.slotKey);
        if (inp.reload) startReload(state, p);
        if (inp.grenadeKey) throwGrenade(state, p, inp.grenadeKey);
        const def = WEAPONS[activeWeaponKey(p)];
        const wantFire = def.auto ? inp.fire : inp.firePressed;
        if (wantFire && tryFire(state, p, world.colliders, effects)) {
          viewmodel.onShot();
        }
      }
      stepBots(state, world.colliders, effects, dt);
      stepGrenades(state, world.colliders, effects, dt);
    } else if (state.phase === 'freeze') {
      // Buy menu toggles during freeze time; the round is frozen.
      if (state.input.buyToggle) state.buyOpen = !state.buyOpen;
    }
  }
  input.consumeStep();
}

// --- Rendering --------------------------------------------------------
const _eye = { x: 0, y: 0, z: 0 };
const hudEl = document.getElementById('hud');

function render(dt) {
  hudEl.classList.toggle('hidden', state.fighters.length === 0);
  const p = playerOf(state);
  if (state.phase === 'menu' && !started) {
    // Attract camera: slow orbit over the yard.
    attractAngle += dt * 0.07;
    const r = 26;
    camera.position.set(Math.cos(attractAngle) * r, 12, Math.sin(attractAngle) * r);
    camera.lookAt(0, 0, 0);
    viewmodel.group.visible = false;
  } else {
    viewmodel.group.visible = p.alive;
    eyePos(p, _eye);
    camera.position.set(_eye.x, _eye.y, _eye.z);
    camera.rotation.y = p.yaw + p.recoilYaw;
    camera.rotation.x = p.pitch + p.recoilPitch;
    camera.rotation.z = 0;
    // Sniper scope narrows the field of view.
    const wantFov = p.aiming ? 38 : 75;
    fovCurrent += (wantFov - fovCurrent) * Math.min(1, dt * 12);
    if (Math.abs(fovCurrent - camera.fov) > 0.05) {
      camera.fov = fovCurrent;
      camera.updateProjectionMatrix();
    }
    document.getElementById('scope').classList.toggle('hidden',
      !(p.aiming && p.alive));
    viewmodel.update(p, dt, speed2D(p) > 0.5 && p.onGround);
  }
  syncFighterMeshes();
  syncGrenadeMeshes();
  effects.update(dt);
  hud.update(state, dt);
  renderer.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (paused) { render(0); return; }
  input.poll();
  // Demo capture hook: keep E held during the plant shot.
  if (SHOT === 'plant') state.input.useHeld = true;
  if (state.muted !== undefined) setMuted(state.muted);
  accumulator += dt;
  let steps = 0;
  while (accumulator >= SIM_DT && steps < 5) {
    simulate(SIM_DT);
    accumulator -= SIM_DT;
    steps++;
  }
  if (steps === 5) accumulator = 0;
  drainEvents();
  render(dt);
}

// --- Menus and flow ---------------------------------------------------
function startGame() {
  ensureAudio();
  startMatch(state);
  buildFighterMeshes();
  started = true;
  hud.showMenu(false);
  hud.hideMatchEnd();
  hud.showPause(false);
  if (!demoMode) input.requestLock();
}

hud.bind({
  onStart: () => startGame(),
  onRestart: () => startGame(),
  onResume: () => {
    hud.showPause(false);
    paused = false;
    input.requestLock();
  },
  onMute: () => {
    state.muted = !state.muted;
    setMuted(state.muted);
    document.getElementById('mute-btn').textContent = state.muted ? 'SOUND: OFF' : 'SOUND: ON';
  },
  onBuy: (key) => {
    if (state.phase === 'freeze') buyItem(state, playerOf(state), key);
  },
});

input.onLockLost = () => {
  if (started && !demoMode && state.phase !== 'matchEnd' && state.phase !== 'menu') {
    paused = true;
    hud.showPause(true);
  }
};
input.onAnyGesture = () => ensureAudio();

canvas.addEventListener('click', () => {
  if (started && !paused && !demoMode) input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Deterministic demo hook for captures -----------------------------
// ?shot=combat|buy|plant starts a scripted round so screenshots show
// real gameplay. Normal play (no query) is untouched.
function setupShot() {
  if (!SHOT || SHOT === 'menu') return;
  startGame();
  const p = playerOf(state);
  if (SHOT === 'buy') {
    state.phase = 'freeze';
    state.phaseTime = 30;
    state.buyOpen = true;
    p.money = 4750;
    return;
  }
  state.phase = 'live';
  state.phaseTime = 90;
  p.primary = 'rifle';
  p.activeSlot = 0;
  p.mag.primary = WEAPONS.rifle.mag;
  p.reserve.primary = WEAPONS.rifle.reserve;
  p.armor = 100;
  p.grenades.he = 1;
  p.grenades.flash = 1;
  if (SHOT === 'combat') {
    p.pos.x = -6; p.pos.z = 0; p.yaw = -Math.PI / 2; p.pitch = 0.02;
    // Two defenders in view down mid, holding the doors.
    const foes = state.fighters.filter((f) => f.team === 'sentinel');
    const spots = [
      { x: 2, z: -1.5, yaw: Math.PI / 2 },
      { x: 5, z: 2, yaw: Math.PI / 2 },
      { x: 8, z: -5, yaw: Math.PI * 0.75 },
    ];
    foes.forEach((f, i) => {
      const spot = spots[i % spots.length];
      f.pos.x = spot.x; f.pos.z = spot.z; f.yaw = spot.yaw;
      if (f.brain) { f.brain.state = 'hold'; f.brain.holdYaw = spot.yaw; f.brain.route = []; }
    });
    const mates = state.fighters.filter((f) => f.team === 'vanguard' && !f.isPlayer);
    mates.forEach((f, i) => {
      f.pos.x = -13 - i * 1.5; f.pos.z = -2 + i * 1.8; f.yaw = -Math.PI / 2;
      if (f.brain) { f.brain.state = 'hold'; f.brain.holdYaw = -Math.PI / 2; f.brain.route = []; }
    });
  }
  if (SHOT === 'plant') {
    p.pos.x = -19; p.pos.z = -16; p.yaw = -2.27; p.pitch = -0.12;
    for (const f of state.fighters) f.hasCharge = false;
    p.hasCharge = true;
    state.bomb.state = 'carried';
    state.bomb.carrierId = p.id;
    state.input.useHeld = true; // hold E: the plant bar fills in-shot
    const foes = state.fighters.filter((f) => f.team === 'sentinel');
    foes.forEach((f, i) => {
      f.pos.x = 20 + i; f.pos.z = -10 + i * 3; f.yaw = Math.PI / 2;
      if (f.brain) { f.brain.state = 'hold'; f.brain.route = []; }
    });
  }
  buildFighterMeshes();
}

setupShot();
requestAnimationFrame(frame);
