// Minimal unit tests for angle utilities (no DOM needed)

import { smoothAngle, deg2rad } from '../angleUtils';
import { coRegisterY } from '../calibrationUtils';

// Test smoothAngle
console.assert(
  Math.abs(smoothAngle(0, 1.0, 0.6) - 0.6) < 1e-6,
  'smoothAngle: alpha=0.6 should give 0.6 * 1.0 = 0.6'
);

console.assert(
  Math.abs(smoothAngle(0.5, 0.8, 0.6) - (0.6 * 0.8 + 0.4 * 0.5)) < 1e-6,
  'smoothAngle: should blend previous and next values'
);

console.assert(
  smoothAngle(0, deg2rad(25), 0.6, deg2rad(20)) <= deg2rad(20),
  'smoothAngle: should clamp to maxAbs'
);

console.log('✓ smoothAngle tests passed');

// Test coRegisterY
const yF = 1400, hF = 1100, tF = 2100, hS = 1120, tS = 2140;
const r = (yF - hF) / (tF - hF);
const yS = hS + r * (tS - hS);
const coRegResult = coRegisterY(yF, hF, tF, hS, tS);
console.assert(
  Math.abs(coRegResult - yS) < 1e-6,
  `coRegisterY: expected ${yS}, got ${coRegResult}`
);

console.log('✓ coRegisterY tests passed');

console.log('All angle utility tests passed!');

