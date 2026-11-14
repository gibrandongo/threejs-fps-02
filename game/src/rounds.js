// BREACHLINE — rounds: the match state machine. Freeze time, live
// play, the bomb's plant/defuse timers, win conditions, economy and
// the buy menu. One function per transition; the simulation calls
// stepRounds once per fixed step.
import {
  ARMOR_PRICE, BOMB_PLANT_REWARD, BOMB_TIMER, DEFUSE_TIME,
  FREEZE_TIME, GRENADES, LOSS_REWARD, MAX_ROUNDS, PLANT_TIME,
  ROUND_TIME, WEAPONS, WIN_REWARD, WINS_TO_TAKE_MATCH,
} from './config.js';
import { SITES, SPAWNS } from './world.js';
import { aliveOf, makeFighter, playerOf, resetFighterForRound } from './state.js';
import { makeBrain, assignRoles } from './bots.js';
import { sfx } from './audio.js';

const CALLSIGNS = {
  vanguard: ['Rook', 'Iris', 'Dagger', 'Moss'],
  sentinel: ['Bastion', 'Wren', 'Havoc', 'Slate', 'Fenn'],
};

export function startMatch(s) {
  s.score.vanguard = 0;
  s.score.sentinel = 0;
  s.lossStreak.vanguard = 0;
  s.lossStreak.sentinel = 0;
  s.round = 1;
  s.matchWinner = null;
  s.fighters = [];
  s.fighters.push(makeFighter(0, 'vanguard', true, 'You'));
  let id = 1;
  for (const name of CALLSIGNS.vanguard) {
    const f = makeFighter(id++, 'vanguard', false, name);
    f.brain = makeBrain('mid', null);
    s.fighters.push(f);
  }
  for (const name of CALLSIGNS.sentinel) {
    const f = makeFighter(id++, 'sentinel', false, name);
    f.brain = makeBrain('roam', null);
    s.fighters.push(f);
  }
  for (const f of s.fighters) {
    f.money = 800;
    f.primary = null;
    f.secondary = 'sidearm';
    f.activeSlot = 1;
    f.mag.secondary = WEAPONS.sidearm.mag;
    f.reserve.secondary = WEAPONS.sidearm.reserve;
    f.kills = 0; f.deaths = 0;
  }
  s.killfeed = [];
  startRound(s);
}

export function startRound(s) {
  const spawnsV = [...SPAWNS.vanguard];
  const spawnsS = [...SPAWNS.sentinel];
  let vi = 0, si = 0;
  for (const f of s.fighters) {
    const spawn = f.team === 'vanguard' ? spawnsV[vi++] : spawnsS[si++];
    const yaw = f.team === 'vanguard' ? -Math.PI / 2 : Math.PI / 2;
    resetFighterForRound(f, spawn, yaw);
    // Ammunition is topped up every round; weapons and gear persist.
    refillAmmo(f);
    if (!f.isPlayer) botBuy(f);
  }
  // The player carries the charge at the start of every round.
  const player = playerOf(s);
  player.hasCharge = true;
  s.bomb = {
    state: 'carried', carrierId: player.id,
    pos: { x: 0, y: 0, z: 0 }, site: null,
    timer: 0, plantProgress: 0, defuseProgress: 0,
    planterId: -1, defuserId: -1,
  };
  s.grenades = [];
  s.phase = 'freeze';
  s.phaseTime = FREEZE_TIME;
  s.roundWinner = null;
  s.roundBanner = `Round ${s.round}`;
  s.buyOpen = false;
  assignRoles(s);
  s.events.push({ kind: 'roundStart', round: s.round });
}

function refillAmmo(f) {
  if (f.primary) {
    const d = WEAPONS[f.primary];
    f.mag.primary = d.mag;
    f.reserve.primary = d.reserve;
  }
  const sd = WEAPONS[f.secondary];
  f.mag.secondary = sd.mag;
  f.reserve.secondary = sd.reserve;
}

