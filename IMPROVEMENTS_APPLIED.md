# Trustworthy Improvements Applied

This document summarizes the high-impact improvements added to move from "works" → "trustworthy".

## ✅ Implemented Improvements

### 1. A/B Toggle Feature Flag for Side Pitch
**Location**: `web/src/App.js` (line 22-24)

Added feature flag `FLAGS.sidePitchInScale` to toggle between applying pitch correction in scale vs. numeric correction. This allows instant A/B comparison in QA.

```javascript
const FLAGS = {
  sidePitchInScale: true, // if true, skip numeric pitch on side depths
};
```

**QA Check**: Log chest/waist/hips deltas when flipping this flag. Should see ~0–3% difference, not >8%.

---

### 2. Angle Sanity + Smoothing Budget
**Location**: `web/src/utils/angleUtils.js`

Added `smoothAngle()` function that:
- Guards angle inputs with bounds (±20°)
- Applies EMA smoothing (60% new, 40% old) to prevent single bad frames from swinging outputs
- Used for both yaw (front) and pitch (side) before any cos() calculations

```javascript
export const smoothAngle = (prevRad, nextRad, alpha = 0.6, maxAbs = deg2rad(20)) => {
  const n = clamp(nextRad, -maxAbs, maxAbs);
  return prevRad == null ? n : alpha * n + (1 - alpha) * prevRad;
};
```

---

### 3. Hard Co-Registration Snap
**Location**: `web/src/utils/calibrationUtils.js`

Added `snapPairToY()` function that snaps the measured side pair to the co-registered Y before computing depth. This ensures front and side measurements are at the same physical height.

```javascript
export const snapPairToY = (pFront, pBack, yTarget) => {
  const f = pFront ? { ...pFront, y: yTarget } : null;
  const b = pBack ? { ...pBack, y: yTarget } : null;
  return [f, b];
};
```

**Usage**: Applied per landmark right before `segmentMm` in `App.js` (line ~2542).

---

### 4. W/D Ratio Check in finalizeBand
**Location**: `web/src/utils/measurementUtils.js`

Added check for width/depth ratio > 1.60 to catch lingering arm/torso bleed. Sets `wdSuspicious` flag when detected.

```javascript
const MAX_WD_RATIO = 1.60;
const wdRatio = Math.max(w, d) / Math.max(1e-6, Math.min(w, d));
if (wdRatio > MAX_WD_RATIO) {
  console.warn(`[finalize] ${key}: W/D ratio too high; marking as suspicious`);
  meas.flags[key] = { ...meas.flags[key], wdSuspicious: true };
}
```

**UI Note**: Suspicious bands should be grayed out with message "adjust dots or recapture" (UI implementation pending).

---

### 5. Enhanced Export Schema
**Location**: `web/src/App.js` - `exportMeasurements()` function

Export now includes:
- Image IDs with timestamps
- Full calibration data (mm_per_px, tilt_applied, pitch_rad, yaw_rad, head_px, heel_px)
- All dot positions (front and side)
- Band ratios
- Measurements (front_widths, side_depths, circumference, area_mm2)
- Flags (wdSuspicious, etc.)
- Version string ("manual-v2.3")

**Schema Example**:
```json
{
  "image_ids": { "front": "front_2025-11-18", "side": "side_2025-11-18" },
  "height_cm": 173,
  "calibration": { ... },
  "dots": { "front": [...], "side": [...] },
  "bands": { "ratios": { ... } },
  "measurements_mm": { ... },
  "flags": { "chest": { "wdSuspicious": false }, ... },
  "version": "manual-v2.3"
}
```

---

### 6. Improved Foreshortening Caps
**Location**: `web/src/utils/foreshorteningUtils.js`

Added `expandByCos()` function that:
- Prevents shrinkage from cos rounding errors
- Never allows result to be < -2% smaller than raw value
- Caps expansion at +12%

```javascript
export const expandByCos = (raw, cosVal, cap = 1.12) => {
  const base = raw / Math.max(cosVal, 0.90);
  return clamp(base, raw * 0.98, raw * cap); // never < -2% smaller
};
```

---

### 7. Rounded-Rect Radius Heuristic
**Location**: `web/src/utils/circumferenceUtils.js`

Updated `roundedRectPerimeter()` to make radius depend on aspect ratio:
- Very oblong sections (aspect > 1.35): radius = 18% of smaller dimension
- Normal sections: radius = 25% of smaller dimension

