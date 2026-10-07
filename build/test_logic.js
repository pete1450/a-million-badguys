/* Headless tests for crowd-control logic.js (mob + straight fire + pickups) */
'use strict';
const L = require('./logic.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name); }
}

const def = L.LEVELS[0];

// ---- 1. parsing ----
const lv = L.parseLevel(def);
const enemyEm = lv.emitters.filter(e => e.kind === 'enemy');
ok(enemyEm.length === 44, 'enemy emitters: 43 base + 1 big = ' + enemyEm.length);
// banners ARE the pickups: pre-placed lines on the decks
// spacing = speed / perSecond
const leftV = lv.viaducts.find(v => v.from === 0);
const rightV = lv.viaducts.find(v => v.from === 37);
const expSpacing = leftV.bannerSpeed / leftV.bannerRate;
const leftGaps = [];
for (let i = 1; i < leftV.banners.length; i++) leftGaps.push(leftV.banners[i].z - leftV.banners[i-1].z);
const avgGap = leftGaps.reduce((a, b) => a + b, 0) / leftGaps.length;
ok(Math.abs(avgGap - expSpacing) < 0.01,
  'banner spacing = speed/perSecond = ' + avgGap.toFixed(2));
ok(leftV.banners.length === rightV.banners.length && leftV.banners.length > 0,
  'banners pre-placed: ' + leftV.banners.length + '/' + rightV.banners.length);
ok(Math.abs(leftV.banners[0].x - 6.0) < 1e-9,
  'banner line runs down the bridge center (x=6.0)');
ok(leftV.banners.every(b => b.value === 1) && rightV.banners.every(b => b.value === 10),
  'banner values 1 / 10');
ok(enemyEm.reduce((a, e) => a + e.remaining, 0) === 1002, 'enemy count total = 1002');
ok(lv.totalEnemies === 1002, 'totalEnemies = 1002');
ok(lv.walls.length === 3, 'three walls (2 vertical + 1 destructible)');
const dwall = lv.walls.find(w => w.destructible);
ok(dwall && dwall.hp === 5 && !dwall.destroyed, 'destructible wall with 5hp');
// mirror reflection: bullet (0,-1) off 45° wall -> (-1,0)
{
  const mdef = {
    name: 't', width: 100, depth: 88,
    player: { at: 50, hp: 150, fireRate: 0, bulletDamage: 1, bulletSpeed: 46, troopRate: 0, mobSpeed: 20, pierce: 0 },
    modules: [
      { type: 'wall', from: [40, 30], to: [60, 40], mirror: true },
      { type: 'enemy', kind: 'base', from: 28, to: 28, perSecond: 0.01, count: 1, hp: 1, speed: 0, damage: 0 },
    ],
  };
  const ms = L.createGame(mdef);
  ok(ms.level.walls[0].mirror === true, 'mirror flag parsed');
  ms.bullets.push({ id: 9999, x: 25, y: 1.2, z: 45, dx: 0, dz: -1, speed: 20, damage: 1, pierce: 0 });
  let bdir = null;
  for (let f = 0; f < 120; f++) {
    L.updateGame(ms, 1/30, { targetX: 50 });
    const b = ms.bullets.find(b => b.id === 9999);
    if (!b) break; // died (fail)
    if (Math.abs(b.dx) > 0.01) { bdir = [b.dx, b.dz]; break; }
  }
  ok(bdir && Math.abs(bdir[0] + 1) < 0.01 && Math.abs(bdir[1]) < 0.01,
    'mirror reflects (0,-1) to (-1,0), bullet survives');
}
ok(lv.boulders && lv.boulders.length === 1, 'one boulder placed for testing');
const bd0 = lv.boulders[0];
ok(Math.abs(bd0.x - 16) < 1e-9 && Math.abs(bd0.z - 50) < 1e-9 && bd0.r === 2.5,
  'boulder at [32,50] indexed=(16,50) world, 2x size r=2.5');
// angle 60°: dx=sin(60°), dz=-cos(60°)
ok(Math.abs(bd0.dx - Math.sin(60 * Math.PI / 180)) < 1e-9 &&
   Math.abs(bd0.dz + Math.cos(60 * Math.PI / 180)) < 1e-9,
  'boulder angle 60° (east-northeast)');
ok(bd0.blocker && bd0.blocker.hp === 3 && bd0.state === 'blocked',
  'boulder has 3hp blocker cube, starts blocked');
