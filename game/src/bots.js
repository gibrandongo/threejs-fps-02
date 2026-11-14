// BREACHLINE — bot brains: waypoint routes, perception, combat and
// objective play. Bots see (line of sight + field of view), hear
// (recent gunfire), hold angles, rotate on the plant, and plant or
// defuse the charge. Each bot runs a small state machine on the
// fixed simulation step.
import { BOT_SKILL } from './config.js';
import { lineOfSight, moveCircle } from './collision.js';
import { WAYPOINTS, SITES, nearestWaypoint, planRoute } from './world.js';
import { eyeHeight, eyePos, activeWeaponDef } from './player.js';
import { tryFire, startReload } from './weapons.js';

const _eye = { x: 0, y: 0, z: 0 };
const _scratch = { x: 0, z: 0 };

export function makeBrain(role, site) {
  return {
    role, // 'a' | 'b' | 'mid' | 'anchorA' | 'anchorB' | 'roam'
    site, // 'A' | 'B' | null
    state: 'move', // move | hold | plant | defuse | pickup
    route: [],
    routeIndex: 0,
    targetId: -1,
    knownEnemy: null, // {x, y, z, time}
    reactUntil: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    scanPhase: Math.random() * Math.PI * 2,
    holdYaw: 0,
    strafeDir: 1,
    strafeUntil: 0,
    perceiveAt: 0, // next perception tick (staggered)
    planting: false,
    defusing: false,
    crouchHold: false,
  };
}

// Assign routes and objectives at round start.
export function assignRoles(s) {
  const attackers = s.fighters.filter((f) => f.alive && f.team === 'vanguard' && !f.isPlayer);
  const defenders = s.fighters.filter((f) => f.alive && f.team === 'sentinel');
  const aRoute = [8, 13]; // A site nodes
  const bRoute = [25, 28]; // B site nodes
  attackers.forEach((f, i) => {
    const role = i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : 'mid';
    f.brain.role = role;
    f.brain.site = role === 'a' ? 'A' : role === 'b' ? 'B' : null;
    const dest = role === 'a' ? aRoute[i % 2] : role === 'b' ? bRoute[i % 2] : 15;
    f.brain.route = planRoute(nearestWaypoint(f.pos.x, f.pos.z), dest);
    f.brain.routeIndex = 0;
    f.brain.state = 'move';
  });
  defenders.forEach((f, i) => {
    const role = i % 3 === 0 ? 'anchorA' : i % 3 === 1 ? 'anchorB' : 'roam';
    f.brain.role = role;
    f.brain.site = role === 'anchorA' ? 'A' : role === 'anchorB' ? 'B' : null;
    const dest = role === 'anchorA' ? 13 : role === 'anchorB' ? 28 : 16;
    f.brain.route = planRoute(nearestWaypoint(f.pos.x, f.pos.z), dest);
    f.brain.routeIndex = 0;
    f.brain.state = 'move';
    // Face the likely enemy approach once in position.
    f.brain.holdYaw = role === 'anchorA' ? Math.PI * 0.75 : role === 'anchorB' ? -Math.PI * 0.25 : Math.PI;
  });
}

function enemyVisible(s, f, e, colliders) {
  eyePos(f, _eye);
  const ex = e.pos.x, ey = e.pos.y + 1.2, ez = e.pos.z;
  const dx = ex - _eye.x, dy = ey - _eye.y, dz = ez - _eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > BOT_SKILL.seeDistance) return false;
  // Field of view: compare against the bot's facing.
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
  const dot = (dx * fx + dz * fz) / (d || 1);
  if (dot < BOT_SKILL.fovCos && d > 6) return false;
  return lineOfSight(colliders, _eye.x, _eye.y, _eye.z, ex, ey, ez);
}

function perceive(s, f, colliders) {
  const b = f.brain;
  let best = null, bestD = Infinity;
  for (const e of s.fighters) {
    if (!e.alive || e.team === f.team) continue;
    const d = Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
    if (d < bestD && enemyVisible(s, f, e, colliders)) {
      best = e; bestD = d;
    }
  }
  if (best) {
    if (b.targetId !== best.id) {
      b.reactUntil = s.time + BOT_SKILL.reactMin +
        Math.random() * (BOT_SKILL.reactMax - BOT_SKILL.reactMin);
      b.burstLeft = 0;
    }
    b.targetId = best.id;
    b.knownEnemy = { x: best.pos.x, y: best.pos.y, z: best.pos.z, time: s.time };
  } else if (b.targetId >= 0) {
    const t = s.fighters[b.targetId];
    if (!t || !t.alive) b.targetId = -1;
    else if (s.time - (b.knownEnemy ? b.knownEnemy.time : 0) > 3) b.targetId = -1;
  }
}

