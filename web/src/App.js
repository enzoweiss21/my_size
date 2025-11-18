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
  // detected body features/measurements
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
  // - Measured pixel distance between head and heel (spanPx)
  // Formula: scaleMmPerPx = (heightCm * 10) / spanPx
  // This calibration is then used with deterministic segmentation scanning
  const lockScale = () => {
    const spanPx = Math.abs(heelY - headY);
    if (spanPx < 200) return alert("Subject too small in frame. Step back.");
    if (Math.abs(pitchDeg) > 2 || Math.abs(rollDeg) > 2) return alert("Hold phone level (|pitch|,|roll| < 2°).");
    const computedScale = (heightCm * 10) / spanPx; // mm per pixel
    setScaleMmPerPx(computedScale);
    console.log(`Pixel calibration locked: ${computedScale.toFixed(3)} mm/px (${heightCm}cm / ${spanPx}px)`);
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

      // Optionally refine mask with matting (future: MODNet/RVM)
      // For now, use binary mask directly
      let refinedMask = mdata;
      const width = canvas.width;
      const height = canvas.height;
      
      // Optional matting refinement (can be enabled later with MODNet/RVM)
      if (false) { // Set to true when matting model is loaded
        refinedMask = await refineMaskWithMatting(canvas, mdata, width, height);
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

  // ---- perform front segmentation ----
  const performFrontSegmentation = async (canvas) => {
    try {
      const result = await createSegmentationComposite(canvas);
      if (result) {
        setFrontComposite(result.compositeCanvas.toDataURL("image/png"));
        console.log("Front segmentation complete");
      }
    } catch (error) {
      console.error("Front segmentation failed:", error);
    }
  };

  // ---- perform side segmentation and calculate measurements ----
  const performSideSegmentation = async (canvas) => {
    try {
      const result = await createSegmentationComposite(canvas);
      if (!result) return;

      // Store side composite
      setSideComposite(result.compositeCanvas.toDataURL("image/png"));
      
      console.log("Side segmentation complete - composite rendered");
      
      // IMPORTANT: Compute measurements from mask data, not rendered RGB image
      const measurements = detectBodyFeatures(result.maskData, result.width, result.height);
      setBodyMeasurements(measurements);
      
      // Log measurements for debugging
      console.log("Body measurements detected from mask:", measurements);
    } catch (error) {
      console.error("Side segmentation failed:", error);
      alert("Failed to segment image: " + error.message);
    }
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

  // ---- detect body features from segmentation mask ----
  // Uses: Pixel Calibration + Deterministic Segmentation
  // 
  // 1. PIXEL CALIBRATION: Uses scaleMmPerPx derived from user's known height
  //    and measured pixel span (head-to-heel distance in pixels).
  //    Formula: scaleMmPerPx = (heightCm * 10) / spanPx
  //
  // 2. DETERMINISTIC SEGMENTATION: Scans segmentation mask at fixed vertical
  //    percentages to find body width. No ML/detection models for measurements -
  //    purely pixel-based deterministic scanning.
  //
  // IMPORTANT: This function computes measurements directly from mask data,
  // not from the rendered RGB composite image. This ensures accurate measurements
  // regardless of visual rendering (white background, colors, etc.)
  const detectBodyFeatures = (maskData, width, height) => {
    if (!scaleMmPerPx) {
      console.warn("No scale available for measurements");
      return null;
    }
    
    // maskData is a Uint8Array where each value represents mask confidence
    // Values > 127 typically indicate person pixels

    // Define key vertical positions as percentages from head (0.0) to heel (1.0)
    // These are approximate body landmarks
    const landmarks = {
      chest: 0.30,   // ~30% down from head
      waist: 0.45,   // ~45% down from head
      hips: 0.55,    // ~55% down from head
      thighs: 0.70,  // ~70% down from head
    };

    // Convert head/heel Y positions to actual pixel positions
    const headYPx = (headY / 720) * height;
    const heelYPx = (heelY / 720) * height;
    const bodyHeightPx = heelYPx - headYPx;

    const measurements = {};

    // Calculate horizontal width at each landmark
    for (const [name, ratio] of Object.entries(landmarks)) {
      const yPx = Math.floor(headYPx + (bodyHeightPx * ratio));
      
      if (yPx < 0 || yPx >= height) {
        measurements[name] = null;
        continue;
      }

      // Scan horizontally to find leftmost and rightmost pixels of body
      let leftX = -1;
      let rightX = -1;

      for (let x = 0; x < width; x++) {
        const idx = yPx * width + x;
        if (maskData[idx] > 127) { // Body pixel (mask value > 127)
          if (leftX === -1) leftX = x;
          rightX = x;
        }
      }

      if (leftX >= 0 && rightX >= 0 && rightX > leftX) {
        const widthPx = rightX - leftX;
        const widthMm = widthPx * scaleMmPerPx;
        const widthCm = widthMm / 10;
        
        measurements[name] = {
          pixels: widthPx,
          mm: Math.round(widthMm),
          cm: Math.round(widthCm * 10) / 10, // Round to 1 decimal
          y: yPx,
          leftX,
          rightX,
        };
      } else {
        measurements[name] = null;
      }
    }

    // Also calculate total body height
    measurements.height = {
      pixels: bodyHeightPx,
      mm: Math.round(bodyHeightPx * scaleMmPerPx),
      cm: Math.round((bodyHeightPx * scaleMmPerPx / 10) * 10) / 10,
    };

    return measurements;
  };

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

            <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12}}>
              {bodyMeasurements.chest && (
                <div style={{padding: 12, background: "#111827", borderRadius: 8}}>
                  <div style={{fontSize: 12, opacity: 0.7, marginBottom: 4}}>Chest</div>
                  <div style={{fontSize: 18, fontWeight: "bold"}}>{bodyMeasurements.chest.cm} cm</div>
                  <div style={{fontSize: 11, opacity: 0.6}}>{bodyMeasurements.chest.mm} mm</div>
                </div>
              )}
              {bodyMeasurements.waist && (
                <div style={{padding: 12, background: "#111827", borderRadius: 8}}>
                  <div style={{fontSize: 12, opacity: 0.7, marginBottom: 4}}>Waist</div>
                  <div style={{fontSize: 18, fontWeight: "bold"}}>{bodyMeasurements.waist.cm} cm</div>
                  <div style={{fontSize: 11, opacity: 0.6}}>{bodyMeasurements.waist.mm} mm</div>
                </div>
              )}
              {bodyMeasurements.hips && (
                <div style={{padding: 12, background: "#111827", borderRadius: 8}}>
                  <div style={{fontSize: 12, opacity: 0.7, marginBottom: 4}}>Hips</div>
                  <div style={{fontSize: 18, fontWeight: "bold"}}>{bodyMeasurements.hips.cm} cm</div>
                  <div style={{fontSize: 11, opacity: 0.6}}>{bodyMeasurements.hips.mm} mm</div>
                </div>
              )}
              {bodyMeasurements.thighs && (
                <div style={{padding: 12, background: "#111827", borderRadius: 8}}>
                  <div style={{fontSize: 12, opacity: 0.7, marginBottom: 4}}>Thighs</div>
                  <div style={{fontSize: 18, fontWeight: "bold"}}>{bodyMeasurements.thighs.cm} cm</div>
                  <div style={{fontSize: 11, opacity: 0.6}}>{bodyMeasurements.thighs.mm} mm</div>
                </div>
              )}
            </div>

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