// Bots spend simply: best affordable primary, armour, one grenade.
function botBuy(f) {
  const order = ['rifle', 'sniper', 'smg', 'shotgun'];
  if (!f.primary) {
    for (const key of order) {
      if (f.money >= WEAPONS[key].price) {
        f.primary = key;
        f.money -= WEAPONS[key].price;
        f.activeSlot = 0;
        break;
      }
    }
  }
  if (f.money >= ARMOR_PRICE && f.armor < 50) {
    f.armor = 100;
    f.money -= ARMOR_PRICE;
  }
  if (f.money >= GRENADES.he.price && Math.random() < 0.6) {
    f.grenades.he++;
    f.money -= GRENADES.he.price;
  }
  if (f.money >= GRENADES.flash.price && Math.random() < 0.4) {
    f.grenades.flash++;
    f.money -= GRENADES.flash.price;
  }
}

export function stepRounds(s, effects, dt) {
  if (s.phase === 'freeze') {
    s.phaseTime -= dt;
    if (s.phaseTime <= 0) {
      s.phase = 'live';
      s.phaseTime = ROUND_TIME;
      s.buyOpen = false;
      s.events.push({ kind: 'roundLive' });
    }
    return;
  }
  if (s.phase === 'roundEnd') {
    s.phaseTime -= dt;
    if (s.phaseTime <= 0) {
      if (s.matchWinner) {
        s.phase = 'matchEnd';
      } else {
        s.round++;
        startRound(s);
      }
    }
    return;
  }
  if (s.phase !== 'live') return;

  s.phaseTime -= dt;
  stepBomb(s, effects, dt);

  const vAlive = aliveOf(s, 'vanguard');
  const sAlive = aliveOf(s, 'sentinel');
  if (vAlive === 0 && s.bomb.state !== 'planted') {
    endRound(s, 'sentinel', 'Vanguard eliminated');
  } else if (sAlive === 0 && s.bomb.state !== 'planted') {
    endRound(s, 'vanguard', 'Sentinel eliminated');
  } else if (sAlive === 0 && s.bomb.state === 'planted') {
    // Defenders wiped after the plant: the bomb decides it.
    // (No early win — the timer runs out and the charge blows.)
  } else if (s.phaseTime <= 0 && s.bomb.state !== 'planted') {
    endRound(s, 'sentinel', 'Time expired');
  }
}

function stepBomb(s, effects, dt) {
  const bomb = s.bomb;
  if (bomb.state === 'carried' || bomb.state === 'dropped') {
    // Player picks the dropped charge up by walking over it.
    if (bomb.state === 'dropped') {
      const p = playerOf(s);
      if (p.alive && Math.hypot(bomb.pos.x - p.pos.x, bomb.pos.z - p.pos.z) < 1.2) {
        p.hasCharge = true;
        bomb.state = 'carried';
        bomb.carrierId = p.id;
        s.events.push({ kind: 'chargePicked', fighterId: p.id });
      }
    }
    // Planting: carrier standing in a site and holding use.
    const carrier = bomb.carrierId >= 0 ? s.fighters[bomb.carrierId] : null;
    if (carrier && carrier.alive) {
      const site = siteAt(carrier.pos.x, carrier.pos.z);
      const using = carrier.isPlayer ? s.input.useHeld : carrier.brain && carrier.brain.planting;
      if (site && using) {
        bomb.plantProgress += dt;
        bomb.site = site.label;
        if (bomb.plantProgress >= PLANT_TIME) {
          bomb.state = 'planted';
          bomb.timer = BOMB_TIMER;
          bomb.pos.x = carrier.pos.x;
          bomb.pos.y = 0;
          bomb.pos.z = carrier.pos.z;
          bomb.planterId = carrier.id;
          carrier.hasCharge = false;
          carrier.money += BOMB_PLANT_REWARD;
          sfx.plant();
          s.events.push({ kind: 'planted', site: site.label, fighterId: carrier.id });
        }
      } else {
        bomb.plantProgress = 0;
      }
    } else {
      bomb.plantProgress = 0;
    }
    return;
  }
  if (bomb.state !== 'planted') return;

  bomb.timer -= dt;
  // Beeps accelerate as the timer runs down.
  const interval = bomb.timer > 20 ? 1.0 : bomb.timer > 10 ? 0.5 : 0.25;
  if (!bomb._beepAt || s.time >= bomb._beepAt) {
    bomb._beepAt = s.time + interval;
    sfx.beep(bomb.timer <= 10);
  }
  // Defusing: a defender at the bomb holding use.
  let defusing = false;
  for (const f of s.fighters) {
    if (!f.alive || f.team !== 'sentinel') continue;
    const d = Math.hypot(bomb.pos.x - f.pos.x, bomb.pos.z - f.pos.z);
    if (d > 1.6) continue;
    const using = f.isPlayer ? s.input.useHeld : f.brain && f.brain.defusing;
    if (using) {
      defusing = true;
      bomb.defuserId = f.id;
      bomb.defuseProgress += dt;
      if (bomb.defuseProgress >= DEFUSE_TIME) {
        bomb.state = 'defused';
        sfx.defuse();
        s.events.push({ kind: 'defused', fighterId: f.id });
        endRound(s, 'sentinel', 'Charge defused');
        return;
      }
    }
  }
  if (!defusing) bomb.defuseProgress = 0;

  if (bomb.timer <= 0) {
    bomb.state = 'exploded';
    effects.explosion(bomb.pos.x, bomb.pos.y, bomb.pos.z);
    const p = playerOf(s);
    const d = Math.hypot(bomb.pos.x - p.pos.x, bomb.pos.z - p.pos.z);
    sfx.explosion(d);
    s.events.push({ kind: 'explosion', pos: { ...bomb.pos } });
    endRound(s, 'vanguard', 'Charge detonated');
  }
}

