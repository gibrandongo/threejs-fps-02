// BREACHLINE — collision: axis-aligned boxes only. The map is built from
// boxes, fighters are vertical capsules approximated as XZ circles, and
// line-of-sight is a segment-vs-box slab test. No allocations in the
// hot paths: callers pass scratch objects.

// A collider: {x0, z0, x1, z1, y0, y1}. y0 is usually 0 (floor), y1 the
// top of the wall or crate. Fighters collide in XZ when their vertical
// span overlaps the box's.
export function makeBox(x0, z0, x1, z1, y0, y1) {
  return { x0, z0, x1, z1, y0, y1 };
}

// Move a circle (centre px/pz, radius r, feet at py, height h) by (dx, dz)
// against the boxes, sliding along walls. Returns the corrected position
// in out {x, z}. Axis-separated: X first, then Z.
export function moveCircle(boxes, px, pz, py, h, r, dx, dz, out) {
  let x = px + dx;
  let z = pz;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (py + h <= b.y0 || py >= b.y1) continue;
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) {
      if (dx > 0) x = b.x0 - r; else if (dx < 0) x = b.x1 + r;
    }
  }
  z = pz + dz;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (py + h <= b.y0 || py >= b.y1) continue;
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) {
      if (dz > 0) z = b.z0 - r; else if (dz < 0) z = b.z1 + r;
    }
  }
  out.x = x;
  out.z = z;
}

// Segment vs one box, slab method. Returns the hit fraction t in [0,1]
// or -1 when the segment misses. outN receives the face normal.
export function segmentBox(ax, ay, az, bx, by, bz, box, outN) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let tmin = 0, tmax = 1, axis = -1, sign = 0;
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (ax < box.x0 || ax > box.x1) return -1;
  } else {
    let t1 = (box.x0 - ax) / dx, t2 = (box.x1 - ax) / dx, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y slab (box.y0/y1)
  if (Math.abs(dy) < 1e-9) {
    if (ay < box.y0 || ay > box.y1) return -1;
  } else {
    let t1 = (box.y0 - ay) / dy, t2 = (box.y1 - ay) / dy, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (az < box.z0 || az > box.z1) return -1;
  } else {
    let t1 = (box.z0 - az) / dz, t2 = (box.z1 - az) / dz, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (outN) {
    outN.x = axis === 0 ? sign : 0;
    outN.y = axis === 1 ? sign : 0;
    outN.z = axis === 2 ? sign : 0;
  }
  return tmin;
}

// True when the segment from A to B is not blocked by any box.
export function lineOfSight(boxes, ax, ay, az, bx, by, bz) {
  for (let i = 0; i < boxes.length; i++) {
    if (segmentBox(ax, ay, az, bx, by, bz, boxes[i], null) >= 0) return false;
  }
  return true;
}

// Closest box hit along the segment; returns t in [0,1] or -1, and
// writes the face normal into outN and the hit point into outP.
export function raycastBoxes(boxes, ox, oy, oz, dx, dy, dz, maxT, outN, outP) {
  let best = -1;
  const n = { x: 0, y: 0, z: 0 };
  const bx = ox + dx * maxT, by = oy + dy * maxT, bz = oz + dz * maxT;
  for (let i = 0; i < boxes.length; i++) {
    const t = segmentBox(ox, oy, oz, bx, by, bz, boxes[i], n);
    if (t >= 0 && (best < 0 || t < best)) {
      best = t;
      outN.x = n.x; outN.y = n.y; outN.z = n.z;
    }
  }
  if (best >= 0 && outP) {
    outP.x = ox + dx * maxT * best;
    outP.y = oy + dy * maxT * best;
    outP.z = oz + dz * maxT * best;
  }
  return best < 0 ? -1 : best * maxT;
}

// Segment vs sphere (for headshots): returns distance along the ray or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  if (t < 0 || t > maxT) return -1;
  return t;
}

// Ray vs a vertical cylinder (body hitbox): returns distance or -1.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1, maxT) {
  // Solve in XZ, then check the Y span.
  const lx = ox - cx, lz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    // Ray parallel to the cylinder axis: inside the XZ circle?
    if (lx * lx + lz * lz > r * r) return -1;
    const t0 = (y0 - oy) / dy, t1 = (y1 - oy) / dy;
    const t = Math.min(t0, t1);
    return t >= 0 && t <= maxT ? t : -1;
  }
  const b = 2 * (lx * dx + lz * dz);
  const c = lx * lx + lz * lz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0 || t > maxT) return -1;
  const y = oy + dy * t;
  if (y < y0 || y > y1) return -1;
  return t;
}
