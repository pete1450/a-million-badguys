/* CROWD CONTROL — three.js renderer, ad-style glossy 3D.
 * Behind-the-mob 3/4 view (NOT isometric). Drives logic.js. */
(function () {
'use strict';

// ---------- dom ----------
var container = document.getElementById('scene');
var el = {
  levelName: document.getElementById('levelName'),
  enemiesLeft: document.getElementById('enemiesLeft'),
  hpFill: document.getElementById('hpFill'),
  squadCount: document.getElementById('squadCount'),
  pauseBtn: document.getElementById('pauseBtn'),
  restartBtn: document.getElementById('restartBtn'),
  focusBtn: document.getElementById('focusBtn'),
  camBtn: document.getElementById('camBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  levelNav: document.getElementById('levelNav'),
  hint: document.getElementById('hint'),
  overlay: document.getElementById('overlay'),
  ovTitle: document.getElementById('ovTitle'),
  ovStats: document.getElementById('ovStats'),
  againBtn: document.getElementById('againBtn'),
  flash: document.getElementById('flash'),
};

// ---------- renderer / scene ----------
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

var scene = new THREE.Scene();
var WATER_COLOR = 0x103a63;
var FOG_COLOR = 0x7a9ab8; // hazy light blue: the path fades into it
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(FOG_COLOR, 90, 170); // the far path emerges from fog

var camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

// glossy mobile-game lighting: bright hemi + warm sun with soft shadows
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8a7f6a, 0.5));
var sun = new THREE.DirectionalLight(0xfff2dd, 0.8);
sun.position.set(45, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.4;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.06));

function fitCamera(W, D) {
  var w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  var aspect = w / h;
  // perspective: low behind the mob, looking down the path to a vanishing point
  camera.fov = aspect >= 1 ? 45 : 55;
  camera.aspect = aspect;
  camera.near = 0.1; camera.far = 600;
  camX = W / 2;
  camera.position.set(camX, 11, D + 22);
  camera.lookAt(camX, 2.5, D / 2 - 6);
  camera.updateProjectionMatrix();
  // keep the sun's shadow frustum on the field
  sun.target.position.set(W / 2, 0, D / 2);
  sun.target.updateMatrixWorld();
  sun.position.set(W / 2 + 20, 60, D / 2 + 25);
}
window.addEventListener('resize', function () { fitCamera(cur.W, cur.D); });

// ---------- canvas textures ----------
function canvasTex(size, draw, repeat) {
  var c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  var t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

// cracked concrete for destructible walls (obviously breakable)
var crackTex = canvasTex(256, function (g, s) {
  g.fillStyle = '#a9a49a'; g.fillRect(0, 0, s, s); // base concrete
  g.strokeStyle = 'rgba(40,32,28,0.85)'; g.lineWidth = 3;
  // jagged cracks
  for (var i = 0; i < 7; i++) {
    var x = Math.random() * s, y = 0;
    g.beginPath(); g.moveTo(x, y);
    while (y < s) {
      x += (Math.random() - 0.5) * 40;
      y += 20 + Math.random() * 30;
      g.lineTo(x, y);
    }
    g.stroke();
    // branches
    for (var b = 0; b < 3; b++) {
      var bx = x + (Math.random() - 0.5) * 60, by = y * Math.random();
      g.beginPath(); g.moveTo(bx, by);
      g.lineTo(bx + (Math.random() - 0.5) * 50, by + (Math.random() - 0.5) * 50);
      g.stroke();
    }
  }
});
// dark navy water with soft drifting streaks
var waterTex = canvasTex(256, function (g, s) {
  g.fillStyle = '#103a63'; g.fillRect(0, 0, s, s);
  for (var i = 0; i < 46; i++) {
    var x = Math.random() * s, y = Math.random() * s;
    var r = 12 + Math.random() * 42;
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    var lite = Math.random() < 0.5;
    gr.addColorStop(0, lite ? 'rgba(46,110,165,0.20)' : 'rgba(6,22,42,0.22)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
  }
}, [7, 7]);

// banner faces: glossy rounded rect + bold "+1" / "+10"
function bannerTex(text, top, bottom) {
  var c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  var g = c.getContext('2d');
  var gr = g.createLinearGradient(0, 0, 0, 160);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.beginPath();
  var r = 18;
  g.moveTo(r, 0); g.lineTo(128 - r, 0); g.quadraticCurveTo(128, 0, 128, r);
  g.lineTo(128, 160 - r); g.quadraticCurveTo(128, 160, 128 - r, 160);
  g.lineTo(r, 160); g.quadraticCurveTo(0, 160, 0, 160 - r);
  g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 6; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(10, 10, 108, 26); // gloss strip
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeText(text, 64, 88); g.fillStyle = '#ffffff'; g.fillText(text, 64, 88);
  var t = new THREE.CanvasTexture(c);
  return t;
}

// square number faces for pickups: the +1 / +10 right on the square, ad-style
function pickupFaceTex(text, top, bottom) {
  var c = document.createElement('canvas');
  c.width = c.height = 128;
  var g = c.getContext('2d');
  var gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  var r = 22;
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(128 - r, 0); g.quadraticCurveTo(128, 0, 128, r);
  g.lineTo(128, 128 - r); g.quadraticCurveTo(128, 128, 128 - r, 128);
  g.lineTo(r, 128); g.quadraticCurveTo(0, 128, 0, 128 - r);
  g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 6; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(12, 12, 104, 24); // gloss strip
  g.font = 'bold 56px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeText(text, 64, 72); g.fillStyle = '#ffffff'; g.fillText(text, 64, 72);
  return new THREE.CanvasTexture(c);
}

// ---------- material helpers ----------
function phong(color, shininess, specular) {
  return new THREE.MeshPhongMaterial({
    color: color, shininess: shininess || 38,
    specular: specular || 0x2a3540,
  });
}
function lam(color) { return new THREE.MeshLambertMaterial({ color: color }); }

// ---------- instancing helpers ----------
var _m4 = new THREE.Matrix4();
var _q = new THREE.Quaternion();
var _eul = new THREE.Euler();
var _pos = new THREE.Vector3();
var _scl = new THREE.Vector3(1, 1, 1);
function setInst(mesh, i, x, y, z, sx, sy, sz, rz, rx) {
  _pos.set(x, y, z);
  _scl.set(sx || 1, sy || 1, sz || 1);
  _eul.set(rx || 0, 0, rz || 0); _q.setFromEuler(_eul);
  _m4.compose(_pos, _q, _scl);
  mesh.setMatrixAt(i, _m4);
}
function makeInstanced(geo, mat, cap, shadow) {
  var m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  if (shadow !== false) { m.castShadow = true; }
  _eul.set(0, 0, 0); _q.setFromEuler(_eul);
  _scl.set(0, 0, 0); _pos.set(0, -10, 0);
  for (var i = 0; i < cap; i++) { _m4.compose(_pos, _q, _scl); m.setMatrixAt(i, _m4); }
  m.count = 0;
  return m;
}
function box(w, h, d, mat) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------- text labels ----------
function makeLabel(scale) {
  var canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  var tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false }));
  var k = scale || 1;
  sp.scale.set(3.0 * k, 1.5 * k, 1);
  sp.renderOrder = 20;
  return {
    sprite: sp,
    draw: function (text, color) {
      var g = canvas.getContext('2d');
      g.clearRect(0, 0, 128, 64);
      g.font = 'bold 40px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = 'rgba(8,8,8,0.9)';
      g.strokeText(text, 64, 34);
      g.fillStyle = color || '#fff';
      g.fillText(text, 64, 34);
      tex.needsUpdate = true;
    },
  };
}

var popups = [];
function initPopups(n) {
  for (var i = 0; i < n; i++) {
    var lb = makeLabel(1);
    lb.sprite.visible = false;
    scene.add(lb.sprite);
    popups.push({ lb: lb, life: 0, vy: 0 });
  }
}
var popupIdx = 0;
function spawnPopup(text, x, y, z, color) {
  var p = popups[popupIdx++ % popups.length];
  p.lb.draw(text, color);
  p.lb.sprite.position.set(x, y, z);
  p.lb.sprite.visible = true;
  p.lb.sprite.material.opacity = 1;
  p.life = 1.1; p.vy = 2.4;
}

// ---------- game state ----------
var cur = { W: 50, D: 44, levelIdx: 0, S: null, paused: false, halfW: 17, topDown: false };
var camX = 25; // follows the mob horizontally
var world = null;
var boulderMeshes = [];
var wallMeshes = [];
var viaductViews = [];   // {v, group, deck, columnParts[], label, anim, bannerMesh, bannerFaces, rubble[]}
var playerMesh = null;
var waterMesh = null;
var shakeT = 0;
var im = {};
var particles = [];

function burst(x, y, z, n, color, speed) {
  for (var i = 0; i < n; i++) {
    if (particles.length >= 256) particles.shift();
    var a = Math.random() * 6.283, r = (0.4 + Math.random() * 0.6) * (speed || 6);
    particles.push({
      x: x, y: y, z: z,
      vx: Math.cos(a) * r, vy: 3 + Math.random() * 6, vz: Math.sin(a) * r,
      life: 0.7 + Math.random() * 0.5, color: color,
    });
  }
}

