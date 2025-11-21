# Manual Drawing Mode - Workflow & Calculations

## 📋 Workflow Overview

### Step 1: Photo Capture (Back-to-Back)
1. **Front Photo Capture**
   - User clicks "Capture FRONT" button
   - 5-second countdown timer appears
   - Photo is captured and stored in `frontImageData`
   - If side photo already exists → go to front calibration
   - If not → prompt for side photo capture

2. **Side Photo Capture**
   - User clicks "Capture SIDE" button
   - 5-second countdown timer appears
   - Photo is captured and stored in `sideImageData`
   - Move to front calibration

**Note**: Both photos are captured back-to-back before any calibration or dot placement (user doesn't have to get up twice).

---

### Step 2: Pixel Calibration (Front Photo)
1. **Display Front Photo**
   - Front photo is displayed
   - User enters their height (cm)

2. **Calibration Lines**
   - Two blue draggable lines appear:
     - **Head line** (top) - mark top of head
     - **Heel line** (bottom) - mark bottom of heels
   - User drags lines to correct positions

3. **Lock Front Scale**
   - User clicks "Lock Front Scale" button
   - System:
     - Detects pose from photo (MediaPipe Pose Landmarker)
     - Estimates pitch angle from pose (shoulder-hip slope)
     - Estimates yaw angle from pose (shoulder-hip horizontal offset)
     - Applies **sub-pixel edge snap** (`refineEdgeY`) to refine head/heel positions
     - Calculates pixel scale: `frontScaleMmPerPx = (heightCm * 10 * cos(pitch)) / spanPx`
     - Stores: `frontPitch`, `frontYaw`, `frontScaleMmPerPx`

4. **Move to Dot Placement**
   - After scale is locked, user clicks "Start Placing Dots"
   - State changes to `"front-dots"`

---

### Step 3: Pixel Calibration (Side Photo)
1. **Display Side Photo**
   - Side photo is displayed
   - Same height value is used

2. **Calibration Lines**
   - Two blue draggable lines appear:
     - **Head line** (top)
     - **Heel line** (bottom)
   - User drags lines to correct positions

3. **Lock Side Scale**
   - User clicks "Lock Side Scale" button
   - System:
     - Detects pose from photo
     - Estimates pitch angle from pose
     - Applies sub-pixel edge snap
     - Calculates pixel scale: `sideScaleMmPerPx = (heightCm * 10 * cos(pitch)) / spanPx`
     - Stores: `sidePitch`, `sideScaleMmPerPx`

4. **Move to Dot Placement**
   - After scale is locked, user clicks "Start Placing Dots"
   - State changes to `"side-dots"`

---

### Step 4: Dot Placement (Front Photo)

User places dots in this order:

#### Width Measurements (Left/Right pairs):
1. **Shoulders** - left dot, then right dot
2. **Chest** - left dot, then right dot
3. **Waist** - left dot, then right dot
4. **Hips** - left dot, then right dot

#### Thigh Measurements:
5. **Thighs (thickness)** - left dot, then right dot
6. **Thighs (top)** - single dot at top of thigh (for leg length)

#### Knee:
7. **Knee (center)** - single dot at center of knee (midpoint for leg length)

#### Calf Measurements:
8. **Calves (thickness)** - left dot, then right dot
9. **Calves (bottom)** - single dot at ankle (for leg length)

**Visual Guide**: Each dot type has a unique color for easy identification.

---

### Step 5: Dot Placement (Side Photo)

User places dots in this order (Front/Back pairs):

1. **Chest** - front dot, then back dot
2. **Waist** - front dot, then back dot
3. **Hips** - front dot, then back dot
4. **Thighs** - front dot, then back dot
5. **Calves** - front dot, then back dot

---

### Step 6: Calculate Measurements

When user clicks "Calculate Measurements", the system:

1. **Calculates Raw Measurements** (from dots)
2. **Applies Foreshortening Corrections** (pitch/yaw)
3. **Calculates 3D Measurements** (circumference, area)
4. **Calculates Leg Lengths** (from front photo)

---

## 🧮 Calculation Formulas

### 1. Pixel-to-Real-World Conversion (Calibration)

**Formula**:
```
scaleMmPerPx = (heightCm * 10 * cos(pitchRad)) / spanPx
```

Where:
- `heightCm` = User's height in centimeters
- `pitchRad` = Estimated pitch angle from pose (radians)
- `spanPx` = Pixel distance between head and heel lines (after edge refinement)
- `cos(pitchRad)` = Pitch-tilt correction factor

**Edge Refinement** (`refineEdgeY`):
- Samples a horizontal strip around the user-dragged line
- Computes vertical gradient (edge strength)
- Snaps to the strongest edge within ±3 pixels
- Reduces calibration error by 2-5 pixels

---

### 2. Distance Calculation (from dots)

**Formula**:
```javascript
calculateDistance(dot1, dot2, scaleMmPerPx) {
  dx = dot2.x - dot1.x
  dy = dot2.y - dot1.y
  distancePx = sqrt(dx² + dy²)
  distanceMm = distancePx * scaleMmPerPx
  distanceCm = distanceMm / 10
}
```

**Used for**:
- Width measurements (front photo): left dot ↔ right dot
- Depth measurements (side photo): front dot ↔ back dot

---

### 3. Foreshortening Corrections

**Purpose**: Correct for camera angle (yaw/pitch) that makes measurements appear smaller.

#### Front Width Corrections (Yaw):
```
correctedWidth = rawWidth / cos(yawRad)
```

Where:
- `yawRad` = Estimated yaw angle from front pose (radians)
- Clamped to ±30° maximum
- Correction capped at +15% (soft cap)

#### Side Depth Corrections (Pitch):
```
correctedDepth = rawDepth / cos(pitchRad)
```

Where:
- `pitchRad` = Estimated pitch angle from side pose (radians)
- Clamped to ±30° maximum
- Correction capped at +15% (soft cap)

**Implementation** (`correctForeshortening`):
- Uses `cos(max(abs(angle), 0.87))` to avoid division by tiny values
- Applies soft cap: `min(corrected, raw * 1.15)`

---

### 4. 3D Measurements (Circumference & Area)

#### Cross-Sectional Area (Ellipse):
```
semiMajorAxis = widthMm / 2
semiMinorAxis = depthMm / 2
areaMm² = π * semiMajorAxis * semiMinorAxis
areaCm² = areaMm² / 100
```

#### Circumference (Auto-Chooser):

The system automatically selects the best model based on aspect ratio and curvature:

**A) Rounded Rectangle** (if `curvatureHint > 0.6`):
```
r = 0.12 * min(width, depth)
perimeter = 2 * ((width - 2r) + (depth - 2r)) + 2πr
```