function aimAt(f, tx, ty, tz, dt, rate) {
  const dx = tx - f.pos.x, dz = tz - f.pos.z;
  const wantYaw = Math.atan2(-dx, -dz);
  let dyaw = wantYaw - f.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const maxTurn = rate * dt;
  f.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
  const dist = Math.hypot(dx, dz);
  const wantPitch = Math.atan2(ty - (f.pos.y + eyeHeight(f)), dist || 1);
  const dpitch = wantPitch - f.pitch;
  f.pitch += Math.max(-maxTurn, Math.min(maxTurn, dpitch));
}

function moveToward(f, tx, tz, colliders, dt, speed) {
  const dx = tx - f.pos.x, dz = tz - f.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  f.vel.x += (vx - f.vel.x) * Math.min(1, dt * 8);
  f.vel.z += (vz - f.vel.z) * Math.min(1, dt * 8);
  moveCircle(colliders, f.pos.x, f.pos.z, 0, 1.8, 0.38,
    f.vel.x * dt, f.vel.z * dt, _scratch);
  f.pos.x = _scratch.x;
  f.pos.z = _scratch.z;
  return d < 1.1;
}

export function stepBots(s, colliders, effects, dt) {
  for (const f of s.fighters) {
    if (!f.alive || f.isPlayer || !f.brain) continue;
    const b = f.brain;
    b.planting = false;
    b.defusing = false;

    // Perception on a stagger, not every step.
    if (s.time >= b.perceiveAt) {
      b.perceiveAt = s.time + 0.12;
      perceive(s, f, colliders);
    }

    // Hearing: recent shots within earshot mark a position to check.
    if (b.targetId < 0) {
      for (const ev of s.events) {
        if (ev.kind !== 'shot') continue;
        const shooter = s.fighters[ev.fighterId];
        if (!shooter || shooter.team === f.team) continue;
        const d = Math.hypot(ev.pos.x - f.pos.x, ev.pos.z - f.pos.z);
        if (d < BOT_SKILL.hearRadius) {
          b.knownEnemy = { x: ev.pos.x, y: 0, z: ev.pos.z, time: s.time };
        }
      }
    }

    const target = b.targetId >= 0 ? s.fighters[b.targetId] : null;
    const engaging = target && target.alive && s.time >= b.reactUntil;

    if (engaging) {
      // Combat: face the enemy, strafe, fire in bursts.
      aimAt(f, target.pos.x, target.pos.y + 1.35, target.pos.z, dt, 6);
      if (s.time >= b.strafeUntil) {
        b.strafeDir = Math.random() < 0.5 ? -1 : 1;
        b.strafeUntil = s.time + 0.5 + Math.random() * 0.8;
      }
      const sx = Math.cos(f.yaw) * b.strafeDir;
      const sz = -Math.sin(f.yaw) * b.strafeDir;
      moveToward(f, f.pos.x + sx * 2, f.pos.z + sz * 2, colliders, dt, 2.2);
      // Fire when roughly on target.
      const dx = target.pos.x - f.pos.x, dz = target.pos.z - f.pos.z;
      const wantYaw = Math.atan2(-dx, -dz);
      let dyaw = wantYaw - f.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(dyaw) < 0.12 && s.time >= b.burstPauseUntil) {
        if (b.burstLeft <= 0) {
          b.burstLeft = BOT_SKILL.burstMin +
            Math.floor(Math.random() * (BOT_SKILL.burstMax - BOT_SKILL.burstMin));
        }
        // Aim error: nudge the shot, not the facing, so misses read.
        const err = (Math.random() - 0.5) * BOT_SKILL.aimError * 2;
        f.yaw += err;
        const magKey = f.activeSlot === 0 ? 'primary' : 'secondary';
        if (f.mag[magKey] <= 0) startReload(s, f);
        else if (tryFire(s, f, colliders, effects)) b.burstLeft--;
        f.yaw -= err;
        if (b.burstLeft <= 0) b.burstPauseUntil = s.time + 0.35 + Math.random() * 0.4;
      }
      // Low ammo and no target pressure: reload.
      const def = activeWeaponDef(f);
      const magKey = f.activeSlot === 0 ? 'primary' : 'secondary';
      if (f.mag[magKey] === 0) startReload(s, f);
      else if (f.mag[magKey] < def.mag * 0.3 && !engaging) startReload(s, f);
      continue;
    }

    // Objective behaviours.
    if (s.bomb.state === 'planted' && f.team === 'sentinel') {
      // Rotate to the planted site and defuse.
      const bp = s.bomb.pos;
      const d = Math.hypot(bp.x - f.pos.x, bp.z - f.pos.z);
      if (d < 1.6) {
        b.defusing = true;
        aimAt(f, bp.x, 0.5, bp.z, dt, 4);
      } else {
        followRouteTo(s, f, bp.x, bp.z, colliders, dt);
      }
      continue;
    }
    if (s.bomb.state === 'dropped' && f.team === 'vanguard' && !f.hasCharge) {
      // Nearest living attacker fetches the dropped charge.
      let nearest = true;
      for (const o of s.fighters) {
        if (o === f || !o.alive || o.team !== 'vanguard' || o.isPlayer) continue;
        const dd = Math.hypot(s.bomb.pos.x - o.pos.x, s.bomb.pos.z - o.pos.z);
        const md = Math.hypot(s.bomb.pos.x - f.pos.x, s.bomb.pos.z - f.pos.z);
        if (dd < md) { nearest = false; break; }
      }
      if (nearest) {
        const d = Math.hypot(s.bomb.pos.x - f.pos.x, s.bomb.pos.z - f.pos.z);
        if (d < 1.2) {
          f.hasCharge = true;
          s.bomb.state = 'carried';
          s.bomb.carrierId = f.id;
          s.events.push({ kind: 'chargePicked', fighterId: f.id });
        } else {
          followRouteTo(s, f, s.bomb.pos.x, s.bomb.pos.z, colliders, dt);
          continue;
        }
      }
    }
    if (f.hasCharge && f.team === 'vanguard') {
      const site = SITES[b.site || 'A'];
      const inside = f.pos.x >= site.x0 && f.pos.x <= site.x1 &&
        f.pos.z >= site.z0 && f.pos.z <= site.z1;
      if (inside) {
        b.state = 'plant';
        b.planting = true;
        continue;
      }
      // Head for the assigned site.
      const cx = (site.x0 + site.x1) / 2, cz = (site.z0 + site.z1) / 2;
      followRouteTo(s, f, cx, cz, colliders, dt);
      continue;
    }
    if (s.bomb.state === 'planted' && f.team === 'vanguard') {
      // After the plant, hold near the site and watch approaches.
      holdPosition(f, dt);
      continue;
    }

    // Route following / holding.
    if (b.state === 'move' && b.route.length > 0) {
      const node = WAYPOINTS[b.route[b.routeIndex]];
      const arrived = moveToward(f, node.x, node.z, colliders, dt, 4.4);
      // Face travel direction.
      const wantYaw = Math.atan2(-(node.x - f.pos.x), -(node.z - f.pos.z));
      let dyaw = wantYaw - f.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      f.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
      if (arrived) {
        b.routeIndex++;
        if (b.routeIndex >= b.route.length) {
          b.state = 'hold';
          b.holdYaw = f.yaw;
        }
      }
    } else {
      holdPosition(f, dt);
    }

    // Investigate a heard position when idle.
    if (b.state === 'hold' && b.knownEnemy && s.time - b.knownEnemy.time < 4) {
      aimAt(f, b.knownEnemy.x, 1.2, b.knownEnemy.z, dt, 3);
    }
  }
}

function followRouteTo(s, f, tx, tz, colliders, dt) {
  const b = f.brain;
  // Rebuild the route when the destination moved on, or when stale.
  const destNode = nearestWaypoint(tx, tz);
  const curNode = nearestWaypoint(f.pos.x, f.pos.z);
  if (b.route.length === 0 || b.route[b.route.length - 1] !== destNode) {
    b.route = planRoute(curNode, destNode);
    b.routeIndex = 0;
  }
  if (b.routeIndex < b.route.length) {
    const node = WAYPOINTS[b.route[b.routeIndex]];
    if (moveToward(f, node.x, node.z, colliders, dt, 4.6)) b.routeIndex++;
  } else {
    moveToward(f, tx, tz, colliders, dt, 4.6);
  }
}

function holdPosition(f, dt) {
  // Stand, crouch sometimes, sweep the view slowly.
  f.vel.x *= 0.8; f.vel.z *= 0.8;
  const b = f.brain;
  b.scanPhase += dt * 0.5;
  const sweep = Math.sin(b.scanPhase) * 0.6;
  f.yaw += (b.holdYaw + sweep - f.yaw) * Math.min(1, dt * 2);
  f.crouched = b.crouchHold;
}