// character part geometries (shared)
var GEO = {
  torso: new THREE.BoxGeometry(0.62, 0.72, 0.42),
  head: new THREE.SphereGeometry(0.26, 12, 10),
  helmet: new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  bigTorso: new THREE.BoxGeometry(1.45, 1.65, 1.0),
  bigHead: new THREE.SphereGeometry(0.58, 14, 12),
  bigHelmet: new THREE.SphereGeometry(0.68, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
};

function buildInstanced() {
  var sh = function (m) { m.castShadow = true; return m; };
  // base enemies: red torso, skin head, dark-red helmet
  im.eTorso = makeInstanced(GEO.torso, sh(phong(0xd8362a, 45)), 1600);
  im.eHead = makeInstanced(GEO.head, sh(phong(0xeab886, 30)), 1600);
  im.eHelmet = makeInstanced(GEO.helmet, sh(phong(0x9c1f14, 55)), 1600);
  // big guys: bulky dark-red brutes
  im.bTorso = makeInstanced(GEO.bigTorso, sh(phong(0x7d1410, 45)), 16);
  im.bHead = makeInstanced(GEO.bigHead, sh(phong(0xeab886, 30)), 16);
  im.bHelmet = makeInstanced(GEO.bigHelmet, sh(phong(0x4d0b08, 55)), 16);
  // healthbars: bg (dark) + fg (green, x-scaled by hp). For enemies with
  // healthbar:true in their JSON (the big guys).
  im.hbBg = makeInstanced(new THREE.PlaneGeometry(2.2, 0.28),
    new THREE.MeshBasicMaterial({ color: 0x1a0000 }), 16, false);
  im.hbFg = makeInstanced(new THREE.PlaneGeometry(2.2, 0.28),
    new THREE.MeshBasicMaterial({ color: 0x2eff5a }), 16, false);
  // squad troops: blue torso, skin head, blue helmet
  im.tTorso = makeInstanced(GEO.torso, sh(phong(0x2f7fe0, 45)), 600);
  im.tHead = makeInstanced(GEO.head, sh(phong(0xeab886, 30)), 600);
  im.tHelmet = makeInstanced(GEO.helmet, sh(phong(0x1c55b0, 55)), 600);
  // bullets: hot yellow tracers (unlit)
  im.bullet = makeInstanced(new THREE.BoxGeometry(0.34, 0.34, 0.85),
    new THREE.MeshBasicMaterial({ color: 0xffc400 }), 768, false);
  // pickups: glowing squares (unlit core)
  im.pickup = makeInstanced(new THREE.BoxGeometry(1.44, 1.44, 1.44),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), 256, false);
  // pickup number faces, billboarded: the +1 / +10 right on the square
  var faceB = pickupFaceTex('+1', '#3f8ef2', '#1c55b0');
  var faceY = pickupFaceTex('+10', '#f7c948', '#d1941a');
  im.pickupFaceB = makeInstanced(new THREE.PlaneGeometry(1.24, 1.24),
    new THREE.MeshBasicMaterial({ map: faceB, transparent: true }), 256, false);
  im.pickupFaceY = makeInstanced(new THREE.PlaneGeometry(1.24, 1.24),
    new THREE.MeshBasicMaterial({ map: faceY, transparent: true }), 256, false);
  // pickup halo: additive glow shell
  im.pickupGlow = makeInstanced(new THREE.BoxGeometry(2.5, 2.5, 2.5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.33,
      blending: THREE.AdditiveBlending, depthWrite: false }), 256, false);
  // dust / debris
  im.particle = makeInstanced(new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), 256, false);
  for (var k in im) scene.add(im[k]);
  var c = new THREE.Color();
  for (var i = 0; i < 256; i++) {
    im.pickup.setColorAt(i, c.setHex(0xffffff));
    im.pickupGlow.setColorAt(i, c.setHex(0xffffff));
    im.particle.setColorAt(i, c.setHex(0xffffff));
  }
  im.pickup.instanceColor.needsUpdate = true;
  im.pickupGlow.instanceColor.needsUpdate = true;
  im.particle.instanceColor.needsUpdate = true;
}

// detailed hero: legs, khaki torso, arms+gun, sphere head, blue helmet
function buildPlayerMesh(x, z) {
  var g = new THREE.Group();
  var legM = phong(0x3a4a5a, 30);
  var l1 = box(0.26, 0.5, 0.3, legM); l1.position.set(-0.18, 0.25, 0);
  var l2 = box(0.26, 0.5, 0.3, legM); l2.position.set(0.18, 0.25, 0);
  var torso = box(0.78, 0.8, 0.5, phong(0xd9a066, 35)); torso.position.y = 0.9;
  var armM = phong(0xc08d52, 35);
  var a1 = box(0.22, 0.22, 0.62, armM); a1.position.set(-0.32, 1.05, -0.3);
  var a2 = box(0.22, 0.22, 0.62, armM); a2.position.set(0.32, 1.05, -0.3);
  var gun = box(0.2, 0.24, 1.15, phong(0x2c3138, 60, 0x555f6a)); gun.position.set(0.3, 1.1, -0.85);
  var grip = box(0.18, 0.4, 0.2, phong(0x2c3138, 40)); grip.position.set(0.3, 0.85, -0.5);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), phong(0xeab886, 30));
  head.position.y = 1.62; head.castShadow = true;
  var helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    phong(0x2f7fe0, 60, 0x446688));
  helmet.position.y = 1.7; helmet.castShadow = true;
  g.add(l1); g.add(l2); g.add(torso); g.add(a1); g.add(a2);
  g.add(gun); g.add(grip); g.add(head); g.add(helmet);
  g.position.set(x, 0, z);
  return g;
}

