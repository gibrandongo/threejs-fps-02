// BREACHLINE — weapons: firing, hits, damage, reloads, grenades and
// the first-person viewmodel. Hit detection is analytic: a ray against
// the map's boxes, a sphere for the head and a cylinder for the body,
// so headshots are exact and cheap. No allocations in the fire path.
import * as THREE from 'three';
import {
  ARMOR_ABSORB, GRENADES, KILL_REWARD, WEAPONS,
} from './config.js';
import { rayCylinder, raySphere, raycastBoxes } from './collision.js';
import { eyeHeight, eyePos, activeWeaponDef, activeWeaponKey, currentSpread } from './player.js';
import { sfx } from './audio.js';

const _eye = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };
const _n = { x: 0, y: 0, z: 0 };
const _p = { x: 0, y: 0, z: 0 };
const _spread = { x: 0, y: 0, z: 0 };
const _muzzle = { x: 0, y: 0, z: 0 };

// Forward vector from yaw/pitch, with recoil applied.
export function aimDir(f, out) {
  const pitch = f.pitch + f.recoilPitch;
  const yaw = f.yaw + f.recoilYaw;
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

function addSpread(dir, spread, out) {
  // Random point in a disc perpendicular to dir, scaled by spread.
  const rx = (Math.random() * 2 - 1) * spread;
  const ry = (Math.random() * 2 - 1) * spread;
  // Build a cheap orthonormal basis.
  let ux = -dir.z, uy = 0, uz = dir.x;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = dir.y * uz - dir.z * uy;
  const vy = dir.z * ux - dir.x * uz;
  const vz = dir.x * uy - dir.y * ux;
  out.x = dir.x + ux * rx + vx * ry;
  out.y = dir.y + uy * rx + vy * ry;
  out.z = dir.z + uz * rx + vz * ry;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

// Fire one trigger pull (auto weapons call this every step while held).
// Returns true when a shot left the barrel.
export function tryFire(s, f, colliders, effects) {
  if (!f.alive || f.reloading > 0 || f.fireCooldown > 0) return false;
  const key = activeWeaponKey(f);
  const def = WEAPONS[key];
  const magKey = f.activeSlot === 0 ? 'primary' : 'secondary';
  if (f.mag[magKey] <= 0) {
    if (f.isPlayer) sfx.dryFire();
    f.fireCooldown = 0.25;
    return false;
  }
  f.mag[magKey]--;
  f.fireCooldown = 1 / def.rate;
  f.firedThisStep = true;
  // Recoil: pitch climbs, yaw drifts, bloom grows.
  f.recoilPitch += def.recoil * (0.7 + Math.random() * 0.6);
  f.recoilYaw += (Math.random() - 0.5) * def.recoil * 0.8;
  f.spreadBloom = Math.min(0.05, f.spreadBloom + def.recoil * 0.55);

  eyePos(f, _eye);
  aimDir(f, _dir);
  const spread = currentSpread(f) * (f.aiming ? 0.35 : 1);
  const origin = { x: _eye.x, y: _eye.y, z: _eye.z };
  let hitSomething = false;

  for (let p = 0; p < def.pellets; p++) {
    const dir = addSpread(_dir, spread, _spread);
    const end = fireRay(s, f, origin, dir, def, colliders, effects);
    if (end) hitSomething = true;
  }
  // Muzzle flash + tracer from the barrel.
  const mz = muzzleWorld(f);
  effects.muzzle(mz.x, mz.y, mz.z);
  const dist = Math.hypot(_eye.x - s.fighters[s.playerId].pos.x,
    _eye.y - (s.fighters[s.playerId].pos.y + eyeHeight(s.fighters[s.playerId])),
    _eye.z - s.fighters[s.playerId].pos.z);
  sfx.shot(dist, key === 'sniper' || key === 'shotgun');
  s.events.push({ kind: 'shot', fighterId: f.id, pos: { ...origin } });
  return hitSomething;
}

// One pellet ray: nearest of walls and enemy fighters. Applies damage.
function fireRay(s, shooter, origin, dir, def, colliders, effects) {
  const MAX = 120;
  const wallT = raycastBoxes(colliders, origin.x, origin.y, origin.z,
    dir.x, dir.y, dir.z, MAX, _n, _p);
  let bestT = wallT < 0 ? MAX : wallT;
  let victim = null, head = false;

  for (const f of s.fighters) {
    if (!f.alive || f === shooter || f.team === shooter.team) continue;
    const headY = f.pos.y + eyeHeight(f);
    const ht = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      f.pos.x, headY, f.pos.z, 0.2, bestT);
    if (ht >= 0) { bestT = ht; victim = f; head = true; continue; }
    const bt = rayCylinder(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      f.pos.x, f.pos.z, 0.38, f.pos.y + 0.05, f.pos.y + 1.5, bestT);
    if (bt >= 0) { bestT = bt; victim = f; head = false; }
  }

  const endX = origin.x + dir.x * bestT;
  const endY = origin.y + dir.y * bestT;
  const endZ = origin.z + dir.z * bestT;
  const mz = muzzleWorld(shooter);
  effects.tracer(mz, { x: endX, y: endY, z: endZ }, def.tracer);

  if (victim) {
    let dmg = def.damage * (head ? def.headMult : 1);
    if (bestT > def.range) {
      const over = Math.min(1, (bestT - def.range) / def.range);
      dmg *= 1 - (1 - def.falloff) * over;
    }
    damageFighter(s, victim, dmg, shooter, head, effects);
    // No blood spray when the player is hit: the burst would spawn at
    // the camera and fill the screen. The damage arc covers it.
    if (!victim.isPlayer) effects.blood(endX, endY, endZ);
    if (shooter.isPlayer) {
      s.events.push({ kind: 'hitmarker', head });
      sfx.hit(head);
    }
    return true;
  }
  if (wallT >= 0) {
    effects.impact(endX, endY, endZ, _n.x, _n.y, _n.z);
  }
  return false;
}

export function damageFighter(s, target, amount, attacker, head, effects) {
  if (!target.alive) return;
  let dmg = amount;
  if (target.armor > 0) {
    const absorbed = dmg * ARMOR_ABSORB;
    target.armor = Math.max(0, target.armor - absorbed * 0.5);
    dmg -= absorbed;
  }
  target.health -= dmg;
  if (target.isPlayer) {
    sfx.hurt();
    if (attacker) {
      target.hurtDir = Math.atan2(
        -(attacker.pos.x - target.pos.x), -(attacker.pos.z - target.pos.z));
    }
  }
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.vel.x = 0; target.vel.z = 0;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money += KILL_REWARD;
    }
    target.deaths++;
    s.killfeed.unshift({
      killer: attacker ? attacker.name : '—',
      victim: target.name,
      head, weapon: attacker ? activeWeaponKey(attacker) : '',
      time: s.time,
    });
    if (s.killfeed.length > 5) s.killfeed.pop();
    s.events.push({ kind: 'kill', victimId: target.id, attackerId: attacker ? attacker.id : -1 });
    // Drop the charge where its carrier fell.
    if (target.hasCharge) {
      target.hasCharge = false;
      s.bomb.state = 'dropped';
      s.bomb.pos.x = target.pos.x;
      s.bomb.pos.y = 0;
      s.bomb.pos.z = target.pos.z;
      s.bomb.carrierId = -1;
      s.events.push({ kind: 'chargeDropped' });
    }
  }
}

