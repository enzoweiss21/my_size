import { circumferenceMm } from './circumferenceUtils';

// Maximum width/depth ratio to catch lingering arm/torso bleed
const MAX_WD_RATIO = 1.60;

/**
 * Finalize a single band measurement with symmetric coupling and plausibility checks
 * This applies symmetric clamping and calculates circumference/area in one place
 */
export const finalizeBand = (meas, key) => {
  let w = meas.frontWidthsMm[key];
  let d = meas.sideDepthsMm[key];
  
  if (w == null || d == null || !isFinite(w) || !isFinite(d) || w <= 0 || d <= 0) {
    return; // Skip invalid measurements
  }

  // Symmetric clamp both ways (prevents arm contamination and back/head bumps)
  const r = 1.25;
  const wOriginal = w;
  const dOriginal = d;
  w = Math.min(w, r * d);
  d = Math.min(d, r * w);
  
  if (w !== wOriginal || d !== dOriginal) {
    console.warn(`[${key}] Symmetric clamping: width ${(wOriginal/10).toFixed(1)}→${(w/10).toFixed(1)}cm, depth ${(dOriginal/10).toFixed(1)}→${(d/10).toFixed(1)}cm`);
  }

  // Check W/D ratio for suspicious measurements (catches lingering arm/torso bleed)
  const wdRatio = Math.max(w, d) / Math.max(1e-6, Math.min(w, d));
  if (wdRatio > MAX_WD_RATIO) {
    console.warn(`[finalize] ${key}: W/D ratio too high (${wdRatio.toFixed(2)}); marking as suspicious`);
    meas.flags = meas.flags || {};
    meas.flags[key] = { ...meas.flags[key], wdSuspicious: true };
  } else {
    meas.flags = meas.flags || {};
    meas.flags[key] = { ...meas.flags[key], wdSuspicious: false };
  }

  // Calculate circumference using auto-chooser
  const aspectRatio = Math.max(w, d) / Math.min(w, d);
  const curvatureHint = aspectRatio > 1.3 ? 0.7 : 0.4;
  const C = circumferenceMm(w, d, curvatureHint); // mm

  // Calculate cross-sectional area (ellipse baseline)
  const semiMajorAxis = w / 2;
  const semiMinorAxis = d / 2;
  const A = Math.PI * semiMajorAxis * semiMinorAxis; // mm^2

  // Plausibility windows (tune per band as needed)
  const cm = C / 10;
  if (key === "chest" && (cm < 85 || cm > 150)) {
    console.warn(`[plausibility] chest ${cm.toFixed(1)} cm outside typical range (85-150cm)`);
  }

  // Update measurements
  meas.frontWidthsMm[key] = w;
  meas.sideDepthsMm[key] = d;
  meas.circumferencesMm = meas.circumferencesMm || {};
  meas.circumferencesMm[key] = C;
  meas.areasMm2 = meas.areasMm2 || {};
  meas.areasMm2[key] = A;
  
  return { width: w, depth: d, circumference: C, area: A };
};