function buildWorld(level) {
  if (world) scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  viaductViews = [];
  var W = level.width, D = level.depth;

  // water
  waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(420, 420),
    new THREE.MeshPhongMaterial({ color: 0xffffff, map: waterTex, shininess: 90, specular: 0x88bbee }));
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(W / 2, -0.9, D / 2);
  waterMesh.receiveShadow = true;
  world.add(waterMesh);

  // plain gray concrete platform, ad-style (no grid)
  var plat = new THREE.Mesh(new THREE.BoxGeometry(W + 8, 1.2, D + 12),
    phong(0xcfcbc0, 10));
  plat.position.set(W / 2, -0.6, D / 2);
  plat.receiveShadow = true;
  world.add(plat);
  // pale edge trim along the platform sides
  var trimM = phong(0xf2efe6, 25);
  [-3.75, W + 3.75].forEach(function (x) {
    var trim = box(0.5, 0.35, D + 12, trimM);
    trim.position.set(x, 0.12, D / 2);
    world.add(trim);
  });

  // defense line
  var line = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.5 }));
  line.position.set(W / 2, 0.07, level.playerZ - 0.6);
  world.add(line);

  // separation walls: concrete barriers with pale caps (vertical or angled).
  // Unlit material so angled walls stay visible regardless of sun angle.
  // Modules (boulders/blockers) can intersect walls: the wall visual gets a
  // gap where they overlap, but the wall collision (enemies) stays whole.
  // Destructible walls get a cracked texture + HP label; hidden when destroyed.
  wallMeshes = [];
  level.walls.forEach(function (wl) {
    var sx = wl.x2 - wl.x1, sz = wl.z2 - wl.z1;
    var len = Math.hypot(sx, sz);
    var ang = Math.atan2(sx, sz); // rotation about Y
    // collect obstacle intervals (t in [0,1]) that cut a visual gap
    var gaps = [];
    if (level.boulders) level.boulders.forEach(function (bd) {
      if (bd.state === 'gone') return;
      // visual gap radius slightly larger than collision so the wall
      // visually notches around the trap even when not quite touching
      var obstacles = [{ x: bd.x, z: bd.z, r: bd.r + 0.8 }];
      if (bd.blocker && !bd.blocker.destroyed) obstacles.push({ x: bd.blocker.x, z: bd.blocker.z, r: 2.4 + 0.8 });
      obstacles.forEach(function (ob) {
        var len2 = sx * sx + sz * sz;
        if (len2 < 1e-9) return;
        var t0 = ((ob.x - wl.x1) * sx + (ob.z - wl.z1) * sz) / len2;
        var cx = wl.x1 + sx * t0, cz = wl.z1 + sz * t0;
        var d = Math.hypot(ob.x - cx, ob.z - cz);
        if (d < ob.r) {
          var dt = Math.sqrt(ob.r * ob.r - d * d) / Math.sqrt(len2);
          gaps.push([Math.max(0, t0 - dt), Math.min(1, t0 + dt)]);
        }
      });
    });
    // merge gaps and render the remaining solid pieces
    gaps.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    gaps.forEach(function (g) {
      var last = merged[merged.length - 1];
      if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
      else merged.push([g[0], g[1]]);
    });
    var pieces = [];
    var cur = 0;
    merged.forEach(function (g) {
      if (g[0] > cur) pieces.push([cur, g[0]]);
      cur = Math.max(cur, g[1]);
    });
    if (cur < 1) pieces.push([cur, 1]);
    if (pieces.length === 0) pieces.push([0, 1]); // shouldn't happen
    var meshes = [];
    // Mirror walls: rubber band stretched between two posts (not concrete)
    if (wl.mirror) {
      var postG = new THREE.CylinderGeometry(0.35, 0.45, 3.2, 10);
      var postM = new THREE.MeshPhongMaterial({ color: 0x4a3f35, shininess: 20 });
      [0, 1].forEach(function (ei) {
        var px = ei === 0 ? wl.x1 : wl.x2, pz = ei === 0 ? wl.z1 : wl.z2;
        var post = new THREE.Mesh(postG, postM);
        post.position.set(px, 1.6, pz);
        post.castShadow = true;
        world.add(post); meshes.push(post);
      });
      // the band: thin stretched box between posts
      var bandLen = len;
      var band = box(0.25, 0.5, bandLen, new THREE.MeshPhongMaterial({
        color: 0xd94a6a, shininess: 60, // pinkish rubber
      }));
      band.position.set((wl.x1 + wl.x2) / 2, 1.6, (wl.z1 + wl.z2) / 2);
      band.rotation.y = ang;
      band.castShadow = true;
      world.add(band); meshes.push(band);
      var entry2 = { wl: wl, meshes: meshes, label: null };
      wallMeshes.push(entry2);
      return; // skip normal wall rendering
    }
    var wallMat = wl.destructible
      ? new THREE.MeshBasicMaterial({ map: crackTex }) // cracked = breakable
      : new THREE.MeshBasicMaterial({ color: 0xa9a49a });
    pieces.forEach(function (p) {
      var t0 = p[0], t1 = p[1];
      if (t1 - t0 < 0.01) return; // skip slivers
      var mx = wl.x1 + sx * (t0 + t1) / 2, mz = wl.z1 + sz * (t0 + t1) / 2;
      var plen = len * (t1 - t0);
      var m = box(0.8, 2.4, plen, wallMat);
      m.position.set(mx, 1.2, mz); m.rotation.y = ang;
      var cap = box(1.0, 0.3, plen, new THREE.MeshBasicMaterial({ color: 0xe8e2d2 }));
      cap.position.set(mx, 2.55, mz); cap.rotation.y = ang;
      world.add(m); world.add(cap);
      meshes.push(m); meshes.push(cap);
    });
    var entry = { wl: wl, meshes: meshes, label: null };
    // HP counter for destructible walls (sprite = always faces camera)
    if (wl.destructible) {
      var wmx = (wl.x1 + wl.x2) / 2, wmz = (wl.z1 + wl.z2) / 2;
      var wlbl = makeLabel(2.5);
      wlbl.draw(String(wl.hp), '#ffffff');
      wlbl.sprite.position.set(wmx, 3.4, wmz);
      world.add(wlbl.sprite);
      entry.label = wlbl;
    }
    wallMeshes.push(entry);
  });

  // boulders (rolling crush traps)
  boulderMeshes = [];
  if (level.boulders) level.boulders.forEach(function (bd) {
    var geo = new THREE.IcosahedronGeometry(bd.r, 0); // low-poly rock
    var mat = new THREE.MeshPhongMaterial({ color: 0x6b5d4f, shininess: 8, flatShading: true });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.set(bd.x, bd.r, bd.z);
    world.add(mesh);
    var entry = { bd: bd, mesh: mesh, rampMesh: null, blockerMesh: null, blockerLabel: null };
    // small ramp underneath (visual perch), tilted so the low side faces
    // the blocker (boulder rolls down toward it). Rectangular, long axis
    // aligned to the facing angle so the 75° (not 90°) is visible.
    if (bd.ramp) {
      var rampLen = bd.r * 3.2, rampWid = bd.r * 2.0;
      var rampG = new THREE.BoxGeometry(rampWid, 0.6, rampLen);
      var rampM = new THREE.MeshPhongMaterial({ color: 0x8a7f72, shininess: 5 });
      var ramp = new THREE.Mesh(rampG, rampM);
      ramp.position.set(bd.x, 0.3, bd.z);
      // face the boulder's direction: length axis (z) along (dx,dz)
      // (three.js rotation.y: +z axis maps to (sin φ, cos φ), so φ = atan2(dx, dz))
      var faceY = Math.atan2(bd.dx, bd.dz);
      ramp.rotation.order = 'YXZ';
      ramp.rotation.y = faceY;
      ramp.rotation.x = 0.22; // front (facing dir) dips down toward the blocker
      ramp.castShadow = true; ramp.receiveShadow = true;
      world.add(ramp);
      entry.rampMesh = ramp;
    }
    // destructible blocker cube in front (4.8^3, 2x of 2x)
    if (bd.blocker) {
      var bk = bd.blocker;
      var cubeG = new THREE.BoxGeometry(4.8, 4.8, 4.8);
      var cubeM = new THREE.MeshPhongMaterial({ color: 0xc46a4a, shininess: 15 }); // reddish, shoot me
      var cube = new THREE.Mesh(cubeG, cubeM);
      cube.position.set(bk.x, 2.4, bk.z);
      cube.rotation.y = Math.atan2(bd.dx, bd.dz); // face the boulder's direction
      cube.castShadow = true;
      world.add(cube);
      entry.blockerMesh = cube;
      // HP label right in front of the block (sprite = always faces camera)
      var lbl = makeLabel(3.0);
      lbl.draw(String(bk.hp), '#ffffff');
      lbl.sprite.position.set(bk.x, 2.2, bk.z + 2.7);
      world.add(lbl.sprite);
      entry.blockerLabel = lbl;
    }
    boulderMeshes.push(entry);
  });

  // viaducts (high elevated decks that tilt when the column is destroyed)
  level.viaducts.forEach(function (v, vi) {
    var g = new THREE.Group();
    var wdt = v.to - v.from + 1;
    var zmid = (v.deckZ0 + v.deckZ1) / 2;
    var zlen = v.deckZ1 - v.deckZ0;
    var DECK_Y = 7; // deck center height (a lot higher)
    var deckM = phong(0xcac2b2, 22);
    var deck = box(wdt, 0.9, zlen, deckM);
    deck.position.set(v.cx, DECK_Y, zmid);
    g.add(deck);
    // deck side skirt
    var skirt = box(wdt + 0.3, 0.5, zlen + 0.3, phong(0x9d968a, 20));
    skirt.position.set(v.cx, DECK_Y - 0.55, zmid);
    g.add(skirt);
    // railing posts along both long edges
    var postG = new THREE.BoxGeometry(0.22, 0.9, 0.22);
    var postM = phong(0x8f8a7e, 25);
    for (var x = v.from; x <= v.to; x += 1) {
      [v.deckZ0 + 0.3, v.deckZ1 - 0.3].forEach(function (z) {
        var p = new THREE.Mesh(postG, postM);
        p.position.set(x + 0.5, DECK_Y + 0.9, z);
        p.castShadow = true;
        g.add(p);
      });
    }
    // rails
    [v.deckZ0 + 0.3, v.deckZ1 - 0.3].forEach(function (z) {
      var rail = box(wdt, 0.18, 0.18, phong(0x8f8a7e, 30));
      rail.position.set(v.cx, DECK_Y + 1.35, z);
      g.add(rail);
    });
    // banners ARE the pickups: ONE object (box with the +1/+10 texture on its
    // front face via material groups). Impossible for the label to separate.
    var faceTex = bannerTex(vi === 0 ? '+1' : '+10',
      vi === 0 ? '#3f8ef2' : '#f7c948', vi === 0 ? '#1c55b0' : '#d1941a');
    var bannerGeo = new THREE.BoxGeometry(3.15, 4.8, 0.54);
    var sideMat = phong(v.color, 60);
    var faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
    // BoxGeometry groups: [+x, -x, +y, -y, +z, -z]; +z (index 4) gets the label
    var bannerMesh = new THREE.InstancedMesh(bannerGeo,
      [sideMat, sideMat, sideMat, sideMat, faceMat, sideMat], 64);
    bannerMesh.frustumCulled = false;
    bannerMesh.castShadow = true;
    // init all instances to hidden
    _eul.set(0, 0, 0); _q.setFromEuler(_eul); _scl.set(0.001, 0.001, 0.001); _pos.set(0, -10, 0);
    for (var bii = 0; bii < 64; bii++) { _m4.compose(_pos, _q, _scl); bannerMesh.setMatrixAt(bii, _m4); }
    bannerMesh.count = 64;
    bannerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.add(bannerMesh);
    // column: base slab + shaft + capital, standing just off the deck's
    // near end like the ad's pillar (fully visible, not hidden under deck)
    // column: tall pillar reaching the high deck (stays in world, doesn't tilt)
    var colM = phong(0xb5afa2, 18);
    var parts = [];
    var base = box(2.3, 0.5, 2.3, colM); base.position.set(v.cx, 0.25, v.colZ);
    var shaft = box(1.7, 6.0, 1.7, colM); shaft.position.set(v.cx, 3.25, v.colZ);
    var cap = box(2.1, 0.4, 2.1, colM); cap.position.set(v.cx, 6.7, v.colZ);
    parts.push(base, shaft, cap);
    parts.forEach(function (p) { world.add(p); });
    // pivot for tilt: deck rotates around its back edge when the column falls
    var pivot = new THREE.Group();
    pivot.position.set(v.cx, 7, v.deckZ0);
    g.position.set(-v.cx, -7, -v.deckZ0);
    pivot.add(g);
    world.add(pivot);
    // chunky shot counter ON the column's front face, ad-style
    var label = makeLabel(0.7);
    label.draw(String(v.shotsLeft), '#ffffff');
    label.sprite.position.set(v.cx, 3.5, v.colZ + 0.95);
    world.add(label.sprite);
    viaductViews.push({ v: v, group: g, pivot: pivot, columnParts: parts, label: label,
      anim: 0, bannerMesh: bannerMesh, bannerPhase: Math.random() * 6.28, rubble: [] });
  });

  playerMesh = buildPlayerMesh(level.playerX, level.playerZ);
  world.add(playerMesh);
}

function enrichLevel(level, def) {
  level.playerX = def.player.at + 0.5;
  level.playerZ = level.depth - 4;
}

function loadLevel(idx) {
  cur.levelIdx = idx;
  var def = LEVELS[idx];
  cur.levelDef = def; // keep the raw JSON for the designer
  var S = createGame(def);
  enrichLevel(S.level, def);
  cur.S = S;
  cur.W = S.level.width; cur.D = S.level.depth;
  cur.paused = false;
  targetXCmd = null;
  particles = [];
  for (var k in im) { scene.remove(im[k]); if (im[k].geometry) im[k].geometry.dispose(); }
  buildInstanced();
  buildWorld(S.level);
  fitCamera(cur.W, cur.D);
  el.levelName.textContent = S.level.name;
  el.overlay.classList.add('hidden');
  el.pauseBtn.textContent = '⏸';
  el.focusBtn.style.background = ''; el.focusBtn.style.color = '';
  el.levelNav.style.display = LEVELS.length > 1 ? 'flex' : 'none';
  updateHud();
}

