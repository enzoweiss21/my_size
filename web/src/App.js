import React, { useRef, useEffect, useState } from "react";
import { FilesetResolver, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";

export default function App() {
  const videoRef = useRef(null);
  const displayRef = useRef(null); // video or captured image
  const overlayRef = useRef(null);
  const segRef = useRef(null);
  const poseRef = useRef(null);
  const capturedCanvasRef = useRef(null); // offscreen canvas of captured photo
  const streamRef = useRef(null); // store camera stream

  // user input + draggable lines
  const [heightCm, setHeightCm] = useState(173);
  const [headY, setHeadY] = useState(200);   // logical 0..720
  const [heelY, setHeelY] = useState(700);
  const [dragging, setDragging] = useState(null); // "head" | "heel" | null

  // computed scale
  const [scaleMmPerPx, setScaleMmPerPx] = useState(null);

  // device orientation (keep phone level)
  const [pitchDeg, setPitchDeg] = useState(0);
  const [rollDeg, setRollDeg] = useState(0);

  // segmentation model
  const [isModelReady, setIsModelReady] = useState(false); // Track model readiness
  const [isPoseReady, setIsPoseReady] = useState(false);
  // captured still photo for calibration
  const [capturedDataUrl, setCapturedDataUrl] = useState(null);
  // countdown before photo capture
  const [countdown, setCountdown] = useState(null); // 3..2..1 or null
  // saved front image (blob/data URL)
  const [frontImageData, setFrontImageData] = useState(null);
  // capture state: null = calibration, "front" = front captured, "side" = ready for side
  const [captureState, setCaptureState] = useState(null); // null | "front" | "side"
  // side photo data (separate from capturedDataUrl for calibration)
  const [sideImageData, setSideImageData] = useState(null);
  // segmentation composites (white background masks)
  const [frontComposite, setFrontComposite] = useState(null);
  const [sideComposite, setSideComposite] = useState(null);
  // front photo measurements (widths)
  const [frontMeasurements, setFrontMeasurements] = useState(null);
  // side photo measurements (depths/thickness)
  const [sideMeasurements, setSideMeasurements] = useState(null);
  // combined 3D measurements (calculated from both)
  const [bodyMeasurements, setBodyMeasurements] = useState(null);

  // ---- camera init ----
  useEffect(() => {
    (async () => {
      try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
        streamRef.current = stream; // Store stream for later use
        if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.onloadeddata = () => {
        videoRef.current.play().catch((err) => console.error("Video play error:", err));
      };
        }
      } catch (err) {
        console.error("Camera error:", err);
      }
    })();
    // Cleanup on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ---- device orientation ----
  useEffect(() => {
    const h = (e) => { setPitchDeg(e.beta || 0); setRollDeg(e.gamma || 0); };
    if (window.DeviceOrientationEvent) window.addEventListener("deviceorientation", h, true);
    return () => window.removeEventListener("deviceorientation", h, true);
  }, []);

  // ---- load segmentation model ----
  useEffect(() => {
    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            // Use a hosted model URL since there's no local /public/models file
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
          },
          outputCategoryMask: true,
          runningMode: "IMAGE",
          categoryAllowlist: ["person"],
        });
        segRef.current = segmenter;
        setIsModelReady(true); // Set model as ready
        // Load pose landmarker
        const pose = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
          },
          runningMode: "IMAGE",
          numPoses: 1,
        });
        poseRef.current = pose;
        setIsPoseReady(true);
      } catch (error) {
        console.error("Failed to load segmentation model:", error);
        alert("Failed to load segmentation model. Please check the model file.");
      }
    })();
  }, []);

  // ---- draw overlay (lines + level bubble + scale readout) ----
  useEffect(() => {
    const cvs = overlayRef.current, disp = displayRef.current;
    if (!cvs || !disp) return;
    const ctx = cvs.getContext("2d");
    let raf;
    const draw = () => {
      const w = (cvs.width = disp.clientWidth);
      const h = (cvs.height = disp.clientHeight);
      ctx.clearRect(0, 0, w, h);

      // level bubble
      ctx.fillStyle = "#111827"; ctx.globalAlpha = 0.85;
      ctx.fillRect(12, 12, 170, 58); ctx.globalAlpha = 1;
      ctx.fillStyle = "white"; ctx.font = "12px sans-serif";
      ctx.fillText(`pitch: ${pitchDeg.toFixed(1)}°`, 20, 34);
      ctx.fillText(`roll: ${rollDeg.toFixed(1)}°`, 20, 52);

      // draggable lines (map 0..720 to canvas height)
      const yHeadPx = (headY / 720) * h;
      const yHeelPx = (heelY / 720) * h;
      ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 3; ctx.setLineDash([8,6]);
      ctx.beginPath(); ctx.moveTo(0, yHeadPx); ctx.lineTo(w, yHeadPx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, yHeelPx); ctx.lineTo(w, yHeelPx); ctx.stroke();
      ctx.setLineDash([]);

      if (scaleMmPerPx) {
        const txt = `scale: ${scaleMmPerPx.toFixed(3)} mm/px`;
        const m = ctx.measureText(txt);
        ctx.fillStyle = "#111827";
        ctx.fillRect(w - m.width - 26, 12, m.width + 16, 26);
        ctx.fillStyle = "white";
        ctx.fillText(txt, w - m.width - 18, 30);
      }

      // countdown overlay
      if (typeof countdown === "number") {
        const r = Math.min(w, h) * 0.12;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#111827";
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r + 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${Math.floor(r)}px system-ui, sans-serif`;
        ctx.fillText(String(countdown), w / 2, h / 2);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [headY, heelY, scaleMmPerPx, pitchDeg, rollDeg, capturedDataUrl, sideImageData, countdown]);

  // ---- drag handlers ----
  const onPointerDown = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const y720 = (y / overlayRef.current.height) * 720;
    if (Math.abs(y720 - headY) < 16) setDragging("head");
    else if (Math.abs(y720 - heelY) < 16) setDragging("heel");
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const y720 = Math.max(0, Math.min(720, (y / overlayRef.current.height) * 720));
    if (dragging === "head") setHeadY(y720);
    else setHeelY(y720);
  };
  const onPointerUp = () => setDragging(null);

  // ---- compute pixel calibration scale ----
  // This establishes the pixel-to-millimeter conversion ratio using:
  // - User's known height (heightCm)
  // - Measured pixel distance between head and heel (spanPx) in ACTUAL image pixels
  // Formula: scaleMmPerPx = (heightCm * 10) / spanPx
  // This calibration is then used with deterministic segmentation scanning
  const lockScale = () => {
    // Get the actual image/canvas dimensions
    const canvas = capturedCanvasRef.current;
    if (!canvas) {
      return alert("No image captured. Please capture a photo first.");
    }
    
    const actualImageHeight = canvas.height;
    const actualImageWidth = canvas.width;
    
    // Convert logical coordinates (0-720) to actual pixel coordinates
    const headYPx = (headY / 720) * actualImageHeight;
    const heelYPx = (heelY / 720) * actualImageHeight;
    const spanPx = Math.abs(heelYPx - headYPx);
    
    if (spanPx < 200) return alert("Subject too small in frame. Step back.");
    if (Math.abs(pitchDeg) > 2 || Math.abs(rollDeg) > 2) return alert("Hold phone level (|pitch|,|roll| < 2°).");
    
    const computedScale = (heightCm * 10) / spanPx; // mm per pixel
    setScaleMmPerPx(computedScale);
    console.log(`Pixel calibration locked: ${computedScale.toFixed(3)} mm/px`);
    console.log(`  Image dimensions: ${actualImageWidth}×${actualImageHeight}px`);
    console.log(`  Head Y: ${headYPx.toFixed(1)}px, Heel Y: ${heelYPx.toFixed(1)}px`);
    console.log(`  Span: ${spanPx.toFixed(1)}px, Height: ${heightCm}cm (${heightCm * 10}mm)`);
  };

  // ---- capture photo helper ----
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      alert("Camera not ready yet.");
      return null;
    }
    try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
      capturedCanvasRef.current = canvas;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedDataUrl(dataUrl);
      return canvas;
    } catch (error) {
      console.error("Error capturing photo:", error);
      alert("Failed to capture photo: " + error.message);
      return null;
    }
  };

  const startCountdownAndCapture = (onComplete) => {
    if (typeof countdown === "number") return;
    let t = 3;
    setCountdown(t);
    const interval = setInterval(() => {
      t -= 1;
      if (t <= 0) {
        clearInterval(interval);
        setCountdown(null);
        // Slight delay to allow last frame draw
        setTimeout(() => {
          const canvas = capturePhoto();
          if (canvas && onComplete) {
            onComplete(canvas);
          } else if (!canvas && onComplete) {
            console.error("Failed to capture photo, callback cancelled");
          }
        }, 50);
      } else {
        setCountdown(t);
      }
    }, 1000);
  };

  const retakePhoto = () => {
    capturedCanvasRef.current = null;
    setCapturedDataUrl(null);
    if (captureState === "side") {
      setSideImageData(null); // Clear side image when retaking
    }
    if (captureState === null) {
      setScaleMmPerPx(null); // Only reset scale if we're in initial calibration
    }
  };

  // ---- auto-detect head/heel from pose landmarks ----
  const autoDetectHeadHeel = async () => {
    if (!isPoseReady) return alert("Pose model not ready");
    const canvas = capturedCanvasRef.current;
    if (!canvas) return alert("Capture a photo first.");
    const result = await poseRef.current.detect(canvas);
    if (!result || !result.landmarks || result.landmarks.length === 0) {
      return alert("No pose detected. Try retaking the photo.");
    }
    // Use normalized landmarks of the first pose
    const lms = result.landmarks[0];
    const h = canvas.height;
    // Approximate head as min y among head-adjacent points
    // Use: nose(0), left_eye(1), right_eye(2), left_ear(7), right_ear(8)
    const headIdx = [0, 1, 2, 7, 8];
    let minHeadY = Infinity;
    headIdx.forEach(i => {
      if (lms[i]) minHeadY = Math.min(minHeadY, lms[i].y);
    });
    // Heels: left_heel(30), right_heel(31) in BlazePose full set
    // If absent, fallback to ankles: left_ankle(27), right_ankle(28)
    const heelCandidates = [30, 31, 27, 28].filter(i => lms[i]);
    if (heelCandidates.length === 0 || !isFinite(minHeadY)) {
      return alert("Could not find head/heels reliably. Adjust lines manually.");
    }
    let maxHeelY = -Infinity;
    heelCandidates.forEach(i => {
      maxHeelY = Math.max(maxHeelY, lms[i].y);
    });
    // Convert normalized y (0..1) to 0..720 logical space used by overlay lines
    const headY720 = Math.max(0, Math.min(720, minHeadY * h * (720 / h)));
    const heelY720 = Math.max(0, Math.min(720, maxHeelY * h * (720 / h)));
    setHeadY(headY720);
    setHeelY(heelY720);
  };

  // ---- capture front photo ----
  const handleCaptureFront = () => {
    if (typeof countdown === "number") return;
    startCountdownAndCapture((canvas) => {
      // After photo is captured, save it and show for line adjustment
      const frontDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setFrontImageData(frontDataUrl);
      setCaptureState("front");
      // Photo is already shown via capturedDataUrl from capturePhoto()
    });
  };

  // ---- capture side photo (doesn't segment yet) ----
  const handleCaptureSide = () => {
    if (typeof countdown === "number") return;
    
    // If we already have a captured photo, save it as side image
    let canvas = capturedCanvasRef.current;
    if (!canvas) {
      // No photo yet, start countdown and capture
      startCountdownAndCapture((capturedCanvas) => {
        if (!capturedCanvas) {
          console.error("Failed to capture canvas");
          return;
        }
        // Save side image
        const sideDataUrl = capturedCanvas.toDataURL("image/jpeg", 0.9);
        setSideImageData(sideDataUrl);
        capturedCanvasRef.current = capturedCanvas;
        setCapturedDataUrl(sideDataUrl);
      });
      return;
    }
    
    // Use existing captured photo
    const sideDataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setSideImageData(sideDataUrl);
    setCapturedDataUrl(sideDataUrl);
  };

  // ---- submit side photo and calculate measurements ----
  const handleSubmitSide = async () => {
    if (!isModelReady) return alert("Segmentation model not ready");
    if (!scaleMmPerPx) return alert("Please lock scale first");
    if (!sideImageData && !capturedCanvasRef.current) {
      return alert("Please capture or upload a side photo first");
    }

    // Use the saved side image canvas
    const canvas = capturedCanvasRef.current;
    if (!canvas) {
      // Recreate canvas from side image data
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = sideImageData;
      });
      const newCanvas = document.createElement("canvas");
      newCanvas.width = img.width;
      newCanvas.height = img.height;
      const ctx = newCanvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      capturedCanvasRef.current = newCanvas;
      await performSideSegmentation(newCanvas);
    } else {
      await performSideSegmentation(canvas);
    }
  };

  // ---- create segmentation composite (reusable for front and side) ----
  const createSegmentationComposite = async (canvas) => {
    if (!canvas) {
      console.error("No canvas provided for segmentation");
      return null;
    }

    // Test if canvas is valid by checking dimensions
    if (!canvas.width || !canvas.height) {
      console.error("Invalid canvas dimensions:", canvas.width, canvas.height);
      return null;
    }

    // Convert canvas to Image element (MediaPipe prefers Image or Video elements)
    const img = new Image();
    
    await new Promise((resolve, reject) => {
      img.onload = () => {
        console.log("Image loaded for segmentation:", img.width, img.height);
        resolve();
      };
      img.onerror = (e) => {
        console.error("Image load error:", e);
        reject(new Error("Failed to load image from canvas"));
      };
      // Use PNG for better quality
      img.src = canvas.toDataURL("image/png");
    });

    try {
      console.log("Starting segmentation with image:", img.width, img.height);
      const result = await segRef.current.segment(img);
    const mask = result.categoryMask;
    const mdata = mask.getAsUint8Array();

      // Apply probability threshold: p ≥ 0.7 (reduces "whispy" arm pixels)
      // MediaPipe categoryMask returns binary (0 or 255), but we ensure threshold at 0.7
      // If confidence mask available, use it; otherwise threshold binary mask at 178 (0.7 * 255)
      let refinedMask = new Uint8Array(mdata.length);
      const probabilityThreshold = 0.7;
      const thresholdValue = Math.round(probabilityThreshold * 255); // 178.5 → 178

    for (let i = 0; i < mdata.length; i++) {
        // Threshold mask: only keep pixels with p ≥ 0.7
        refinedMask[i] = mdata[i] >= thresholdValue ? 255 : 0;
      }
      
      const width = canvas.width;
      const height = canvas.height;
      
      // Optional matting refinement (can be enabled later with MODNet/RVM)
      if (false) { // Set to true when matting model is loaded
        refinedMask = await refineMaskWithMatting(canvas, refinedMask, width, height);
      }

      // Create composite: original image over white background using mask
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = width;
      compositeCanvas.height = height;
      const ctx = compositeCanvas.getContext("2d");
      
      // Fill with white background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
      
      // Draw original image
      ctx.drawImage(canvas, 0, 0);
      
      // Apply mask: set alpha channel based on mask data
      const imageData = ctx.getImageData(0, 0, compositeCanvas.width, compositeCanvas.height);
      const pixels = imageData.data;
      
      for (let i = 0; i < refinedMask.length; i++) {
        const pixelIdx = i * 4;
        const maskValue = refinedMask[i];
        
        // Binary mask: > 127 = person, <= 127 = background (white)
        if (maskValue <= 127) {
          // Set to white for pixels outside mask
          pixels[pixelIdx] = 255;     // R
          pixels[pixelIdx + 1] = 255; // G
          pixels[pixelIdx + 2] = 255; // B
          pixels[pixelIdx + 3] = 255; // A
        }
        // Else keep original pixel (person is visible)
      }
      
      ctx.putImageData(imageData, 0, 0);
      
      return {
        compositeCanvas,
        maskData: refinedMask,
        width,
        height
      };
    } catch (error) {
      console.error("Segmentation failed:", error);
      throw error;
    }
  };

  // ---- perform front segmentation and calculate widths ----
  const performFrontSegmentation = async (canvas) => {
    try {
      const result = await createSegmentationComposite(canvas);
      if (result) {
        setFrontComposite(result.compositeCanvas.toDataURL("image/png"));
        
        // Calculate widths from front photo
        const widths = detectBodyFeatures(result.maskData, result.width, result.height, "width");
        setFrontMeasurements(widths);
        
        // If we have both front and side measurements, calculate 3D
        if (sideMeasurements && widths) {
          calculate3DMeasurements(widths, sideMeasurements, scaleMmPerPx);
        }
        
        console.log("Front segmentation complete - widths calculated");
      }
    } catch (error) {
      console.error("Front segmentation failed:", error);
    }
  };

  // ---- perform side segmentation and calculate depths ----
  const performSideSegmentation = async (canvas) => {
    try {
      const result = await createSegmentationComposite(canvas);
      if (!result) return;

      // Store side composite
      setSideComposite(result.compositeCanvas.toDataURL("image/png"));
      
      // Calculate depths/thickness from side photo
      const depths = detectBodyFeatures(result.maskData, result.width, result.height, "depth");
      setSideMeasurements(depths);
      
      // If we have both front and side measurements, calculate 3D
      if (frontMeasurements && depths) {
        calculate3DMeasurements(frontMeasurements, depths, scaleMmPerPx);
      }
      
      console.log("Side segmentation complete - depths calculated");
    } catch (error) {
      console.error("Side segmentation failed:", error);
      alert("Failed to segment image: " + error.message);
    }
  };

  // ---- calculate 3D measurements from widths (front) and depths (side) ----
  // Improved algorithm accounting for body wrap-around:
  // - Front photo: Measures left-right width of body (what we see from front)
  // - Side photo: Measures front-back depth/thickness (what we see from side)
  // - Circumference: Uses elliptical model (width × depth) to account for full wrap-around
  const calculate3DMeasurements = (widths, depths, scaleMmPerPx = null) => {
    if (!widths || !depths) {
      console.warn("Missing width or depth measurements for 3D calculation");
      return;
    }

    const landmarks = ["chest", "waist", "hips", "thighs"];
    const combinedMeasurements = {};

    // For each landmark, combine width (front) and depth (side) for 3D calculations
    landmarks.forEach(landmark => {
      const width = widths[landmark];
      const depth = depths[landmark];

      if (width && depth) {
        // Final sanity check: depth should not be > width * 1.1
        // If so, likely included back/head bump, edge artifacts, or arm still in width measurement
        if (depth.cm > width.cm * 1.1) {
          console.warn(`${landmark}: Rejected - depth (${depth.cm}cm) > width (${width.cm}cm) * 1.1`);
          console.warn(`  Likely included back/head bump, edge artifacts, or arm still in width. Skipping this measurement.`);
          return; // Skip this landmark
        }
        
        // Front photo gives us the left-right width (one dimension of the cross-section)
        // Side photo gives us the front-back depth (the other dimension)
        // For circumference calculation, we treat the body cross-section as an ellipse
        
        // The width and depth are already the full dimensions (not halves)
        // So we use them directly as the major and minor axes of an ellipse
        const semiMajorAxis = width.mm / 2; // half-width (left-to-right radius)
        const semiMinorAxis = depth.mm / 2; // half-depth (front-to-back radius)
        
        // Calculate cross-sectional area using ellipse formula: π × a × b
        const crossSectionalAreaMm2 = Math.PI * semiMajorAxis * semiMinorAxis;
        const crossSectionalAreaCm2 = crossSectionalAreaMm2 / 100;

        // Calculate circumference using Ramanujan's ellipse approximation
        // This gives us the full wrap-around measurement accounting for both dimensions
        // C ≈ π * (a + b) * (1 + (3h) / (10 + √(4 - 3h)))
        // where h = ((a - b) / (a + b))²
        const h = Math.pow((semiMajorAxis - semiMinorAxis) / (semiMajorAxis + semiMinorAxis), 2);
        const circumferenceMm = Math.PI * (semiMajorAxis + semiMinorAxis) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
        const circumferenceCm = circumferenceMm / 10;

        // Store area for trapezoidal integration later
        combinedMeasurements[landmark] = {
          // 2D measurements from photos
          width: {
            cm: Math.round(width.cm * 10) / 10,
            mm: width.mm
          },
          depth: {
            cm: Math.round(depth.cm * 10) / 10,
            mm: depth.mm
          },
          // 3D calculations (full body wrap-around)
          crossSectionalArea: {
            cm2: Math.round(crossSectionalAreaCm2 * 10) / 10,
            mm2: Math.round(crossSectionalAreaMm2)
          },
          circumference: {
            cm: Math.round(circumferenceCm * 10) / 10,
            mm: Math.round(circumferenceMm)
          },
          // Volume placeholder - will calculate using trapezoidal integration
          volume: {
            cm3: 0,
            liters: 0,
            _areaCm2: crossSectionalAreaCm2, // Store for integration
            _yPos: width.y || depth.y // Store Y position for spacing
          }
        };
        
        console.log(`${landmark}: width=${width.cm}cm, depth=${depth.cm}cm → circumference=${Math.round(circumferenceCm * 10) / 10}cm`);
      }
    });

    // Calculate volumes using trapezoidal integration: Σ ((A_i + A_{i+1}) / 2) * Δz_i
    const landmarkOrder = ["chest", "waist", "hips", "thighs"];
    for (let i = 0; i < landmarkOrder.length - 1; i++) {
      const landmark1 = landmarkOrder[i];
      const landmark2 = landmarkOrder[i + 1];
      const m1 = combinedMeasurements[landmark1];
      const m2 = combinedMeasurements[landmark2];
      
      if (m1 && m2 && m1._areaCm2 && m2._areaCm2) {
        // Calculate spacing in mm (using scale and Y position difference)
        // If Y positions available, use them; otherwise use default spacing
        let deltaZmm;
        if (m1._yPos && m2._yPos && scaleMmPerPx) {
          deltaZmm = Math.abs((m2._yPos - m1._yPos) * scaleMmPerPx);
        } else {
          // Fallback: approximate spacing (each landmark ~15cm apart)
          deltaZmm = 150; // 15cm in mm
        }
        
        // Trapezoidal integration: (A1 + A2) / 2 * Δz
        const avgAreaCm2 = (m1._areaCm2 + m2._areaCm2) / 2;
        const segmentVolumeCm3 = avgAreaCm2 * (deltaZmm / 10); // Convert mm to cm
        const segmentVolumeLiters = segmentVolumeCm3 / 1000;
        
        // Distribute volume between landmarks (half to each)
        m1.volume.cm3 += Math.round(segmentVolumeCm3 / 2);
        m1.volume.liters += segmentVolumeLiters / 2;
        m2.volume.cm3 += Math.round(segmentVolumeCm3 / 2);
        m2.volume.liters += segmentVolumeLiters / 2;
        
        // Round final liters
        m1.volume.liters = Math.round(m1.volume.liters * 100) / 100;
        m2.volume.liters = Math.round(m2.volume.liters * 100) / 100;
        
        // Clean up temporary fields
        delete m1._areaCm2;
        delete m1._yPos;
        delete m2._areaCm2;
        delete m2._yPos;
      }
    }
    
    // Handle single landmark case (fallback to simple calculation)
    landmarkOrder.forEach(landmark => {
      const m = combinedMeasurements[landmark];
      if (m && m.volume.cm3 === 0 && m._areaCm2) {
        // No neighbor, use simple area × 15cm
        m.volume.cm3 = Math.round(m._areaCm2 * 15);
        m.volume.liters = Math.round((m.volume.cm3 / 1000) * 100) / 100;
        delete m._areaCm2;
        delete m._yPos;
      }
    });

    // Calculate total body height (from calibration)
    if (widths.height || depths.height) {
      const heightData = widths.height || depths.height;
      combinedMeasurements.height = heightData;
    }

    setBodyMeasurements(combinedMeasurements);
    console.log("3D measurements calculated:", combinedMeasurements);
  };

  // ---- optional matting refinement (MODNet/RVM) ----
  // Placeholder for future matting refinement to improve mask edges/hair
  // This would use MODNet or RVM (Robust Video Matting) for better alpha matting
  const refineMaskWithMatting = async (canvas, initialMask, width, height) => {
    // TODO: Implement matting refinement
    // Example integration points:
    // - MODNet: https://github.com/ZHKKKe/MODNet
    // - RVM: https://github.com/PeterL1n/RobustVideoMatting
    // - TensorFlow.js port or server-side API
    
    console.log("Matting refinement not yet implemented, using initial mask");
    return initialMask; // Return original mask for now
  };

  // ---- helper: calculate percentile ----
  const percentile = (sortedArray, percentile) => {
    if (sortedArray.length === 0) return null;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  };

  // ---- helper: auto-tune opening kernel per landmark ----
  const measureWidthWithRetune = (maskData, width, height, useInverted, torsoROI, name, centerY, bodyHeightCm, scaleMmPerPx, initialKernel, depthEstimate) => {
    const bandHalfHeight = 20;
    const bandStartY = Math.max(0, centerY - bandHalfHeight);
    const bandEndY = Math.min(height - 1, centerY + bandHalfHeight);
    
    for (let k = initialKernel; k <= 30; k += 3) {
      // Apply opening with kernel k
      const opened = applyHorizontalOpening(maskData, width, height, useInverted, k);
      
      // Scan band
      const widthSamples = [];
      for (let y = bandStartY; y <= bandEndY; y++) {
        const regions = scanRowForBodyRegions(opened, width, y, useInverted, torsoROI, "width");
        if (regions.length === 1) {
          const region = regions[0];
          const dimPx = region.end - region.start;
          widthSamples.push({
            width: dimPx,
            leftX: region.start,
            rightX: region.end
          });
        }
      }
      
      if (widthSamples.length === 0) continue;
      
      // Use 10th percentile
      widthSamples.sort((a, b) => a.width - b.width);
      const wPx = percentile(widthSamples.map(s => s.width), 10);
      const wCm = (wPx * scaleMmPerPx) / 10;
      const wRatio = wCm / bodyHeightCm;
      
      // Check guardrails
      const valid = wRatio >= 0.25 && wRatio <= 0.50;
      const depthCheck = !depthEstimate || wCm <= 1.3 * depthEstimate;
      
      if (valid && depthCheck) {
        const chosen = widthSamples.find(s => s.width === wPx);
        return { widthPx: wPx, widthCm: wCm, kernel: k, details: chosen };
      }
    }
    
    return null; // Failed all kernels
  };

  // ---- find largest 2D connected component (torso ROI) ----
  const findTorsoROI = (maskData, width, height, useInverted) => {
    // Find all 2D connected components using flood fill
    const visited = new Uint8Array(width * height);
    const components = [];
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (visited[idx]) continue;
        
        const maskValue = maskData[idx];
        const isBodyPixel = useInverted ? maskValue < 127 : maskValue > 127;
        if (!isBodyPixel) continue;
        
        // Flood fill to find connected component
        const component = [];
        const stack = [[x, y]];
        let minX = x, maxX = x, minY = y, maxY = y;
        
        while (stack.length > 0) {
          const [cx, cy] = stack.pop();
          const cidx = cy * width + cx;
          if (visited[cidx]) continue;
          
          const cmaskValue = maskData[cidx];
          const cisBodyPixel = useInverted ? cmaskValue < 127 : cmaskValue > 127;
          if (!cisBodyPixel) continue;
          
          visited[cidx] = 1;
          component.push([cx, cy]);
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy);
          maxY = Math.max(maxY, cy);
          
          // Add neighbors
          if (cx > 0) stack.push([cx - 1, cy]);
          if (cx < width - 1) stack.push([cx + 1, cy]);
          if (cy > 0) stack.push([cx, cy - 1]);
          if (cy < height - 1) stack.push([cx, cy + 1]);
        }
        
        if (component.length > 100) { // Minimum size threshold
          components.push({
            pixels: component.length,
            bbox: { minX, maxX, minY, maxY },
            width: maxX - minX,
            height: maxY - minY
          });
        }
      }
    }
    
    if (components.length === 0) return null;
    
    // Return largest component
    components.sort((a, b) => b.pixels - a.pixels);
    return components[0].bbox;
  };

  // ---- horizontal morphological opening to suppress arms ----
  // Erodes then dilates horizontally only (removes lateral arm bulges without shrinking torso height)
  const applyHorizontalOpening = (maskData, width, height, useInverted, kernelSize) => {
    const result = new Uint8Array(maskData.length);
    
    // Erode horizontally
    const eroded = new Uint8Array(maskData.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const maskValue = maskData[idx];
        const isBodyPixel = useInverted ? maskValue < 127 : maskValue > 127;
        
        if (!isBodyPixel) {
          eroded[idx] = maskValue;
          continue;
        }
        
        // Check if all pixels in horizontal kernel are body pixels
        let allBody = true;
        for (let dx = -kernelSize; dx <= kernelSize; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            allBody = false;
            break;
          }
          const nidx = y * width + nx;
          const nmaskValue = maskData[nidx];
          const nisBodyPixel = useInverted ? nmaskValue < 127 : nmaskValue > 127;
          if (!nisBodyPixel) {
            allBody = false;
            break;
          }
        }
        
        eroded[idx] = allBody ? maskValue : (useInverted ? 255 : 0);
      }
    }
    
    // Dilate horizontally
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const maskValue = eroded[idx];
        const isBodyPixel = useInverted ? maskValue < 127 : maskValue > 127;
        
        if (isBodyPixel) {
          result[idx] = maskValue;
          continue;
        }
        
        // Check if any pixel in horizontal kernel is body pixel
        let anyBody = false;
        for (let dx = -kernelSize; dx <= kernelSize; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nidx = y * width + nx;
          const nmaskValue = eroded[nidx];
          const nisBodyPixel = useInverted ? nmaskValue < 127 : nmaskValue > 127;
          if (nisBodyPixel) {
            anyBody = true;
            break;
          }
        }
        
        result[idx] = anyBody ? (useInverted ? 0 : 255) : maskValue;
      }
    }
    
    return result;
  };

  // ---- scan single row and find non-edge-touching body regions ----
  const scanRowForBodyRegions = (maskData, width, y, useInverted, roi, type = "width") => {
    const bodyRegions = [];
    let currentRegion = null;
    const startX = roi ? Math.max(0, roi.minX - 5) : 0;
    const endX = roi ? Math.min(width, roi.maxX + 5) : width;
    
    for (let x = startX; x < endX; x++) {
      const idx = y * width + x;
      const maskValue = maskData[idx];
      const isBodyPixel = useInverted ? maskValue < 127 : maskValue > 127;
      
      if (isBodyPixel) {
        if (currentRegion === null) {
          currentRegion = { start: x, end: x };
        } else {
          currentRegion.end = x;
        }
      } else {
        if (currentRegion !== null) {
          bodyRegions.push(currentRegion);
          currentRegion = null;
        }
      }
    }
    
    if (currentRegion !== null) {
      bodyRegions.push(currentRegion);
    }
    
    // Edge rejection logic:
    // - For front photos (width): reject regions touching ANY edge (person should be centered)
    // - For side photos (depth): allow regions touching ONE edge (person is at side of frame)
    //   but reject regions touching BOTH edges (spans full width = likely background/artifacts)
    const nonEdgeRegions = bodyRegions.filter(region => {
      const touchesLeftEdge = region.start <= 1;
      const touchesRightEdge = region.end >= width - 2;
      const touchesBothEdges = touchesLeftEdge && touchesRightEdge;
      const spanRatio = (region.end - region.start) / width;
      
      if (type === "width") {
        // Front photo: reject if touches any edge
        return !touchesLeftEdge && !touchesRightEdge;
      } else {
        // Side photo: reject if touches both edges OR spans > 80% of width
        if (touchesBothEdges || spanRatio > 0.8) {
          return false;
        }
        // Allow regions touching one edge (normal for side profile)
        return true;
      }
    });
    
    return nonEdgeRegions;
  };

  // ---- detect body features from segmentation mask ----
  // Uses: Pixel Calibration + Deterministic Segmentation with fixes:
  // 1. Reject edge-touching components (x=0 or x=W-1)
  // 2. Use torso-only ROI (largest 2D connected component)
  // 3. Median across vertical band (±15px) instead of single row
  // 4. Sanity constraints based on height (0.25H ≤ width ≤ 0.55H, etc.)
  // 5. Discard fragmented rows (>1 internal component after edge rejection)
  const detectBodyFeatures = (maskData, width, height, type = "width") => {
    if (!scaleMmPerPx) {
      console.warn("No scale available for measurements");
      return null;
    }
    
    // maskData is a Uint8Array where each value represents mask confidence
    // Values > 127 typically indicate person pixels

    // Determine if mask is inverted by sampling multiple points
    // Sample center and a few points around it
    const centerY = Math.floor(height * 0.5);
    const centerX = Math.floor(width * 0.5);
    const samplePoints = [
      centerY * width + centerX,
      centerY * width + Math.floor(width * 0.3),
      centerY * width + Math.floor(width * 0.7),
      Math.floor(height * 0.3) * width + centerX,
      Math.floor(height * 0.7) * width + centerX,
    ];
    const samples = samplePoints.map(idx => maskData[idx]);
    const avgSample = samples.reduce((a, b) => a + b, 0) / samples.length;
    let useInverted = avgSample < 64;

    // Find torso ROI (largest 2D connected component)
    let torsoROI = findTorsoROI(maskData, width, height, useInverted);
    
    // If ROI spans > 90% of image width, mask is likely inverted
    if (torsoROI && (torsoROI.maxX - torsoROI.minX) / width > 0.9) {
      console.warn(`[${type}] Torso ROI spans ${((torsoROI.maxX - torsoROI.minX) / width * 100).toFixed(1)}% of width - trying inverted mask`);
      useInverted = !useInverted;
      torsoROI = findTorsoROI(maskData, width, height, useInverted);
    }
    
    if (!torsoROI) {
      console.warn(`[${type}] No valid torso ROI found`);
      return null;
    }
    
    const roiWidthRatio = (torsoROI.maxX - torsoROI.minX) / width;
    console.log(`[${type}] Torso ROI: x=${torsoROI.minX}-${torsoROI.maxX}, y=${torsoROI.minY}-${torsoROI.maxY} (${(roiWidthRatio * 100).toFixed(1)}% of width), inverted=${useInverted}`);

    // Convert head/heel Y positions to actual pixel positions
    const headYPx = (headY / 720) * height;
    const heelYPx = (heelY / 720) * height;
    const bodyHeightPx = heelYPx - headYPx;
    const bodyHeightCm = bodyHeightPx * scaleMmPerPx / 10;
    
    // Scale logging
    console.log(`[scale] mm/px=${scaleMmPerPx.toFixed(3)}, spanPx=${bodyHeightPx.toFixed(1)}, H=${bodyHeightCm.toFixed(1)}cm`);

    // Sanity constraints based on height
    // Width (front photo): side-to-side breadth is larger
    const minWidthCm = bodyHeightCm * 0.25; // 25% of height
    const maxWidthCm = bodyHeightCm * 0.50; // 50% of height (reduced from 55%)
    // Depth (side photo): front-to-back thickness is naturally smaller
    const minDepthCm = bodyHeightCm * 0.18; // 18% of height (restored for better validation)
    const maxDepthCm = bodyHeightCm * 0.45; // 45% of height (reduced from 50%)

    // Define key vertical positions as ratios from HEAD (0.0 = head, 1.0 = heel)
    // All ratios are from HEAD to ensure correct ordering: chest < waist < hips < thighs
    // Based on anatomical proportions and avoiding deltoids/arm flare
    const landmarks = {
      chest: 0.30,   // 30% down from head (~0.26-0.35H typical range)
      waist: 0.45,   // 45% down from head (~0.23-0.32H typical range)
      hips: 0.55,    // 55% down from head (~0.26-0.36H typical range)
      thighs: 0.70,  // 70% down from head
    };
    
    // Sanity check: verify band ordering (chest should be above waist/hips)
    const chestY = Math.floor(headYPx + (bodyHeightPx * landmarks.chest));
    const waistY = Math.floor(headYPx + (bodyHeightPx * landmarks.waist));
    const hipsY = Math.floor(headYPx + (bodyHeightPx * landmarks.hips));
    
    if (!(chestY < waistY && waistY < hipsY)) {
      console.warn(`[bands] Invalid order detected! chestY=${chestY}, waistY=${waistY}, hipsY=${hipsY}`);
      console.warn(`[bands] Falling back to safe ratios: chest=0.30, waist=0.45, hips=0.55`);
      // Already using safe ratios, but log the issue
    }
    
    console.log(`[bands % of H from head]`, {
      chest: landmarks.chest.toFixed(2),
      waist: landmarks.waist.toFixed(2),
      hips: landmarks.hips.toFixed(2),
      thighs: landmarks.thighs.toFixed(2)
    });
    console.log(`[bands y px]`, {
      chest: chestY,
      waist: waistY,
      hips: hipsY,
      thighs: Math.floor(headYPx + (bodyHeightPx * landmarks.thighs))
    });

    // Apply horizontal morphological opening for width measurements (suppress arms)
    // Calculate kernel size: remove 35-45mm of lateral arm bulge
    // k_px = round(desired_mm / mm_per_px) where desired_mm ∈ [35, 45]
    let processedMaskData = maskData;
    let kernelSize = null;
    if (type === "width") {
      const targetRemovalMm = 35; // Start with 35mm (3.5cm)
      kernelSize = Math.max(15, Math.min(30, Math.round(targetRemovalMm / scaleMmPerPx)));
      console.log(`[${type}] Applying horizontal opening with kernel=${kernelSize}px (target: ${targetRemovalMm}mm removal, scale=${scaleMmPerPx.toFixed(3)}mm/px)`);
      processedMaskData = applyHorizontalOpening(maskData, width, height, useInverted, kernelSize);
    }

    const measurements = {};

    // Calculate horizontal width at each landmark using vertical band median
    for (const [name, ratio] of Object.entries(landmarks)) {
      const centerY = Math.floor(headYPx + (bodyHeightPx * ratio));
      
      if (centerY < 0 || centerY >= height) {
        console.warn(`  ${name}: Y position ${centerY} out of bounds (0-${height})`);
        measurements[name] = null;
        continue;
      }
      
      // Validate Y position is within body bounds
      if (centerY < headYPx - 10 || centerY > heelYPx + 10) {
        console.warn(`  ${name}: Y position ${centerY} outside body bounds (${headYPx}-${heelYPx})`);
        measurements[name] = null;
        continue;
      }

      // Landmark-specific bounds (after opening & before retune)
      let landmarkMinCm, landmarkMaxCm;
      if (type === "width") {
        // Front width guardrails (as fractions of height)
        if (name === "chest") {
          landmarkMinCm = bodyHeightCm * 0.26;
          landmarkMaxCm = bodyHeightCm * 0.35;
        } else if (name === "waist") {
          landmarkMinCm = bodyHeightCm * 0.23;
          landmarkMaxCm = bodyHeightCm * 0.32;
        } else if (name === "hips") {
          landmarkMinCm = bodyHeightCm * 0.26;
          landmarkMaxCm = bodyHeightCm * 0.36;
        } else { // thighs
          landmarkMinCm = bodyHeightCm * 0.20;
          landmarkMaxCm = bodyHeightCm * 0.50;
        }
      } else {
        // Side depth guardrails (as fractions of height)
        // Lowered minimums based on actual measurements (chest/waist typically 10-15% of height)
        if (name === "chest") {
          landmarkMinCm = bodyHeightCm * 0.10; // Lowered from 0.18 (was 30.6cm for 170cm, now 17cm)
          landmarkMaxCm = bodyHeightCm * 0.28;
        } else if (name === "waist") {
          landmarkMinCm = bodyHeightCm * 0.14; // Lowered from 0.18 (was 30.6cm for 170cm, now 23.8cm)
          landmarkMaxCm = bodyHeightCm * 0.28;
        } else if (name === "hips") {
          landmarkMinCm = bodyHeightCm * 0.18;
          landmarkMaxCm = bodyHeightCm * 0.30;
        } else { // thighs
          landmarkMinCm = bodyHeightCm * 0.12;
          landmarkMaxCm = bodyHeightCm * 0.45;
        }
      }
      
      let dimPx, dimCm, usedKernel = kernelSize, chosenRegion = null;
      
      if (type === "width") {
        // For width: use auto-tune with 10th percentile
        // Try initial kernel, then retune if needed
        const depthEstimate = measurements.waist ? measurements.waist.cm * 1.2 : null; // Rough estimate
        const result = measureWidthWithRetune(
          maskData, width, height, useInverted, torsoROI, name, centerY,
          bodyHeightCm, scaleMmPerPx, kernelSize, depthEstimate
        );
        
        if (result) {
          dimPx = result.widthPx;
          dimCm = result.widthCm;
          usedKernel = result.kernel;
          chosenRegion = result.details;
          
          // Enhanced debug logs
          const widthSamples = []; // Would need to collect from measureWidthWithRetune
          console.log(`[width] ${name}: p10=${dimPx.toFixed(1)}px, kernel=${usedKernel}px`);
          if (chosenRegion) {
            console.log(`[asym] ${name}: L=${chosenRegion.leftX - torsoROI.minX}px, R=${torsoROI.maxX - chosenRegion.rightX}px`);
          }
        } else {
          console.warn(`  ${name} (${type}): Auto-tune failed for all kernels`);
          measurements[name] = null;
          continue;
        }
      } else {
        // For depth: use vertical band with MEDIAN
        const bandHalfHeight = 20;
        const bandStartY = Math.max(0, centerY - bandHalfHeight);
        const bandEndY = Math.min(height - 1, centerY + bandHalfHeight);
        const dimensionSamples = [];
        
        for (let y = bandStartY; y <= bandEndY; y++) {
          const regions = scanRowForBodyRegions(processedMaskData, width, y, useInverted, torsoROI, type);
          if (regions.length === 1) {
            const region = regions[0];
            dimensionSamples.push(region.end - region.start);
          }
        }
        
        if (dimensionSamples.length === 0) {
          console.warn(`  ${name} (${type}): No valid regions found in vertical band`);
          measurements[name] = null;
          continue;
        }
        
        // Use median for depth
        dimensionSamples.sort((a, b) => a - b);
        const medianIdx = Math.floor(dimensionSamples.length / 2);
        dimPx = dimensionSamples.length % 2 === 0
          ? (dimensionSamples[medianIdx - 1] + dimensionSamples[medianIdx]) / 2
          : dimensionSamples[medianIdx];
        dimCm = (dimPx * scaleMmPerPx) / 10;
        
        // Enhanced debug logs
        const p30 = percentile(dimensionSamples, 30);
        const p50 = percentile(dimensionSamples, 50);
        const p70 = percentile(dimensionSamples, 70);
        console.log(`[depth] ${name}: p50=${p50?.toFixed(1) || 'N/A'}px, p30=${p30?.toFixed(1) || 'N/A'}px, p70=${p70?.toFixed(1) || 'N/A'}px`);
      }
      
      // Symmetry clamp for width (apply BEFORE bounds check)
      if (type === "width" && chosenRegion) {
        const torsoCenterX = (torsoROI.minX + torsoROI.maxX) / 2;
        const leftHalf = chosenRegion.leftX - torsoROI.minX;
        const rightHalf = torsoROI.maxX - chosenRegion.rightX;
        const asymmetry = Math.abs(leftHalf - rightHalf) / dimPx;
        
        if (asymmetry > 0.25) {
          // Apply symmetry clamp: width = 2 * min(leftHalf, rightHalf)
          const wSym = 2 * Math.min(leftHalf, rightHalf);
          console.log(`[asym] ${name}: High asymmetry ${(asymmetry * 100).toFixed(1)}%, clamping: ${dimPx.toFixed(1)}px → ${wSym.toFixed(1)}px`);
          dimPx = Math.min(dimPx, wSym);
          dimCm = (dimPx * scaleMmPerPx) / 10;
        }
      }
      
      // Soft coupling: width ≤ 1.25 * depth (only if we have depth estimate)
      // Note: depthEstimate is only available for width measurements
      if (type === "width") {
        const currentDepthEstimate = measurements.waist ? measurements.waist.cm * 1.2 : null;
        if (currentDepthEstimate && dimCm > currentDepthEstimate * 1.25) {
          const capped = currentDepthEstimate * 1.25;
          console.log(`[guards] ${name}: Soft cap applied: ${dimCm.toFixed(1)}cm → ${capped.toFixed(1)}cm (1.25×depth)`);
          dimCm = capped;
          dimPx = (capped * 10) / scaleMmPerPx;
        }
      }
      
      // Check bounds with ±10% tolerance
      const tolerance = 0.10;
      const adjustedMinCm = landmarkMinCm * (1 - tolerance);
      const adjustedMaxCm = landmarkMaxCm * (1 + tolerance);
      
      let shouldReject = false;
      let rejectReason = "";
      let guardTripped = "";
      
      // Check bounds with tolerance
      if (dimCm < adjustedMinCm || dimCm > adjustedMaxCm) {
        // Check strict bounds
        if (dimCm < landmarkMinCm || dimCm > landmarkMaxCm) {
          shouldReject = true;
          rejectReason = `outside height-based bounds (${landmarkMinCm.toFixed(1)}-${landmarkMaxCm.toFixed(1)}cm)`;
          guardTripped = `range guard: ${dimCm.toFixed(1)}cm vs [${landmarkMinCm.toFixed(1)}, ${landmarkMaxCm.toFixed(1)}]`;
        } else {
          console.log(`[guards] ${name}: ${dimCm.toFixed(1)}cm within tolerance (±10%) of bounds`);
        }
      }
      
      if (shouldReject) {
        console.warn(`[guards] ${name} (${type}): Rejected - ${rejectReason}`);
        console.warn(`  ${guardTripped}`);
        console.warn(`  Body height: ${bodyHeightCm.toFixed(1)}cm`);
        measurements[name] = null;
        continue;
      }
      
      console.log(`  ${name} (${type}): ${dimPx.toFixed(1)}px → ${dimCm.toFixed(1)}cm`);
      if (type === "width") {
        console.log(`    [opening] k_px=${usedKernel}px applied, [width] chosen=${dimPx.toFixed(1)}px`);
      }
      
      const dimMm = dimPx * scaleMmPerPx;
      
      measurements[name] = {
        pixels: Math.round(dimPx),
        mm: Math.round(dimMm),
        cm: Math.round(dimCm * 10) / 10, // Round to 1 decimal
        type: type, // "width" or "depth"
        y: centerY,
      };
    }
    
    // Final sanity check: depth should not be > width * 1.3 at chest/waist
    // (This check would need front measurements, so we'll do it in calculate3DMeasurements)

    // Also calculate total body height
    measurements.height = {
      pixels: bodyHeightPx,
      mm: Math.round(bodyHeightPx * scaleMmPerPx),
      cm: Math.round((bodyHeightPx * scaleMmPerPx / 10) * 10) / 10,
    };

    return measurements;
  };

  // ---- calculate 3D measurements from widths and depths ----
  // Combines front photo widths with side photo depths to calculate 3D measurements
  // For circumference, uses ellipse approximation: C ≈ π * (3(a+b) - √((3a+b)(a+3b)))
  // Where a = width/2, b = depth/2 (half-axes of the ellipse)

  // ---- upload photo handlers (for testing) ----
  const handleFileUpload = async (event, type) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert("Please upload an image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas from uploaded image
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        
        // Store canvas and data URL
        capturedCanvasRef.current = canvas;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        setCapturedDataUrl(dataUrl);

        if (type === "front") {
          // Process as front photo
          setFrontImageData(dataUrl);
          setCaptureState("front");
        } else if (type === "side") {
          // Process as side photo - save but don't segment yet
          setCaptureState("side");
          setSideImageData(dataUrl);
          // Don't trigger segmentation yet - wait for explicit submit
        }
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      alert("Failed to read file");
    };
    reader.readAsDataURL(file);
    
    // Reset file input so same file can be selected again
    event.target.value = '';
  };

  // Submit to proceed to side capture (resets camera view but keeps scale)
  const handleSubmit = async () => {
    // Segment front photo before moving to side
    if (frontImageData && isModelReady) {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = frontImageData;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      await performFrontSegmentation(canvas);
    }

    setCaptureState("side");
    // Reset to camera view for side capture
    setCapturedDataUrl(null);
    capturedCanvasRef.current = null;
    // Reconnect stream to video element if needed
    setTimeout(() => {
      if (videoRef.current && streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(err => console.error("Video play error:", err));
      }
    }, 100);
  };

  return (
    <div style={{background:"#0b1220", color:"#e5e7eb", minHeight:"100vh"}}>
      <div style={{maxWidth:960, margin:"0 auto", padding:16}}>
        <h1>Calibration</h1>
        <p>Enter height → drag <b>Head</b>/<b>Heel</b> lines → Lock scale.</p>

        <div style={{display:"flex", gap:12, alignItems:"center", margin:"12px 0"}}>
          <input type="number" value={heightCm} onChange={e=>setHeightCm(+e.target.value)} style={{width:90}}/> cm
          <button onClick={lockScale}>Lock scale</button>
          {scaleMmPerPx && <span>Scale: {scaleMmPerPx.toFixed(3)} mm/px</span>}
        </div>

        <div style={{display:"flex", gap:12, margin:"12px 0", flexWrap:"wrap", alignItems:"center"}}>
          {captureState === null && (
            <>
              <button 
                onClick={handleCaptureFront} 
                disabled={typeof countdown === "number" || !isModelReady}
              >
                {typeof countdown === "number" ? `Capturing in ${countdown}...` : "Capture FRONT"}
          </button>
              {/* Upload option for testing */}
              <label style={{
                padding: "8px 16px",
                background: "#374151",
                border: "1px solid #4B5563",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                display: "inline-block"
              }}>
                📁 Upload Front (test)
                <input
                  type="file"
                  accept="image/*"
                  style={{display: "none"}}
                  onChange={(e) => handleFileUpload(e, "front")}
                />
              </label>
              {capturedDataUrl && (
                <>
                  <button onClick={retakePhoto} disabled={typeof countdown === "number"}>
                    Retake Photo
          </button>
                  <button 
                    onClick={autoDetectHeadHeel} 
                    disabled={!capturedDataUrl || !isPoseReady || typeof countdown === "number"}
                  >
                    Auto-detect head/heel
                  </button>
                </>
              )}
            </>
          )}
          {captureState === "front" && (
            <>
              {capturedDataUrl && (
                <>
                  <button onClick={retakePhoto} disabled={typeof countdown === "number"}>
                    Retake Front Photo
                  </button>
                  <button 
                    onClick={autoDetectHeadHeel} 
                    disabled={!capturedDataUrl || !isPoseReady || typeof countdown === "number"}
                  >
                    Auto-detect head/heel
                  </button>
                </>
              )}
              <button 
                onClick={handleSubmit} 
                disabled={!scaleMmPerPx}
                style={{background:"#10b981", color:"white", fontWeight:"bold"}}
              >
                Submit & Capture Side
              </button>
            </>
          )}
          {captureState === "side" && (
            <>
              <button 
                onClick={handleCaptureSide} 
                disabled={typeof countdown === "number" || !isModelReady || !scaleMmPerPx}
              >
                {typeof countdown === "number" ? `Capturing in ${countdown}...` : "Capture SIDE"}
              </button>
              {/* Upload option for testing */}
              <label style={{
                padding: "8px 16px",
                background: (!scaleMmPerPx || !isModelReady) ? "#1F2937" : "#374151",
                border: "1px solid #4B5563",
                borderRadius: "6px",
                cursor: (!scaleMmPerPx || !isModelReady) ? "not-allowed" : "pointer",
                fontSize: "14px",
                display: "inline-block",
                opacity: (!scaleMmPerPx || !isModelReady) ? 0.5 : 1
              }}>
                📁 Upload Side (test)
                <input
                  type="file"
                  accept="image/*"
                  style={{display: "none"}}
                  onChange={(e) => handleFileUpload(e, "side")}
                  disabled={!scaleMmPerPx || !isModelReady}
                />
              </label>
              {(capturedDataUrl || sideImageData) && (
                <>
                  <button onClick={retakePhoto} disabled={typeof countdown === "number"}>
                    Retake Side Photo
                  </button>
                  <button 
                    onClick={autoDetectHeadHeel} 
                    disabled={(!capturedDataUrl && !sideImageData) || !isPoseReady || typeof countdown === "number"}
                  >
                    Auto-detect head/heel
          </button>
                  <button
                    onClick={handleSubmitSide}
                    disabled={!scaleMmPerPx || !isModelReady || typeof countdown === "number"}
                    style={{background:"#10b981", color:"white", fontWeight:"bold"}}
                  >
                    Submit Side & Calculate
          </button>
                </>
              )}
            </>
          )}
        </div>

        <div style={{position:"relative", width:"100%", aspectRatio:"16/9", background:"black", borderRadius:12, overflow:"hidden"}}>
        {!capturedDataUrl && !sideImageData ? (
          <video 
            key="camera-video"
            ref={(el)=>{
              if (el) {
                videoRef.current = el;
                displayRef.current = el;
                // Reconnect stream if we have one stored
                if (streamRef.current) {
                  el.srcObject = streamRef.current;
                  el.onloadeddata = () => {
                    el.play().catch(err => console.error("Video play error:", err));
                  };
                }
              }
            }} 
            className="video" 
            style={{width:"100%", height:"100%", objectFit:"contain"}} 
            playsInline 
            muted 
            autoPlay
          />
        ) : (
          <img ref={displayRef} src={sideImageData || capturedDataUrl} alt="Captured" style={{width:"100%", height:"100%", objectFit:"contain"}} />
        )}
          <canvas
            ref={overlayRef}
            style={{position:"absolute", inset:0}}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>
        <p style={{opacity:0.7, fontSize:12, marginTop:8}}>
          Tips: phone level (|pitch|,|roll| &lt; 2°), subject centered, full body visible, tight clothing.
        </p>

        {/* Display segmentation composites (front and side) */}
        {(frontComposite || sideComposite) && (
          <div style={{
            marginTop: 24,
            padding: 20,
            background: "#1f2937",
            borderRadius: 12,
            border: "1px solid #374151"
          }}>
            <h2 style={{margin: "0 0 16px 0", fontSize: 20}}>Body Segmentation Masks</h2>
            <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16}}>
              {frontComposite && (
                <div>
                  <h3 style={{margin: "0 0 8px 0", fontSize: 16, opacity: 0.9}}>Front View</h3>
                  <img 
                    src={frontComposite} 
                    alt="Front segmentation" 
                    style={{
                      width: "100%",
                      height: "auto",
                      borderRadius: 8,
                      border: "2px solid #374151"
                    }}
                  />
                </div>
              )}
              {sideComposite && (
                <div>
                  <h3 style={{margin: "0 0 8px 0", fontSize: 16, opacity: 0.9}}>Side View</h3>
                  <img 
                    src={sideComposite} 
                    alt="Side segmentation" 
                    style={{
                      width: "100%",
                      height: "auto",
                      borderRadius: 8,
                      border: "2px solid #374151"
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Display detected body measurements */}
        {bodyMeasurements && (
          <div style={{
            marginTop: 24,
            padding: 20,
            background: "#1f2937",
            borderRadius: 12,
            border: "1px solid #374151"
          }}>
            <h2 style={{margin: "0 0 16px 0", fontSize: 20}}>Detected Body Measurements</h2>
            
            {bodyMeasurements.height && (
              <div style={{marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #374151"}}>
                <strong>Height:</strong> {bodyMeasurements.height.cm} cm ({bodyMeasurements.height.mm} mm)
              </div>
            )}

            {/* 2D Measurements (Widths and Depths) */}
            {["chest", "waist", "hips", "thighs"].map(landmark => {
              const measurement = bodyMeasurements[landmark];
              if (!measurement) return null;

              return (
                <div key={landmark} style={{
                  marginBottom: 20,
                  padding: 16,
                  background: "#111827",
                  borderRadius: 8,
                  border: "1px solid #374151"
                }}>
                  <h3 style={{margin: "0 0 12px 0", fontSize: 16, textTransform: "capitalize"}}>{landmark}</h3>
                  <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12}}>
                    <div>
                      <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Width (Front)</div>
                      <div style={{fontSize: 18, fontWeight: "bold"}}>{measurement.width.cm} cm</div>
                      <div style={{fontSize: 11, opacity: 0.6}}>{measurement.width.mm} mm</div>
                    </div>
                    <div>
                      <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Depth (Side)</div>
                      <div style={{fontSize: 18, fontWeight: "bold"}}>{measurement.depth.cm} cm</div>
                      <div style={{fontSize: 11, opacity: 0.6}}>{measurement.depth.mm} mm</div>
                    </div>
                  </div>
                  
                  {/* 3D Calculations */}
                  <div style={{marginTop: 12, paddingTop: 12, borderTop: "1px solid #374151"}}>
                    <div style={{fontSize: 12, opacity: 0.7, marginBottom: 8}}>3D Measurements</div>
                    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8}}>
                      <div>
                        <div style={{fontSize: 10, opacity: 0.6}}>Circumference</div>
                        <div style={{fontSize: 14, fontWeight: "bold"}}>{measurement.circumference.cm} cm</div>
                      </div>
                      <div>
                        <div style={{fontSize: 10, opacity: 0.6}}>Cross-Section</div>
                        <div style={{fontSize: 14, fontWeight: "bold"}}>{measurement.crossSectionalArea.cm2} cm²</div>
                      </div>
                      <div>
                        <div style={{fontSize: 10, opacity: 0.6}}>Volume</div>
                        <div style={{fontSize: 14, fontWeight: "bold"}}>{measurement.volume.liters} L</div>
                        <div style={{fontSize: 9, opacity: 0.5}}>{measurement.volume.cm3} cm³</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {(!bodyMeasurements.chest && !bodyMeasurements.waist && !bodyMeasurements.hips && !bodyMeasurements.thighs) && (
              <p style={{opacity: 0.7, fontSize: 14, marginTop: 12}}>
                Could not detect all measurements. Please ensure the subject is fully visible and well-lit.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
