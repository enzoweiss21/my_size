# Manual Drawing Calculation Fixes Applied

## ✅ Issues Fixed

### 1. **Double Pitch Correction** - FIXED ✅
**Problem**: Pitch correction was applied twice:
- First in `lockScale()`: `scaleMmPerPx = (height * cos(pitch)) / spanPx`
- Then again in `correctForeshortening()`: `depth = depth / cos(pitch)`

**Solution**:
- Added `tiltApplied` flags (`frontTiltApplied`, `sideTiltApplied`)
- Updated `correctForeshortening()` to accept `sideTiltApplied` parameter
- If `sideTiltApplied === true`, skip pitch correction for side depths
- Store tilt-applied flags when locking scale

**Files Changed**:
- `utils/foreshorteningUtils.js` - Added `sideTiltApplied` parameter
- `App.js` - Store and pass `tiltApplied` flags

---

### 2. **Yaw Proxy Too Noisy** - FIXED ✅
**Problem**: Shoulder-hip x-offset was noisy, causing jumpy yaw estimates

**Solution**:
- Created `estimateYawFromPoseStable()` function with moving average smoothing
- Uses 60% new value, 40% previous value (alpha = 0.6)
- Tighter bounds: ±20° instead of ±30°
- Stores smoothed yaw in `frontYawSmoothed` state

**Files Changed**:
- `utils/angleUtils.js` - Added `estimateYawFromPoseStable()` function
- `App.js` - Use smoothed yaw estimate

---

### 3. **Band Co-Registration Drift** - FIXED ✅
**Problem**: Front and side bands at different head→heel ratios → bad 3D measurements

**Solution**:
- Added `coRegisterY()` function to compute side Y from front Y ratio
- Before measuring side depths, snap side dots to co-registered Y position
- Ensures front and side measurements are at the same physical height

**Implementation**:
```javascript
// Compute ratio from front photo
const r = (yFrontPx - frontHead) / (frontHeel - frontHead);
// Apply ratio to side photo
const ySideRegistered = sideHead + r * (sideHeel - sideHead);
```

**Files Changed**:
- `utils/calibrationUtils.js` - Added `coRegisterY()` function
- `App.js` - Apply co-registration before measuring side depths

---

### 4. **Symmetric Coupling & Plausibility** - FIXED ✅
**Problem**: Coupling and plausibility checks scattered throughout code

**Solution**:
- Created `finalizeBand()` function (single place for all checks)
- Applies symmetric clamping: `width = min(width, 1.25 * depth)` and `depth = min(depth, 1.25 * width)`
- Calculates circumference and area in one place
- Plausibility checks (e.g., chest 85-150cm)
- All coupling/plausibility logic centralized

**Files Changed**:
- `utils/measurementUtils.js` - Added `finalizeBand()` function
- `App.js` - Use `finalizeBand()` for all measurements

---

## 📊 New Workflow

### Calibration (Front & Side)
1. **Detect pose** from photo
2. **Estimate pitch/yaw** from pose landmarks
3. **Apply pitch-tilt correction** in `lockScale()`:
   ```
   scaleMmPerPx = (heightCm * 10 * cos(pitch)) / spanPx
   ```
4. **Store tilt-applied flag** = `true`
5. **Store pixel positions** (headY, heelY) for co-registration

### Measurement Calculation
1. **Calculate raw measurements** from dots (pixel distances → mm)
2. **Co-register side dots** to same physical height as front dots
3. **Apply foreshortening corrections**:
   - Front widths: `width = width / cos(yaw)` (smoothed yaw)
   - Side depths: **SKIP** if `tiltApplied === true` (already corrected in lockScale)
4. **Finalize bands** with `finalizeBand()`:
   - Symmetric clamping (prevents arm contamination)
   - Plausibility checks
   - Calculate circumference and area
5. **Calculate 3D measurements** using finalized values

---

## 🔍 Debug Logging

### Scale Locking
Logs now show:
- Raw scale (without tilt correction)
- Tilt-corrected scale
- Tilt factor (`cos(pitch)`)
- Yaw (smoothed) for front photos

### Measurement Calculation
Logs now show:
- `[Foreshortening] Front tilt applied: true/false, Side tilt applied: true/false`
- Co-registration adjustments
- `[band] Finalized: width=Xcm, depth=Ycm, C=Zcm`

---

## 📝 State Variables Added

```javascript
const [frontTiltApplied, setFrontTiltApplied] = useState(false);
const [sideTiltApplied, setSideTiltApplied] = useState(false);
const [frontYawSmoothed, setFrontYawSmoothed] = useState(0);
const [frontHeadYPx, setFrontHeadYPx] = useState(null);
const [frontHeelYPx, setFrontHeelYPx] = useState(null);
const [sideHeadYPx, setSideHeadYPx] = useState(null);
const [sideHeelYPx, setSideHeelYPx] = useState(null);
```

---

## ✅ Expected Improvements

1. **No double pitch correction** → More accurate depths
2. **Smoother yaw** → More stable width corrections
3. **Co-registered bands** → Better 3D measurements (3-5% error reduction)
4. **Centralized coupling** → Consistent validation, fewer edge cases

---

## 🧪 Testing Recommendations

1. **Verify no double correction**: Check console logs - side depths should only be corrected once
2. **Check co-registration**: Logs should show Y adjustments when dots are off
3. **Validate symmetric coupling**: Width/depth should be clamped if ratio > 1.25
4. **Test plausibility**: Chest circumference should warn if outside 85-150cm

---

## 📚 Related Files

- `utils/angleUtils.js` - Smooth yaw estimation
- `utils/foreshorteningUtils.js` - Conditional pitch correction
- `utils/calibrationUtils.js` - Co-registration helper
- `utils/measurementUtils.js` - Finalize band function
- `App.js` - Updated workflow with fixes