function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    if (x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1) return site;
  }
  return null;
}

function endRound(s, winner, reason) {
  if (s.phase !== 'live') return;
  s.phase = 'roundEnd';
  s.phaseTime = 4;
  s.roundWinner = winner;
  s.score[winner]++;
  const loser = winner === 'vanguard' ? 'sentinel' : 'vanguard';
  s.lossStreak[winner] = 0;
  s.lossStreak[loser]++;
  const lossBonus = Math.min(3, s.lossStreak[loser] - 1) * 500;
  for (const f of s.fighters) {
    if (f.team === winner) f.money += WIN_REWARD;
    else f.money += LOSS_REWARD + lossBonus;
    if (f.money > 16000) f.money = 16000;
  }
  s.roundBanner = `${winner === 'vanguard' ? 'Vanguard' : 'Sentinel'} wins — ${reason}`;
  s.events.push({ kind: 'roundEnd', winner, reason });
  const player = playerOf(s);
  if (player.team === winner) sfx.roundWin();
  else sfx.roundLose();
  if (s.score[winner] >= WINS_TO_TAKE_MATCH) {
    s.matchWinner = winner;
  } else if (s.round >= MAX_ROUNDS) {
    if (s.score.vanguard === s.score.sentinel) s.matchWinner = 'draw';
    else s.matchWinner = s.score.vanguard > s.score.sentinel ? 'vanguard' : 'sentinel';
  }
}

// --- Buy menu -------------------------------------------------------
export const BUY_ITEMS = [
  { key: 'smg', label: 'Kestrel SMG', price: 1500, kind: 'primary' },
  { key: 'shotgun', label: 'Breacher-12', price: 1200, kind: 'primary' },
  { key: 'rifle', label: 'VK-7 Rifle', price: 2700, kind: 'primary' },
  { key: 'sniper', label: 'Longbow-88', price: 4750, kind: 'primary' },
  { key: 'armor', label: 'Kevlar Armour', price: ARMOR_PRICE, kind: 'armor' },
  { key: 'he', label: 'HE Charge', price: GRENADES.he.price, kind: 'grenade' },
  { key: 'flash', label: 'Flash Charge', price: GRENADES.flash.price, kind: 'grenade' },
];

export function buyItem(s, f, itemKey) {
  if (s.phase !== 'freeze') return false;
  const item = BUY_ITEMS.find((i) => i.key === itemKey);
  if (!item || f.money < item.price) {
    sfx.denied();
    return false;
  }
  if (item.kind === 'primary') {
    if (f.primary === item.key) { sfx.denied(); return false; }
    f.primary = item.key;
    const d = WEAPONS[item.key];
    f.mag.primary = d.mag;
    f.reserve.primary = d.reserve;
    f.activeSlot = 0;
  } else if (item.kind === 'armor') {
    if (f.armor >= 100) { sfx.denied(); return false; }
    f.armor = 100;
  } else {
    f.grenades[item.key]++;
  }
  f.money -= item.price;
  sfx.buy();
  s.events.push({ kind: 'bought', fighterId: f.id, item: itemKey });
  return true;
}
