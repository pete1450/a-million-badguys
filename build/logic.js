/* ============================================================================
 * CROWD CONTROL — pure game logic (no DOM, no THREE). Runs in node for tests.
 *
 * Indexed units (level authoring, 0..99) scale to world units (x0.5) so the
 * physical playfield stays 50 wide while lanes get denser.
 *
 * The player's mob (you + recruited troops) slides side-to-side along x.
 * Everything the mob shoots flies straight ahead (-z). Line up with a lane to
 * kill its enemies, or line up with a bridge column to drop the bridge.
 * Destroyed bridges release glowing pickup squares that drift down toward the
 * mob; touching one adds its value to the squad. Every bullet does 1 damage.
 *
 * LEVEL SCHEMA (JSON):
 * {
 *   "name": "Bridge Choice",
 *   "width": 100,             // playfield columns 0 .. width-1 (indexed; x0.5 to world)
 *   "depth": 88,              // z extent; enemies spawn at z=2, mob at z=depth-4
 *   "player": { "at": 25, "hp": 150, "fireRate": 4, "bulletDamage": 1,
 *               "bulletSpeed": 46, "troopRate": 1.0, "mobSpeed": 20, "pierce": 0 },
 *   "modules": [
 *     // Enemy wave: one emitter per index in [from..to] (or single "at").
 *     // "count" is the TOTAL for the module, split across its emitters.
 *     // Each emitter spawns every 1/perSecond and stops when its counter hits 0.
 *     { "type": "enemy", "kind": "base", "from": 14, "to": 35,
 *       "perSecond": 1.0, "count": 1000, "hp": 1, "speed": 1.7, "damage": 1 },
 *     { "type": "enemy", "kind": "big", "at": 22,
 *       "perSecond": 0.016, "count": 2, "hp": 300, "speed": 0.55, "damage": 25 },
 *     // Separation wall at one column.
 *     { "type": "wall", "at": 13 },
 *     // Viaduct: elevated deck over [from..to] held by a shootable column.
 *     // "shots" = bullet hits to destroy the column (the "2" in the ad).
 *     // contents = pickup emitters, BLOCKED until column down.
 *     // "lines" = number of single-file pickup lines across the deck (ad: 1).
 *     // deckZ0/deckZ1 = deck span (default 4 .. depth-24); the pillar stands
 *     // just off the deck's near end.
 *     { "type": "viaduct", "from": 0, "to": 11, "shots": 2,
 *       "contents": { "kind": "pickup", "value": 1, "perSecond": 1,
 *                     "count": 120, "speed": 3.0, "lines": 1 } },
 *   ]
 * }
 * ========================================================================== */
'use strict';

// Indexed (level-authoring) units scale to world units: 100 lanes -> 50 wide.
const IDX2W = 0.5;

