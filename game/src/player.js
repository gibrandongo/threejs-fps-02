// BREACHLINE — player movement: acceleration-based, CS-flavoured.
// Full speed only when standing and moving cleanly; crouching and
// sneaking slow you down but tighten your spread; jumping kills your
// accuracy until you land. Collision slides along the map's boxes.
import {
  ACCEL_AIR, ACCEL_GROUND, CROUCH_SPEED, EYE_CROUCH, EYE_STAND,
  FRICTION, GRAVITY, JUMP_SPEED, PLAYER_RADIUS, SNEAK_SPEED,
  WALK_SPEED, WEAPONS,
} from './config.js';
import { moveCircle } from './collision.js';

const scratch = { x: 0, z: 0 };

export function eyeHeight(f) {
  return f.crouched ? EYE_CROUCH : EYE_STAND;
}

export function eyePos(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + eyeHeight(f);
  out.z = f.pos.z;
  return out;
}

// Current horizontal speed, used by the spread model.
export function speed2D(f) {
  return Math.hypot(f.vel.x, f.vel.z);
}

export function maxSpeedFor(f) {
  let base = f.crouched ? CROUCH_SPEED : WALK_SPEED;
  const def = activeWeaponDef(f);
  if (def) base *= 1 - def.movePenalty;
  return base;
}

export function activeWeaponDef(f) {
  if (f.activeSlot === 0 && f.primary) return WEAPONS[f.primary];
  return WEAPONS[f.secondary];
}

export function activeWeaponKey(f) {
  if (f.activeSlot === 0 && f.primary) return f.primary;
  return f.secondary;
}

// One fixed simulation step of player locomotion.
export function stepPlayer(f, input, colliders, dt) {
  // Look: mouse deltas arrive in radians already scaled by sensitivity.
  f.yaw -= input.lookDX;
  f.pitch -= input.lookDY;
  const lim = Math.PI / 2 - 0.02;
  if (f.pitch > lim) f.pitch = lim;
  if (f.pitch < -lim) f.pitch = -lim;

  f.crouched = input.crouch;

  // Wish direction in world space from yaw.
  const sin = Math.sin(f.yaw), cos = Math.cos(f.yaw);
  const fwdX = -sin, fwdZ = -cos;
  const rightX = cos, rightZ = -sin;
  let wx = fwdX * input.forward + rightX * input.strafe;
  let wz = fwdZ * input.forward + rightZ * input.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }

  const sneaking = input.sneak && !input.crouch;
  const maxSpeed = sneaking ? SNEAK_SPEED : maxSpeedFor(f);
  const accel = f.onGround ? ACCEL_GROUND : ACCEL_AIR;

  if (wl > 0.01) {
    f.vel.x += wx * accel * dt;
    f.vel.z += wz * accel * dt;
    // Cap horizontal speed, softly: excess bleeds off, never snaps.
    const sp = speed2D(f);
    if (sp > maxSpeed) {
      const k = maxSpeed / sp;
      f.vel.x *= k;
      f.vel.z *= k;
    }
  } else if (f.onGround) {
    // Ground friction brings a standing player to a stop.
    const sp = speed2D(f);
    const drop = FRICTION * dt;
    if (sp <= drop) { f.vel.x = 0; f.vel.z = 0; }
    else {
      const k = (sp - drop) / sp;
      f.vel.x *= k;
      f.vel.z *= k;
    }
  }

  if (input.jump && f.onGround) {
    f.vel.y = JUMP_SPEED;
    f.onGround = false;
  }

  // Gravity and floor.
  f.vel.y -= GRAVITY * dt;
  f.pos.y += f.vel.y * dt;
  if (f.pos.y <= 0) {
    f.pos.y = 0;
    f.vel.y = 0;
    f.onGround = true;
  }

  // Horizontal move with wall sliding.
  const height = eyeHeight(f) + 0.15;
  moveCircle(colliders, f.pos.x, f.pos.z, f.pos.y, height, PLAYER_RADIUS,
    f.vel.x * dt, f.vel.z * dt, scratch);
  // If a wall stopped us, kill the velocity into it.
  if (scratch.x !== f.pos.x + f.vel.x * dt) f.vel.x = 0;
  if (scratch.z !== f.pos.z + f.vel.z * dt) f.vel.z = 0;
  f.pos.x = scratch.x;
  f.pos.z = scratch.z;

  // Recoil recovery: aim settles back toward neutral.
  const def = activeWeaponDef(f);
  const recover = def ? def.recoilRecover : 0.1;
  f.recoilPitch *= Math.max(0, 1 - recover * dt * 10);
  f.recoilYaw *= Math.max(0, 1 - recover * dt * 10);
  f.spreadBloom = Math.max(0, f.spreadBloom - dt * 2.2);
}

// Spread in radians for the next shot: base + movement + air + bloom,
// reduced by crouching and sneaking. Stopping to aim pays.
export function currentSpread(f) {
  const def = activeWeaponDef(f);
  if (!def) return 0.02;
  let s = def.spreadBase + f.spreadBloom;
  const sp = speed2D(f);
  const frac = Math.min(1, sp / WALK_SPEED);
  s += def.spreadMove * frac;
  if (!f.onGround) s += def.spreadAir;
  if (f.crouched) s *= 0.7;
  return s;
}
