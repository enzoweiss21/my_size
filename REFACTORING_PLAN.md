# App.js Refactoring Plan

## ✅ Completed

### 1. **Utility Functions Extracted** (`utils/`)
- `formatUtils.js` - Unit conversion & formatting
- `angleUtils.js` - Angle calculations & pose estimation  
- `foreshorteningUtils.js` - Foreshortening corrections
- `calibrationUtils.js` - Pixel calibration utilities
- `circumferenceUtils.js` - Circumference calculation models
- `manualDrawingUtils.js` - Manual drawing helpers

### 2. **UI Components Extracted** (`components/`)
- `ModeSelector.jsx` - Mode selection screen
- `MeasurementDisplay.jsx` - Measurement display component

### 3. **Custom Hooks Extracted** (`hooks/`)
- `useCamera.js` - Camera initialization & stream management
- `useMediaPipe.js` - MediaPipe model loading
- `useDeviceOrientation.js` - Device orientation tracking

### 4. **App.js Updated**
- Removed duplicate function definitions
- Integrated custom hooks
- Using extracted components
- **Current size: ~4200 lines** (down from 4373)

## 📋 Next Steps (Recommended Priority)

### Phase 1: Extract Mode Components (HIGH PRIORITY)
Create separate components for each mode to reduce App.js size significantly:

1. **`PoseEstimationMode.jsx`**
   - Extract all pose estimation mode logic (~1500+ lines)
   - Props: camera refs, MediaPipe refs, state handlers
   - Contains: photo capture, segmentation, measurements

2. **`ManualDrawingMode.jsx`**
   - Extract all manual drawing mode logic (~2000+ lines)  
   - Props: camera refs, state handlers
   - Contains: dot placement, calibration, measurements

### Phase 2: Extract Shared Components (MEDIUM PRIORITY)
1. **`CalibrationOverlay.jsx`** - Overlay canvas for calibration lines
2. **`DotPlacement.jsx`** - Dot placement UI & SVG rendering
3. **`PhotoCapture.jsx`** - Camera view & capture UI
4. **`SegmentationDisplay.jsx`** - Segmentation mask display

### Phase 3: Extract Additional Hooks (LOW PRIORITY)
1. **`useMeasurements.js`** - Measurement calculation logic
2. **`useSegmentation.js`** - Segmentation processing
3. **`useCalibration.js`** - Calibration logic

## 🎯 Final Goal

App.js should become a **simple router/coordinator** (~200-300 lines):
```javascript
export default function App() {
  const [mode, setMode] = useState("select");
  
  // Hooks
  const { videoRef, streamRef } = useCamera();
  const { segRef, poseRef, isModelReady, isPoseReady } = useMediaPipe();
  const { pitchDeg, rollDeg } = useDeviceOrientation();
  
  // Render based on mode
  if (mode === "select") return <ModeSelector onSelectMode={setMode} />;
  
  return (
    <div>
      <button onClick={() => setMode("select")}>Back</button>
      {mode === "pose" && (
        <PoseEstimationMode 
          videoRef={videoRef}
          segRef={segRef}
          poseRef={poseRef}
          // ... other props
        />
      )}
      {mode === "manual" && (
        <ManualDrawingMode 
          videoRef={videoRef}
          // ... other props
        />
      )}
    </div>
  );
}
```

## 📊 Progress
- ✅ Utilities extracted
- ✅ UI components extracted  
- ✅ Hooks extracted
- ⏳ Mode components (NEXT)
- ⏳ Shared components
- ⏳ Additional hooks

## 🔍 Benefits Achieved So Far
1. **Reusability** - Utilities can be imported anywhere
2. **Testability** - Hooks and utils can be tested independently
3. **Maintainability** - Clear separation of concerns
4. **Readability** - Smaller, focused files

## ⚠️ Notes
- App.js still has all the mode logic inline - this is the biggest refactoring remaining
- State management is complex - need to carefully pass props or use context
- Consider using Context API for deeply nested state if props get unwieldy


