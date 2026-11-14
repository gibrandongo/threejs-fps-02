// BREACHLINE — effects: pooled tracers, impact sparks, muzzle flashes
// and explosions. Pools are allocated once at startup; the simulation
// never allocates in the hot loop, it only activates and retires items.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 400;
const MAX_FLASHES = 8;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // Tracers: one LineSegments geometry, segments toggled by alpha.
    this.tracers = [];
    const tracerMat = new THREE.LineBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false,
    });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerNext = 0;
    // Particles: one Points cloud, positions/velocities in flat arrays.
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setDrawRange(0, 0);
    const pMat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.pGeo, pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pNext = 0;
    this.pActive = 0;
    // Muzzle flashes: small additive sprites, one per fighter max.
    this.flashes = [];
    const flashTex = makeFlashTexture();
    for (let i = 0; i < MAX_FLASHES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: flashTex, color: 0xffc46a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(0.55, 0.55, 1);
      spr.visible = false;
      scene.add(spr);
      this.flashes.push({ spr, life: 0 });
    }
    this.flashNext = 0;
    // Explosion light, reused.
    this.boomLight = new THREE.PointLight(0xff9040, 0, 30, 1.6);
    scene.add(this.boomLight);
    this.boomLife = 0;
  }

  tracer(from, to, color) {
    const t = this.tracers[this.tracerNext];
    this.tracerNext = (this.tracerNext + 1) % MAX_TRACERS;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.07;
  }

  burst(x, y, z, count, color, speed, life, gravity) {
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.pVel[i * 3] = Math.cos(a) * Math.cos(e) * s;
      this.pVel[i * 3 + 1] = Math.sin(e) * s + speed * 0.35;
      this.pVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s;
      this.pLife[i] = life * (0.6 + Math.random() * 0.7);
      this.pMax[i] = this.pLife[i];
      this.pCol[i * 3] = r;
      this.pCol[i * 3 + 1] = g;
      this.pCol[i * 3 + 2] = b;
      this.pActive++;
    }
    this.pGeo.attributes.color.needsUpdate = true;
  }

  impact(x, y, z, nx, ny, nz) {
    this.burst(x, y, z, 6, 0xc9b48a, 2.6, 0.35, 9);
    this.burst(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, 3, 0xffd27a, 3.5, 0.12, 0);
  }

  blood(x, y, z) {
    this.burst(x, y, z, 10, 0xa02828, 2.2, 0.5, 9);
  }

  muzzle(x, y, z) {
    const f = this.flashes[this.flashNext];
    this.flashNext = (this.flashNext + 1) % MAX_FLASHES;
    f.spr.position.set(x, y, z);
    f.spr.material.rotation = Math.random() * Math.PI;
    f.spr.visible = true;
    f.life = 0.05;
  }

  explosion(x, y, z) {
    this.burst(x, y + 0.4, z, 60, 0xff7a30, 7, 0.7, 6);
    this.burst(x, y + 0.4, z, 40, 0x3a3a3a, 4, 1.1, 3);
    this.burst(x, y + 0.4, z, 25, 0xffd27a, 9, 0.4, 2);
    this.boomLight.position.set(x, y + 1.5, z);
    this.boomLight.intensity = 400;
    this.boomLife = 0.45;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.line.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
      else t.line.material.opacity = t.life / 0.07 * 0.9;
    }
    for (const f of this.flashes) {
      if (!f.spr.visible) continue;
      f.life -= dt;
      if (f.life <= 0) f.spr.visible = false;
    }
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      this.boomLight.intensity = Math.max(0, this.boomLife / 0.45) * 400;
      if (this.boomLife <= 0) this.boomLight.intensity = 0;
    }
    // Particles: integrate alive ones, compact by draw range trick —
    // dead particles are parked far below the map.
    let moved = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      moved = true;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -100;
        continue;
      }
      this.pVel[i * 3 + 1] -= 9 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.02) {
        this.pPos[i * 3 + 1] = 0.02;
        this.pVel[i * 3 + 1] = 0;
      }
    }
    if (moved) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.setDrawRange(0, MAX_PARTICLES);
    }
  }
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,220,1)');
  grad.addColorStop(0.35, 'rgba(255,200,110,0.9)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
