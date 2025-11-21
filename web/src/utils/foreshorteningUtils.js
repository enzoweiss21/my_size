import { clamp } from './angleUtils';

// Expand by cos with tighter caps and prevent shrinkage from rounding errors
export const expandByCos = (raw, cosVal, cap = 1.12) => {
  const base = raw / Math.max(cosVal, 0.90);
  return clamp(base, raw * 0.98, raw * cap); // never < -2% smaller
};

// Apply foreshortening corrections with soft caps
// sideTiltApplied: if true, pitch correction was already applied in lockScale, so skip it here
export const correctForeshortening = (meas, yawFrontRad, pitchSideRad, sideTiltApplied = false) => {
  const cosy = Math.max(Math.cos(Math.abs(yawFrontRad || 0)), 0.90); // a bit stricter
  const cosp = Math.max(Math.cos(Math.abs(pitchSideRad || 0)), 0.90);
  const cap = 1.12; // max +12% expansion (slightly tighter)
  
  const corrected = {
    frontWidthsMm: meas.frontWidthsMm ? { ...meas.frontWidthsMm } : {},
    sideDepthsMm: meas.sideDepthsMm ? { ...meas.sideDepthsMm } : {}
  };
  
  // Correct front widths for yaw
  if (corrected.frontWidthsMm) {
    for (const k of ["shoulders", "chest", "waist", "hips", "thighs", "calves"]) {
      if (corrected.frontWidthsMm[k] != null && typeof corrected.frontWidthsMm[k] === 'number') {
        const wRaw = corrected.frontWidthsMm[k];
      if (isFinite(wRaw) && wRaw > 0) {
        corrected.frontWidthsMm[k] = expandByCos(wRaw, cosy, cap);
        // Validate result
        if (!isFinite(corrected.frontWidthsMm[k]) || corrected.frontWidthsMm[k] <= 0) {
          console.warn(`[${k}] Invalid corrected width, using raw value:`, wRaw);
          corrected.frontWidthsMm[k] = wRaw;
        }
      }
      }
    }
  }
  
  // Correct side depths for pitch (ONLY if not already applied in lockScale)
  if (corrected.sideDepthsMm) {
    for (const k of ["chest", "waist", "hips", "thighs", "calves"]) {
      if (corrected.sideDepthsMm[k] != null && typeof corrected.sideDepthsMm[k] === 'number') {
        const dRaw = corrected.sideDepthsMm[k];
      if (isFinite(dRaw) && dRaw > 0) {
        // Skip pitch correction if already applied in lockScale
        const dCorr = sideTiltApplied ? dRaw : expandByCos(dRaw, cosp, cap);
        corrected.sideDepthsMm[k] = dCorr;
        // Validate result
        if (!isFinite(corrected.sideDepthsMm[k]) || corrected.sideDepthsMm[k] <= 0) {
          console.warn(`[${k}] Invalid corrected depth, using raw value:`, dRaw);
          corrected.sideDepthsMm[k] = dRaw;
        }
      }
      }
    }
  }
  
  return corrected;
};

