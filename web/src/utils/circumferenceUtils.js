// Ramanujan ellipse perimeter (stable version)
export const ramanujanEllipsePerimeter = (widthMm, depthMm) => {
  const a = widthMm / 2;
  const b = depthMm / 2;
  const sum = a + b;
  const diff = Math.abs(a - b);
  
  if (sum < 1e-6) return 0;
  
  const h = Math.pow(diff / sum, 2);
  return Math.PI * sum * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
};

// Superellipse (Lamé) perimeter
export const superellipsePerimeter = (aMm, bMm, n = 3.2) => {
  const steps = 256;
  const dt = 2 * Math.PI / steps;
  let s = 0;
  
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const c = Math.cos(t);
    const s1 = Math.sin(t);
    
    // Calculate derivatives for speed computation
    const dac = aMm * (2 / n) * Math.pow(Math.abs(c), 2 / n - 1) * (-Math.sin(t));
    const dbs = bMm * (2 / n) * Math.pow(Math.abs(s1), 2 / n - 1) * Math.cos(t);
    
    const speed = Math.hypot(dac, dbs);
    s += (i === 0 || i === steps) ? speed : (i % 2 ? 4 * speed : 2 * speed);
  }
  
  return (dt / 3) * s;
};

// Rounded-rectangle perimeter with aspect-dependent radius heuristic
// Make radius depend on aspect, so very oblong sections don't get over-rounded
export const roundedRectPerimeter = (widthMm, depthMm, rMm = null) => {
  const w = widthMm;
  const d = depthMm;
  let r;
  
  if (rMm != null) {
    r = rMm;
  } else {
    const aspect = Math.max(w, d) / Math.min(w, d);
    // Use smaller radius for very oblong sections
    const baseRadius = aspect > 1.35 ? 0.18 : 0.25;
    r = Math.min(w, d) * baseRadius;
    r = Math.min(r, w / 2, d / 2); // Don't exceed half the smaller dimension
  }
  
  const core = 2 * ((w - 2 * r) + (d - 2 * r));
  return core + 2 * Math.PI * r;
};

// Alias for backward compatibility
export const rrPerimeter = roundedRectPerimeter;

// Auto-chooser for circumference model
export const circumferenceMm = (widthMm, depthMm, curvatureHint = 0.5) => {
  // Validate inputs
  if (!widthMm || !depthMm || !isFinite(widthMm) || !isFinite(depthMm)) {
    console.warn("circumferenceMm: Invalid inputs", { widthMm, depthMm });
    return 0;
  }
  if (widthMm <= 0 || depthMm <= 0) {
    console.warn("circumferenceMm: Non-positive inputs", { widthMm, depthMm });
    return 0;
  }
  
  const aspectRatio = Math.max(widthMm, depthMm) / Math.min(widthMm, depthMm);
  
  if (!isFinite(aspectRatio) || aspectRatio <= 0) {
    console.warn("circumferenceMm: Invalid aspect ratio", { widthMm, depthMm, aspectRatio });
    return 0;
  }
  
  let result = 0;
  
  // Boxy silhouette -> rounded rectangle
  if (curvatureHint > 0.6) {
    const r = 0.12 * Math.min(widthMm, depthMm);
    result = roundedRectPerimeter(widthMm, depthMm, r);
  }
  // Near-circle -> Ramanujan
  else if (aspectRatio < 1.15) {
    result = ramanujanEllipsePerimeter(widthMm, depthMm);
  }
  // General case -> superellipse
  else {
    const n = aspectRatio > 1.3 ? 4.0 : 3.2;
    result = superellipsePerimeter(widthMm / 2, depthMm / 2, n);
  }
  
  // Validate result
  if (!isFinite(result) || result <= 0) {
    console.warn("circumferenceMm: Invalid result, using Ramanujan fallback", { widthMm, depthMm, result });
    result = ramanujanEllipsePerimeter(widthMm, depthMm);
    if (!isFinite(result) || result <= 0) {
      console.error("circumferenceMm: All methods failed", { widthMm, depthMm });
      return 0;
    }
  }
  
  return result;
};

