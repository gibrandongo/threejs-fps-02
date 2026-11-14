// BREACHLINE — the single state store. Every mutable fact about a match
// lives in this one object; modules read and write it, none keeps a
// private copy of match truth. Rendering reads it, the simulation owns it.
import { START_MONEY } from './config.js';

export function makeFighter(id, team, isPlayer, name) {
  return {
    id, team, isPlayer, name,
    alive: true, health: 100, armor: 0,
    // Kinematic state (metres, radians). pos is feet position.
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, onGround: true, crouched: false,
    // Loadout.
    primary: null, // weapon key or null
    secondary: 'sidearm',
    activeSlot: 0, // 0 primary, 1 secondary
    mag: { primary: 0, secondary: 12 },
    reserve: { primary: 0, secondary: 48 },
    grenades: { he: 0, flash: 0 },
    grenadeSlot: 'he',
    reloading: 0, // seconds left, 0 = not reloading
    fireCooldown: 0,
    recoilPitch: 0, recoilYaw: 0,
    spreadBloom: 0,
    // Round stats.
    kills: 0, deaths: 0, money: START_MONEY,
    // Bomb.
    hasCharge: false,
    // Transient per-frame flags, reset by the simulation.
    firedThisStep: false,
    aiming: false, // right-mouse aim (sniper scope, tighter spread)
    hurtDir: -1, // yaw of last attacker, -1 = none this frame
    // Bot brain (null for the player).
    brain: null,
    // Render handles, filled by world.js (meshes, viewmodel).
    mesh: null, headMesh: null, bodyMesh: null,
    flashUntil: 0, // game time until which the fighter is blinded
  };
}

export function makeState() {
  return {
    time: 0, // total simulated seconds
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    phaseTime: 0, // seconds left in the current phase
    round: 1,
    score: { vanguard: 0, sentinel: 0 },
    lossStreak: { vanguard: 0, sentinel: 0 },
    fighters: [],
    playerId: 0,
    // Bomb state machine: carried | dropped | planted | exploded | defused
    bomb: {
      state: 'carried', carrierId: 0,
      pos: { x: 0, y: 0, z: 0 }, site: null,
      timer: 0, plantProgress: 0, defuseProgress: 0,
      planterId: -1, defuserId: -1,
    },
    grenades: [], // live thrown grenades
    events: [], // {kind, ...} drained by hud/audio each frame
    killfeed: [],
    roundBanner: '',
    roundWinner: null,
    matchWinner: null,
    // Input snapshot, written by input handling, read by the simulation.
    input: {
      forward: 0, strafe: 0, jump: false, crouch: false, sneak: false,
      fire: false, firePressed: false, reload: false,
      lookDX: 0, lookDY: 0, use: false, useHeld: false,
      slotKey: -1, grenadeKey: '', buyToggle: false, scoreboard: false,
    },
    buyOpen: false,
    paused: false,
    muted: false,
  };
}

// The one shared instance. main.js creates it; every module imports it.
export const state = makeState();

export function playerOf(s) {
  return s.fighters[s.playerId];
}

export function aliveOf(s, team) {
  let n = 0;
  for (const f of s.fighters) if (f.alive && f.team === team) n++;
  return n;
}

export function resetFighterForRound(f, spawn, yaw) {
  f.alive = true;
  f.health = 100;
  f.pos.x = spawn.x; f.pos.y = spawn.y || 0; f.pos.z = spawn.z;
  f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
  f.yaw = yaw; f.pitch = 0;
  f.onGround = true; f.crouched = false;
  f.reloading = 0; f.fireCooldown = 0;
  f.recoilPitch = 0; f.recoilYaw = 0; f.spreadBloom = 0;
  f.flashUntil = 0;
  f.hasCharge = false;
  if (f.brain) {
    f.brain.state = 'move';
    f.brain.routeIndex = 0;
    f.brain.targetId = -1;
    f.brain.knownEnemy = null;
    f.brain.reactUntil = 0;
    f.brain.burstLeft = 0;
    f.brain.pauseUntil = 0;
  }
}