**B) Ramanujan Ellipse** (if `aspectRatio < 1.15` - near circular):
```
a = width/2, b = depth/2
h = ((a-b)/(a+b))²
perimeter = π(a+b) * (1 + (3h)/(10 + √(4-3h)))
```

**C) Superellipse (Lamé)** (default for general case):
```
n = 3.2 (or 4.0 if aspectRatio > 1.3)
perimeter = ∫₀²π √((dx/dt)² + (dy/dt)²) dt
```
Where the parametric equations use:
- `x = a * sign(cos(t)) * |cos(t)|^(2/n)`
- `y = b * sign(sin(t)) * |sin(t)|^(2/n)`

**Curvature Hint**:
- `aspectRatio = max(width, depth) / min(width, depth)`
- `curvatureHint = aspectRatio > 1.3 ? 0.7 : 0.4`

---

### 5. Leg Length Calculations

#### Upper Leg Length (Thigh to Knee):
```
dx = knee.center.x - thighs.top.x
dy = knee.center.y - thighs.top.y
lengthPx = sqrt(dx² + dy²)
lengthMm = lengthPx * frontScaleMmPerPx
```

#### Lower Leg Length (Knee to Ankle):
```
dx = calves.bottom.x - knee.center.x
dy = calves.bottom.y - knee.center.y
lengthPx = sqrt(dx² + dy²)
lengthMm = lengthPx * frontScaleMmPerPx
```

#### Total Leg Length (Thigh to Ankle):
```
dx = calves.bottom.x - thighs.top.x
dy = calves.bottom.y - thighs.top.y
lengthPx = sqrt(dx² + dy²)
lengthMm = lengthPx * frontScaleMmPerPx
```

---

## 🔍 Quality Assurance Checks

### 1. Soft Coupling (Arm Contamination Detection)
```
if (widthMm > depthMm * 1.25) {
  // Possible arm contamination
  widthMm = depthMm * 1.25  // Clamp width
}
```

### 2. Human Plausibility Check
```
if (chestCircumference < 90cm || chestCircumference > 140cm) {
  console.warn("Chest circumference outside typical range");
}
```

### 3. Input Validation
- Checks for `NaN`, `Infinity`, zero/negative values
- Validates corrected measurements are finite
- Falls back to raw values if corrections are invalid

---

## 📊 Measurement Types Calculated

### From Front Photo (Widths):
- Shoulders width
- Chest width
- Waist width
- Hips width
- Thighs width (thickness)
- Calves width (thickness)
- Upper leg length (thigh top → knee)
- Lower leg length (knee → ankle)
- Total leg length (thigh top → ankle)

### From Side Photo (Depths):
- Chest depth
- Waist depth
- Hips depth
- Thighs depth
- Calves depth

### 3D Measurements (Combined):
- Circumference (auto-chooser model)
- Cross-sectional area (ellipse)

---

## 🎯 Key Features

1. **Sub-pixel Edge Snap**: Refines user-dragged calibration lines to nearest strong edge
2. **Pose-tilt Correction**: Adjusts pixel scale using `cos(pitch)` during calibration
3. **Foreshortening Correction**: Numeric pitch/yaw corrections applied to raw measurements
4. **Auto-chooser Circumference**: Selects best model (Ramanujan/Superellipse/Rounded-Rect) automatically
5. **Soft Coupling**: Detects and corrects arm contamination in width measurements
6. **Validation**: Multiple layers of validation to catch invalid measurements

---

## 📝 Notes

- All measurements are stored in both **mm** and **cm**
- Display can toggle between **cm** and **inches**
- Calculations use **corrected** (foreshortening-adjusted) values for 3D measurements
- Raw values are logged to console for debugging
- Invalid measurements are skipped with warnings


