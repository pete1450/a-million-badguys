/* Smoke-test game.js boot + frames with stubbed DOM/THREE. Catches ReferenceErrors/typos. */
'use strict';
const fs = require('fs');
const vm = require('vm');

function anyStub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

let rafCb = null;
const canvasStub = () => anyStub();
const sandbox = {
  console,
  performance: { now: () => simTime },
  requestAnimationFrame: (cb) => { rafCb = cb; },
  setTimeout: () => 0,
  window: { innerWidth: 900, innerHeight: 700, addEventListener() {} },
  document: {
    getElementById: () => anyStub(),
    createElement: () => anyStub(),
    querySelectorAll: () => [],
    querySelector: () => anyStub(),
  },
  THREE: anyStub(),
};
let simTime = 0;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(__dirname + '/logic.js', 'utf8'), sandbox, { filename: 'logic.js' });
vm.runInContext(fs.readFileSync(__dirname + '/game.js', 'utf8'), sandbox, { filename: 'game.js' });

// drive 600 frames (~10s game time): boot + early combat + rendering paths
for (let i = 0; i < 600; i++) {
  const cb = rafCb; rafCb = null;
  if (!cb) throw new Error('frame loop stalled at frame ' + i);
  simTime += 16.7;
  cb(simTime);
}
console.log('SMOKE OK: 600 frames, no exceptions');
