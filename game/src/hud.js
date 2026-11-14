// BREACHLINE — HUD: every DOM element the player sees, driven from
// the central state once per rendered frame. No game logic lives here;
// it only reflects state and forwards clicks to callbacks main.js
// supplies. The minimap is a 2D canvas redrawn from the same box list
// the simulation collides with.
import { DEFUSE_TIME, PLANT_TIME } from './config.js';
import { activeWeaponDef } from './player.js';
import { SITES } from './world.js';
import { BUY_ITEMS } from './rounds.js';

function el(id) {
  return document.getElementById(id);
}

export class Hud {
  constructor() {
    this.hitUntil = 0;
    this.bannerUntil = 0;
    this.lastBanner = '';
    this.minimap = null;
    this.mmCtx = null;
    this.colliders = [];
  }

  initMinimap(colliders) {
    this.colliders = colliders;
    this.minimap = el('minimap');
    if (this.minimap) this.mmCtx = this.minimap.getContext('2d');
  }

  bind(callbacks) {
    el('start-btn').addEventListener('click', () => callbacks.onStart());
    el('restart-btn').addEventListener('click', () => callbacks.onRestart());
    el('resume-btn').addEventListener('click', () => callbacks.onResume());
    el('mute-btn').addEventListener('click', () => callbacks.onMute());
    const buyList = el('buy-list');
    for (const item of BUY_ITEMS) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.innerHTML = `<span>${item.label}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => callbacks.onBuy(item.key));
      buyList.appendChild(row);
      item._row = row;
    }
  }

  showMenu(show) {
    el('menu').classList.toggle('hidden', !show);
  }

  showPause(show) {
    el('pause').classList.toggle('hidden', !show);
  }

  showMatchEnd(winner, score) {
    const m = el('match-end');
    m.classList.remove('hidden');
    el('match-title').textContent =
      winner === 'draw' ? 'Match drawn' : `${winner === 'vanguard' ? 'Vanguard' : 'Sentinel'} takes the match`;
    el('match-score').textContent = `${score.vanguard} — ${score.sentinel}`;
  }

  hideMatchEnd() {
    el('match-end').classList.add('hidden');
  }

  update(s, dt) {
    if (!s.fighters.length) return; // Menu: no match state to show yet.
    const p = s.fighters[s.playerId];
    // Crosshair spread: gap grows with movement bloom.
    const gap = 6 + Math.min(26, (p.spreadBloom * 400 + (p.onGround ? 0 : 10)));
    el('crosshair').style.setProperty('--gap', `${gap.toFixed(1)}px`);
    el('crosshair').classList.toggle('hidden', !p.alive || s.phase === 'menu');

    // Vitals.
    el('health-num').textContent = Math.max(0, Math.ceil(p.health));
    el('health-bar').style.width = `${Math.max(0, p.health)}%`;
    el('health-bar').classList.toggle('low', p.health <= 30);
    el('armor-num').textContent = Math.ceil(p.armor);
    el('armor-row').classList.toggle('hidden', p.armor <= 0);

    // Ammunition.
    const def = activeWeaponDef(p);
    const magKey = p.activeSlot === 0 ? 'primary' : 'secondary';
    el('ammo-mag').textContent = p.mag[magKey];
    el('ammo-reserve').textContent = p.reserve[magKey];
    el('weapon-name').textContent = def.name;
    el('reload-hint').classList.toggle('hidden', !(p.reloading > 0));
    el('grenade-he').textContent = `HE ${p.grenades.he}`;
    el('grenade-flash').textContent = `FL ${p.grenades.flash}`;
    el('charge-tag').classList.toggle('hidden', !p.hasCharge);

    // Money, timer, score.
    el('money').textContent = `$${p.money}`;
    const t = Math.max(0, Math.ceil(s.phaseTime));
    el('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    el('timer').classList.toggle('urgent', s.phase === 'live' && t <= 10);
    el('score-v').textContent = s.score.vanguard;
    el('score-s').textContent = s.score.sentinel;
    el('round-label').textContent = `ROUND ${s.round}`;
    el('alive-v').textContent = s.fighters.filter((f) => f.alive && f.team === 'vanguard').length;
    el('alive-s').textContent = s.fighters.filter((f) => f.alive && f.team === 'sentinel').length;

    // Bomb status.
    const bombBox = el('bomb-status');
    if (s.bomb.state === 'planted') {
      bombBox.classList.remove('hidden');
      bombBox.textContent = `CHARGE PLANTED — ${s.bomb.timer.toFixed(1)}s — SITE ${s.bomb.site}`;
      bombBox.classList.toggle('urgent', s.bomb.timer <= 10);
    } else if (s.bomb.state === 'carried' && p.hasCharge) {
      bombBox.classList.remove('hidden');
      bombBox.classList.remove('urgent');
      bombBox.textContent = 'YOU CARRY THE CHARGE — PLANT AT A OR B (HOLD E)';
    } else {
      bombBox.classList.add('hidden');
    }

    // Plant / defuse progress.
    const prog = el('progress-wrap');
    if (s.bomb.plantProgress > 0) {
      prog.classList.remove('hidden');
      el('progress-label').textContent = 'PLANTING';
      el('progress-bar').style.width = `${(s.bomb.plantProgress / PLANT_TIME) * 100}%`;
    } else if (s.bomb.defuseProgress > 0) {
      prog.classList.remove('hidden');
      el('progress-label').textContent = 'DEFUSING';
      el('progress-bar').style.width = `${(s.bomb.defuseProgress / DEFUSE_TIME) * 100}%`;
    } else {
      prog.classList.add('hidden');
    }

    // Killfeed.
    const feed = el('killfeed');
    const html = s.killfeed.map((k) =>
      `<div><b class="${k.head ? 'hs' : ''}">${escapeHtml(k.killer)}</b> ▸ ${escapeHtml(k.victim)}${k.head ? ' <span class="hs">HEADSHOT</span>' : ''}</div>`).join('');
    if (feed._html !== html) { feed.innerHTML = html; feed._html = html; }

    // Round banner.
    if (s.roundBanner !== this.lastBanner) {
      this.lastBanner = s.roundBanner;
      this.bannerUntil = s.time + 3;
      el('banner').textContent = s.roundBanner;
      el('banner').classList.remove('hidden');
    }
    if (s.time > this.bannerUntil) el('banner').classList.add('hidden');

    // Buy menu.
    el('buy-menu').classList.toggle('hidden', !s.buyOpen);
    if (s.buyOpen) {
      for (const item of BUY_ITEMS) {
        item._row.classList.toggle('poor', p.money < item.price);
      }
      el('buy-money').textContent = `$${p.money}`;
    }

    // Scoreboard.
    el('scoreboard').classList.toggle('hidden', !s.input.scoreboard);
    if (s.input.scoreboard) this.renderScoreboard(s);

    // Damage direction indicator.
    if (p.hurtDir >= 0) {
      const ind = el('dmg-dir');
      const rel = p.hurtDir - p.yaw;
      ind.style.transform = `rotate(${(-rel).toFixed(2)}rad)`;
      ind.classList.remove('hidden');
      clearTimeout(this._dmgTimer);
      this._dmgTimer = setTimeout(() => ind.classList.add('hidden'), 600);
      p.hurtDir = -1;
    }

    // Flash overlay.
    const flash = el('flash');
    if (s.time < p.flashUntil) {
      const left = p.flashUntil - s.time;
      flash.style.opacity = Math.min(1, left / 1.2).toFixed(2);
      flash.classList.remove('hidden');
    } else {
      flash.classList.add('hidden');
    }

    // Spectate / death overlay.
    el('dead-overlay').classList.toggle('hidden', p.alive || s.phase !== 'live');
    if (!p.alive) {
      el('dead-text').textContent = 'You are down — watching the round play out';
    }

    this.drawMinimap(s);
  }

  onHitmarker(head) {
    const m = el('hitmarker');
    m.classList.remove('hidden');
    m.classList.toggle('hs', head);
    clearTimeout(this._hmTimer);
    this._hmTimer = setTimeout(() => m.classList.add('hidden'), 120);
  }

  renderScoreboard(s) {
    const rows = [...s.fighters]
      .sort((a, b) => (a.team === b.team ? b.kills - a.kills : a.team === 'vanguard' ? -1 : 1))
      .map((f) => `<div class="sb-row ${f.team} ${f.isPlayer ? 'me' : ''} ${f.alive ? '' : 'dead'}">
        <span>${escapeHtml(f.name)}</span><span>${f.kills}</span><span>${f.deaths}</span><span>$${f.money}</span></div>`)
      .join('');
    el('sb-body').innerHTML = rows;
  }

  drawMinimap(s) {
    const g = this.mmCtx;
    if (!g) return;
    const W = 150, H = 120;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,24,32,0.72)';
    g.fillRect(0, 0, W, H);
    const sx = (x) => (x + 30) / 60 * W;
    const sz = (z) => (z + 24) / 48 * H;
    g.fillStyle = 'rgba(150,150,150,0.5)';
    for (const b of this.colliders) {
      g.fillRect(sx(b.x0), sz(b.z0), sx(b.x1) - sx(b.x0), sz(b.z1) - sz(b.z0));
    }
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    for (const key of ['A', 'B']) {
      const site = SITES[key];
      g.fillStyle = 'rgba(255,182,72,0.9)';
      g.fillText(key, sx((site.x0 + site.x1) / 2), sz((site.z0 + site.z1) / 2));
    }
    for (const f of s.fighters) {
      if (!f.alive) continue;
      g.fillStyle = f.team === 'vanguard' ? '#6fbf73' : '#e0704a';
      g.beginPath();
      g.arc(sx(f.pos.x), sz(f.pos.z), f.isPlayer ? 4 : 3, 0, Math.PI * 2);
      g.fill();
      if (f.isPlayer) {
        g.strokeStyle = '#fff';
        g.beginPath();
        g.moveTo(sx(f.pos.x), sz(f.pos.z));
        g.lineTo(sx(f.pos.x - Math.sin(f.yaw) * 4), sz(f.pos.z - Math.cos(f.yaw) * 4));
        g.stroke();
      }
    }
    if (s.bomb.state === 'planted' || s.bomb.state === 'dropped') {
      g.fillStyle = '#ffb648';
      g.fillRect(sx(s.bomb.pos.x) - 3, sz(s.bomb.pos.z) - 3, 6, 6);
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