function indicesOf(m) {
  if (m.at !== undefined && m.at !== null) return [m.at | 0];
  const a = m.from | 0;
  const b = (m.to !== undefined && m.to !== null) ? m.to | 0 : a;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

// Split `count` into `n` integer shares summing to count (remainder -> first).
function distribute(count, n) {
  count = Math.max(0, count | 0);
  n = Math.max(1, n | 0);
  const base = Math.floor(count / n), rem = count % n;
  const out = new Array(n).fill(base);
  for (let i = 0; i < rem; i++) out[i]++;
  return out;
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

let _eid = 1;
function nextId() { return _eid++; }

// Dense organized rings around the main troop (troop 0 at center).
// Ring k (k>=1) sits at radius k*RING_GAP with as many troops as fit
// at ARC_PER_TROOP spacing. Fixed geometry — not squad-scaled.
const RING_GAP = 0.85;
const ARC_PER_TROOP = 0.8;
function ringCount(k) {
  return Math.max(3, Math.floor(2 * Math.PI * k * RING_GAP / ARC_PER_TROOP));
}
// cumulative troops up to and including ring k (ring 0 = the center troop)
function ringCumulative(k) {
  let n = 1;
  for (let j = 1; j <= k; j++) n += ringCount(j);
  return n;
}
// half-width of the mob's firing line / pickup collection: outer ring radius
function mobHalfWidth(squad) {
  const n = Math.max(1, squad | 0);
  let k = 0;
  while (ringCumulative(k) < n && k < 60) k++;
  return k * RING_GAP + 0.5;
}
// formation slot for soldier i (shared with the renderer).
// Slots repeat every 60; extra soldiers stack on the same slots.
function soldierOffset(squad, i, concentrated) {
  if (i === 0) return { dx: 0, dz: 0 };
  let n = i; // 1-based among ring troops
  let k = 1;
  while (k < 60) {
    const count = ringCount(k);
    if (n <= count) {
      const ang = (n - 1) / count * Math.PI * 2;
      const r = k * RING_GAP;
      let dx = Math.cos(ang) * r, dz = Math.sin(ang) * r;
      if (concentrated) { dx *= 0.35; dz *= 1.8; } // narrow ellipse: shots line up
      return { dx: dx, dz: dz };
    }
    n -= count;
    k++;
  }
  return { dx: 0, dz: 0 };
}

function parseLevel(def) {
  const L = {
    name: def.name || 'Level',
    width: (def.width || 100) * IDX2W,   // physical world width stays 50
    depth: def.depth || 44,
    player: Object.assign(
      { at: 50, hp: 150, fireRate: 4, bulletDamage: 1, bulletSpeed: 46, troopRate: 1.0, mobSpeed: 20, pierce: 0 },
      def.player || {}),
    emitters: [],
    walls: [],
    viaducts: [],
    totalEnemies: 0,
  };
  L.player.at = (L.player.at !== undefined ? L.player.at : 50) * IDX2W;
  for (const m of def.modules || []) {
    if (m.type === 'enemy') {
      const idx = indicesOf(m);
      const shares = distribute(m.count || 0, idx.length);
      idx.forEach((x, i) => {
        L.emitters.push({
          id: nextId(), kind: 'enemy', x: (x + 0.5) * IDX2W, z: 2,
          interval: 1 / (m.perSecond || 1),
          remaining: shares[i], timer: 0,
          params: {
            kind: m.kind || 'base',
            hp: (m.hp !== undefined) ? m.hp : 1,
            speed: (m.speed !== undefined) ? m.speed : 1.7,
            damage: (m.damage !== undefined) ? m.damage : 1,
            healthbar: (m.healthbar === true),
          },
        });
      });
      L.totalEnemies += (m.count | 0);
    } else if (m.type === 'wall') {
      // Three forms:
      //   {at: 26}                    -> vertical wall at lane 26, z 2..depth-14
      //   {from: [x,z], to: [x,z]}    -> wall segment ([indexed x, world z]), any size/angle
      //   + destructible: true, hp: N  -> shootable; cracks + HP counter; removed at 0
      const dw = {
        destructible: !!m.destructible,
        hp: m.hp || 5, maxHp: m.hp || 5,
        destroyed: false,
        mirror: !!m.mirror, // bullet mirror: bounces bullets (reflects angle of incidence)
      };
      if (Array.isArray(m.from) && Array.isArray(m.to)) {
        L.walls.push(Object.assign({
          x1: m.from[0] * IDX2W, z1: m.from[1],
          x2: m.to[0] * IDX2W, z2: m.to[1],
        }, dw));
      } else {
        const x = (m.at | 0) * IDX2W;
        L.walls.push(Object.assign({ x1: x, z1: 2, x2: x, z2: L.depth - 14 }, dw));
      }
    } else if (m.type === 'boulder') {
      // {at: [indexedX, z], angle: 0-359, delay, speed, ramp, blocker: {hp}}
      // angle: 0=north(-z), 90=east(+x), 180=south(+z), 270=west(-x), clockwise.
      // If blocker is set, the boulder waits perched on its ramp until the
      // destructible cube in front is destroyed; otherwise released after delay.
      const bx = m.at[0] * IDX2W, bz = m.at[1];
      const angRad = ((m.angle !== undefined ? m.angle : 0) * Math.PI) / 180;
      const dx = Math.sin(angRad), dz = -Math.cos(angRad); // 0=north(-z)
      if (!L.boulders) L.boulders = [];
      const bd = {
        id: nextId(),
        x: bx, z: bz,
        dx: dx, dz: dz,
        r: 2.5, speed: m.speed || 13, // 2x size
        state: 'waiting', waitT: m.delay !== undefined ? m.delay : 2.0,
        crumbleT: 0, rollA: 0,
        ramp: !!m.ramp,
        blocker: null,
        distTraveled: 0, // accumulates while rolling
        clearDist: 0,    // walls ignored until traveled past this (for inset traps)
      };
      if (m.blocker) {
        const bhp = m.blocker.hp || 3;
        // cube sits in front of the boulder, in the facing direction
        // (blocker is 4.8^3, half=2.4)
        const gap = 0.6;
        const blockDist = bd.r + 2.4 + gap;
        bd.blocker = {
          x: bx + dx * blockDist,
          z: bz + dz * blockDist,
          hp: bhp, maxHp: bhp, destroyed: false,
        };
        // ignore walls until the boulder is past the blocker location,
        // so the trap can be inset into a wall without instant collision
        bd.clearDist = blockDist + bd.r;
        bd.state = 'blocked'; // waits for the cube to be destroyed
      }
      L.boulders.push(bd);
    } else if (m.type === 'viaduct') {
      const idx = indicesOf(m);
      const fromI = Math.min(m.from | 0, (m.to !== undefined ? m.to | 0 : m.from | 0));
      const toI = Math.max(m.from | 0, (m.to !== undefined ? m.to | 0 : m.from | 0));
      const from = fromI * IDX2W, to = (toI + 1) * IDX2W;
      const deckZ0 = (m.deckZ0 !== undefined) ? m.deckZ0 : 4;
      const deckZ1 = (m.deckZ1 !== undefined) ? m.deckZ1 : L.depth - 24;
      const v = {
        id: nextId(),
        from, to,
        cx: (from + to) / 2,                // world x of deck/column center
        shots: (m.shots !== undefined) ? m.shots : 3,
        shotsLeft: (m.shots !== undefined) ? m.shots : 3,
        destroyed: false,
        deckZ0, deckZ1,
        colZ: deckZ1 + 1.5,   // pillar stands just off the deck's near end
        color: (m.color !== undefined) ? m.color : 0x2b6fd9,
        contents: m.contents || { kind: 'pickup', value: 1, speed: 3.0 },
        bannersReleased: false,
        banners: [],
      };
      // banners ARE the pickups: pre-placed in a line on the deck, released
      // (start drifting toward the mob) when the column is destroyed.
      // They never run out: new ones keep spawning at the back until game over.
      // Spacing = speed / perSecond, so the pre-placed line matches the
      // steady-state flow of spawned ones.
      const bval = (v.contents.value !== undefined) ? v.contents.value : 1;
      const bspd = (v.contents.speed !== undefined) ? v.contents.speed : 3.0;
      const brate = (v.contents.perSecond !== undefined) ? v.contents.perSecond : 1 / 3;
      v.bannerValue = bval;
      v.bannerSpeed = bspd;
      v.bannerRate = brate;
      v.bannerTimer = 0;
      const bspacing = bspd / brate;
      for (let bz = deckZ0 + 2; bz < deckZ1; bz += bspacing) {
        v.banners.push({
          id: nextId(), x: v.cx, z: bz,
          value: bval, speed: bspd, color: v.color,
          collected: false,
        });
      }
      L.viaducts.push(v);
    }
  }
  return L;
}

function createGame(def) {
  const level = parseLevel(def);
  const px = level.player.at + 0.5;
  return {
    level,
    time: 0,
    status: 'playing',           // 'playing' | 'won' | 'lost'
    enemies: [],                 // {id,x,z,hp,maxHp,speed,damage,kind,phase,dead}
    pickups: [],                 // {id,x,z,value,speed,color}
    bullets: [],                 // {id,x,y,z,speed,damage} — fly straight -z
    squad: 0,
    mobX: px,
    targetX: px,
    // per-troop firing clocks: each formation slot fires at troopRate with its
    // own random phase offset, so the combined spray isn't metronomic.
    slotPhase: Array.from({ length: 60 }, () => Math.random()),
    slotNext: new Array(60).fill(0),
    concentrated: false,
    player: {
      x: px, z: level.depth - 4,
      hp: level.player.hp, maxHp: level.player.hp,
      fireTimer: 0,
    },
    events: [],
    stats: { spawned: 0, killed: 0, leaked: 0, pickupsGot: 0, pickupCount: 0, columnsDown: 0, bulletsFired: 0 },
  };
}

function viaductById(level, id) {
  for (const v of level.viaducts) if (v.id === id) return v;
  return null;
}

function emitterBlocked(level, e) {
  if (e.kind !== 'pickup') return false;
  const v = viaductById(level, e.viaductId);
  return !v || !v.destroyed;
}

function enemiesRemaining(S) {
  let n = S.enemies.length;
  for (const e of S.level.emitters) if (e.kind === 'enemy') n += e.remaining;
  return n;
}

function enemyRadius(e) { return e.kind === 'big' ? 0.58 : 0.26; } // head-sized, no compression

// does a bullet's swept path (bx, zPrev -> zNew) hit a wall segment?
// walls are solid: hit → damage if destructible, bullet always disappears.
// Uses a generous radius so bullets die at the front edge, well before they
// could reach enemies pressed against the far side.
function bulletHitsWall(xPrev, zPrev, xNew, zNew, wl) {
  // Swept: does segment (xPrev,zPrev)->(xNew,zNew) come within R of wall segment?
  const R = 0.9; // generous: wall half-thickness (0.4) + margin
  // Quick AABB reject
  const minX = Math.min(wl.x1, wl.x2) - R, maxX = Math.max(wl.x1, wl.x2) + R;
  const minZ = Math.min(wl.z1, wl.z2) - R, maxZ = Math.max(wl.z1, wl.z2) + R;
  if (Math.max(xPrev, xNew) < minX || Math.min(xPrev, xNew) > maxX) return false;
  if (Math.max(zPrev, zNew) < minZ || Math.min(zPrev, zNew) > maxZ) return false;
  // Distance from segment to segment (2D)
  const sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
  const bx = xNew - xPrev, bz = zNew - zPrev;
  // Closest point on wall segment to bullet start
  const wlen2 = sx * sx + sz * sz;
  let t = wlen2 > 1e-9 ? ((xPrev - wl.x1) * sx + (zPrev - wl.z1) * sz) / wlen2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = wl.x1 + sx * t, cz = wl.z1 + sz * t;
  // If start is within R, hit
  if (Math.hypot(xPrev - cx, zPrev - cz) <= R) return true;
  // Otherwise check if the bullet segment crosses within R of the wall
  // (sample the closest approach)
  const blen2 = bx * bx + bz * bz;
  if (blen2 < 1e-9) return false;
  // Project wall closest point onto bullet segment
  let u = ((cx - xPrev) * bx + (cz - zPrev) * bz) / blen2;
  u = Math.max(0, Math.min(1, u));
  const px = xPrev + bx * u, pz = zPrev + bz * u;
  return Math.hypot(px - cx, pz - cz) <= R;
}

function updateGame(S, dt, input) {
  S.events.length = 0;
  if (S.status !== 'playing') return;
  if (dt <= 0) return;
  S.time += dt;
  const P = S.level.player;
  const halfW = mobHalfWidth(S.squad);

  // ---- mob movement: direct 1:1 with the pointer (no speed lag) ----
  if (input && input.targetX !== undefined && input.targetX !== null) {
    S.targetX = clamp(input.targetX, 2.5, S.level.width - 2.5);
  }
  S.mobX = S.targetX;
  S.player.x = S.mobX;

  // ---- emitters ----
  for (const e of S.level.emitters) {
    if (e.remaining <= 0) continue;
    if (emitterBlocked(S.level, e)) continue;   // blocked: timer frozen, nothing feeds out
    e.timer -= dt;
    let guard = 0;
    while (e.timer <= 0 && e.remaining > 0 && guard++ < 64) {
      if (e.kind === 'enemy') {
        // don't emit into an occupied space: wait until it clears
        let occupied = false;
        for (const o of S.enemies) {
          const dx = o.x - e.x, dz = o.z - e.z;
          if (dx * dx + dz * dz < 1.0) { occupied = true; break; }
        }
        if (occupied) break;
      }
      e.remaining--;
      e.timer += e.interval;
      if (e.kind === 'enemy') {
        const en = {
          id: nextId(), x: e.x, z: e.z,
          hp: e.params.hp, maxHp: e.params.hp,
          speed: e.params.speed, damage: e.params.damage,
          kind: e.params.kind, phase: Math.random() * 6.28, dead: false,
          healthbar: e.params.healthbar || false,
        };
        S.enemies.push(en);
        S.stats.spawned++;
        S.events.push({ t: 'enemySpawn', id: en.id, kind: en.kind, x: en.x, z: en.z });
      } else {
        const pk = {
          id: nextId(), x: e.x, z: e.z + 1.5,
          value: e.params.value, speed: e.params.speed, color: e.params.color,
        };
        S.pickups.push(pk);
        S.events.push({ t: 'pickupSpawn', id: pk.id, x: pk.x, z: pk.z, value: pk.value });
      }
    }
  }

  // ---- the mob fires straight ahead (-z) ----
  // The player fires at fireRate; every troop fires at troopRate (1 shot/s
  // each, so N troops = N shots/s) on its own clock with a random phase
  // offset per formation slot — the spray pattern stays random.
  S.player.fireTimer -= dt;
  let fguard = 0;
  while (S.player.fireTimer <= 0 && P.fireRate > 0 && fguard++ < 16) {
    S.player.fireTimer += 1 / P.fireRate;
    S.bullets.push({
      id: nextId(),
      x: S.mobX, y: 1.2, z: S.player.z - 0.8,
      dx: 0, dz: -1, // direction (unit); mirrors can change this
      speed: P.bulletSpeed, damage: P.bulletDamage, pierce: P.pierce,
    });
    S.stats.bulletsFired++;
  }
  {
    const activeSlots = Math.min(S.squad, 60);
    const perSlotInterval = activeSlots > 0 ? activeSlots / (S.squad * P.troopRate) : 1;
    for (let s = 0; s < activeSlots; s++) {
      if (!(S.slotNext[s] > 0)) S.slotNext[s] = S.time + S.slotPhase[s] * perSlotInterval;
      let g = 0;
      while (S.time >= S.slotNext[s] && g++ < 8) {
        const o = soldierOffset(S.squad, s, S.concentrated);
        S.bullets.push({
          id: nextId(),
          x: S.mobX + o.dx, y: 1.2, z: S.player.z + o.dz - 0.8,
          dx: 0, dz: -1,
          speed: P.bulletSpeed, damage: P.bulletDamage, pierce: P.pierce,
        });
        S.stats.bulletsFired++;
        S.slotNext[s] += perSlotInterval;
      }
    }
    // deactivated slots get a fresh random offset when the squad grows back
    for (let s = activeSlots; s < 60; s++) S.slotNext[s] = 0;
  }

  // ---- boulders: released in facing dir, crush enemies (no budget) until
  // hitting anything non-enemy (wall, column, bounds, mob), then crumble ----
  if (S.level.boulders) {
    for (const bd of S.level.boulders) {
      if (bd.state === 'blocked') {
        // perched on ramp, waiting for the blocker cube to be destroyed
        // (released by bullet logic when blocker.hp hits 0)
      } else if (bd.state === 'waiting') {
        bd.waitT -= dt;
        if (bd.waitT <= 0) { bd.state = 'rolling'; S.events.push({ t: 'boulderRoll', id: bd.id, x: bd.x, z: bd.z }); }
      } else if (bd.state === 'rolling') {
        const nx = bd.x + bd.dx * bd.speed * dt;
        const nz = bd.z + bd.dz * bd.speed * dt;
        bd.rollA += (bd.speed * dt) / bd.r; // rolling rotation
        bd.distTraveled += bd.speed * dt;
        let hitSolid = false;
        // walls (skip destroyed; also skip until past the blocker location so
        // inset traps don't instantly collide with the wall they're in)
        const wallsArmed = bd.distTraveled >= bd.clearDist;
        for (const wl of S.level.walls) {
          if (wl.destroyed) continue;
          if (!wallsArmed) continue;
          const sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
          const l2 = sx * sx + sz * sz;
          let t = l2 > 1e-9 ? ((nx - wl.x1) * sx + (nz - wl.z1) * sz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = wl.x1 + sx * t, cz = wl.z1 + sz * t;
          if (Math.hypot(nx - cx, nz - cz) < bd.r + 0.4) { hitSolid = true; break; }
        }
        // viaduct columns (standing ones)
        if (!hitSolid) for (const v of S.level.viaducts) {
          if (v.destroyed) continue;
          if (Math.hypot(nx - v.cx, nz - v.colZ) < bd.r + 0.9) { hitSolid = true; break; }
        }
        // map bounds (level.width/depth are already world units)
        if (nx < bd.r || nx > S.level.width - bd.r || nz < bd.r || nz > S.level.depth - bd.r) hitSolid = true;
        // player mob (don't crush the player, just stop)
        if (Math.hypot(nx - S.mobX, nz - S.player.z) < bd.r + 0.9) hitSolid = true;
        if (hitSolid) {
          bd.state = 'crumbling'; bd.crumbleT = 0.9;
          S.events.push({ t: 'boulderStop', id: bd.id, x: bd.x, z: bd.z });
        } else {
          bd.x = nx; bd.z = nz;
          // crush: no kill budget, instant kill on contact
          for (const e of S.enemies) {
            if (e.dead) continue;
            const er = e.kind === 'big' ? 0.58 : 0.26;
            if (Math.hypot(e.x - bd.x, e.z - bd.z) < bd.r + er) {
              e.hp = 0; e.dead = true;
              S.events.push({ t: 'enemyDie', id: e.id, kind: e.kind, x: e.x, z: e.z, crushed: true });
              S.stats.killed++;
            }
          }
        }
      } else if (bd.state === 'crumbling') {
        bd.crumbleT -= dt;
        if (bd.crumbleT <= 0) bd.state = 'gone';
        else if (Math.random() < 0.6) S.events.push({ t: 'boulderCrumble', id: bd.id, x: bd.x, z: bd.z });
      }
    }
    S.level.boulders = S.level.boulders.filter(bd => bd.state !== 'gone');
  }

  // ---- bullets fly straight, hit first thing in their lane ----
  // lane buckets: enemies sit at integer lane centers, bullets fly straight,
  // so each bullet only needs to check its own lane +/-1.
  const laneMap = new Map();
  for (const e of S.enemies) {
    if (e.dead) continue;
    const li = Math.floor(e.x);
    let arr = laneMap.get(li);
    if (!arr) { arr = []; laneMap.set(li, arr); }
    arr.push(e);
  }
  const deadBullets = new Set();
  for (const b of S.bullets) {
    const xPrev = b.x, zPrev = b.z;
    b.x += b.dx * b.speed * dt;
    b.z += b.dz * b.speed * dt;
    // out of bounds: die
    if (b.x < -2 || b.x > S.level.width + 2 || b.z < -2 || b.z > S.level.depth + 2) {
      deadBullets.add(b); continue;
    }
    // walls: mirror walls bounce the bullet (reflect angle of incidence);
    // destructible walls take damage; others kill the bullet.
    let hitWall = false;
    for (const wl of S.level.walls) {
      if (wl.destroyed) continue;
      if (bulletHitsWall(xPrev, zPrev, b.x, b.z, wl)) {
        if (wl.mirror) {
          // reflect: r = d - 2*(d·n)*n
          const sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
          const sl = Math.hypot(sx, sz) || 1;
          let nx = -sz / sl, nz = sx / sl;
          let dot = b.dx * nx + b.dz * nz;
          // The normal's sign depends on endpoint order; flip it so it faces
          // the incoming bullet (dot<0). Reflection is identical for n/-n.
          if (dot > 0) { nx = -nx; nz = -nz; dot = -dot; }
          // Only bounce if moving INTO the wall (dot<0). If dot>=0 the bullet
          // is already leaving — a stale overlap from the last bounce — so
          // ignore it instead of reflecting back into the wall.
          if (dot < -1e-6) {
            b.dx -= 2 * dot * nx; b.dz -= 2 * dot * nz;
            const rl = Math.hypot(b.dx, b.dz) || 1;
            b.dx /= rl; b.dz /= rl;
            // push fully out of the collision radius (R=0.9) so we don't re-hit
            b.x += b.dx * 1.1; b.z += b.dz * 1.1;
            S.events.push({ t: 'mirrorBounce', x: b.x, z: b.z });
          }
        } else {
          hitWall = true;
          if (wl.destructible) {
            wl.hp -= b.damage;
            S.events.push({ t: 'wallHit', x: b.x, z: b.z, hpLeft: Math.max(0, wl.hp) });
            if (wl.hp <= 0 && !wl.destroyed) {
              wl.destroyed = true;
              S.events.push({ t: 'wallDown', x: (wl.x1 + wl.x2) / 2, z: (wl.z1 + wl.z2) / 2 });
            }
          }
        }
        break;
      }
    }
    if (hitWall) { deadBullets.add(b); continue; }
    // nearest living enemy in this lane at/below the bullet
    // (wall-aware: skip enemies on the far side of a wall segment from the bullet,
    //  so diagonal walls can't be shot through via the axis-aligned hit box)
    let hit = null;
    const bl = Math.floor(b.x);
    for (let li = bl - 1; li <= bl + 1; li++) {
      const arr = laneMap.get(li);
      if (!arr) continue;
      for (const e of arr) {
        if (e.dead) continue;
        if (Math.abs(e.x - b.x) < 0.55 && e.z <= b.z + 0.4 && e.z >= b.z - 1.6) {
          if (!hit || e.z > hit.z) {
            // check: is a wall segment between bullet (b.x,b.z) and enemy (e.x,e.z)?
            let blocked = false;
            for (const wl of S.level.walls) {
              if (wl.destroyed) continue;
              const wdx = wl.x2 - wl.x1, wdz = wl.z2 - wl.z1;
              const wlen2 = wdx * wdx + wdz * wdz;
              if (wlen2 < 1e-9) continue;
              // signed distances of bullet and enemy from the wall line
              const db = (wdx * (wl.z1 - b.z) - wdz * (wl.x1 - b.x)) / Math.sqrt(wlen2);
              const de = (wdx * (wl.z1 - e.z) - wdz * (wl.x1 - e.x)) / Math.sqrt(wlen2);
              // opposite sides and within the wall's thickness band?
              if (db * de < 0 && Math.abs(db) < 1.2 && Math.abs(de) < 1.2) {
                // also require the crossing to be within the segment bounds
                const t = ((b.x - wl.x1) * wdx + (b.z - wl.z1) * wdz) / wlen2;
                if (t > -0.1 && t < 1.1) { blocked = true; break; }
              }
            }
            if (!blocked) hit = e;
          }
        }
      }
    }
    if (hit) {
      hit.hp -= b.damage;
      if (hit.hp <= 0 && !hit.dead) {
        hit.dead = true;
        S.events.push({ t: 'enemyDie', id: hit.id, kind: hit.kind, x: hit.x, z: hit.z });
        S.stats.killed++;
      }
      if (b.pierce > 0) { b.pierce--; }   // punch through, keep flying
      else deadBullets.add(b);
      continue;
    }
    // columns (pillars stand just off the deck's near end)
    for (const v of S.level.viaducts) {
      if (v.destroyed) continue;
      if (Math.abs(b.x - v.cx) < 1.1 && Math.abs(b.z - v.colZ) < 1.3) {
        v.shotsLeft--;
        S.events.push({ t: 'columnHit', id: v.id, shotsLeft: v.shotsLeft, x: v.cx, z: v.colZ });
        if (v.shotsLeft <= 0) {
          v.destroyed = true;
          v.bannersReleased = true;   // banners start drifting toward the mob
          S.stats.columnsDown++;
          S.events.push({ t: 'columnDown', id: v.id, x: v.cx, z: v.colZ });
        }
        deadBullets.add(b);
        break;
      }
    }
    if (deadBullets.has(b)) continue;
    // boulder blocker cubes (destructible; destroying releases the boulder)
    if (S.level.boulders) for (const bd of S.level.boulders) {
      const bk = bd.blocker;
      if (!bk || bk.destroyed) continue;
      if (Math.abs(b.x - bk.x) < 2.6 && Math.abs(b.z - bk.z) < 2.6) {
        bk.hp--;
        S.events.push({ t: 'blockerHit', id: bd.id, hpLeft: bk.hp, x: bk.x, z: bk.z });
        if (bk.hp <= 0) {
          bk.destroyed = true;
          bd.state = 'rolling'; // released!
          S.events.push({ t: 'boulderRoll', id: bd.id, x: bd.x, z: bd.z });
          S.events.push({ t: 'blockerDown', id: bd.id, x: bk.x, z: bk.z });
        }
        deadBullets.add(b);
        break;
      }
    }
    if (b.z < 1) deadBullets.add(b);
  }
  if (deadBullets.size) S.bullets = S.bullets.filter(b => !deadBullets.has(b));
  S.enemies = S.enemies.filter(e => !e.dead);

  // ---- enemies march (with cheap crowd physics) ----
  // Separation via spatial hash so the crowd fills available space; wall
  // segments push back along their normal (enemies slide along them); a
  // blocked enemy slows to a stop so funnels form a natural backup queue.
  const leaked = [];
  // save start-of-frame positions for the anti-tunnel check
  for (const e of S.enemies) { e._sx = e.x; e._sz = e.z; }
  {
    const CELL = 1.6;
    const grid = new Map();
    const bin = () => {
      grid.clear();
      for (const e of S.enemies) {
        e._gx = Math.floor(e.x / CELL); e._gz = Math.floor(e.z / CELL);
        const k = e._gx * 128 + e._gz;
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(e);
      }
    };
    bin();
    // pass 1: soft separation + wall forces
    for (const e of S.enemies) {
      const r1 = enemyRadius(e);
      let fx = 0, fz = 0, nn = 0;
      outer: for (let gx = e._gx - 1; gx <= e._gx + 1; gx++) {
        for (let gz = e._gz - 1; gz <= e._gz + 1; gz++) {
          const arr = grid.get(gx * 128 + gz);
          if (!arr) continue;
          for (const n of arr) {
            if (n === e) continue;
            if (++nn > 24) break outer; // cap: dense piles stay cheap
            const rr = r1 + enemyRadius(n);
            const dx = e.x - n.x, dz = e.z - n.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < rr * rr && d2 > 1e-8) {
              const d = Math.sqrt(d2);
              const push = (rr - d) / rr * 3.2;
              fx += dx / d * push; fz += dz / d * push;
            }
          }
        }
      }
      // walls: segments (vertical or angled); push out along the normal so
      // the crowd slides along them
      for (const wl of S.level.walls) {
        if (wl.destroyed) continue; // rubble: no avoidance force
        const sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
        const len2 = sx * sx + sz * sz;
        let t = len2 > 1e-8 ? ((e.x - wl.x1) * sx + (e.z - wl.z1) * sz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = e.x - (wl.x1 + sx * t), dz = e.z - (wl.z1 + sz * t);
        const rr = r1 + 0.4; // enemy radius + wall half-thickness
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (rr - d) / rr * 6.0;
          fx += dx / d * push; fz += dz / d * push;
        }
      }
      const vx = Math.max(-2.5, Math.min(2.5, fx));
      const vz = Math.max(0, Math.min(e.speed, e.speed + fz));
      e.x = Math.max(0.5, Math.min(S.level.width - 0.5, e.x + vx * dt));
      e.z += vz * dt;
    }
    // hard wall constraint: project any enemy inside a wall back out to the
    // surface. Shared by pass 2 and pass 4. Iterates to settle corners where
    // two walls are close together. Boulders and blocker cubes are solid too.
    const constrainWalls = () => {
      for (let witer = 0; witer < 3; witer++) {
        let fixed = false;
        for (const e of S.enemies) {
          const r1 = enemyRadius(e);
          for (const wl of S.level.walls) {
            if (wl.destroyed) continue; // rubble: no collision
            const sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
            const len2 = sx * sx + sz * sz;
            let t = len2 > 1e-8 ? ((e.x - wl.x1) * sx + (e.z - wl.z1) * sz) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const cx = wl.x1 + sx * t, cz = wl.z1 + sz * t;
            const dx = e.x - cx, dz = e.z - cz;
            const rr = r1 + 0.4; // enemy radius + wall half-thickness
            const d2 = dx * dx + dz * dz;
            if (d2 < rr * rr) {
              if (d2 > 1e-8) {
                const d = Math.sqrt(d2);
                e.x = cx + dx / d * rr; e.z = cz + dz / d * rr;
              } else {
                const len = Math.sqrt(len2) || 1;
                e.x = cx + (-sz / len) * rr; e.z = cz + (sx / len) * rr;
              }
              fixed = true;
            }
          }
          // boulders (even untriggered) and blocker cubes are solid circles
          if (S.level.boulders) for (const bd of S.level.boulders) {
            if (bd.state === 'gone') continue;
            // boulder body
            let dx = e.x - bd.x, dz = e.z - bd.z;
            let rr = r1 + bd.r;
            let d2 = dx * dx + dz * dz;
            if (d2 < rr * rr && d2 > 1e-8) {
              const d = Math.sqrt(d2);
              e.x = bd.x + dx / d * rr; e.z = bd.z + dz / d * rr;
              fixed = true;
            }
            // blocker cube (if not destroyed, 4.8^3 so radius 2.4)
            const bk = bd.blocker;
            if (bk && !bk.destroyed) {
              dx = e.x - bk.x; dz = e.z - bk.z;
              rr = r1 + 2.4;
              d2 = dx * dx + dz * dz;
              if (d2 < rr * rr && d2 > 1e-8) {
                const d = Math.sqrt(d2);
                e.x = bk.x + dx / d * rr; e.z = bk.z + dz / d * rr;
                fixed = true;
              }
            }
          }
        }
        if (!fixed) break;
      }
    };
    // pass 2: hard wall constraint
    constrainWalls();
    // pass 3: HARD enemy de-penetration — head-sized, never overlap.
    // Runs after walls so wall-projected enemies get separated too.
    bin();
    for (let iter = 0; iter < 8; iter++) {
      for (const e of S.enemies) {
        const r1 = enemyRadius(e);
        for (let gx = e._gx - 1; gx <= e._gx + 1; gx++) {
          for (let gz = e._gz - 1; gz <= e._gz + 1; gz++) {
            const arr = grid.get(gx * 128 + gz);
            if (!arr) continue;
            for (const n of arr) {
              if (n === e || n.id < e.id) continue; // each pair once
              const rr = r1 + enemyRadius(n);
              let dx = e.x - n.x, dz = e.z - n.z;
              let d2 = dx * dx + dz * dz;
              if (d2 >= rr * rr) continue;
              let ux, uz, d;
              if (d2 > 1e-8) { d = Math.sqrt(d2); ux = dx / d; uz = dz / d; }
              else { d = 0; ux = 1; uz = 0; } // exact overlap: arbitrary axis
              const corr = (rr - d) * 0.5;
              e.x += ux * corr; e.z += uz * corr;
              n.x -= ux * corr; n.z -= uz * corr;
            }
          }
        }
      }
      if (iter < 7) bin();
    }
    // pass 4: final wall constraint (safety net)
    constrainWalls();
    // pass 5: ANTI-TUNNEL — if an enemy's start-to-end segment crossed a wall's
    // middle (not around the end), it popped through; snap it back to where
    // it started the frame (which was on the correct side).
    for (const e of S.enemies) {
      for (const wl of S.level.walls) {
        if (wl.destroyed) continue;
        const sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
        const len2 = sx * sx + sz * sz;
        if (len2 < 1e-8) continue;
        const side = (x, z) => sx * (z - wl.z1) - sz * (x - wl.x1);
        const s0 = side(e._sx, e._sz), s1 = side(e.x, e.z);
        if (s0 === 0 || s1 === 0 || Math.sign(s0) === Math.sign(s1)) continue;
        // sides differ — check it crossed the middle, not around an end
        let t0 = ((e._sx - wl.x1) * sx + (e._sz - wl.z1) * sz) / len2;
        let t1 = ((e.x - wl.x1) * sx + (e.z - wl.z1) * sz) / len2;
        t0 = Math.max(0, Math.min(1, t0)); t1 = Math.max(0, Math.min(1, t1));
        // if either endpoint is near the segment ends, it went around (legit)
        if (t0 < 0.05 || t0 > 0.95 || t1 < 0.05 || t1 > 0.95) continue;
        // crossed the middle: revert to start-of-frame position
        e.x = e._sx; e.z = e._sz;
        break;
      }
    }
    // pass 6: leak check
    for (const e of S.enemies) {
      if (e.z >= S.player.z - 0.6) {
        leaked.push(e);
        S.player.hp -= e.damage;
        S.stats.leaked++;
        S.events.push({ t: 'enemyLeak', id: e.id, kind: e.kind, x: e.x, z: e.z, damage: e.damage, hp: S.player.hp });
      }
    }
  }
  if (leaked.length) {
    const dead = new Set(leaked);
    S.enemies = S.enemies.filter(e => !dead.has(e));
  }

  // ---- banners (viaduct powerups): drift toward mob once released; collect on touch ----
  const collectR = halfW + 1.0;
  for (const v of S.level.viaducts) {
    if (!v.bannersReleased) continue;
    // infinite supply: keep spawning at the back until the game ends
    v.bannerTimer -= dt;
    if (v.bannerTimer <= 0) {
      v.bannerTimer = 1 / v.bannerRate; // spacing = speed / perSecond
      v.banners.push({
        id: nextId(), x: v.cx, z: v.deckZ0 + 2,
        value: v.bannerValue, speed: v.bannerSpeed, color: v.color,
        collected: false,
      });
    }
    for (const b of v.banners) {
      if (b.collected) continue;
      b.z += b.speed * dt;
      if (Math.abs(b.x - S.mobX) < collectR && Math.abs(b.z - S.player.z) < 1.3) {
        b.collected = true;
        S.squad = Math.min(999, S.squad + b.value);
        S.stats.pickupsGot += b.value;
        S.stats.pickupCount++;
        S.events.push({ t: 'pickupGet', id: b.id, x: b.x, z: b.z, value: b.value, squad: S.squad });
      } else if (b.z > S.player.z + 3) {
        b.collected = true; // missed, hide
      }
    }
    // prune collected banners so the array (and instance list) doesn't grow
    // forever — spawns keep flowing until the level ends
    if (v.banners.length > 96) {
      v.banners = v.banners.filter(b => !b.collected);
    }
  }

  // ---- win / lose ----
  if (S.player.hp <= 0) {
    S.player.hp = 0;
    S.status = 'lost';
    S.events.push({ t: 'lose', stats: Object.assign({}, S.stats) });
  } else if (enemiesRemaining(S) === 0) {
    S.status = 'won';
    S.events.push({ t: 'win', stats: Object.assign({}, S.stats) });
  }
}

// ================= Level(s) =================
// Authored in INDEXED units (0..99). parseLevel scales x by IDX2W (0.5) so the
// physical world stays 50 units wide — denser lanes, same playfield size.
// LEVELS is injected by build.py from levels/*.json (see build.py).
// When running under node directly (tests), fall back to the level 0
// demonstrator so the suites don't need the build step.
var LEVELS = (typeof LEVELS !== 'undefined' && LEVELS) || [
  {
    name: 'Bridge Choice',
    width: 100,
    depth: 88,
    player: { at: 50, hp: 150, fireRate: 4, bulletDamage: 1, bulletSpeed: 46, troopRate: 1.0, mobSpeed: 20, pierce: 0 },
    modules: [
      { type: 'enemy', kind: 'base', from: 28, to: 70, perSecond: 1.0, count: 1000,
        hp: 1, speed: 2.1, damage: 1 },
      { type: 'enemy', kind: 'big', at: 44, perSecond: 0.016, count: 2,
        hp: 300, speed: 1.12, damage: 25, healthbar: true },
      { type: 'wall', at: 26 },
      { type: 'wall', at: 72 },
      { type: 'wall', from: [45, 30], to: [55, 30], destructible: true, hp: 5 },
      { type: 'boulder', at: [32, 50], angle: 60, speed: 14, ramp: true, blocker: { hp: 3 } },
      { type: 'viaduct', from: 0, to: 23, shots: 2, color: 0x2b6fd9,
        contents: { kind: 'pickup', value: 1, perSecond: 1, count: 120, speed: 3.45, lines: 1 } },
      { type: 'viaduct', from: 74, to: 97, shots: 10, color: 0xf2c230,
        contents: { kind: 'pickup', value: 10, perSecond: 1, count: 120, speed: 3.45, lines: 1 } },
    ],
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    indicesOf, distribute, parseLevel, createGame, updateGame,
    enemiesRemaining, emitterBlocked, viaductById, mobHalfWidth, soldierOffset, LEVELS,
  };
}