// ---------- level designer ----------
var designer = {
  active: false,
  tool: 'select',
  def: null,           // level def JSON being edited
  selected: -1,        // index into def.modules
  placingWallA: null,  // first endpoint when placing angled wall
  customDef: null,     // last played custom def (for Back to Designer)
  playingCustom: false,
  zoom: 1.0,           // top-down zoom (wheel)
  panX: 0, panZ: 0,    // top-down pan offset from center (for zoom-to-cursor)
};
var GRID_SNAP = 0.5;

function designDef() {
  if (!designer.def) {
    // start from a clean template (not the current level)
    designer.def = {
      name: 'Custom Level',
      width: 100, depth: 88,
      player: { at: 50, hp: 150, fireRate: 4, bulletDamage: 1, bulletSpeed: 46, troopRate: 1.0, mobSpeed: 20, pierce: 0 },
      modules: [],
    };
  }
  return designer.def;
}

function snap(v) { return Math.round(v / GRID_SNAP) * GRID_SNAP; }

function enterDesigner() {
  // Start from the current level's JSON (deep copy). If you want something
  // completely different, delete things — it's your canvas now.
  var wasPlayingCustom = designer.playingCustom;
  designer.active = true;
  designer.playingCustom = false;
  designer.zoom = 1.0; designer.panX = 0; designer.panZ = 0;
  var srcDef = null;
  if (wasPlayingCustom && designer.customDef) srcDef = designer.customDef;
  else if (cur.levelDef) srcDef = cur.levelDef;
  else if (cur.levelIdx >= 0 && LEVELS[cur.levelIdx]) srcDef = LEVELS[cur.levelIdx];
  if (srcDef) {
    designer.def = JSON.parse(JSON.stringify(srcDef));
  } else {
    designDef(); // blank template (shouldn't happen)
  }
  // force top-down view
  if (!cur.topDown) document.getElementById('camBtn').click();
  document.getElementById('designerPanel').style.display = 'block';
  document.getElementById('designerPanel').classList.add('open');
  document.getElementById('desBackBtn').style.display = 'none';
  document.querySelector('#designerPanel .tools').style.display = 'grid';
  document.getElementById('designerJson').style.display = 'block';
  syncDesignerJson();
  rebuildDesignerWorld();
  if (designerHelpers) designerHelpers.visible = true;
  setDesignerTool('select');
}

function exitDesigner() {
  designer.active = false;
  document.getElementById('designerPanel').classList.remove('open');
  document.getElementById('designerPanel').style.display = 'none';
  closePopup();
  if (designerHelpers) designerHelpers.visible = false;
  // reload the normal level
  loadLevel(cur.levelIdx || 0);
}

var designerHelpers = null; // group for orbs + emitter ghosts (designer only)

function rebuildDesignerWorld() {
  // Build a non-playing preview from the design def.
  // We reuse loadLevel machinery but with a flag to prevent gameplay.
  var def = designer.def;
  var S = createGame(def);
  enrichLevel(S.level, def);
  cur.S = S;
  cur.W = S.level.width; cur.D = S.level.depth;
  cur.paused = true; // no simulation in designer
  particles = [];
  for (var k in im) { scene.remove(im[k]); if (im[k].geometry) im[k].geometry.dispose(); }
  buildInstanced();
  buildWorld(S.level);
  fitCamera(cur.W, cur.D);
  // ensure top-down
  cur.topDown = true;
  buildDesignerHelpers(S);
  updateHud();
}

function buildDesignerHelpers(S) {
  // Clear old helpers
  if (designerHelpers) { scene.remove(designerHelpers); }
  designerHelpers = new THREE.Group();
  var orbGeo = new THREE.SphereGeometry(0.45, 12, 10);
  var orbMat = new THREE.MeshBasicMaterial({ color: 0xffd54a }); // yellow drag handle
  function orb(x, y, z) {
    var m = new THREE.Mesh(orbGeo, orbMat);
    m.position.set(x, y, z);
    designerHelpers.add(m);
  }
  var def = designer.def;
  def.modules.forEach(function (m) {
    if (m.type === 'wall') {
      if (m.at !== undefined) {
        var wx = (m.at | 0) * 0.5;
        orb(wx, 3.2, def.depth / 2); // drag handle at wall center top
      } else if (m.from && m.to) {
        orb(m.from[0] * 0.5, 3.2, m.from[1]); // endpoint A
        orb(m.to[0] * 0.5, 3.2, m.to[1]);     // endpoint B
      }
    } else if (m.type === 'boulder') {
      orb(m.at[0] * 0.5, 5.5, m.at[1]); // above the boulder
    } else if (m.type === 'viaduct') {
      var cx = (((m.from | 0) + (m.to | 0) + 1) / 2) * 0.5;
      orb(cx, 8.5, (4 + (def.depth - 24)) / 2); // above deck center
    } else if (m.type === 'enemy') {
      // show the actual enemy model at each emitter position
      var isBig = (m.kind === 'big');
      var eGeo = new THREE.BoxGeometry(isBig ? 1.1 : 0.55, isBig ? 1.1 : 0.55, isBig ? 1.1 : 0.55);
      var eMat = new THREE.MeshBasicMaterial({ color: isBig ? 0x7d1410 : 0xd8362a });
      S.level.emitters.forEach(function (e) {
        if (e.kind !== 'enemy') return;
        // match emitter to this module by x-range (approx)
        var mod = def.modules.find(function (mm) {
          if (mm.type !== 'enemy' || mm.kind !== m.kind) return false;
          var f = mm.at !== undefined ? mm.at : mm.from;
          var t = mm.at !== undefined ? mm.at : mm.to;
          var ex = (e.x / 0.5) - 0.5; // back to indexed
          return ex >= f - 0.6 && ex <= t + 0.6;
        });
        if (!mod) return;
        // only draw for the current module (avoid dupes across modules)
        if (mod !== m) return;
        var em = new THREE.Mesh(eGeo, eMat);
        em.position.set(e.x, 0.5, e.z);
        designerHelpers.add(em);
      });
      // drag orb at range center
      var f2 = m.at !== undefined ? m.at : m.from;
      var t2 = m.at !== undefined ? m.at : m.to;
      orb(((f2 + t2) / 2) * 0.5, 1.2, 2);
    }
  });
  scene.add(designerHelpers);
}

function syncDesignerJson() {
  document.getElementById('designerJson').value = JSON.stringify(designer.def, null, 2);
}

function applyDesignerJson() {
  try {
    var def = JSON.parse(document.getElementById('designerJson').value);
    if (!def.modules || !Array.isArray(def.modules)) throw new Error('modules must be an array');
    designer.def = def;
    designer.selected = -1;
    closePopup();
    rebuildDesignerWorld();
  } catch (e) {
    alert('Invalid JSON: ' + e.message);
  }
}

function setDesignerTool(t) {
  designer.tool = t;
  designer.placingWallA = null;
  var btns = document.querySelectorAll('#designerPanel .tools button');
  btns.forEach(function (b) { b.classList.toggle('active', b.dataset.tool === t); });
}

// Raycast screen -> ground plane (y=0) in top-down view
function screenToGround(clientX, clientY) {
  var rect = renderer.domElement.getBoundingClientRect();
  var nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  var ny = -((clientY - rect.top) / rect.height) * 2 + 1;
  var vec = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
  var dir = vec.sub(camera.position).normalize();
  var t = -camera.position.y / dir.y;
  if (t < 0) return null;
  return {
    x: camera.position.x + dir.x * t,
    z: camera.position.z + dir.z * t,
  };
}

// Find module index at a world position (for selection/erase)
function pickModule(x, z) {
  var mods = designer.def.modules;
  // check in reverse (topmost last)
  for (var i = mods.length - 1; i >= 0; i--) {
    var m = mods[i];
    if (m.type === 'wall') {
      if (m.at !== undefined) {
        var wx = (m.at | 0) * 0.5;
        if (Math.abs(x - wx) < 0.8 && z > 0 && z < designer.def.depth) return i;
      } else if (m.from && m.to) {
        var x1 = m.from[0] * 0.5, z1 = m.from[1], x2 = m.to[0] * 0.5, z2 = m.to[1];
        // distance to segment
        var sx = x2 - x1, sz = z2 - z1, l2 = sx * sx + sz * sz;
        var t = l2 > 1e-9 ? ((x - x1) * sx + (z - z1) * sz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - (x1 + sx * t), z - (z1 + sz * t)) < 0.9) return i;
      }
    } else if (m.type === 'boulder') {
      var bx = m.at[0] * 0.5, bz = m.at[1];
      if (Math.hypot(x - bx, z - bz) < 2.8) return i;
    } else if (m.type === 'enemy') {
      // enemies are ranges; pick by lane
      var ex;
      if (m.at !== undefined) ex = (m.at | 0) * 0.5;
      else if (m.from !== undefined) ex = ((m.from | 0) * 0.5 + ((m.to | 0) * 0.5)) / 2;
      else continue;
      if (Math.abs(x - ex) < 2 && z < 12) return i; // near spawn line
    } else if (m.type === 'viaduct') {
      var vx1 = (m.from | 0) * 0.5, vx2 = ((m.to | 0) + 1) * 0.5;
      if (x >= vx1 - 1 && x <= vx2 + 1 && z > 2 && z < designer.def.depth - 20) return i;
    }
  }
  return -1;
}