ok(leftV.shots === 2 && rightV.shots === 10, 'column shots 2 / 10');
ok(!leftV.bannersReleased && !rightV.bannersReleased, 'banners not released initially');
ok(L.mobHalfWidth(1) === 0.5 && L.mobHalfWidth(60) > 3 && L.mobHalfWidth(60) < 5,
  'mobHalfWidth grows with rings (' + L.mobHalfWidth(1) + '/' + L.mobHalfWidth(60) + ')');
const so0 = L.soldierOffset(10, 0), so1 = L.soldierOffset(10, 1);
ok(so0.dx === 0 && so0.dz === 0, 'troop 0 at center');
ok(Math.abs(Math.hypot(so1.dx, so1.dz) - 0.85) < 1e-9, 'troop 1 on ring 1');

// ---- 2. blocked: banners don't release; mob moves; bullets fly straight ----
{
  const S = L.createGame(def);
  for (let i = 0; i < 150; i++) L.updateGame(S, 1 / 30, { targetX: 25.5 });
  const lv2 = S.level;
  ok(lv2.viaducts.every(v => !v.bannersReleased), 'no banners released while bridge stands');
  ok(S.stats.spawned >= 100, 'enemies spawn (spawned ' + S.stats.spawned + ')');
  // bullets travel -z (no homing): all bullet z decrease over time
  const zBefore = new Map(S.bullets.map(b => [b.id, b.z]));
  L.updateGame(S, 1 / 30, { targetX: 25.5 });
  ok(S.bullets.every(b => !zBefore.has(b.id) || b.z <= zBefore.get(b.id)),
    'bullets fly straight ahead (-z)');
  // mob snaps directly to target (1:1 with pointer)
  const S2 = L.createGame(def);
  const x0 = S2.mobX;
  L.updateGame(S2, 1, { targetX: 6 });
  ok(S2.mobX === 6, 'mob moves directly to targetX');
}

// ---- 3. park under left column -> bridge drops -> banners release, mob collects on touch ----
{
  const S = L.createGame(def);
  const left = S.level.viaducts.find(v => v.from === 0);
  let t = 0;
  while (!left.destroyed && t < 30) { L.updateGame(S, 1 / 30, { targetX: 6 }); t += 1 / 30; }
  ok(left.destroyed, 'left column destroyed by parking mob under it (t=' + t.toFixed(1) + 's)');
  ok(S.stats.columnsDown === 1, 'columnsDown = 1');
  ok(left.bannersReleased, 'banners released on destroy');
  const squad0 = S.squad;
  for (let i = 0; i < 600; i++) L.updateGame(S, 1 / 30, { targetX: 6 }); // under the banner line
  ok(S.stats.pickupCount > 0, 'banners drift out after release (' + S.stats.pickupCount + ')');
  ok(S.squad > squad0, 'mob collected pickups on touch (squad ' + squad0 + ' -> ' + S.squad + ')');
}

// ---- 4. combat: bot sweeps enemy lanes, kills enemies, mechanics work ----
{
  const S = L.createGame(def);
  let t = 0, dt = 1 / 30;
  while (S.status === 'playing' && t < 120) {
    // simple sweep across the enemy spawn zone (world 14..35)
    const tx = 24.5 + 10.5 * Math.sin(t * 1.2);
    L.updateGame(S, dt, { targetX: tx });
    t += dt;
  }
  console.log('sim: status=' + S.status + ' t=' + t.toFixed(1) + 's hp=' + S.player.hp.toFixed(0) +
    ' killed=' + S.stats.killed + ' leaked=' + S.stats.leaked +
    ' pickupsGot=' + S.stats.pickupsGot + ' squad=' + S.squad);
  // NOTE (2026-10-03): single-hit bullets + 30% fire-rate cut = much harder;
  // bot verifies combat mechanics, not a full win.
  ok(S.stats.killed > 50, 'bot kills enemies (killed ' + S.stats.killed + ')');
}

// ---- 5. no bridge, no movement -> overrun ----
{
  const S = L.createGame(def);
  let t = 0;
  while (S.status === 'playing' && t < 900) { L.updateGame(S, 1 / 30, { targetX: 25.5 }); t += 1 / 30; }
  console.log('idle sim: status=' + S.status + ' t=' + t.toFixed(1) + 's');
  ok(S.status === 'lost', 'camping mid with no bridge loses');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