export function startReload(s, f) {
  if (!f.alive || f.reloading > 0) return;
  const def = activeWeaponDef(f);
  const magKey = f.activeSlot === 0 ? 'primary' : 'secondary';
  if (f.mag[magKey] >= def.mag || f.reserve[magKey] <= 0) return;
  f.reloading = def.reload;
  if (f.isPlayer) sfx.reload();
}

export function finishReload(f) {
  const def = activeWeaponDef(f);
  const magKey = f.activeSlot === 0 ? 'primary' : 'secondary';
  const need = def.mag - f.mag[magKey];
  const take = Math.min(need, f.reserve[magKey]);
  f.mag[magKey] += take;
  f.reserve[magKey] -= take;
}

export function switchSlot(f, slot) {
  if (slot === 0 && !f.primary) return;
  if (f.activeSlot === slot) return;
  f.activeSlot = slot;
  f.reloading = 0;
  f.fireCooldown = Math.max(f.fireCooldown, 0.25);
}

// --- Grenades -------------------------------------------------------
export function throwGrenade(s, f, kind) {
  if (!f.alive || f.grenades[kind] <= 0) return false;
  f.grenades[kind]--;
  eyePos(f, _eye);
  aimDir(f, _dir);
  const g = {
    kind, ownerId: f.id,
    pos: { x: _eye.x + _dir.x * 0.5, y: _eye.y - 0.15, z: _eye.z + _dir.z * 0.5 },
    vel: {
      x: _dir.x * 15 + f.vel.x * 0.5,
      y: _dir.y * 15 + 3.5,
      z: _dir.z * 15 + f.vel.z * 0.5,
    },
    fuse: GRENADES[kind].fuse,
    mesh: null,
  };
  s.grenades.push(g);
  s.events.push({ kind: 'grenadeThrown', grenade: g });
  return true;
}

const _gn = { x: 0, y: 0, z: 0 };
const _gp = { x: 0, y: 0, z: 0 };

