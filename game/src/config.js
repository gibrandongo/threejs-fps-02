// BREACHLINE — configuration: every tunable number in one place.
// Weapons, economy, round flow and bot behaviour live here so the
// simulation modules stay free of magic numbers.
export const SIM_DT = 1 / 60;
export const ROUND_TIME = 100; // seconds of live play per round
export const FREEZE_TIME = 5; // seconds of buy time before the round starts
export const PLANT_TIME = 3.5; // seconds holding E to plant the charge
export const DEFUSE_TIME = 5.0; // seconds holding E to defuse
export const BOMB_TIMER = 35; // seconds from plant to detonation
export const WINS_TO_TAKE_MATCH = 8;
export const MAX_ROUNDS = 15;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const BOMB_PLANT_REWARD = 300;

export const GRAVITY = 22; // m/s^2, snappy arcade gravity
export const PLAYER_RADIUS = 0.38;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.1;
export const WALK_SPEED = 4.6; // m/s, full sprint
export const CROUCH_SPEED = 2.3;
export const SNEAK_SPEED = 2.4; // shift-walk: slow, quiet, accurate
export const JUMP_SPEED = 7.2;
export const ACCEL_GROUND = 42;
export const ACCEL_AIR = 9;
export const FRICTION = 11;

// A weapon: damage at close range, falloff, fire rate, spread model,
// recoil model, magazine, reserve, movement penalty and price.
export const WEAPONS = {
  sidearm: {
    name: 'P9 Sidearm', slot: 1, price: 0, auto: false,
    damage: 34, headMult: 3.2, range: 28, falloff: 0.55,
    rate: 6.5, mag: 12, reserve: 48, reload: 1.6,
    spreadBase: 0.006, spreadMove: 0.028, spreadAir: 0.05,
    recoil: 0.011, recoilRecover: 0.09, pellets: 1,
    movePenalty: 0.0, kick: 0.4, tracer: 0xffd27a,
  },
  smg: {
    name: 'Kestrel SMG', slot: 0, price: 1500, auto: true,
    damage: 26, headMult: 3.0, range: 24, falloff: 0.5,
    rate: 12, mag: 30, reserve: 120, reload: 2.1,
    spreadBase: 0.012, spreadMove: 0.035, spreadAir: 0.06,
    recoil: 0.008, recoilRecover: 0.11, pellets: 1,
    movePenalty: 0.04, kick: 0.5, tracer: 0xffe08a,
  },
  shotgun: {
    name: 'Breacher-12', slot: 0, price: 1200, auto: false,
    damage: 11, headMult: 2.2, range: 12, falloff: 0.25,
    rate: 1.4, mag: 6, reserve: 30, reload: 2.8,
    spreadBase: 0.055, spreadMove: 0.05, spreadAir: 0.07,
    recoil: 0.05, recoilRecover: 0.06, pellets: 8,
    movePenalty: 0.08, kick: 1.6, tracer: 0xffb36a,
  },
  rifle: {
    name: 'VK-7 Rifle', slot: 0, price: 2700, auto: true,
    damage: 33, headMult: 3.8, range: 40, falloff: 0.7,
    rate: 10, mag: 30, reserve: 90, reload: 2.4,
    spreadBase: 0.005, spreadMove: 0.032, spreadAir: 0.055,
    recoil: 0.013, recoilRecover: 0.1, pellets: 1,
    movePenalty: 0.06, kick: 0.7, tracer: 0xffd27a,
  },
  sniper: {
    name: 'Longbow-88', slot: 0, price: 4750, auto: false,
    damage: 110, headMult: 2.0, range: 90, falloff: 0.95,
    rate: 0.85, mag: 5, reserve: 20, reload: 3.4,
    spreadBase: 0.001, spreadMove: 0.09, spreadAir: 0.12,
    recoil: 0.06, recoilRecover: 0.05, pellets: 1,
    movePenalty: 0.12, kick: 2.2, tracer: 0x9fd8ff, scoped: true,
  },
};

export const GRENADES = {
  he: { name: 'HE Charge', price: 300, fuse: 2.0, radius: 7, damage: 95 },
  flash: { name: 'Flash Charge', price: 200, fuse: 1.5, radius: 18 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // fraction of damage armor eats

// Bot skill: reaction time, aim error, burst discipline, hearing radius.
export const BOT_SKILL = {
  reactMin: 0.28, reactMax: 0.62,
  aimError: 0.022, // radians of aim noise
  burstMin: 2, burstMax: 5,
  hearRadius: 26,
  seeDistance: 42,
  fovCos: 0.25, // ~75 degrees half-angle
};