// ---- item popup: shows all options for the selected module ----
function openPopup(idx, clientX, clientY) {
  designer.selected = idx;
  var m = designer.def.modules[idx];
  var popup = document.getElementById('itemPopup');
  var title = document.getElementById('popupTitle');
  var fields = document.getElementById('popupFields');
  title.textContent = m.type.charAt(0).toUpperCase() + m.type.slice(1) + ' #' + idx;
  var html = '';
  function numField(key, label, val, step) {
    html += '<label>' + label + '</label><input type="number" data-k="' + key + '" value="' + val + '" step="' + (step || 1) + '">';
  }
  function textField(key, label, val) {
    html += '<label>' + label + '</label><input type="text" data-k="' + key + '" value="' + (val || '') + '">';
  }
  function boolField(key, label, val) {
    html += '<label><input type="checkbox" data-k="' + key + '" ' + (val ? 'checked' : '') + ' style="width:auto"> ' + label + '</label>';
  }
  function enumField(key, label, val, options) {
    html += '<label>' + label + '</label><select data-k="' + key + '">';
    options.forEach(function (opt) {
      html += '<option value="' + opt + '"' + (val === opt ? ' selected' : '') + '>' + opt + '</option>';
    });
    html += '</select>';
  }
  function pairField(key, label, v0, v1) {
    html += '<label>' + label + '</label><div class="prow"><div><input type="number" data-k="' + key + '.0" value="' + v0 + '" step="0.5"></div><div><input type="number" data-k="' + key + '.1" value="' + v1 + '" step="0.5"></div></div>';
  }
  if (m.type === 'wall') {
    if (m.at !== undefined) {
      numField('at', 'Lane (indexed, ×0.5 = world x)', m.at);
    } else {
      pairField('from', 'From [indexedX, z]', m.from[0], m.from[1]);
      pairField('to', 'To [indexedX, z]', m.to[0], m.to[1]);
    }
    boolField('destructible', 'Destructible', m.destructible);
    if (m.destructible) numField('hp', 'HP', m.hp || 5);
    boolField('mirror', 'Bullet mirror (bounces bullets)', m.mirror);
  } else if (m.type === 'boulder') {
    pairField('at', 'At [indexedX, z]', m.at[0], m.at[1]);
    numField('angle', 'Angle° (0=N, 90=E)', m.angle || 0);
    numField('speed', 'Speed', m.speed || 13, 0.5);
    boolField('ramp', 'Ramp underneath', m.ramp);
    if (m.blocker) numField('blocker.hp', 'Blocker HP', m.blocker.hp || 3);
    else html += '<label><input type="checkbox" data-k="blocker" style="width:auto"> Has blocker cube</label>';
    numField('delay', 'Delay (s, if no blocker)', m.delay !== undefined ? m.delay : 2);
  } else if (m.type === 'enemy') {
    enumField('kind', 'Kind', m.kind || 'base', ['base', 'big']);
    if (m.at !== undefined) numField('at', 'Lane (indexed)', m.at);
    else { numField('from', 'From lane', m.from); numField('to', 'To lane', m.to); }
    numField('perSecond', 'Per second / emitter', m.perSecond || 1, 0.1);
    numField('count', 'Total count', m.count || 100);
    numField('hp', 'HP', m.hp || 1);
    numField('speed', 'Speed', m.speed || 2.1, 0.1);
    numField('damage', 'Damage', m.damage || 1);
    boolField('healthbar', 'Health bar', m.healthbar);
  } else if (m.type === 'viaduct') {
    numField('from', 'From lane (indexed)', m.from);
    numField('to', 'To lane (indexed)', m.to);
    numField('shots', 'Column shots', m.shots || 3);
    numField('contents.value', 'Banner value', (m.contents && m.contents.value) || 1);
    numField('contents.speed', 'Banner speed', (m.contents && m.contents.speed) || 3.45, 0.1);
  }
  fields.innerHTML = html;
  // position near click, clamped to viewport
  var px = Math.min(clientX || 100, window.innerWidth - 260);
  var py = Math.min(clientY || 100, window.innerHeight - 320);
  popup.style.left = px + 'px';
  popup.style.top = py + 'px';
  popup.classList.add('open');
}

function closePopup() {
  document.getElementById('itemPopup').classList.remove('open');
  designer.selected = -1;
}

function applyPopup() {
  var idx = designer.selected;
  if (idx < 0) return;
  var m = designer.def.modules[idx];
  var inputs = document.querySelectorAll('#popupFields [data-k]');
  inputs.forEach(function (inp) {
    var k = inp.dataset.k;
    var val;
    if (inp.type === 'checkbox') val = inp.checked;
    else if (inp.type === 'number') val = parseFloat(inp.value);
    else val = inp.value;
    // support nested keys like "blocker.hp" and "from.0"
    var parts = k.split('.');
    var obj = m;
    for (var i = 0; i < parts.length - 1; i++) {
      var pk = parts[i];
      if (pk === 'blocker' && !obj.blocker && val === true) { obj.blocker = { hp: 3 }; return; }
      if (obj[pk] === undefined) obj[pk] = {};
      obj = obj[pk];
    }
    var lk = parts[parts.length - 1];
    if (lk === 'blocker' && val === false) { delete obj.blocker; return; }
    obj[lk] = val;
  });
  // cleanup: if blocker checkbox unchecked, remove
  syncDesignerJson();
  rebuildDesignerWorld();
  closePopup();
}

function loadCustomLevel(def) {
  // Play a designer-created level. Stores it for Back to Designer.
  designer.customDef = JSON.parse(JSON.stringify(def)); // deep copy
  designer.playingCustom = true;
  designer.active = false;
  cur.levelDef = designer.customDef;
  document.getElementById('designerPanel').classList.remove('open');
  document.getElementById('designerPanel').style.display = 'none';
  closePopup();
  // force chase view for play
  if (cur.topDown) document.getElementById('camBtn').click();
  var S = createGame(def);
  enrichLevel(S.level, def);
  cur.S = S;
  cur.W = S.level.width; cur.D = S.level.depth;
  cur.paused = false; cur.levelIdx = -1;
  targetXCmd = null; particles = [];
  for (var k in im) { scene.remove(im[k]); if (im[k].geometry) im[k].geometry.dispose(); }
  buildInstanced(); buildWorld(S.level); fitCamera(cur.W, cur.D);
  el.levelName.textContent = def.name + ' (custom)';
  el.overlay.classList.add('hidden');
  if (designerHelpers) designerHelpers.visible = false;
  // show Back to Designer button
  var panel = document.getElementById('designerPanel');
  panel.style.display = 'block'; panel.classList.add('open');
  document.getElementById('desBackBtn').style.display = 'block';
  // hide other designer controls while playing
  document.querySelector('#designerPanel .tools').style.display = 'none';
  document.getElementById('designerJson').style.display = 'none';
  updateHud();
}

function backToDesigner() {
  if (designer.customDef) designer.def = designer.customDef;
  designer.playingCustom = false;
  document.querySelector('#designerPanel .tools').style.display = 'grid';
  document.getElementById('designerJson').style.display = 'block';
  document.getElementById('desBackBtn').style.display = 'none';
  enterDesigner();
}

// Designer pointer handling (top-down only)
var desDrag = null; // {idx, dx, dz} for moving
function designerPointerDown(clientX, clientY) {
  if (!designer.active) return false;
  var g = screenToGround(clientX, clientY);
  if (!g) return true;
  var sx = snap(g.x), sz = snap(g.z);
  var tool = designer.tool;
  if (tool === 'select') {
    var idx = pickModule(g.x, g.z);
    if (idx >= 0) {
      // start drag; popup opens on click (pointerup without move), not on drag
      // for two-point items (angled wall), remember which endpoint was grabbed
      var dragInfo = { idx: idx, startX: g.x, startZ: g.z, moved: false, cx: clientX, cy: clientY, endpoint: -1 };
      var dm = designer.def.modules[idx];
      if (dm.type === 'wall' && dm.from && dm.to) {
        var d0 = Math.hypot(g.x - dm.from[0] * 0.5, g.z - dm.from[1]);
        var d1 = Math.hypot(g.x - dm.to[0] * 0.5, g.z - dm.to[1]);
        dragInfo.endpoint = d0 <= d1 ? 0 : 1;
      }
      desDrag = dragInfo;
    } else closePopup();
  } else if (tool === 'eraser') {
    var eidx = pickModule(g.x, g.z);
    if (eidx >= 0) {
      designer.def.modules.splice(eidx, 1);
      syncDesignerJson(); rebuildDesignerWorld();
    }
  } else if (tool === 'wallV') {
    designer.def.modules.push({ type: 'wall', at: Math.round(sx * 2) });
    syncDesignerJson(); rebuildDesignerWorld();
  } else if (tool === 'wallA') {
    if (!designer.placingWallA) {
      designer.placingWallA = [Math.round(sx * 2), Math.round(sz)];
    } else {
      var a = designer.placingWallA;
      designer.def.modules.push({ type: 'wall', from: a, to: [Math.round(sx * 2), Math.round(sz)] });
      designer.placingWallA = null;
      syncDesignerJson(); rebuildDesignerWorld();
    }
  } else if (tool === 'boulder') {
    designer.def.modules.push({
      type: 'boulder', at: [Math.round(sx * 2), Math.round(sz)],
      angle: 90, speed: 14, ramp: true, blocker: { hp: 3 },
    });
    syncDesignerJson(); rebuildDesignerWorld();
    setDesignerTool('select');
  } else if (tool === 'enemy') {
    designer.def.modules.push({
      type: 'enemy', kind: 'base', from: Math.round(sx * 2) - 5, to: Math.round(sx * 2) + 5,
      perSecond: 1.0, count: 100, hp: 1, speed: 2.1, damage: 1,
    });
    syncDesignerJson(); rebuildDesignerWorld();
    setDesignerTool('select');
  } else if (tool === 'viaduct') {
    var f = Math.round(sx * 2) - 6;
    designer.def.modules.push({
      type: 'viaduct', from: f, to: f + 12, shots: 3, color: 0x2b6fd9,
      contents: { kind: 'pickup', value: 1, speed: 3.45 },
    });
    syncDesignerJson(); rebuildDesignerWorld();
    setDesignerTool('select');
  }
  return true;
}