export function stepGrenades(s, colliders, effects, dt) {
  for (let i = s.grenades.length - 1; i >= 0; i--) {
    const g = s.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 20 * dt;
    const nx = g.pos.x + g.vel.x * dt;
    const ny = g.pos.y + g.vel.y * dt;
    const nz = g.pos.z + g.vel.z * dt;
    // Bounce off walls: segment test against boxes.
    const t = raycastBoxes(colliders, g.pos.x, g.pos.y, g.pos.z,
      nx - g.pos.x, ny - g.pos.y, nz - g.pos.z, 1, _gn, _gp);
    if (t >= 0) {
      g.pos.x = _gp.x; g.pos.y = _gp.y; g.pos.z = _gp.z;
      if (_gn.x !== 0) g.vel.x = -g.vel.x * 0.45;
      if (_gn.y !== 0) g.vel.y = -g.vel.y * 0.45;
      if (_gn.z !== 0) g.vel.z = -g.vel.z * 0.45;
    } else {
      g.pos.x = nx; g.pos.y = ny; g.pos.z = nz;
    }
    if (g.pos.y < 0.09) {
      g.pos.y = 0.09;
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7; g.vel.z *= 0.7;
    }
    if (g.fuse <= 0) {
      detonate(s, g, effects);
      s.events.push({ kind: 'grenadeGone', grenade: g });
      s.grenades.splice(i, 1);
    }
  }
}

function detonate(s, g, effects) {
  const def = GRENADES[g.kind];
  const player = s.fighters[s.playerId];
  const distP = Math.hypot(g.pos.x - player.pos.x, g.pos.y - player.pos.y, g.pos.z - player.pos.z);
  if (g.kind === 'he') {
    effects.explosion(g.pos.x, g.pos.y, g.pos.z);
    sfx.explosion(distP);
    for (const f of s.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - g.pos.x, (f.pos.y + 1) - g.pos.y, f.pos.z - g.pos.z);
      if (d > def.radius) continue;
      const dmg = def.damage * (1 - d / def.radius * 0.7);
      damageFighter(s, f, dmg, s.fighters[g.ownerId] || null, false, effects);
    }
    s.events.push({ kind: 'explosion', pos: { ...g.pos } });
  } else {
    // Flash: blind fighters with line of sight who face the blast.
    effects.burst(g.pos.x, g.pos.y, g.pos.z, 20, 0xffffff, 3, 0.3, 0);
    sfx.grenade(distP);
    for (const f of s.fighters) {
      if (!f.alive) continue;
      const dx = g.pos.x - f.pos.x, dy = g.pos.y - (f.pos.y + 1.5), dz = g.pos.z - f.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > def.radius) continue;
      // Facing factor: 1 when looking straight at it, 0.25 from behind.
      aimDir(f, _dir);
      const facing = Math.max(0, (_dir.x * dx + _dir.y * dy + _dir.z * dz) / (d || 1));
      const strength = (1 - d / def.radius) * (0.25 + 0.75 * facing);
      if (strength > 0.15) {
        f.flashUntil = s.time + strength * 3.2;
        if (f.isPlayer) s.events.push({ kind: 'flashed', strength });
      }
    }
  }
}

// Muzzle position in world space (used for tracers and flashes).
export function muzzleWorld(f) {
  eyePos(f, _eye);
  aimDir(f, _dir);
  _muzzle.x = _eye.x + _dir.x * 0.7 - Math.cos(f.yaw) * 0.18;
  _muzzle.y = _eye.y + _dir.y * 0.7 - 0.12;
  _muzzle.z = _eye.z + _dir.z * 0.7 + Math.sin(f.yaw) * 0.18;
  return _muzzle;
}

// --- Viewmodel ------------------------------------------------------
// A chunky low-poly gun built from boxes, parented to the camera.
// Bob, kick and reload dip are driven from the fighter's state.
export function buildViewmodel(camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.55, metalness: 0.5 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.6, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 10), mid);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.38);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), mid);
  mag.position.set(0, -0.13, 0.02);
  mag.rotation.x = 0.15;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.22), grip);
  stock.position.set(0, -0.02, 0.32);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), dark);
  sight.position.set(0, 0.09, -0.08);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.16), grip);
  hand.position.set(0, -0.1, -0.2);
  group.add(body, barrel, mag, stock, sight, hand);
  group.position.set(0.24, -0.22, -0.45);
  camera.add(group);
  return {
    group, kick: 0, bobPhase: 0,
    update(f, dt, moving) {
      this.kick = Math.max(0, this.kick - dt * 6);
      if (moving) this.bobPhase += dt * 9;
      const bob = moving ? Math.sin(this.bobPhase) * 0.008 : 0;
      const bobX = moving ? Math.cos(this.bobPhase * 0.5) * 0.006 : 0;
      const dip = f.reloading > 0 ? -0.12 : 0;
      group.position.set(
        0.24 + bobX - (f.aiming ? 0.09 : 0),
        -0.22 + bob + dip + (f.aiming ? 0.045 : 0),
        -0.45 + this.kick * 0.09,
      );
      group.rotation.x = this.kick * 0.35 + (f.reloading > 0 ? 0.4 : 0);
    },
    onShot() { this.kick = 1; },
  };
}
