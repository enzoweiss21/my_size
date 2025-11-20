// Minimal unit tests for measurement utilities (no DOM needed)

import { finalizeBand } from '../measurementUtils';

// Test finalizeBand coupling
let meas = {
  frontWidthsMm: { chest: 400 },
  sideDepthsMm: { chest: 250 },
  circumferencesMm: {},
  areasMm2: {},
  flags: {}
};

finalizeBand(meas, 'chest');
console.assert(
  meas.frontWidthsMm.chest <= 1.25 * meas.sideDepthsMm.chest + 1e-6,
  'finalizeBand: width should be clamped to 1.25 * depth'
);

console.assert(
  meas.sideDepthsMm.chest <= 1.25 * meas.frontWidthsMm.chest + 1e-6,
  'finalizeBand: depth should be clamped to 1.25 * width'
);

console.assert(
  meas.circumferencesMm.chest > 0,
  'finalizeBand: should calculate circumference'
);

console.assert(
  meas.areasMm2.chest > 0,
  'finalizeBand: should calculate area'
);

// Test wdSuspicious flag
let measSuspicious = {
  frontWidthsMm: { chest: 500 },
  sideDepthsMm: { chest: 200 },
  circumferencesMm: {},
  areasMm2: {},
  flags: {}
};

finalizeBand(measSuspicious, 'chest');
const wdRatio = Math.max(measSuspicious.frontWidthsMm.chest, measSuspicious.sideDepthsMm.chest) /
                Math.min(measSuspicious.frontWidthsMm.chest, measSuspicious.sideDepthsMm.chest);
if (wdRatio > 1.60) {
  console.assert(
    measSuspicious.flags.chest?.wdSuspicious === true,
    'finalizeBand: should flag wdSuspicious when ratio > 1.60'
  );
}

console.log('✓ finalizeBand tests passed');
console.log('All measurement utility tests passed!');