function designerPointerMove(clientX, clientY) {
  if (!designer.active || !desDrag) return false;
  var g = screenToGround(clientX, clientY);
  if (!g) return true;
  // mark as a drag if the pointer moved more than a few pixels
  if (!desDrag.moved && Math.hypot(clientX - desDrag.cx, clientY - desDrag.cy) > 6) {
    desDrag.moved = true;
    closePopup(); // don't leave a stale popup open while dragging
  }
  if (!desDrag.moved) return true;
  var m = designer.def.modules[desDrag.idx];
  if (!m) return true;
  var nx = snap(g.x), nz = snap(g.z);
  // two-point item: drag just the grabbed endpoint (no redraw until drop)
  if (m.type === 'wall' && m.from && m.to && desDrag.endpoint >= 0) {
    var pt = desDrag.endpoint === 0 ? m.from : m.to;
    pt[0] = Math.round(nx * 2); pt[1] = Math.round(nz);
    return true;
  }
  // otherwise move the whole item by the snapped delta
  var dx = nx - snap(desDrag.startX);
  var dz = nz - snap(desDrag.startZ);
  if (dx === 0 && dz === 0) return true;
  // move the module by the delta (in its own coordinate form)
  if (m.type === 'wall') {
    if (m.at !== undefined) m.at = Math.round((m.at + dx * 2));
    else { m.from[0] += dx * 2; m.from[1] += dz; m.to[0] += dx * 2; m.to[1] += dz; }
  } else if (m.type === 'boulder') {
    m.at[0] += dx * 2; m.at[1] += dz;
  } else if (m.type === 'enemy') {
    if (m.at !== undefined) m.at += dx * 2;
    else { m.from += dx * 2; m.to += dx * 2; }
  } else if (m.type === 'viaduct') {
    m.from += dx * 2; m.to += dx * 2;
  }
  desDrag.startX = g.x; desDrag.startZ = g.z;
  // no redraw until drop (user request) — just update the data
  return true;
}

function designerPointerUp() {
  // if it was a drag, sync + redraw once on drop
  if (desDrag && desDrag.moved) {
    syncDesignerJson();
    rebuildDesignerWorld();
  }
  // click (no drag) on an item opens its popup; a drag just moves it
  if (desDrag && !desDrag.moved) {
    openPopup(desDrag.idx, desDrag.cx, desDrag.cy);
  }
  desDrag = null;
  return designer.active;
}