This prevents over-rounding of very oblong body sections.

```javascript
const aspect = Math.max(w, d) / Math.min(w, d);
const baseRadius = aspect > 1.35 ? 0.18 : 0.25;
const r = Math.min(w, d) * baseRadius;
```

---

### 8. Instrumentation/Logging
**Location**: `web/src/App.js`

**Per-band logging** (compact format):
```
[b] chest r=0.38 Wraw=352mm Draw=301mm yaw=6.3° pitchS=2.9°
 -> W=365mm D=301mm C=110.2cm flags: ok
```

**Per-photo logging** (scale calculation):
```
[scale] front span=1048px raw=1.65 mm/px tilt=0.995 -> mm/px=1.642
[scale] side span=1048px raw=1.65 mm/px tilt=0.995 -> mm/px=1.642
```

**Dev Panel Metrics** (to be aggregated):
- % bands with wdSuspicious
- mean |ΔC| when toggling A/B flag
- co-registration average |Δy| applied (px)

---

### 9. Minimal Unit Tests
**Location**: `web/src/utils/__tests__/`

Created test files:
- `angleUtils.test.js` - Tests for `smoothAngle()` and `coRegisterY()`
- `measurementUtils.test.js` - Tests for `finalizeBand()` coupling and flags

**Test Coverage**:
- Angle smoothing with EMA
- Angle clamping to max bounds
- Co-registration Y calculation
- Symmetric coupling (width/depth clamping)
- W/D ratio flagging

---

### 10. Gotcha Guards
**Location**: `web/src/App.js`

**Dots Near Edges**: Disallow dots within 2px of image borders (lines ~2039, ~509)
```javascript
const MIN_EDGE_DISTANCE = 2;
if (clickX < MIN_EDGE_DISTANCE || clickX > imageWidth - MIN_EDGE_DISTANCE || ...) {
  alert(`Please place dots at least ${MIN_EDGE_DISTANCE}px away from image edges...`);
  return;
}
```

**Crop Check**: Block calibration if top of head is cropped (within 5% of image height)
```javascript
if (headYPx < actualImageHeight * 0.05) {
  return { error: "Top of head appears cropped. Please ensure full body is visible in frame." };
}
```

**Footwear Hint**: Warn if heel line is on shoe (soft hint, not blocker)
```javascript
if (heelYPx > actualImageHeight * 0.95) {
  console.warn("[calibration] Heel line near bottom - if on footwear, measurements may be slightly off. Line to bare heel if possible.");
}
```

**Phone Roll**: Already guarded with `|rollDeg| > 2°` check (line ~625)

---

## 📊 Expected Impact

1. **No double pitch correction** → More accurate depths (already fixed, now with A/B toggle)
2. **Smoother angles** → More stable width/depth corrections (EMA smoothing)
3. **Hard co-registration** → Better 3D measurements (3-5% error reduction)
4. **W/D ratio flagging** → Catch arm/torso contamination early
5. **Richer export** → Easier debugging and future training/analysis
6. **Gotcha guards** → Prevent common user errors

---

## 🧪 Testing Recommendations

1. **A/B Toggle**: Flip `FLAGS.sidePitchInScale` and compare chest/waist/hips deltas
2. **Angle Smoothing**: Verify single bad frames don't cause jumps
3. **Co-registration**: Check logs for Y adjustments when dots are off
4. **W/D Ratio**: Verify suspicious bands are flagged when ratio > 1.60
5. **Export**: Download JSON and verify all fields are populated
6. **Gotcha Guards**: Test placing dots near edges, cropping head, footwear scenarios

---

## 📝 Next Steps (Optional)

1. **UI for wdSuspicious**: Gray out suspicious bands and show message
2. **Dev Panel**: Aggregate instrumentation metrics in a visible panel
3. **Manual Scale Nudge**: Allow ±1% manual adjustment for footwear cases
4. **2D Roll Correction**: Consider adding if roll is significant (optional)

---

## 🔗 Related Files

- `web/src/utils/angleUtils.js` - Smooth angle estimation
- `web/src/utils/foreshorteningUtils.js` - Improved foreshortening corrections
- `web/src/utils/calibrationUtils.js` - Co-registration helpers
- `web/src/utils/measurementUtils.js` - Finalize band with W/D ratio check
- `web/src/utils/circumferenceUtils.js` - Rounded-rect radius heuristic
- `web/src/App.js` - Main application with all improvements integrated
- `web/src/utils/__tests__/` - Unit tests