// ---------- input: relative drag moves the mob (no camera feedback loop) ----------
// Absolute screen->world mapping breaks when the camera follows the mob
// (the mapping shifts as the camera moves, causing runaway/jerk).
// Instead, pointer DELTAS move the mob 1:1 with the finger on screen.
var targetXCmd = null;
var lastPX = null; // last pointer clientX for delta tracking
function pxToWorld() {
  // world units per screen pixel at the mob's depth
  if (!cur.S) return 0.03;
  var dist = Math.abs((cur.D + 22) - cur.S.player.z);
  var halfW = dist * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
  var rectW = renderer.domElement.getBoundingClientRect().width || 1;
  return (2 * halfW) / rectW;
}
function onPointMove(clientX) {
  if (!cur.S) return;
  if (lastPX !== null) {
    var dxWorld = (clientX - lastPX) * pxToWorld();
    var base = (targetXCmd === null) ? cur.S.mobX : targetXCmd;
    targetXCmd = base + dxWorld;
  }
  lastPX = clientX;
}
function onPointDown(clientX) { lastPX = clientX; }
function onPointUp() { lastPX = null; }
// pointer lock: click captures the mouse for infinite movement (no screen edge)
var pointerLocked = false;
function tryLockPointer() {
  var el = renderer.domElement;
  if (el.requestPointerLock) {
    try {
      var p = el.requestPointerLock();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
}
if (document.addEventListener) document.addEventListener('pointerlockchange', function () {
  pointerLocked = (document.pointerLockElement === renderer.domElement);
  lastPX = null;
});
renderer.domElement.addEventListener('pointermove', function (ev) {
  if (!cur.S) return;
  if (designer.active) { designerPointerMove(ev.clientX, ev.clientY); return; }
  if (pointerLocked) {
    // infinite relative movement; mouse never hits the screen edge
    var dxW = (ev.movementX || 0) * pxToWorld();
    var base = (targetXCmd === null) ? cur.S.mobX : targetXCmd;
    targetXCmd = base + dxW;
  } else {
    onPointMove(ev.clientX);
  }
});
renderer.domElement.addEventListener('pointerdown', function (ev) {
  if (designer.active) { designerPointerDown(ev.clientX, ev.clientY); return; }
  if (ev.pointerType === 'mouse' && !pointerLocked) tryLockPointer();
  if (!pointerLocked) onPointDown(ev.clientX);
});
window.addEventListener('pointerup', function (ev) {
  if (designer.active) { designerPointerUp(); return; }
  onPointUp(ev);
});
renderer.domElement.addEventListener('wheel', function (ev) {
  if (!cur.topDown) return;
  ev.preventDefault();
  var rect = renderer.domElement.getBoundingClientRect();
  var nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  var ny = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  // ground point under cursor BEFORE zoom
  var g = screenToGround(ev.clientX, ev.clientY);
  var newZoom = Math.max(0.4, Math.min(3.0, designer.zoom * (ev.deltaY > 0 ? 0.9 : 1.12)));
  if (g && newZoom !== designer.zoom) {
    // visible size at ground for old and new zoom
    var t = Math.tan(camera.fov * Math.PI / 360);
    var aspect = rect.width / rect.height;
    function visH(z) { return 2 * ((cur.D / 2 + 12) / t / z) * t; } // = 2*(D/2+12)/z
    var vh2 = visH(newZoom), vw2 = vh2 * aspect;
    // new target so (gx,gz) stays under the cursor:
    // gx = tx2 + nx*(vw2/2)  =>  tx2 = gx - nx*(vw2/2)
    // gz = tz2 - ny*(vh2/2)  =>  tz2 = gz + ny*(vh2/2)
    var tx2 = g.x - nx * (vw2 / 2);
    var tz2 = g.z + ny * (vh2 / 2);
    // clamp pan so you can't lose the field
    designer.panX = Math.max(-cur.W, Math.min(cur.W, tx2 - cur.W / 2));
    designer.panZ = Math.max(-cur.D, Math.min(cur.D, tz2 - cur.D / 2));
  }
  designer.zoom = newZoom;
}, { passive: false });
window.addEventListener('pointercancel', onPointUp);
renderer.domElement.addEventListener('pointerleave', onPointUp);
window.addEventListener('keydown', function (ev) {
  if (!cur.S) return;
  if (ev.key === 'ArrowLeft') targetXCmd = (targetXCmd === null ? cur.S.mobX : targetXCmd) - 3;
  if (ev.key === 'ArrowRight') targetXCmd = (targetXCmd === null ? cur.S.mobX : targetXCmd) + 3;
  if (ev.key === 'f' || ev.key === 'F') el.focusBtn.click();
});
window.__cc = { moveTo: function (x) { targetXCmd = x; }, loadLevel: loadLevel, get S() { return cur.S; } };

// ---------- hud ----------
var lastEnemiesLeft = -1, lastSquad = -1, lastHp = -1;
function updateHud() {
  var S = cur.S; if (!S) return;
  var left = enemiesRemaining(S);
  if (left !== lastEnemiesLeft) { el.enemiesLeft.textContent = left; lastEnemiesLeft = left; }
  if (S.squad !== lastSquad) { el.squadCount.textContent = S.squad; lastSquad = S.squad; }
  var hpPct = Math.max(0, S.player.hp / S.player.maxHp * 100);
  if (Math.abs(hpPct - lastHp) > 0.5) {
    el.hpFill.style.width = hpPct + '%';
    el.hpFill.style.background = hpPct > 50 ? '#5fd35f' : (hpPct > 25 ? '#f2c230' : '#e04848');
    lastHp = hpPct;
  }
}
el.pauseBtn.addEventListener('click', function () {
  if (!cur.S || cur.S.status !== 'playing') return;
  cur.paused = !cur.paused;
  el.pauseBtn.textContent = cur.paused ? '▶' : '⏸';
});
el.restartBtn.addEventListener('click', function () { loadLevel(cur.levelIdx); });
el.focusBtn.addEventListener('click', function () {
  if (!cur.S || cur.S.status !== 'playing') return;
  cur.S.concentrated = !cur.S.concentrated;
  el.focusBtn.style.background = cur.S.concentrated ? '#f2c230' : '';
  el.focusBtn.style.color = cur.S.concentrated ? '#000' : '';
});
el.camBtn.addEventListener('click', function () {
  cur.topDown = !cur.topDown;
  el.camBtn.style.background = cur.topDown ? '#f2c230' : '';
  el.camBtn.style.color = cur.topDown ? '#000' : '';
});
el.againBtn.addEventListener('click', function () {
  if (designer.playingCustom && designer.customDef) backToDesigner();
  else loadLevel(cur.levelIdx);
});
// designer buttons
document.getElementById('desBtn').addEventListener('click', function () {
  if (designer.active) exitDesigner(); else enterDesigner();
});
document.querySelectorAll('#designerPanel .tools button').forEach(function (b) {
  b.addEventListener('click', function () { setDesignerTool(b.dataset.tool); });
});
document.getElementById('desPlayBtn').addEventListener('click', function () {
  loadCustomLevel(designer.def);
});
document.getElementById('desExitBtn').addEventListener('click', exitDesigner);
document.getElementById('desBackBtn').addEventListener('click', backToDesigner);
document.getElementById('desCopyBtn').addEventListener('click', function () {
  var ta = document.getElementById('designerJson');
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
});
document.getElementById('desApplyBtn').addEventListener('click', applyDesignerJson);
document.getElementById('popupApply').addEventListener('click', applyPopup);
document.getElementById('popupClose').addEventListener('click', closePopup);
document.getElementById('popupDelete').addEventListener('click', function () {
  if (designer.selected >= 0) {
    designer.def.modules.splice(designer.selected, 1);
    syncDesignerJson(); rebuildDesignerWorld(); closePopup();
  }
});
el.prevBtn.addEventListener('click', function () { loadLevel((cur.levelIdx + LEVELS.length - 1) % LEVELS.length); });
el.nextBtn.addEventListener('click', function () { loadLevel((cur.levelIdx + 1) % LEVELS.length); });

// ---------- events -> visuals ----------
function findVV(id) {
  for (var i = 0; i < viaductViews.length; i++) if (viaductViews[i].v.id === id) return viaductViews[i];
  return null;
}
function handleEvents(S) {
  S.events.forEach(function (ev) {
    switch (ev.t) {
      case 'enemyDie':
        if (ev.crushed) burst(ev.x, 0.7, ev.z, 5, 0x8a7f72, 5); // gray dust for crush
        else burst(ev.x, 0.7, ev.z, 3, ev.kind === 'big' ? 0x7d1410 : 0xd8362a, 4);
        break;
      case 'boulderRoll':
        burst(ev.x, 0.5, ev.z, 4, 0x9a8f82, 3); // dust puff on release
        break;
      case 'boulderStop':
        shakeT = Math.max(shakeT, 0.4);
        burst(ev.x, 1.0, ev.z, 10, 0x8a7f72, 6); // impact burst
        break;
      case 'boulderCrumble':
        burst(ev.x, 0.8, ev.z, 2, 0x7a6f62, 3); // crumbling debris
        break;
      case 'blockerHit': {
        burst(ev.x, 0.8, ev.z, 3, 0xd08050, 4); // orange sparks
        // update the HP label
        for (var bbi = 0; bbi < boulderMeshes.length; bbi++) {
          if (boulderMeshes[bbi].bd.id === ev.id && boulderMeshes[bbi].blockerLabel) {
            boulderMeshes[bbi].blockerLabel.draw(String(Math.max(0, ev.hpLeft)), '#ffffff');
          }
        }
        break;
      }
      case 'blockerDown':
        burst(ev.x, 0.8, ev.z, 8, 0xc46a4a, 5); // cube shatter
        shakeT = Math.max(shakeT, 0.25);
        break;
      case 'wallHit':
        burst(ev.x, 1.2, ev.z, 3, 0xb9b3a6, 4); // concrete chips
        // update HP labels
        for (var whi = 0; whi < wallMeshes.length; whi++) {
          var wme = wallMeshes[whi];
          if (wme.label && Math.abs((wme.wl.x1 + wme.wl.x2) / 2 - ev.x) < 3 &&
              Math.abs((wme.wl.z1 + wme.wl.z2) / 2 - ev.z) < 8) {
            wme.label.draw(String(Math.max(0, ev.hpLeft)), '#ffffff');
          }
        }
        break;
      case 'wallDown':
        burst(ev.x, 1.2, ev.z, 12, 0x8a8078, 6); // wall collapse rubble
        shakeT = Math.max(shakeT, 0.35);
        break;
      case 'mirrorBounce':
        burst(ev.x, 1.2, ev.z, 4, 0xd94a6a, 5); // pink sparkle on bounce
        break;
      case 'enemyLeak':
        shakeT = Math.max(shakeT, 0.3);
        el.flash.style.opacity = '0.55';
        setTimeout(function () { el.flash.style.opacity = '0'; }, 120);
        burst(ev.x, 0.9, ev.z, 6, 0xff6655, 7);
        break;
      case 'columnHit': {
        var vv = findVV(ev.id);
        if (vv) vv.label.draw(String(Math.max(0, ev.shotsLeft)), '#ffffff');
        burst(ev.x, 1.4, ev.z, 4, 0xb9b3a6, 4);
        shakeT = Math.max(shakeT, 0.15);
        break;
      }
      case 'columnDown': {
        var vv2 = findVV(ev.id);
        if (vv2) {
          vv2.anim = 0.0001;
          vv2.label.sprite.visible = false;
          // leave rubble chunks at the base
          for (var i = 0; i < 5; i++) {
            var rk = box(0.5 + Math.random() * 0.5, 0.4 + Math.random() * 0.4, 0.5 + Math.random() * 0.5,
              phong(0x9d968a, 15));
            rk.position.set(ev.x + (Math.random() - 0.5) * 3.4, 0.25, ev.z + (Math.random() - 0.5) * 3.4);
            rk.rotation.y = Math.random() * 3;
            world.add(rk);
            vv2.rubble.push(rk);
          }
        }
        burst(ev.x, 1.5, ev.z, 26, 0xa9a49a, 9);
        burst(ev.x, 3.2, ev.z, 10, 0xcac2b2, 7);
        spawnPopup('BRIDGE DOWN', ev.x, 6.2, ev.z, '#ffe14d');
        shakeT = Math.max(shakeT, 0.5);
        break;
      }
      case 'pickupGet':
        spawnPopup('+' + ev.value, ev.x, 2.0, ev.z, '#ffe14d');
        burst(ev.x, 1.1, ev.z, 4, 0xffe14d, 4);
        break;
      case 'win': showOverlay(true, ev.stats); break;
      case 'lose': showOverlay(false, ev.stats); break;
    }
  });
}

function showOverlay(won, stats) {
  // release the mouse when the level ends
  if (document.exitPointerLock) document.exitPointerLock();
  el.ovTitle.textContent = won ? 'LEVEL CLEAR' : 'OVERRUN';
  el.ovTitle.style.color = won ? '#5fd35f' : '#e04848';
  el.ovStats.innerHTML =
    'Enemies destroyed: <b>' + stats.killed + '</b><br>' +
    'Leaked through: <b>' + stats.leaked + '</b><br>' +
    'Pickups collected: <b>' + stats.pickupCount + ' (+' + stats.pickupsGot + ' troops)</b><br>' +
    'Bridges dropped: <b>' + stats.columnsDown + '</b>';
  // in designer-play mode the button goes back to the editor
  el.againBtn.textContent = designer.playingCustom ? '🎨 Back to Designer' : 'Play again';
  el.overlay.classList.remove('hidden');
}

// ---------- per-frame render ----------
var _color = new THREE.Color();
function render(dt) {
  var S = cur.S;
  if (!S) return;
  var t = S.time;

  // water drift
  waterTex.offset.x = t * 0.008;
  waterTex.offset.y = t * 0.005;

  // bridge collapse animation
  viaductViews.forEach(function (vv) {
    if (vv.anim > 0 && vv.anim < 1) {
      vv.anim = Math.min(1, vv.anim + dt * 1.6);
      var a = vv.anim;
      // front support gone: deck tilts down from the back edge (pivot)
      vv.pivot.rotation.x = a * 0.11;
      vv.columnParts.forEach(function (p) {
        p.scale.y = Math.max(0.001, 1 - a);
      });
      // re-seat parts so they squash toward the ground (column is taller now)
      vv.columnParts[0].position.y = 0.25 * vv.columnParts[0].scale.y;
      vv.columnParts[1].position.y = 0.5 * vv.columnParts[0].scale.y + 3.0 * vv.columnParts[1].scale.y;
      vv.columnParts[2].position.y = 0.5 * vv.columnParts[0].scale.y + 6.0 * vv.columnParts[1].scale.y + 0.2 * vv.columnParts[2].scale.y;
    }
    // banners ARE the pickups: ONE merged object (box + label on front face).
    // Lined up on the deck until the column falls, then drift toward the mob.
    var blist = vv.v.banners;
    for (var bi = 0; bi < blist.length; bi++) {
      var b = blist[bi];
      if (b.collected) {
        setInst(vv.bannerMesh, bi, 0, -10, 0, 0.001, 0.001, 0.001, 0);
      } else {
        // sway while on the deck; steady while drifting
        var sway = vv.v.bannersReleased ? 0 : Math.sin(t * 2.1 + vv.bannerPhase + bi * 0.7) * 0.07;
        // ride on top of the (possibly tilted) deck surface; drop to ground past the end
        var tilt = vv.pivot.rotation.x;
        var by;
        if (b.z <= vv.v.deckZ1) {
          by = 7.45 - (b.z - vv.v.deckZ0) * Math.sin(tilt) + 2.45;
        } else {
          by = 2.6;
        }
        setInst(vv.bannerMesh, bi, b.x, by, b.z, 1, 1, 1, sway);
      }
    }
    // hide unused slots
    for (var bhi = blist.length; bhi < 64; bhi++) {
      setInst(vv.bannerMesh, bhi, 0, -10, 0, 0.001, 0.001, 0.001, 0);
    }
    vv.bannerMesh.instanceMatrix.needsUpdate = true;
  });

  // enemies: torso + head + helmet, walk bob + sway
  var nT = 0, nH = 0, nHl = 0, nBT = 0, nBH = 0, nBHl = 0, nHb = 0;
  for (var i = 0; i < S.enemies.length; i++) {
    var e = S.enemies[i];
    var bob = Math.abs(Math.sin(t * 9 + e.phase)) * 0.13;
    var sway = Math.sin(t * 9 + e.phase) * 0.09;
    if (e.kind === 'big') {
      setInst(im.bTorso, nBT, e.x, 1.65 + bob, e.z, 1, 1, 1, sway * 0.6);
      setInst(im.bHead, nBH, e.x, 2.95 + bob, e.z);
      setInst(im.bHelmet, nBHl, e.x, 3.06 + bob, e.z);
      nBT++; nBH++; nBHl++;
    } else {
      setInst(im.eTorso, nT, e.x, 0.72 + bob, e.z, 1, 1, 1, sway);
      setInst(im.eHead, nH, e.x, 1.32 + bob, e.z);
      setInst(im.eHelmet, nHl, e.x, 1.4 + bob, e.z);
      nT++; nH++; nHl++;
    }
    // healthbar above enemies that have one (big guys)
    if (e.healthbar && !e.dead) {
      var f = Math.max(0, e.hp / e.maxHp);
      setInst(im.hbBg, nHb, e.x, 3.75 + bob, e.z);
      setInst(im.hbFg, nHb, e.x, 3.75 + bob, e.z + 0.02, f, 1, 1, 0);
      nHb++;
    }
  }
  im.eTorso.count = nT; im.eHead.count = nH; im.eHelmet.count = nHl;
  im.bTorso.count = nBT; im.bHead.count = nBH; im.bHelmet.count = nBHl;
  im.hbBg.count = nHb; im.hbFg.count = nHb;
  [im.eTorso, im.eHead, im.eHelmet, im.bTorso, im.bHead, im.bHelmet,
   im.hbBg, im.hbFg].forEach(function (m) {
    m.instanceMatrix.needsUpdate = true;
  });

  // squad mob around the player (shared formation with the logic, so each
  // troop's bullets come from its own position)
  var nt = 0;
  var show = Math.min(S.squad, 60);
  for (var s = 0; s < show; s++) {
    var so = soldierOffset(S.squad, s, S.concentrated);
    var sx = S.mobX + so.dx, sz = S.player.z + so.dz;
    var sb = Math.abs(Math.sin(t * 11 + s * 1.7)) * 0.09;
    var ssw = Math.sin(t * 11 + s * 1.7) * 0.07;
    setInst(im.tTorso, nt, sx, 0.72 + sb, sz, 1, 1, 1, ssw);
    setInst(im.tHead, nt, sx, 1.32 + sb, sz);
    setInst(im.tHelmet, nt, sx, 1.4 + sb, sz);
    nt++;
  }
  im.tTorso.count = nt; im.tHead.count = nt; im.tHelmet.count = nt;
  im.tTorso.instanceMatrix.needsUpdate = true;
  im.tHead.instanceMatrix.needsUpdate = true;
  im.tHelmet.instanceMatrix.needsUpdate = true;
  if (playerMesh) {
    playerMesh.position.x = S.mobX;
    playerMesh.position.y = Math.abs(Math.sin(t * 11)) * 0.05;
  }

  // pickups: steady glowing squares with the +1 / +10 on their face,
  // drifting down in single file (gentle float, no wobble)
  var npk = 0, nFB = 0, nFY = 0;
  for (var pk = 0; pk < S.pickups.length && npk < 256; pk++) {
    var p = S.pickups[pk];
    var pb = Math.sin(t * 4 + p.id) * 0.08;
    setInst(im.pickup, npk, p.x, 0.9 + pb, p.z);
    im.pickup.setColorAt(npk, _color.setHex(p.color));
    setInst(im.pickupGlow, npk, p.x, 0.9 + pb, p.z, 1, 1, 1);
    im.pickupGlow.setColorAt(npk, _color.setHex(p.color));
    // number face toward the camera (billboard tilt matches the camera)
    var fm = p.value >= 10 ? im.pickupFaceY : im.pickupFaceB;
    var fi = p.value >= 10 ? nFY++ : nFB++;
    if (fi < 256) setInst(fm, fi, p.x, 0.9 + 0.4 + pb, p.z + 0.66, 1, 1, 1, 0, -0.54);
    npk++;
  }
  im.pickup.count = npk; im.pickupGlow.count = npk;
  im.pickupFaceB.count = nFB; im.pickupFaceY.count = nFY;
  im.pickup.instanceMatrix.needsUpdate = true;
  im.pickupGlow.instanceMatrix.needsUpdate = true;
  im.pickupFaceB.instanceMatrix.needsUpdate = true;
  im.pickupFaceY.instanceMatrix.needsUpdate = true;
  if (im.pickup.instanceColor) im.pickup.instanceColor.needsUpdate = true;
  if (im.pickupGlow.instanceColor) im.pickupGlow.instanceColor.needsUpdate = true;

  // bullets (visual offset +0.425z so the front tip, not the center,
  // sits at the logic position — the tracer never visually pierces a wall)
  for (var b = 0; b < S.bullets.length && b < 768; b++) {
    var bl = S.bullets[b];
    setInst(im.bullet, b, bl.x, bl.y, bl.z + 0.425);
  }
  im.bullet.count = Math.min(S.bullets.length, 768);
  im.bullet.instanceMatrix.needsUpdate = true;

  // walls: hide when destroyed (destructible)
  for (var wi = 0; wi < wallMeshes.length; wi++) {
    var wm = wallMeshes[wi];
    var showW = !wm.wl.destroyed;
    for (var wj = 0; wj < wm.meshes.length; wj++) wm.meshes[wj].visible = showW;
    if (wm.label) wm.label.sprite.visible = showW;
  }

  // boulders: position, rolling rotation, crumble shrink
  for (var bi = 0; bi < boulderMeshes.length; bi++) {
    var bm = boulderMeshes[bi], bd = bm.bd;
    if (bd.state === 'gone') {
      bm.mesh.visible = false;
      if (bm.rampMesh) bm.rampMesh.visible = false;
      if (bm.blockerMesh) bm.blockerMesh.visible = false;
      if (bm.blockerLabel) bm.blockerLabel.sprite.visible = false;
      continue;
    }
    bm.mesh.visible = true;
    // perched on ramp (elevated) when blocked/waiting, ground level when rolling
    var perchY = (bd.ramp && (bd.state === 'blocked' || bd.state === 'waiting')) ? bd.r + 0.5 : bd.r;
    bm.mesh.position.set(bd.x, perchY, bd.z);
    if (bd.state === 'rolling') {
      // roll around axis perpendicular to travel dir (top moves in travel dir)
      var axis = new THREE.Vector3(bd.dz, 0, -bd.dx).normalize();
      bm.mesh.setRotationFromAxisAngle(axis, bd.rollA);
    } else if (bd.state === 'crumbling') {
      var cs = Math.max(0.05, bd.crumbleT / 0.9); // shrink as it crumbles
      bm.mesh.scale.set(cs, cs, cs);
      bm.mesh.rotation.y += dt * 3; // wobble
    } else { // blocked/waiting: gentle idle bob
      bm.mesh.position.y = perchY + Math.sin(performance.now() * 0.003 + bd.id) * 0.08;
    }
    // blocker cube: visible until destroyed, label shows HP
    if (bm.blockerMesh) {
      var bk = bd.blocker;
      var showBk = bk && !bk.destroyed;
      bm.blockerMesh.visible = showBk;
      if (bm.blockerLabel) {
        bm.blockerLabel.sprite.visible = showBk;
        if (showBk) {
          // pulse when hit (label redrawn on blockerHit event)
        }
      }
    }
  }

  // particles
  var npt = 0;
  for (var q = particles.length - 1; q >= 0; q--) {
    var pt = particles[q];
    pt.life -= dt;
    if (pt.life <= 0) { particles.splice(q, 1); continue; }
    pt.vy -= 14 * dt;
    pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
    if (pt.y < 0.15) { pt.y = 0.15; pt.vy *= -0.3; }
    var sc = Math.max(0.05, pt.life);
    setInst(im.particle, npt, pt.x, pt.y, pt.z, sc, sc, sc);
    im.particle.setColorAt(npt, _color.setHex(pt.color));
    npt++;
  }
  im.particle.count = npt;
  im.particle.instanceMatrix.needsUpdate = true;
  if (im.particle.instanceColor) im.particle.instanceColor.needsUpdate = true;

  // popups
  popups.forEach(function (pp) {
    if (pp.life <= 0) return;
    pp.life -= dt;
    pp.lb.sprite.position.y += pp.vy * dt;
    pp.lb.sprite.material.opacity = Math.max(0, pp.life);
    if (pp.life <= 0) pp.lb.sprite.visible = false;
  });

  // camera: locked directly to the mob (no separate lag)
  var distM = 26;
  var hw = distM * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
  var tX = (hw * 2 >= cur.W + 4) ? cur.W / 2
    : Math.max(hw * 0.7, Math.min(cur.W - hw * 0.7, S.mobX));
  camX = tX;
  var shx = 0, shy = 0;
  if (shakeT > 0) {
    shakeT = Math.max(0, shakeT - dt * 1.4);
    shx = (Math.random() - 0.5) * shakeT * 0.9;
    shy = (Math.random() - 0.5) * shakeT * 0.9;
  }
  if (cur.topDown) {
    // top-down tactical view: whole field from directly above
    // (panX/panZ let wheel-zoom anchor at the cursor instead of the center)
    var topH = (cur.D / 2 + 12) / Math.tan(camera.fov * Math.PI / 360) / (designer.zoom || 1);
    var tX = cur.W / 2 + designer.panX, tZ = cur.D / 2 + designer.panZ;
    camera.position.set(tX + shx, topH, tZ + 0.1);
    camera.lookAt(tX, 0, tZ);
  } else {
    camera.position.set(camX + shx, 11 + shy, cur.D + 22);
    camera.lookAt(camX + shx * 0.5, 2.5, cur.D / 2 - 6);
  }

  updateHud();
  renderer.render(scene, camera);
}

// ---------- main loop ----------
var lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  var dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  var S = cur.S;
  if (S && S.status === 'playing' && !cur.paused) {
    updateGame(S, dt, { targetX: targetXCmd });
    handleEvents(S);
  }
  render(dt);
}

// ---------- boot ----------
initPopups(24);
loadLevel(0);
requestAnimationFrame(frame);

})();
