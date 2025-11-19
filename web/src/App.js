import React, { useRef, useEffect, useState } from "react";
import { FilesetResolver, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";

export default function App() {
  // Mode selection: "select" = start page, "pose" = pose estimation flow, "manual" = manual drawing flow
  const [mode, setMode] = useState("select");

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
  const [countdown, setCountdown] = useState(null); // 5..4..3..2..1 or null
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
  
  // Unit preference: false = cm, true = inches
  const [useInches, setUseInches] = useState(false);

  // Manual drawing mode state
  const [manualDots, setManualDots] = useState({
    front: {
      shoulders: { left: null, right: null },
      chest: { left: null, right: null },
      waist: { left: null, right: null },
      hips: { left: null, right: null },
      // Thigh measurements: thickness (left/right) and upper leg length (top to knee)
      thighs: { left: null, right: null, top: null }, // left/right = thickness, top = top of thigh
      // Knee is the midpoint for leg length
      knee: { center: null }, // Single point at knee (midpoint for leg length)
      // Calf measurements: thickness (left/right) and lower leg length (knee to ankle)
      calves: { left: null, right: null, bottom: null } // left/right = thickness, bottom = ankle
    },
    side: {
      chest: { front: null, back: null },
      waist: { front: null, back: null },
      hips: { front: null, back: null },
      thighs: { front: null, back: null }, // Thigh depth/thickness
      calves: { front: null, back: null }  // Calf depth/thickness
    }
  });
  const [activeDotType, setActiveDotType] = useState(null); // Tracks which measurement type we're placing
  const [draggingDot, setDraggingDot] = useState(null); // e.g. "shoulders-left" | "chest-right" | null
  const [manualCaptureState, setManualCaptureState] = useState("front-capture"); // "front-capture" | "front-calibration" | "side-capture" | "side-calibration" | "front-dots" | "side-dots"
  
  // Separate calibration for front and side photos
  const [frontHeadY, setFrontHeadY] = useState(200);
  const [frontHeelY, setFrontHeelY] = useState(700);
  const [frontScaleMmPerPx, setFrontScaleMmPerPx] = useState(null);
  const [frontDragging, setFrontDragging] = useState(null); // "head" | "heel" | null
  
  const [sideHeadY, setSideHeadY] = useState(200);
  const [sideHeelY, setSideHeelY] = useState(700);
  const [sideScaleMmPerPx, setSideScaleMmPerPx] = useState(null);
  const [sideDragging, setSideDragging] = useState(null); // "head" | "heel" | null

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

  // ---- ensure canvas is available when switching to dot placement ----
  useEffect(() => {
    if (mode === "manual") {
      const needsFrontCanvas = manualCaptureState === "front-dots" || manualCaptureState === "front-calibration";
      const needsSideCanvas = manualCaptureState === "side-dots" || manualCaptureState === "side-calibration";
      if (needsFrontCanvas && frontImageData) {
        // Ensure canvas is set to front image
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          capturedCanvasRef.current = canvas;
        };
        img.src = frontImageData;
      } else if (needsSideCanvas && sideImageData) {
        // Ensure canvas is set to side image
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          capturedCanvasRef.current = canvas;
        };
        img.src = sideImageData;
      }
    }
  }, [mode, manualCaptureState, frontImageData, sideImageData]);

  // ---- ensure camera stream is attached when in capture mode ----
  useEffect(() => {
    if (mode === "manual" && (manualCaptureState === "front-capture" || manualCaptureState === "side-capture")) {
      const ensureCamera = () => {
        if (videoRef.current && streamRef.current) {
          // Check if stream is still active
          const tracks = streamRef.current.getTracks();
          const activeTracks = tracks.filter(t => t.readyState === 'live');
          
          if (activeTracks.length === 0) {
            console.log("Camera stream ended, reinitializing...");
            // Stream ended, need to reinitialize
            (async () => {
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
                  audio: false,
                });
                streamRef.current = stream;
                if (videoRef.current) {
                  videoRef.current.srcObject = stream;
                  videoRef.current.play().catch(console.error);
                }
              } catch (err) {
                console.error("Failed to reinitialize camera:", err);
              }
            })();
            return;
          }
          
          // Reattach stream if needed
          if (videoRef.current.srcObject !== streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
          }
          
          // Ensure video plays
          videoRef.current.play().catch(err => {
            console.error("Video play error:", err);
            // Retry after a short delay
            setTimeout(() => {
              if (videoRef.current && streamRef.current) {
                videoRef.current.srcObject = streamRef.current;
                videoRef.current.play().catch(console.error);
              }
            }, 100);
          });
        } else if (videoRef.current && !streamRef.current) {
          // Video element exists but no stream - try to get it
          console.log("Video element found but no stream, initializing camera...");
          (async () => {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
              });
              streamRef.current = stream;
              if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play().catch(console.error);
              }
            } catch (err) {
              console.error("Failed to initialize camera:", err);
            }
          })();
        }
      };
      
      // Try immediately
      ensureCamera();
      
      // Also try after a short delay to handle async mounting
      const timeout = setTimeout(ensureCamera, 100);
      
      return () => clearTimeout(timeout);
    }
  }, [mode, manualCaptureState]);

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
      // Show calibration lines during calibration phase (both pose and manual modes)
      // Hide them only during dot placement in manual mode
      if (mode === "pose") {
      const yHeadPx = (headY / 720) * h;
      const yHeelPx = (heelY / 720) * h;
      ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 3; ctx.setLineDash([8,6]);
      ctx.beginPath(); ctx.moveTo(0, yHeadPx); ctx.lineTo(w, yHeadPx); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, yHeelPx); ctx.lineTo(w, yHeelPx); ctx.stroke();
      ctx.setLineDash([]);
      } else if (mode === "manual" && manualCaptureState === "front-calibration") {
        const yHeadPx = (frontHeadY / 720) * h;
        const yHeelPx = (frontHeelY / 720) * h;
        ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 3; ctx.setLineDash([8,6]);
        ctx.beginPath(); ctx.moveTo(0, yHeadPx); ctx.lineTo(w, yHeadPx); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, yHeelPx); ctx.lineTo(w, yHeelPx); ctx.stroke();
        ctx.setLineDash([]);
      } else if (mode === "manual" && manualCaptureState === "side-calibration") {
        const yHeadPx = (sideHeadY / 720) * h;
        const yHeelPx = (sideHeelY / 720) * h;
        ctx.strokeStyle = "#60a5fa"; ctx.lineWidth = 3; ctx.setLineDash([8,6]);
        ctx.beginPath(); ctx.moveTo(0, yHeadPx); ctx.lineTo(w, yHeadPx); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, yHeelPx); ctx.lineTo(w, yHeelPx); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Show scale readout
      let currentScale = scaleMmPerPx;
      if (mode === "manual") {
        if (manualCaptureState === "front-calibration" || manualCaptureState === "front-dots") {
          currentScale = frontScaleMmPerPx;
        } else if (manualCaptureState === "side-calibration" || manualCaptureState === "side-dots") {
          currentScale = sideScaleMmPerPx;
        }
      }
      
      if (currentScale) {
        const txt = `scale: ${currentScale.toFixed(3)} mm/px`;
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
  }, [headY, heelY, scaleMmPerPx, pitchDeg, rollDeg, capturedDataUrl, sideImageData, countdown, mode, manualCaptureState, frontHeadY, frontHeelY, frontScaleMmPerPx, sideHeadY, sideHeelY, sideScaleMmPerPx]);

  // ---- drag handlers ----
  const onPointerDown = (e) => {
    // Handle calibration line dragging for manual mode
    if (mode === "manual") {
      if (manualCaptureState === "front-calibration") {
        const rect = overlayRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const y720 = (y / overlayRef.current.height) * 720;
        if (Math.abs(y720 - frontHeadY) < 16) setFrontDragging("head");
        else if (Math.abs(y720 - frontHeelY) < 16) setFrontDragging("heel");
        return;
      } else if (manualCaptureState === "side-calibration") {
        const rect = overlayRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const y720 = (y / overlayRef.current.height) * 720;
        if (Math.abs(y720 - sideHeadY) < 16) setSideDragging("head");
        else if (Math.abs(y720 - sideHeelY) < 16) setSideDragging("heel");
        return;
      } else if (manualCaptureState === "front-dots" || manualCaptureState === "side-dots") {
        // Handle dot dragging - find closest dot
        const rect = overlayRef.current.getBoundingClientRect();
        const img = displayRef.current;
        if (!img || !capturedCanvasRef.current) return;
        
        const imgRect = img.getBoundingClientRect();
        const containerRect = img.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        
        const offsetX = (containerRect.width - imgRect.width) / 2;
        const offsetY = (containerRect.height - imgRect.height) / 2;
        const imageWidth = capturedCanvasRef.current.width || img.naturalWidth || img.width;
        const imageHeight = capturedCanvasRef.current.height || img.naturalHeight || img.height;
        const scaleX = imageWidth / imgRect.width;
        const scaleY = imageHeight / imgRect.height;
        
        const clickX = (e.clientX - rect.left - offsetX) * scaleX;
        const clickY = (e.clientY - rect.top - offsetY) * scaleY;
        
        const threshold = 20 * scaleX; // 20px threshold in image space
        
        let closestDot = null;
        let closestDist = threshold;
        
        if (manualCaptureState === "front-dots") {
          // Standard width measurements (left/right)
          const widthTypes = ['shoulders', 'chest', 'waist', 'hips'];
          for (const type of widthTypes) {
            if (manualDots.front[type].left) {
              const dist = Math.sqrt(Math.pow(clickX - manualDots.front[type].left.x, 2) + Math.pow(clickY - manualDots.front[type].left.y, 2));
              if (dist < closestDist) {
                closestDist = dist;
                closestDot = `${type}-left`;
              }
            }
            if (manualDots.front[type].right) {
              const dist = Math.sqrt(Math.pow(clickX - manualDots.front[type].right.x, 2) + Math.pow(clickY - manualDots.front[type].right.y, 2));
              if (dist < closestDist) {
                closestDist = dist;
                closestDot = `${type}-right`;
              }
            }
          }
          
          // Thigh measurements: left, right, top
          if (manualDots.front.thighs.left) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.thighs.left.x, 2) + Math.pow(clickY - manualDots.front.thighs.left.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'thighs-left';
            }
          }
          if (manualDots.front.thighs.right) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.thighs.right.x, 2) + Math.pow(clickY - manualDots.front.thighs.right.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'thighs-right';
            }
          }
          if (manualDots.front.thighs.top) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.thighs.top.x, 2) + Math.pow(clickY - manualDots.front.thighs.top.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'thighs-top';
            }
          }
          
          // Knee center
          if (manualDots.front.knee.center) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.knee.center.x, 2) + Math.pow(clickY - manualDots.front.knee.center.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'knee-center';
            }
          }
          
          // Calf measurements: left, right, bottom
          if (manualDots.front.calves.left) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.calves.left.x, 2) + Math.pow(clickY - manualDots.front.calves.left.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'calves-left';
            }
          }
          if (manualDots.front.calves.right) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.calves.right.x, 2) + Math.pow(clickY - manualDots.front.calves.right.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'calves-right';
            }
          }
          if (manualDots.front.calves.bottom) {
            const dist = Math.sqrt(Math.pow(clickX - manualDots.front.calves.bottom.x, 2) + Math.pow(clickY - manualDots.front.calves.bottom.y, 2));
            if (dist < closestDist) {
              closestDist = dist;
              closestDot = 'calves-bottom';
            }
          }
        } else if (manualCaptureState === "side-dots") {
          const types = ['chest', 'waist', 'hips', 'thighs', 'calves'];
          for (const type of types) {
            if (manualDots.side[type].front) {
              const dist = Math.sqrt(Math.pow(clickX - manualDots.side[type].front.x, 2) + Math.pow(clickY - manualDots.side[type].front.y, 2));
              if (dist < closestDist) {
                closestDist = dist;
                closestDot = `${type}-front`;
              }
            }
            if (manualDots.side[type].back) {
              const dist = Math.sqrt(Math.pow(clickX - manualDots.side[type].back.x, 2) + Math.pow(clickY - manualDots.side[type].back.y, 2));
              if (dist < closestDist) {
                closestDist = dist;
                closestDot = `${type}-back`;
              }
            }
          }
        }
        
        if (closestDot) {
          setDraggingDot(closestDot);
          return;
        }
        return;
      }
    }
    
    // Pose estimation mode - original behavior
    const rect = overlayRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const y720 = (y / overlayRef.current.height) * 720;
    if (Math.abs(y720 - headY) < 16) setDragging("head");
    else if (Math.abs(y720 - heelY) < 16) setDragging("heel");
  };
  
  const onPointerMove = (e) => {
    // Handle calibration line dragging for manual mode
    if (mode === "manual") {
      if (frontDragging && manualCaptureState === "front-calibration") {
        const rect = overlayRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const y720 = Math.max(0, Math.min(720, (y / overlayRef.current.height) * 720));
        if (frontDragging === "head") setFrontHeadY(y720);
        else setFrontHeelY(y720);
        return;
      } else if (sideDragging && manualCaptureState === "side-calibration") {
        const rect = overlayRef.current.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const y720 = Math.max(0, Math.min(720, (y / overlayRef.current.height) * 720));
        if (sideDragging === "head") setSideHeadY(y720);
        else setSideHeelY(y720);
        return;
      } else if (draggingDot && (manualCaptureState === "front-dots" || manualCaptureState === "side-dots")) {
        // Handle dot dragging - parse draggingDot format: "type-side" or "type-front/back"
        const rect = overlayRef.current.getBoundingClientRect();
        const img = displayRef.current;
        if (!img) return;
        
        const imgRect = img.getBoundingClientRect();
        const containerRect = img.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        
        const offsetX = (containerRect.width - imgRect.width) / 2;
        const offsetY = (containerRect.height - imgRect.height) / 2;
        const imageWidth = capturedCanvasRef.current?.width || img.naturalWidth || img.width;
        const imageHeight = capturedCanvasRef.current?.height || img.naturalHeight || img.height;
        const scaleX = imageWidth / imgRect.width;
        const scaleY = imageHeight / imgRect.height;
        
        const moveX = (e.clientX - rect.left - offsetX) * scaleX;
        const moveY = (e.clientY - rect.top - offsetY) * scaleY;
        
        // Clamp to image bounds
        const clampedX = Math.max(0, Math.min(imageWidth, moveX));
        const clampedY = Math.max(0, Math.min(imageHeight, moveY));
        
        // Handle special case of "knee-center" where we need to handle it differently
        let type, side;
        if (draggingDot === 'knee-center') {
          type = 'knee';
          side = 'center';
        } else {
          [type, side] = draggingDot.split('-');
        }
        
        if (manualCaptureState === "front-dots") {
          // Special handling for knee.center which is a single point, not an object with nested properties
          if (type === 'knee' && side === 'center') {
            setManualDots(prev => ({
              ...prev,
              front: {
                ...prev.front,
                knee: {
                  center: { x: clampedX, y: clampedY }
                }
              }
            }));
          } else {
            setManualDots(prev => ({
              ...prev,
              front: {
                ...prev.front,
                [type]: {
                  ...prev.front[type],
                  [side]: { x: clampedX, y: clampedY }
                }
              }
            }));
          }
        } else if (manualCaptureState === "side-dots") {
          setManualDots(prev => ({
            ...prev,
            side: {
              ...prev.side,
              [type]: {
                ...prev.side[type],
                [side]: { x: clampedX, y: clampedY }
              }
            }
          }));
        }
        return;
      }
    }
    
    // Pose estimation mode - original behavior
    if (!dragging) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const y720 = Math.max(0, Math.min(720, (y / overlayRef.current.height) * 720));
    if (dragging === "head") setHeadY(y720);
    else setHeelY(y720);
  };
  
  const onPointerUp = () => {
    setDragging(null);
    setFrontDragging(null);
    setSideDragging(null);
    setDraggingDot(null);
  };

  // ---- compute pixel calibration scale (IMPROVED) ----
  // This establishes the pixel-to-millimeter conversion ratio using:
  // - User's known height (heightCm)
  // - Measured pixel distance between head and heel (spanPx) in ACTUAL image pixels
  // - Sub-pixel edge refinement for accuracy
  // - Pitch/lens guardrails for quality
  // Formula: scaleMmPerPx = (heightCm * 10) / spanPx
  const lockScale = () => {
    const processScale = (canvas, headYLogical, heelYLogical, isManual = false, photoType = null) => {
      if (!canvas) {
        return { error: isManual ? `No ${photoType} image captured. Please capture a photo first.` : "No image captured. Please capture a photo first." };
      }
      
      // Use actual pixel buffer dimensions (not CSS size)
      const actualImageHeight = canvas.height;
      const actualImageWidth = canvas.width;
      
      // Convert logical Y (0-720) to actual pixel Y
      let headYPx = (headYLogical / 720) * actualImageHeight;
      let heelYPx = (heelYLogical / 720) * actualImageHeight;
      
      // Refine edges using sub-pixel edge snap
      try {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Refine head edge (sample center region)
          headYPx = refineEdgeY(ctx, headYPx, actualImageWidth * 0.3, actualImageWidth * 0.7);
          // Refine heel edge (sample center region)
          heelYPx = refineEdgeY(ctx, heelYPx, actualImageWidth * 0.3, actualImageWidth * 0.7);
        }
      } catch (e) {
        console.warn("Edge refinement failed, using original Y:", e);
      }
      
      const spanPx = Math.abs(heelYPx - headYPx);
      
      // Guardrails
      if (spanPx < 200) {
        return { error: "Subject too small in frame. Step back." };
      }
      
      if (Math.abs(pitchDeg) > 2 || Math.abs(rollDeg) > 2) {
        return { error: "Hold phone level (|pitch|,|roll| < 2°)." };
      }
      
      // Pitch/lens guardrails: reject if span ratio is suspicious
      const spanRatio = spanPx / actualImageHeight;
      if (spanRatio < 0.35 || spanRatio > 0.95) {
        return { error: `Bad calibration: body span (${spanRatio.toFixed(2)} of image height) suggests crop/tilt. Please retake photo.` };
      }
      
      const computedScale = (heightCm * 10) / spanPx;
      
      return {
        scale: computedScale,
        spanPx,
        headYPx,
        heelYPx,
        imageWidth: actualImageWidth,
        imageHeight: actualImageHeight
      };
    };
    
    // Handle manual mode - separate calibration for front and side
    if (mode === "manual") {
      if (manualCaptureState === "front-calibration") {
        const canvas = capturedCanvasRef.current;
        const result = processScale(canvas, frontHeadY, frontHeelY, true, "front");
        if (result.error) {
          return alert(result.error);
        }
        setFrontScaleMmPerPx(result.scale);
        console.log(`Front pixel calibration locked: ${result.scale.toFixed(3)} mm/px`);
        console.log(`  Image: ${result.imageWidth}×${result.imageHeight}px`);
        console.log(`  Head Y: ${result.headYPx.toFixed(1)}px, Heel Y: ${result.heelYPx.toFixed(1)}px`);
        console.log(`  Span: ${result.spanPx.toFixed(1)}px, Height: ${heightCm}cm (${heightCm * 10}mm)`);
        return;
      } else if (manualCaptureState === "side-calibration") {
        const canvas = capturedCanvasRef.current;
        const result = processScale(canvas, sideHeadY, sideHeelY, true, "side");
        if (result.error) {
          return alert(result.error);
        }
        setSideScaleMmPerPx(result.scale);
        console.log(`Side pixel calibration locked: ${result.scale.toFixed(3)} mm/px`);
        console.log(`  Image: ${result.imageWidth}×${result.imageHeight}px`);
        console.log(`  Head Y: ${result.headYPx.toFixed(1)}px, Heel Y: ${result.heelYPx.toFixed(1)}px`);
        console.log(`  Span: ${result.spanPx.toFixed(1)}px, Height: ${heightCm}cm (${heightCm * 10}mm)`);
        return;
      }
    }
    
    // Pose estimation mode
    const canvas = capturedCanvasRef.current;
    const result = processScale(canvas, headY, heelY);
    if (result.error) {
      return alert(result.error);
    }
    setScaleMmPerPx(result.scale);
    console.log(`Pixel calibration locked: ${result.scale.toFixed(3)} mm/px`);
    console.log(`  Image dimensions: ${result.imageWidth}×${result.imageHeight}px`);
    console.log(`  Head Y: ${result.headYPx.toFixed(1)}px, Heel Y: ${result.heelYPx.toFixed(1)}px`);
    console.log(`  Span: ${result.spanPx.toFixed(1)}px, Height: ${heightCm}cm (${heightCm * 10}mm)`);
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
    let t = 5;
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
        // QA: Soft coupling - width should not exceed depth by too much (catches arm leaks)
        let widthMm = width.mm;
        let depthMm = depth.mm;
        
        if (widthMm > depthMm * 1.25) {
          console.warn(`${landmark}: Width (${width.cm}cm) > 1.25× depth (${depth.cm}cm) - possible arm contamination, clamping`);
          widthMm = depthMm * 1.25;
        }
        
        // Final sanity check: depth should not be > width * 1.1
        // If so, likely included back/head bump, edge artifacts
        if (depthMm > widthMm * 1.1) {
          console.warn(`${landmark}: Rejected - depth (${depth.cm}cm) > width (${width.cm}cm) * 1.1`);
          console.warn(`  Likely included back/head bump, edge artifacts. Skipping this measurement.`);
          return; // Skip this landmark
        }
        
        // Calculate cross-sectional area using ellipse formula: π × a × b
        const semiMajorAxis = widthMm / 2;
        const semiMinorAxis = depthMm / 2;
        const crossSectionalAreaMm2 = Math.PI * semiMajorAxis * semiMinorAxis;
        const crossSectionalAreaCm2 = crossSectionalAreaMm2 / 100;

        // Calculate circumference using improved auto-chooser model
        // curvatureHint: 0(round) .. 1(boxy) - estimate from aspect ratio
        const aspectRatio = Math.max(widthMm, depthMm) / Math.min(widthMm, depthMm);
        const curvatureHint = aspectRatio > 1.3 ? 0.7 : 0.4; // Higher aspect = boxier
        
        const circumferenceMmValue = circumferenceMm(widthMm, depthMm, curvatureHint);
        const circumferenceCm = circumferenceMmValue / 10;
        
        // Human plausibility check
        if (landmark === "chest" && (circumferenceCm < 90 || circumferenceCm > 140)) {
          console.warn(`${landmark}: Circumference ${circumferenceCm.toFixed(1)}cm outside typical range (90-140cm). Consider re-taking side photo or adjusting calibration lines.`);
        }

        // Store area for trapezoidal integration later
        combinedMeasurements[landmark] = {
          // 2D measurements from photos (use clamped width if adjusted)
          width: {
            cm: Math.round((widthMm / 10) * 10) / 10,
            mm: widthMm
          },
          depth: {
            cm: Math.round(depth.cm * 10) / 10,
            mm: depthMm
          },
          // 3D calculations (full body wrap-around)
          crossSectionalArea: {
            cm2: Math.round(crossSectionalAreaCm2 * 10) / 10,
            mm2: Math.round(crossSectionalAreaMm2)
          },
          circumference: {
            cm: Math.round(circumferenceCm * 10) / 10,
            mm: Math.round(circumferenceMmValue)
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

  // Manual drawing: handle file upload
  const handleManualFileUpload = async (event, photoType) => {
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

        if (photoType === "front") {
          setFrontImageData(dataUrl);
          if (sideImageData) {
            setManualCaptureState("front-calibration");
          } else {
            setManualCaptureState("side-capture");
            setCapturedDataUrl(null);
          }
        } else if (photoType === "side") {
          setSideImageData(dataUrl);
          if (!frontImageData) {
            setManualCaptureState("front-capture");
            setCapturedDataUrl(null);
          } else {
            setManualCaptureState("front-calibration");
          }
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

  // Helper: Get next dot to place for front photo
  const getNextFrontDot = () => {
    // Standard width measurements (left/right)
    const widthOrder = ['shoulders', 'chest', 'waist', 'hips'];
    for (const type of widthOrder) {
      if (!manualDots.front[type].left) {
        return { type, side: 'left' };
      }
      if (!manualDots.front[type].right) {
        return { type, side: 'right' };
      }
    }
    
    // Thigh measurements: thickness (left/right) then length (top)
    if (!manualDots.front.thighs.left) {
      return { type: 'thighs', side: 'left' };
    }
    if (!manualDots.front.thighs.right) {
      return { type: 'thighs', side: 'right' };
    }
    if (!manualDots.front.thighs.top) {
      return { type: 'thighs', side: 'top' };
    }
    
    // Knee center point (midpoint for leg length)
    if (!manualDots.front.knee.center) {
      return { type: 'knee', side: 'center' };
    }
    
    // Calf measurements: thickness (left/right) then length (bottom)
    if (!manualDots.front.calves.left) {
      return { type: 'calves', side: 'left' };
    }
    if (!manualDots.front.calves.right) {
      return { type: 'calves', side: 'right' };
    }
    if (!manualDots.front.calves.bottom) {
      return { type: 'calves', side: 'bottom' };
    }
    
    return null; // All dots placed
  };

  // Helper: Get next dot to place for side photo
  const getNextSideDot = () => {
    const order = ['chest', 'waist', 'hips', 'thighs', 'calves'];
    for (const type of order) {
      if (!manualDots.side[type].front) {
        return { type, side: 'front' };
      }
      if (!manualDots.side[type].back) {
        return { type, side: 'back' };
      }
    }
    return null; // All dots placed
  };

  // Helper: Check if all front dots are placed
  const areAllFrontDotsPlaced = () => {
    // Standard width measurements
    const widthComplete = ['shoulders', 'chest', 'waist', 'hips'].every(type => 
      manualDots.front[type].left && manualDots.front[type].right
    );
    
    // Thigh measurements: left, right, and top
    const thighsComplete = manualDots.front.thighs.left && 
                          manualDots.front.thighs.right && 
                          manualDots.front.thighs.top;
    
    // Knee center
    const kneeComplete = manualDots.front.knee.center !== null;
    
    // Calf measurements: left, right, and bottom
    const calvesComplete = manualDots.front.calves.left && 
                          manualDots.front.calves.right && 
                          manualDots.front.calves.bottom;
    
    return widthComplete && thighsComplete && kneeComplete && calvesComplete;
  };

  // Helper: Check if all side dots are placed
  const areAllSideDotsPlaced = () => {
    return ['chest', 'waist', 'hips', 'thighs', 'calves'].every(type => 
      manualDots.side[type].front && manualDots.side[type].back
    );
  };

  // Helper: Get dot color based on type and photo type
  const getDotColor = (photoType, type, side) => {
    const colors = {
      front: {
        shoulders: { left: '#ff6b6b', right: '#ee5a6f' },
        chest: { left: '#4ecdc4', right: '#44a08d' },
        waist: { left: '#3b82f6', right: '#ef4444' },
        hips: { left: '#9b59b6', right: '#8e44ad' },
        thighs: { left: '#f39c12', right: '#e67e22', top: '#f39c12' }, // Thickness (left/right) and length (top)
        knee: { center: '#e74c3c' }, // Knee center point
        calves: { left: '#1abc9c', right: '#16a085', bottom: '#1abc9c' } // Thickness (left/right) and length (bottom)
      },
      side: {
        chest: { front: '#f59e0b', back: '#d97706' },
        waist: { front: '#f59e0b', back: '#8b5cf6' },
        hips: { front: '#10b981', back: '#059669' },
        thighs: { front: '#f39c12', back: '#e67e22' }, // Thigh depth/thickness
        calves: { front: '#1abc9c', back: '#16a085' }  // Calf depth/thickness
      }
    };
    return colors[photoType]?.[type]?.[side] || '#60a5fa';
  };

  // Manual drawing: handle clicking on image to place dots (if not dragging)
  const handleManualImageClick = (e, photoType) => {
    // If already dragging a dot, don't place a new one
    if (draggingDot) {
      console.log("Already dragging a dot, ignoring click");
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = e.currentTarget.getBoundingClientRect();
    const img = displayRef.current;
    if (!img) {
      console.log("No image element found");
      return;
    }
    
    if (!img.complete) {
      console.log("Image not loaded yet");
      return;
    }
    
    const imgRect = img.getBoundingClientRect();
    const containerRect = img.parentElement?.getBoundingClientRect();
    if (!containerRect) {
      console.log("No container element found");
      return;
    }
    
    const offsetX = (containerRect.width - imgRect.width) / 2;
    const offsetY = (containerRect.height - imgRect.height) / 2;
    
    // Use image natural dimensions or canvas if available
    const imageWidth = capturedCanvasRef.current?.width || img.naturalWidth || img.width;
    const imageHeight = capturedCanvasRef.current?.height || img.naturalHeight || img.height;
    
    const scaleX = imageWidth / imgRect.width;
    const scaleY = imageHeight / imgRect.height;
    
    const clickX = (e.clientX - rect.left - offsetX) * scaleX;
    const clickY = (e.clientY - rect.top - offsetY) * scaleY;
    
    // Clamp to image bounds
    const clampedX = Math.max(0, Math.min(imageWidth, clickX));
    const clampedY = Math.max(0, Math.min(imageHeight, clickY));
    
    console.log(`Click on ${photoType} photo:`, { clickX, clickY, clampedX, clampedY });
    
    if (photoType === "front") {
      const nextDot = getNextFrontDot();
      if (nextDot) {
        console.log(`Placing ${nextDot.type} ${nextDot.side} dot at:`, { x: clampedX, y: clampedY });
        setManualDots(prev => {
          const updated = {
            ...prev,
            front: {
              ...prev.front,
              [nextDot.type]: {
                ...prev.front[nextDot.type],
                [nextDot.side]: { x: clampedX, y: clampedY }
              }
            }
          };
          console.log("Updated manualDots:", updated);
          return updated;
        });
      } else {
        console.log("All front dots already placed");
      }
    } else if (photoType === "side") {
      const nextDot = getNextSideDot();
      if (nextDot) {
        console.log(`Placing ${nextDot.type} ${nextDot.side} dot at:`, { x: clampedX, y: clampedY });
        setManualDots(prev => {
          const updated = {
            ...prev,
            side: {
              ...prev.side,
              [nextDot.type]: {
                ...prev.side[nextDot.type],
                [nextDot.side]: { x: clampedX, y: clampedY }
              }
            }
          };
          console.log("Updated manualDots:", updated);
          return updated;
        });
      } else {
        console.log("All side dots already placed");
      }
    }
  };

  // ===== UNIT HELPERS (avoid stealth unit slips) =====
  const mm = (px, mmPerPx) => px * mmPerPx;
  const cm = (mm) => mm / 10;
  const inches = (mm) => mm / 25.4;
  
  // Helper: Convert cm to inches (1 cm = 0.393701 inches)
  const cmToInches = (cm) => {
    return Math.round((cm * 0.393701) * 10) / 10;
  };
  
  // ===== PIXEL SCALE REFINEMENT =====
  // Sub-pixel edge snap: refine user-dragged head/heel to nearest strong horizontal edge
  const refineEdgeY = (ctx, y, x0 = null, x1 = null) => {
    const h = ctx.canvas.height;
    const w = ctx.canvas.width;
    const Y = Math.round(y);
    const xL = Math.max(0, Math.floor(x0 ?? 0));
    const xR = Math.min(w - 2, Math.ceil(x1 ?? w - 1));
    
    let best = { g: 0, y: Y };
    
    // 7px vertical window
    for (let dy = -3; dy <= 3; dy++) {
      const y1 = Math.min(h - 2, Math.max(1, Y + dy));
      let gsum = 0;
      
      for (let x = xL; x < xR; x++) {
        // Get vertical gradient (difference between row above and below)
        const imgData = ctx.getImageData(x, y1 - 1, 1, 3);
        if (imgData.data.length >= 12) {
          // Use luminance for gradient
          const lumUp = (imgData.data[0] + imgData.data[1] + imgData.data[2]) / 3;
          const lumDn = (imgData.data[8] + imgData.data[9] + imgData.data[10]) / 3;
          const gy = Math.abs(lumDn - lumUp);
          gsum += gy;
        }
      }
      
      if (gsum > best.g) {
        best = { g: gsum, y: y1 };
      }
    }
    
    return best.y; // refined Y
  };
  
  // Frame burst median: capture multiple frames and use median for stability
  const captureBurstMedian = async (count = 3) => {
    const frames = [];
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms between frames
      const canvas = capturePhoto();
      if (canvas) frames.push(canvas);
    }
    if (frames.length === 0) return null;
    
    // For now, return the middle frame (can implement true median later)
    return frames[Math.floor(frames.length / 2)];
  };
  
  // ===== CIRCUMFERENCE MODELS =====
  // Ramanujan ellipse perimeter (stable version)
  const ramanujanEllipsePerimeter = (widthMm, depthMm) => {
    const a = widthMm / 2;
    const b = depthMm / 2;
    const sum = a + b;
    const diff = Math.abs(a - b);
    
    if (sum < 1e-6) return 0;
    
    const h = Math.pow(diff / sum, 2);
    return Math.PI * sum * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  };
  
  // Superellipse (Lamé) perimeter
  const superellipsePerimeter = (aMm, bMm, n = 3.2) => {
    const steps = 256;
    const dt = 2 * Math.PI / steps;
    let s = 0;
    
    for (let i = 0; i <= steps; i++) {
      const t = i * dt;
      const c = Math.cos(t);
      const s1 = Math.sin(t);
      
      const ac = aMm * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      const bs = bMm * Math.sign(s1) * Math.pow(Math.abs(s1), 2 / n);
      
      const dac = aMm * (2 / n) * Math.pow(Math.abs(c), 2 / n - 1) * (-Math.sin(t));
      const dbs = bMm * (2 / n) * Math.pow(Math.abs(s1), 2 / n - 1) * Math.cos(t);
      
      const speed = Math.hypot(dac, dbs);
      s += (i === 0 || i === steps) ? speed : (i % 2 ? 4 * speed : 2 * speed);
    }
    
    return (dt / 3) * s;
  };
  
  // Rounded-rectangle perimeter
  const roundedRectPerimeter = (widthMm, depthMm, rMm = null) => {
    const w = widthMm;
    const d = depthMm;
    const r = rMm ?? Math.min(0.12 * Math.min(w, d), w / 2, d / 2);
    
    return 2 * ((w - 2 * r) + (d - 2 * r)) + 2 * Math.PI * r;
  };
  
  // Auto-chooser for circumference model
  const circumferenceMm = (widthMm, depthMm, curvatureHint = 0.5) => {
    if (!widthMm || !depthMm) return 0;
    
    const aspectRatio = Math.max(widthMm, depthMm) / Math.min(widthMm, depthMm);
    
    // Boxy silhouette -> rounded rectangle
    if (curvatureHint > 0.6) {
      const r = 0.12 * Math.min(widthMm, depthMm);
      return roundedRectPerimeter(widthMm, depthMm, r);
    }
    
    // Near-circle -> Ramanujan
    if (aspectRatio < 1.15) {
      return ramanujanEllipsePerimeter(widthMm, depthMm);
    }
    
    // General case -> superellipse
    const n = aspectRatio > 1.3 ? 4.0 : 3.2;
    return superellipsePerimeter(widthMm / 2, depthMm / 2, n);
  };
  
  // ===== CO-REGISTRATION HELPERS =====
  // Get Y position at same physical height ratio from head
  const rowAtRatio = (headY, heelY, r) => {
    return headY + r * (heelY - headY); // r = 0..1 from head
  };

  // Helper: Format measurement display based on unit preference
  const formatMeasurement = (cmValue, unit = "length") => {
    if (!cmValue && cmValue !== 0) return { main: "—", sub: "" };
    
    if (useInches) {
      const inches = cmToInches(cmValue);
      if (unit === "area") {
        // Convert cm² to in² (1 cm² = 0.155 in²)
        const sqInches = Math.round((cmValue * 0.155) * 10) / 10;
        return { main: `${sqInches} in²`, sub: `${cmValue.toFixed(1)} cm²` };
      } else if (unit === "volume") {
        // Keep as cm³ for now, could convert to in³ or fl oz
        return { main: `${cmValue.toFixed(1)} cm³`, sub: "" };
      } else {
        // Length measurement
        return { main: `${inches} in`, sub: `${cmValue.toFixed(1)} cm` };
      }
    } else {
      // Use cm
      if (unit === "area") {
        return { main: `${cmValue.toFixed(1)} cm²`, sub: "" };
      } else if (unit === "volume") {
        return { main: `${cmValue.toFixed(1)} cm³`, sub: "" };
      } else {
        return { main: `${cmValue.toFixed(1)} cm`, sub: "" };
      }
    }
  };

  // Calculate manual measurements from dots
  const calculateManualMeasurements = () => {
    if (!frontScaleMmPerPx || !sideScaleMmPerPx) {
      alert("Please lock scales for both front and side photos before calculating measurements.");
      return null;
    }

    const measurements = {};

    // Helper: Calculate distance between two points
    const calculateDistance = (dot1, dot2, scale) => {
      if (!dot1 || !dot2) return null;
      const dx = dot2.x - dot1.x;
      const dy = dot2.y - dot1.y;
      const distancePx = Math.sqrt(dx * dx + dy * dy);
      const distanceMm = distancePx * scale;
      const distanceCm = distanceMm / 10;
      return {
        pixels: Math.round(distancePx),
        mm: Math.round(distanceMm),
        cm: Math.round(distanceCm * 10) / 10
      };
    };

    // Helper: Calculate 3D measurements from width and depth (IMPROVED)
    const calculate3D = (width, depth, name) => {
      if (!width || !depth) return null;
      
      // QA: Soft coupling - width should not exceed depth by too much (catches arm leaks)
      if (width.mm > depth.mm * 1.25) {
        console.warn(`${name}: Width (${width.cm}cm) > 1.25× depth (${depth.cm}cm) - possible arm contamination`);
        // Soft clamp: cap width at 1.25× depth
        width = {
          ...width,
          mm: depth.mm * 1.25,
          cm: (depth.mm * 1.25) / 10
        };
      }
      
      // Symmetry check (for front width measurements)
      // This would need left/right dots to compute, so we'll skip for now
      
      const widthMm = width.mm;
      const depthMm = depth.mm;
      
      // Calculate area (ellipse baseline)
      const semiMajorAxis = widthMm / 2;
      const semiMinorAxis = depthMm / 2;
      const crossSectionalAreaMm2 = Math.PI * semiMajorAxis * semiMinorAxis;
      const crossSectionalAreaCm2 = crossSectionalAreaMm2 / 100;
      
      // Calculate circumference using auto-chooser
      // curvatureHint: 0(round) .. 1(boxy) - estimate from aspect ratio
      const aspectRatio = Math.max(widthMm, depthMm) / Math.min(widthMm, depthMm);
      const curvatureHint = aspectRatio > 1.3 ? 0.7 : 0.4; // Higher aspect = boxier
      
      const circumferenceMmValue = circumferenceMm(widthMm, depthMm, curvatureHint);
      const circumferenceCm = circumferenceMmValue / 10;
      
      // Human plausibility check
      if (name === "chest" && (circumferenceCm < 90 || circumferenceCm > 140)) {
        console.warn(`${name}: Circumference ${circumferenceCm.toFixed(1)}cm outside typical range (90-140cm). Consider re-taking side photo or adjusting calibration lines.`);
      }
      
      return {
        name: name,
        width: width,
        depth: depth,
        circumference: {
          cm: Math.round(circumferenceCm * 10) / 10,
          mm: Math.round(circumferenceMmValue)
        },
        crossSectionalArea: {
          cm2: Math.round(crossSectionalAreaCm2 * 10) / 10,
          mm2: Math.round(crossSectionalAreaMm2)
        }
      };
    };

    // Calculate all front measurements (widths)
    const frontTypes = ['shoulders', 'chest', 'waist', 'hips'];
    frontTypes.forEach(type => {
      const leftDot = manualDots.front[type].left;
      const rightDot = manualDots.front[type].right;
      console.log(`[${type} width] Left dot:`, leftDot, "Right dot:", rightDot);
      const width = calculateDistance(leftDot, rightDot, frontScaleMmPerPx);
      if (width) {
        measurements[`${type}Width`] = width;
        console.log(`[${type} width] Calculated:`, width);
      } else {
        console.log(`[${type} width] Failed to calculate - missing dots`);
      }
    });

    // Calculate thigh and calf widths (thickness from front photo)
    const thighsLeft = manualDots.front.thighs.left;
    const thighsRight = manualDots.front.thighs.right;
    console.log(`[thighs width] Left dot:`, thighsLeft, "Right dot:", thighsRight);
    const thighsWidth = calculateDistance(thighsLeft, thighsRight, frontScaleMmPerPx);
    if (thighsWidth) {
      measurements.thighsWidth = thighsWidth;
      console.log(`[thighs width] Calculated:`, thighsWidth);
    } else {
      console.log(`[thighs width] Failed to calculate - missing dots`);
    }

    const calvesLeft = manualDots.front.calves.left;
    const calvesRight = manualDots.front.calves.right;
    console.log(`[calves width] Left dot:`, calvesLeft, "Right dot:", calvesRight);
    const calvesWidth = calculateDistance(calvesLeft, calvesRight, frontScaleMmPerPx);
    if (calvesWidth) {
      measurements.calvesWidth = calvesWidth;
      console.log(`[calves width] Calculated:`, calvesWidth);
    } else {
      console.log(`[calves width] Failed to calculate - missing dots`);
    }

    // Calculate all side measurements (depths)
    const sideTypes = ['chest', 'waist', 'hips', 'thighs', 'calves'];
    sideTypes.forEach(type => {
      const frontDot = manualDots.side[type].front;
      const backDot = manualDots.side[type].back;
      console.log(`[${type} depth] Front dot:`, frontDot, "Back dot:", backDot);
      const depth = calculateDistance(frontDot, backDot, sideScaleMmPerPx);
      if (depth) {
        measurements[`${type}Depth`] = depth;
        console.log(`[${type} depth] Calculated:`, depth);
      } else {
        console.log(`[${type} depth] Failed to calculate - missing dots`);
      }
    });

    // Calculate 3D measurements for all available pairs
    const all3DTypes = ['chest', 'waist', 'hips', 'thighs', 'calves'];
    all3DTypes.forEach(type => {
      const width = type === 'thighs' ? measurements.thighsWidth : 
                    type === 'calves' ? measurements.calvesWidth :
                    measurements[`${type}Width`];
      const depth = measurements[`${type}Depth`];
      console.log(`[${type} 3D] Width:`, width, "Depth:", depth);
      if (width && depth) {
        const type3D = calculate3D(width, depth, type);
        if (type3D) {
          measurements[`${type}3D`] = type3D;
          console.log(`[${type} 3D] Calculated:`, type3D);
        } else {
          console.log(`[${type} 3D] Failed to calculate - calculate3D returned null`);
        }
      } else {
        console.log(`[${type} 3D] Failed to calculate - missing width or depth. Width:`, width, "Depth:", depth);
      }
    });

    // Calculate leg lengths from front photo (using knee as midpoint)
    // Upper leg length: from thigh top to knee
    if (manualDots.front.thighs.top && manualDots.front.knee.center) {
      const upperLegLengthPx = Math.sqrt(
        Math.pow(manualDots.front.knee.center.x - manualDots.front.thighs.top.x, 2) +
        Math.pow(manualDots.front.knee.center.y - manualDots.front.thighs.top.y, 2)
      );
      const upperLegLengthMm = upperLegLengthPx * frontScaleMmPerPx;
      measurements.upperLegLength = {
        pixels: Math.round(upperLegLengthPx),
        mm: Math.round(upperLegLengthMm),
        cm: Math.round((upperLegLengthMm / 10) * 10) / 10
      };
    }

    // Lower leg length: from knee to ankle (calves bottom)
    if (manualDots.front.knee.center && manualDots.front.calves.bottom) {
      const lowerLegLengthPx = Math.sqrt(
        Math.pow(manualDots.front.calves.bottom.x - manualDots.front.knee.center.x, 2) +
        Math.pow(manualDots.front.calves.bottom.y - manualDots.front.knee.center.y, 2)
      );
      const lowerLegLengthMm = lowerLegLengthPx * frontScaleMmPerPx;
      measurements.lowerLegLength = {
        pixels: Math.round(lowerLegLengthPx),
        mm: Math.round(lowerLegLengthMm),
        cm: Math.round((lowerLegLengthMm / 10) * 10) / 10
      };
    }

    // Total leg length (thigh top to ankle)
    if (manualDots.front.thighs.top && manualDots.front.calves.bottom) {
      const totalLegLengthPx = Math.sqrt(
        Math.pow(manualDots.front.calves.bottom.x - manualDots.front.thighs.top.x, 2) +
        Math.pow(manualDots.front.calves.bottom.y - manualDots.front.thighs.top.y, 2)
      );
      const totalLegLengthMm = totalLegLengthPx * frontScaleMmPerPx;
      measurements.totalLegLength = {
        pixels: Math.round(totalLegLengthPx),
        mm: Math.round(totalLegLengthMm),
        cm: Math.round((totalLegLengthMm / 10) * 10) / 10
      };
    }

    return measurements;
  };

  // Manual drawing: handle front photo capture
  const handleManualCaptureFront = () => {
    startCountdownAndCapture((canvas) => {
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setFrontImageData(dataUrl);
      // If side photo already captured, move straight to calibration, else prompt for side capture
      if (sideImageData) {
        setManualCaptureState("front-calibration");
      } else {
        setManualCaptureState("side-capture");
        setCapturedDataUrl(null);
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
            videoRef.current.play().catch(err => console.error("Video play error:", err));
          }
        }, 100);
      }
    });
  };

  // Manual drawing: handle side photo capture
  const handleManualCaptureSide = () => {
    startCountdownAndCapture((canvas) => {
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setSideImageData(dataUrl);
      if (!frontImageData) {
        // If somehow side captured first, prompt for front capture
        setManualCaptureState("front-capture");
        setCapturedDataUrl(null);
      } else {
        setManualCaptureState("front-calibration");
      }
    });
  };

  // Manual drawing: submit and calculate
  const handleManualSubmit = () => {
    const measurements = calculateManualMeasurements();
    if (measurements && Object.keys(measurements).length > 0) {
      // Store all 3D measurements
      const bodyMeasurementsObj = {};
      ['chest', 'waist', 'hips', 'thighs', 'calves'].forEach(type => {
        if (measurements[`${type}3D`]) {
          bodyMeasurementsObj[type] = measurements[`${type}3D`];
        }
      });
      
      // Store leg length measurements
      if (measurements.upperLegLength) {
        bodyMeasurementsObj.upperLegLength = measurements.upperLegLength;
      }
      if (measurements.lowerLegLength) {
        bodyMeasurementsObj.lowerLegLength = measurements.lowerLegLength;
      }
      if (measurements.totalLegLength) {
        bodyMeasurementsObj.totalLegLength = measurements.totalLegLength;
      }
      
      // Also store widths and depths
      bodyMeasurementsObj.widths = {};
      bodyMeasurementsObj.depths = {};
      ['shoulders', 'chest', 'waist', 'hips'].forEach(type => {
        if (measurements[`${type}Width`]) {
          bodyMeasurementsObj.widths[type] = measurements[`${type}Width`];
        }
      });
      if (measurements.thighsWidth) {
        bodyMeasurementsObj.widths.thighs = measurements.thighsWidth;
      }
      if (measurements.calvesWidth) {
        bodyMeasurementsObj.widths.calves = measurements.calvesWidth;
      }
      
      ['chest', 'waist', 'hips', 'thighs', 'calves'].forEach(type => {
        if (measurements[`${type}Depth`]) {
          bodyMeasurementsObj.depths[type] = measurements[`${type}Depth`];
        }
      });
      
      setBodyMeasurements(bodyMeasurementsObj);
      console.log("Manual measurements calculated:", measurements);
      console.log("Body measurements stored:", bodyMeasurementsObj);
      
      // Debug: Log all calculated measurements
      console.log("=== Measurement Debug ===");
      console.log("Widths:", measurements);
      console.log("Chest 3D:", measurements.chest3D);
      console.log("Waist 3D:", measurements.waist3D);
      console.log("Hips 3D:", measurements.hips3D);
      console.log("Thighs 3D:", measurements.thighs3D);
      console.log("Calves 3D:", measurements.calves3D);
      console.log("Thighs Width:", measurements.thighsWidth);
      console.log("Thighs Depth:", measurements.thighsDepth);
      console.log("Calves Width:", measurements.calvesWidth);
      console.log("Calves Depth:", measurements.calvesDepth);
      console.log("========================");
    } else {
      alert("Please place all dots before submitting.");
    }
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

  // Start page component
  if (mode === "select") {
    return (
      <div style={{background:"#0b1220", color:"#e5e7eb", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center"}}>
        <div style={{maxWidth:600, margin:"0 auto", padding:32, textAlign:"center"}}>
          <h1 style={{fontSize:36, marginBottom:16}}>Body Measurement Tool</h1>
          <p style={{fontSize:18, opacity:0.8, marginBottom:48}}>Choose your measurement method</p>
          
          <div style={{display:"flex", gap:24, justifyContent:"center", flexWrap:"wrap"}}>
            <button
              onClick={() => setMode("pose")}
              style={{
                padding: "24px 48px",
                fontSize: 20,
                background: "#10b981",
                color: "white",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: "bold",
                minWidth: 240,
                boxShadow: "0 4px 6px rgba(0,0,0,0.3)"
              }}
            >
              🤖 Pose Estimation
              <div style={{fontSize:14, marginTop:8, opacity:0.9}}>Automatic AI detection</div>
            </button>
            
            <button
              onClick={() => setMode("manual")}
              style={{
                padding: "24px 48px",
                fontSize: 20,
                background: "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: "bold",
                minWidth: 240,
                boxShadow: "0 4px 6px rgba(0,0,0,0.3)"
              }}
            >
              ✏️ Manual Drawing
              <div style={{fontSize:14, marginTop:8, opacity:0.9}}>Place dots manually</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{background:"#0b1220", color:"#e5e7eb", minHeight:"100vh"}}>
      <div style={{maxWidth:960, margin:"0 auto", padding:16}}>
        {/* Back button */}
        <button
          onClick={() => {
            setMode("select");
            // Reset states
            setCaptureState(null);
            setManualCaptureState("front-capture");
            setBodyMeasurements(null);
            setManualDots({
              front: {
                shoulders: { left: null, right: null },
                chest: { left: null, right: null },
                waist: { left: null, right: null },
                hips: { left: null, right: null },
                thighs: { left: null, right: null, top: null },
                knee: { center: null },
                calves: { left: null, right: null, bottom: null }
              },
              side: {
                chest: { front: null, back: null },
                waist: { front: null, back: null },
                hips: { front: null, back: null },
                thighs: { front: null, back: null },
                calves: { front: null, back: null }
              }
            });
            setDraggingDot(null);
            setFrontHeadY(200);
            setFrontHeelY(700);
            setFrontScaleMmPerPx(null);
            setSideHeadY(200);
            setSideHeelY(700);
            setSideScaleMmPerPx(null);
            setCapturedDataUrl(null);
            setFrontImageData(null);
            setSideImageData(null);
            capturedCanvasRef.current = null;
          }}
          style={{
            marginBottom: 16,
            padding: "8px 16px",
            background: "#374151",
            color: "#e5e7eb",
            border: "1px solid #4B5563",
            borderRadius: 6,
            cursor: "pointer"
          }}
        >
          ← Back to Menu
        </button>

        <h1>Calibration</h1>
        {mode === "manual" ? (
          <p>Enter height, capture <b>front and side photos back-to-back</b>, then sit down to drag the lines, lock scale, and place dots.</p>
        ) : (
        <p>Enter height → drag <b>Head</b>/<b>Heel</b> lines → Lock scale.</p>
        )}

        <div style={{display:"flex", gap:12, alignItems:"center", margin:"12px 0"}}>
          <input type="number" value={heightCm} onChange={e=>setHeightCm(+e.target.value)} style={{width:90}}/> cm
          {mode === "manual" ? (
            <>
              {(manualCaptureState === "front-calibration" || manualCaptureState === "side-calibration") && (
                <>
                  <button 
                    onClick={lockScale} 
                    disabled={manualCaptureState === "front-calibration" ? !frontImageData : !sideImageData}
                  >
                    {manualCaptureState === "front-calibration" ? "Lock Front Scale" : "Lock Side Scale"}
                  </button>
                  {manualCaptureState === "front-calibration" && frontScaleMmPerPx && (
                    <span>Front Scale: {frontScaleMmPerPx.toFixed(3)} mm/px</span>
                  )}
                  {manualCaptureState === "side-calibration" && sideScaleMmPerPx && (
                    <span>Side Scale: {sideScaleMmPerPx.toFixed(3)} mm/px</span>
                  )}
                </>
              )}
            </>
          ) : (
            <>
          <button onClick={lockScale}>Lock scale</button>
          {scaleMmPerPx && <span>Scale: {scaleMmPerPx.toFixed(3)} mm/px</span>}
            </>
          )}
        </div>

        {/* Pose Estimation Mode */}
        {mode === "pose" && (
          <>
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
          </>
        )}

        {/* Manual Drawing Mode */}
        {mode === "manual" && (
          <>
        <div style={{display:"flex", gap:12, margin:"12px 0", flexWrap:"wrap", alignItems:"center"}}>
          {manualCaptureState === "front-capture" && (
            <>
              <button 
                onClick={handleManualCaptureFront} 
                disabled={typeof countdown === "number"}
              >
                {typeof countdown === "number" ? `Capturing in ${countdown}...` : "Capture FRONT"}
              </button>
              <label style={{
                padding: "8px 16px",
                background: "#374151",
                border: "1px solid #4B5563",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                display: "inline-block"
              }}>
                📁 Upload Front Photo
                <input
                  type="file"
                  accept="image/*"
                  style={{display: "none"}}
                  onChange={(e) => handleManualFileUpload(e, "front")}
                />
              </label>
            </>
          )}
          {manualCaptureState === "front-calibration" && (
            <>
              <button onClick={() => {
                setManualCaptureState("front-capture");
                setCapturedDataUrl(null);
                setFrontImageData(null);
                setFrontScaleMmPerPx(null);
                setTimeout(() => {
                  if (videoRef.current && streamRef.current) {
                    videoRef.current.srcObject = streamRef.current;
                    videoRef.current.play().catch(err => console.error("Video play error:", err));
                  }
                }, 100);
              }}>
                Retake Front
              </button>
              {frontScaleMmPerPx && (
                <button 
                  onClick={() => setManualCaptureState("front-dots")}
                  style={{background:"#10b981", color:"white", fontWeight:"bold"}}
                >
                  Place Front Dots
                </button>
              )}
            </>
          )}
          {manualCaptureState === "front-dots" && (
            <>
              <button onClick={() => {
                setManualCaptureState("front-calibration");
                setManualDots(prev => ({
                  ...prev,
                  front: {
                    shoulders: { left: null, right: null },
                    chest: { left: null, right: null },
                    waist: { left: null, right: null },
                    hips: { left: null, right: null },
                    thighs: { left: null, right: null, top: null },
                    knee: { center: null },
                    calves: { left: null, right: null, bottom: null }
                  }
                }));
              }}>
                Back to Calibration
              </button>
              {(() => {
                let placedCount = 0;
                // Standard width measurements (2 dots each)
                ['shoulders', 'chest', 'waist', 'hips'].forEach(type => {
                  if (manualDots.front[type].left) placedCount++;
                  if (manualDots.front[type].right) placedCount++;
                });
                // Thighs: 3 dots (left, right, top)
                if (manualDots.front.thighs.left) placedCount++;
                if (manualDots.front.thighs.right) placedCount++;
                if (manualDots.front.thighs.top) placedCount++;
                // Knee: 1 dot (center)
                if (manualDots.front.knee.center) placedCount++;
                // Calves: 3 dots (left, right, bottom)
                if (manualDots.front.calves.left) placedCount++;
                if (manualDots.front.calves.right) placedCount++;
                if (manualDots.front.calves.bottom) placedCount++;
                
                const totalCount = 15; // 4*2 + 3 + 1 + 3 = 15 dots
                
                if (placedCount > 0) {
                  return (
                    <span style={{opacity: 0.7, fontSize: 12}}>
                      {placedCount}/{totalCount} dots placed. {areAllFrontDotsPlaced() ? "✅ All placed! Drag to adjust or continue." : "Continue placing dots..."}
                    </span>
                  );
                }
                return null;
              })()}
              {areAllFrontDotsPlaced() && (
                <button 
                  onClick={() => {
                    if (!sideImageData) {
                      alert("Please capture your side photo first.");
                      return;
                    }
                    setManualCaptureState("side-calibration");
                  }}
                  style={{background:"#10b981", color:"white", fontWeight:"bold"}}
                >
                  Start Side Calibration
                </button>
              )}
            </>
          )}
          {manualCaptureState === "side-capture" && (
            <>
              <button 
                onClick={handleManualCaptureSide} 
                disabled={typeof countdown === "number"}
              >
                {typeof countdown === "number" ? `Capturing in ${countdown}...` : "Capture SIDE"}
              </button>
              <label style={{
                padding: "8px 16px",
                background: "#374151",
                border: "1px solid #4B5563",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                display: "inline-block"
              }}>
                📁 Upload Side Photo
                <input
                  type="file"
                  accept="image/*"
                  style={{display: "none"}}
                  onChange={(e) => handleManualFileUpload(e, "side")}
                />
              </label>
              {frontImageData && (
                <button
                  onClick={() => {
                    setManualCaptureState("front-capture");
                    setCapturedDataUrl(null);
                    setFrontImageData(null);
                    setFrontScaleMmPerPx(null);
                    setManualDots(prev => ({
                      ...prev,
                      front: {
                        shoulders: { left: null, right: null },
                        chest: { left: null, right: null },
                        waist: { left: null, right: null },
                        hips: { left: null, right: null },
                        thighs: { left: null, right: null, top: null },
                        knee: { center: null },
                        calves: { left: null, right: null, bottom: null }
                      }
                    }));
                  }}
                >
                  Retake Front Photo
                </button>
              )}
            </>
          )}
          {manualCaptureState === "side-calibration" && (
            <>
              <button onClick={() => {
                setManualCaptureState("side-capture");
                setCapturedDataUrl(null);
                setSideImageData(null);
                setSideScaleMmPerPx(null);
                setTimeout(() => {
                  if (videoRef.current && streamRef.current) {
                    videoRef.current.srcObject = streamRef.current;
                    videoRef.current.play().catch(err => console.error("Video play error:", err));
                  }
                }, 100);
              }}>
                Retake Side
              </button>
              {sideScaleMmPerPx && (
                <button 
                  onClick={() => setManualCaptureState("side-dots")}
                  style={{background:"#10b981", color:"white", fontWeight:"bold"}}
                >
                  Place Side Dots
                </button>
              )}
            </>
          )}
          {manualCaptureState === "side-dots" && (
            <>
              <button onClick={() => {
                setManualCaptureState("side-calibration");
                setManualDots(prev => ({
                  ...prev,
                  side: {
                    chest: { front: null, back: null },
                    waist: { front: null, back: null },
                    hips: { front: null, back: null },
                    thighs: { front: null, back: null },
                    calves: { front: null, back: null }
                  }
                }));
              }}>
                Back to Calibration
              </button>
              {(() => {
                const placedCount = ['chest', 'waist', 'hips', 'thighs', 'calves'].reduce((count, type) => {
                  if (manualDots.side[type].front) count++;
                  if (manualDots.side[type].back) count++;
                  return count;
                }, 0);
                const totalCount = 10; // 5 types * 2 dots each
                
                if (placedCount > 0) {
                  return (
                    <span style={{opacity: 0.7, fontSize: 12}}>
                      {placedCount}/{totalCount} dots placed. {areAllSideDotsPlaced() ? "✅ All placed! Drag to adjust or calculate." : "Continue placing dots..."}
                    </span>
                  );
                }
                return null;
              })()}
              <button 
                onClick={handleManualSubmit}
                disabled={!areAllFrontDotsPlaced() || !areAllSideDotsPlaced()}
                style={{background:"#10b981", color:"white", fontWeight:"bold"}}
              >
                Calculate Measurements
              </button>
            </>
          )}
      </div>

        <div style={{display:"flex", gap:16, alignItems:"center", fontSize:12, opacity:0.85}}>
          <span>Front Photo: {frontImageData ? "✅ ready" : "⏳ pending"}</span>
          <span>Side Photo: {sideImageData ? "✅ ready" : "⏳ pending"}</span>
    </div>

        {manualCaptureState !== "side-capture" && (
        <div style={{position:"relative", width:"100%", aspectRatio:"16/9", background:"black", borderRadius:12, overflow:"hidden"}}>
          {manualCaptureState === "front-capture" ? (
            <video 
              key="camera-video-front"
              ref={(el)=>{
                if (el) {
                  videoRef.current = el;
                  displayRef.current = el;
                  if (streamRef.current && el.srcObject !== streamRef.current) {
                    el.srcObject = streamRef.current;
                    el.onloadeddata = () => {
                      el.play().catch(err => console.error("Video play error:", err));
                    };
                  } else if (streamRef.current) {
                    // Stream already attached, just play
                    el.play().catch(err => console.error("Video play error:", err));
                  }
                }
              }} 
              className="video" 
              style={{width:"100%", height:"100%", objectFit:"contain"}} 
              playsInline 
              muted 
              autoPlay
            />
          ) : manualCaptureState === "front-calibration" || manualCaptureState === "front-dots" ? (
            <img 
              ref={displayRef} 
              src={frontImageData || capturedDataUrl} 
              alt="Front Photo" 
              style={{width:"100%", height:"100%", objectFit:"contain", cursor: manualCaptureState === "front-dots" ? (draggingDot ? "grabbing" : "crosshair") : "default"}}
              onClick={(e) => manualCaptureState === "front-dots" && !draggingDot && handleManualImageClick(e, "front")}
            />
          ) : manualCaptureState === "side-calibration" || manualCaptureState === "side-dots" ? (
            <img 
              ref={displayRef} 
              src={sideImageData || capturedDataUrl} 
              alt="Side Photo" 
              style={{width:"100%", height:"100%", objectFit:"contain", cursor: manualCaptureState === "side-dots" ? (draggingDot ? "grabbing" : "crosshair") : "default"}}
              onClick={(e) => manualCaptureState === "side-dots" && !draggingDot && handleManualImageClick(e, "side")}
            />
          ) : null}
          <canvas
            ref={overlayRef}
            style={{
              position:"absolute", 
              inset:0, 
              zIndex:1,
              pointerEvents: (mode === "manual" && (manualCaptureState === "front-dots" || manualCaptureState === "side-dots")) ? "none" : "auto"
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {/* Draw dots on front photo */}
          {manualCaptureState === "front-dots" && frontImageData && (() => {
            const img = displayRef.current;
            if (!img || !img.complete) return null;
            const imgRect = img.getBoundingClientRect();
            const containerRect = img.parentElement?.getBoundingClientRect();
            if (!containerRect) return null;
            
            const imageWidth = capturedCanvasRef.current?.width || img.naturalWidth || img.width;
            const imageHeight = capturedCanvasRef.current?.height || img.naturalHeight || img.height;
            const scaleX = imgRect.width / imageWidth;
            const scaleY = imgRect.height / imageHeight;
            const offsetX = (containerRect.width - imgRect.width) / 2;
            const offsetY = (containerRect.height - imgRect.height) / 2;
            
            // Check if any dots are placed
            const hasAnyDots = 
              ['shoulders', 'chest', 'waist', 'hips'].some(type => 
                manualDots.front[type].left || manualDots.front[type].right
              ) ||
              manualDots.front.thighs.left || manualDots.front.thighs.right || manualDots.front.thighs.top ||
              manualDots.front.knee.center ||
              manualDots.front.calves.left || manualDots.front.calves.right || manualDots.front.calves.bottom;
            
            if (!hasAnyDots) return null;
            
            return (
              <svg style={{position:"absolute", inset:0, pointerEvents:"none", zIndex:2, width:"100%", height:"100%"}}>
                {/* Standard width measurements (shoulders, chest, waist, hips) */}
                {['shoulders', 'chest', 'waist', 'hips'].map(type => {
                  const leftDot = manualDots.front[type].left;
                  const rightDot = manualDots.front[type].right;
                  
                  return (
                    <g key={type}>
                      {leftDot && (() => {
                        const cx = offsetX + (leftDot.x * scaleX);
                        const cy = offsetY + (leftDot.y * scaleY);
                        const isDragging = draggingDot === `${type}-left`;
                        
                        return (
                          <circle 
                            cx={cx} 
                            cy={cy} 
                            r={isDragging ? "5" : "4"} 
                            fill={getDotColor("front", type, "left")} 
                            stroke="white" 
                            strokeWidth={isDragging ? "2" : "1.5"} 
                            opacity={isDragging ? 0.9 : 1}
                            style={{cursor: "grab", pointerEvents: "auto"}}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setDraggingDot(`${type}-left`);
                            }}
                          />
                        );
                      })()}
                      {rightDot && (() => {
                        const cx = offsetX + (rightDot.x * scaleX);
                        const cy = offsetY + (rightDot.y * scaleY);
                        const isDragging = draggingDot === `${type}-right`;
                        
                        return (
                          <circle 
                            cx={cx} 
                            cy={cy} 
                            r={isDragging ? "5" : "4"} 
                            fill={getDotColor("front", type, "right")} 
                            stroke="white" 
                            strokeWidth={isDragging ? "2" : "1.5"} 
                            opacity={isDragging ? 0.9 : 1}
                            style={{cursor: "grab", pointerEvents: "auto"}}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setDraggingDot(`${type}-right`);
                            }}
                          />
                        );
                      })()}
                      {leftDot && rightDot && (
                        <line 
                          x1={offsetX + (leftDot.x * scaleX)} 
                          y1={offsetY + (leftDot.y * scaleY)} 
                          x2={offsetX + (rightDot.x * scaleX)} 
                          y2={offsetY + (rightDot.y * scaleY)} 
                          stroke={getDotColor("front", type, "left")} 
                          strokeWidth="1.5" 
                          strokeDasharray="3,3" 
                          opacity="0.6"
                        />
                      )}
                    </g>
                  );
                })}
                
                {/* Thigh measurements: thickness (left/right) and length (top to knee) */}
                <g key="thighs">
                  {manualDots.front.thighs.left && (() => {
                    const dot = manualDots.front.thighs.left;
                    const cx = offsetX + (dot.x * scaleX);
                    const cy = offsetY + (dot.y * scaleY);
                    const isDragging = draggingDot === 'thighs-left';
                    return (
                      <circle 
                        cx={cx} cy={cy} 
                        r={isDragging ? "5" : "4"} 
                        fill={getDotColor("front", "thighs", "left")} 
                        stroke="white" 
                        strokeWidth={isDragging ? "2" : "1.5"} 
                        opacity={isDragging ? 0.9 : 1}
                        style={{cursor: "grab", pointerEvents: "auto"}}
                        onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('thighs-left'); }}
                      />
                    );
                  })()}
                  {manualDots.front.thighs.right && (() => {
                    const dot = manualDots.front.thighs.right;
                    const cx = offsetX + (dot.x * scaleX);
                    const cy = offsetY + (dot.y * scaleY);
                    const isDragging = draggingDot === 'thighs-right';
                    return (
                      <circle 
                        cx={cx} cy={cy} 
                        r={isDragging ? "5" : "4"} 
                        fill={getDotColor("front", "thighs", "right")} 
                        stroke="white" 
                        strokeWidth={isDragging ? "2" : "1.5"} 
                        opacity={isDragging ? 0.9 : 1}
                        style={{cursor: "grab", pointerEvents: "auto"}}
                        onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('thighs-right'); }}
                      />
                    );
                  })()}
                  {manualDots.front.thighs.left && manualDots.front.thighs.right && (
                    <line 
                      x1={offsetX + (manualDots.front.thighs.left.x * scaleX)} 
                      y1={offsetY + (manualDots.front.thighs.left.y * scaleY)} 
                      x2={offsetX + (manualDots.front.thighs.right.x * scaleX)} 
                      y2={offsetY + (manualDots.front.thighs.right.y * scaleY)} 
                      stroke={getDotColor("front", "thighs", "left")} 
                      strokeWidth="1.5" 
                      strokeDasharray="3,3" 
                      opacity="0.6"
                    />
                  )}
                  {manualDots.front.thighs.top && (() => {
                    const dot = manualDots.front.thighs.top;
                    const cx = offsetX + (dot.x * scaleX);
                    const cy = offsetY + (dot.y * scaleY);
                    const isDragging = draggingDot === 'thighs-top';
                    return (
                      <circle 
                        cx={cx} cy={cy} 
                        r={isDragging ? "5" : "4"} 
                        fill={getDotColor("front", "thighs", "top")} 
                        stroke="white" 
                        strokeWidth={isDragging ? "2" : "1.5"} 
                        opacity={isDragging ? 0.9 : 1}
                        style={{cursor: "grab", pointerEvents: "auto"}}
                        onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('thighs-top'); }}
                      />
                    );
                  })()}
                  {/* Line from thigh top to knee for upper leg length */}
                  {manualDots.front.thighs.top && manualDots.front.knee.center && (
                    <line 
                      x1={offsetX + (manualDots.front.thighs.top.x * scaleX)} 
                      y1={offsetY + (manualDots.front.thighs.top.y * scaleY)} 
                      x2={offsetX + (manualDots.front.knee.center.x * scaleX)} 
                      y2={offsetY + (manualDots.front.knee.center.y * scaleY)} 
                      stroke={getDotColor("front", "thighs", "top")} 
                      strokeWidth="1.5" 
                      strokeDasharray="3,3" 
                      opacity="0.6"
                    />
                  )}
                </g>
                
                {/* Knee center point */}
                {manualDots.front.knee.center && (() => {
                  const dot = manualDots.front.knee.center;
                  const cx = offsetX + (dot.x * scaleX);
                  const cy = offsetY + (dot.y * scaleY);
                  const isDragging = draggingDot === 'knee-center';
                  return (
                    <circle 
                      cx={cx} cy={cy} 
                      r={isDragging ? "5" : "4"} 
                      fill={getDotColor("front", "knee", "center")} 
                      stroke="white" 
                      strokeWidth={isDragging ? "2" : "1.5"} 
                      opacity={isDragging ? 0.9 : 1}
                      style={{cursor: "grab", pointerEvents: "auto"}}
                      onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('knee-center'); }}
                    />
                  );
                })()}
                
                {/* Calf measurements: thickness (left/right) and length (knee to ankle) */}
                <g key="calves">
                  {manualDots.front.calves.left && (() => {
                    const dot = manualDots.front.calves.left;
                    const cx = offsetX + (dot.x * scaleX);
                    const cy = offsetY + (dot.y * scaleY);
                    const isDragging = draggingDot === 'calves-left';
                    return (
                      <circle 
                        cx={cx} cy={cy} 
                        r={isDragging ? "5" : "4"} 
                        fill={getDotColor("front", "calves", "left")} 
                        stroke="white" 
                        strokeWidth={isDragging ? "2" : "1.5"} 
                        opacity={isDragging ? 0.9 : 1}
                        style={{cursor: "grab", pointerEvents: "auto"}}
                        onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('calves-left'); }}
                      />
                    );
                  })()}
                  {manualDots.front.calves.right && (() => {
                    const dot = manualDots.front.calves.right;
                    const cx = offsetX + (dot.x * scaleX);
                    const cy = offsetY + (dot.y * scaleY);
                    const isDragging = draggingDot === 'calves-right';
                    return (
                      <circle 
                        cx={cx} cy={cy} 
                        r={isDragging ? "5" : "4"} 
                        fill={getDotColor("front", "calves", "right")} 
                        stroke="white" 
                        strokeWidth={isDragging ? "2" : "1.5"} 
                        opacity={isDragging ? 0.9 : 1}
                        style={{cursor: "grab", pointerEvents: "auto"}}
                        onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('calves-right'); }}
                      />
                    );
                  })()}
                  {manualDots.front.calves.left && manualDots.front.calves.right && (
                    <line 
                      x1={offsetX + (manualDots.front.calves.left.x * scaleX)} 
                      y1={offsetY + (manualDots.front.calves.left.y * scaleY)} 
                      x2={offsetX + (manualDots.front.calves.right.x * scaleX)} 
                      y2={offsetY + (manualDots.front.calves.right.y * scaleY)} 
                      stroke={getDotColor("front", "calves", "left")} 
                      strokeWidth="1.5" 
                      strokeDasharray="3,3" 
                      opacity="0.6"
                    />
                  )}
                  {manualDots.front.calves.bottom && (() => {
                    const dot = manualDots.front.calves.bottom;
                    const cx = offsetX + (dot.x * scaleX);
                    const cy = offsetY + (dot.y * scaleY);
                    const isDragging = draggingDot === 'calves-bottom';
                    return (
                      <circle 
                        cx={cx} cy={cy} 
                        r={isDragging ? "5" : "4"} 
                        fill={getDotColor("front", "calves", "bottom")} 
                        stroke="white" 
                        strokeWidth={isDragging ? "2" : "1.5"} 
                        opacity={isDragging ? 0.9 : 1}
                        style={{cursor: "grab", pointerEvents: "auto"}}
                        onPointerDown={(e) => { e.stopPropagation(); setDraggingDot('calves-bottom'); }}
                      />
                    );
                  })()}
                  {/* Line from knee to ankle for lower leg length */}
                  {manualDots.front.knee.center && manualDots.front.calves.bottom && (
                    <line 
                      x1={offsetX + (manualDots.front.knee.center.x * scaleX)} 
                      y1={offsetY + (manualDots.front.knee.center.y * scaleY)} 
                      x2={offsetX + (manualDots.front.calves.bottom.x * scaleX)} 
                      y2={offsetY + (manualDots.front.calves.bottom.y * scaleY)} 
                      stroke={getDotColor("front", "calves", "bottom")} 
                      strokeWidth="1.5" 
                      strokeDasharray="3,3" 
                      opacity="0.6"
                    />
                  )}
                </g>
              </svg>
            );
          })()}
          {/* Draw dots on side photo */}
          {manualCaptureState === "side-dots" && sideImageData && (() => {
            const img = displayRef.current;
            if (!img || !img.complete) return null;
            const imgRect = img.getBoundingClientRect();
            const containerRect = img.parentElement?.getBoundingClientRect();
            if (!containerRect) return null;
            
            const imageWidth = capturedCanvasRef.current?.width || img.naturalWidth || img.width;
            const imageHeight = capturedCanvasRef.current?.height || img.naturalHeight || img.height;
            const scaleX = imgRect.width / imageWidth;
            const scaleY = imgRect.height / imageHeight;
            const offsetX = (containerRect.width - imgRect.width) / 2;
            const offsetY = (containerRect.height - imgRect.height) / 2;
            
            const hasAnyDots = ['chest', 'waist', 'hips', 'thighs', 'calves'].some(type => 
              manualDots.side[type].front || manualDots.side[type].back
            );
            
            if (!hasAnyDots) return null;
            
            return (
              <svg style={{position:"absolute", inset:0, pointerEvents:"none", zIndex:2, width:"100%", height:"100%"}}>
                {['chest', 'waist', 'hips', 'thighs', 'calves'].map(type => {
                  const frontDot = manualDots.side[type].front;
                  const backDot = manualDots.side[type].back;
                  
                  return (
                    <g key={type}>
                      {frontDot && (() => {
                        const cx = offsetX + (frontDot.x * scaleX);
                        const cy = offsetY + (frontDot.y * scaleY);
                        const isDragging = draggingDot === `${type}-front`;
                        
                        return (
                          <circle 
                            cx={cx} 
                            cy={cy} 
                            r={isDragging ? "5" : "4"} 
                            fill={getDotColor("side", type, "front")} 
                            stroke="white" 
                            strokeWidth={isDragging ? "2" : "1.5"} 
                            opacity={isDragging ? 0.9 : 1}
                            style={{cursor: "grab", pointerEvents: "auto"}}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setDraggingDot(`${type}-front`);
                            }}
                          />
                        );
                      })()}
                      {backDot && (() => {
                        const cx = offsetX + (backDot.x * scaleX);
                        const cy = offsetY + (backDot.y * scaleY);
                        const isDragging = draggingDot === `${type}-back`;
                        
                        return (
                          <circle 
                            cx={cx} 
                            cy={cy} 
                            r={isDragging ? "5" : "4"} 
                            fill={getDotColor("side", type, "back")} 
                            stroke="white" 
                            strokeWidth={isDragging ? "2" : "1.5"} 
                            opacity={isDragging ? 0.9 : 1}
                            style={{cursor: "grab", pointerEvents: "auto"}}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setDraggingDot(`${type}-back`);
                            }}
                          />
                        );
                      })()}
                      {frontDot && backDot && (
                        <line 
                          x1={offsetX + (frontDot.x * scaleX)} 
                          y1={offsetY + (frontDot.y * scaleY)} 
                          x2={offsetX + (backDot.x * scaleX)} 
                          y2={offsetY + (backDot.y * scaleY)} 
                          stroke={getDotColor("side", type, "front")} 
                          strokeWidth="1.5" 
                          strokeDasharray="3,3" 
                          opacity="0.6"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </div>
        )}

        {manualCaptureState === "side-capture" && (
        <div style={{position:"relative", width:"100%", aspectRatio:"16/9", background:"black", borderRadius:12, overflow:"hidden"}}>
          <video 
            key="camera-video-side"
            ref={(el)=>{
              if (el) {
                videoRef.current = el;
                displayRef.current = el;
                if (streamRef.current && el.srcObject !== streamRef.current) {
                  el.srcObject = streamRef.current;
                  el.onloadeddata = () => {
                    el.play().catch(err => console.error("Video play error:", err));
                  };
                } else if (streamRef.current) {
                  // Stream already attached, just play
                  el.play().catch(err => console.error("Video play error:", err));
                }
              }
            }} 
            className="video" 
            style={{width:"100%", height:"100%", objectFit:"contain"}} 
            playsInline 
            muted 
            autoPlay
          />
          <canvas
            ref={overlayRef}
            style={{position:"absolute", inset:0}}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>
        )}

        <p style={{opacity:0.7, fontSize:12, marginTop:8}}>
          {manualCaptureState === "front-capture" && "📸 Capture or upload your front photo. Side capture happens next; calibration comes later."}
          {manualCaptureState === "front-calibration" && "↕️ Drag the blue lines to mark head and heel positions, then lock scale."}
          {manualCaptureState === "front-dots" && (() => {
            const nextDot = getNextFrontDot();
            const typeNames = {
              shoulders: "Shoulders",
              chest: "Chest",
              waist: "Waist",
              hips: "Hips",
              thighs: "Thighs",
              knee: "Knee",
              calves: "Calves"
            };
            
            if (!nextDot) {
              return (
                <>
                  <strong style={{color: "#10b981", fontSize: 14}}>✅ All front dots placed!</strong>
                  <br />
                  Drag any dot to adjust, or continue to side calibration.
                </>
              );
            }
            
            const color = getDotColor("front", nextDot.type, nextDot.side);
            
            if (nextDot.type === "thighs") {
              if (nextDot.side === "left" || nextDot.side === "right") {
                return (
                  <>
                    <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place Thighs dots (thickness)</strong>
                    <br />
                    Click on the <strong style={{color}}>{nextDot.side.toUpperCase()}</strong> side of the thigh ({nextDot.side === "left" ? "first" : "second"} dot)
                  </>
                );
              } else if (nextDot.side === "top") {
                return (
                  <>
                    <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place Thigh top dot (for length)</strong>
                    <br />
                    Click at the <strong style={{color}}>TOP</strong> of the thigh (where leg starts, for upper leg length)
                  </>
                );
              }
            } else if (nextDot.type === "knee") {
              return (
                <>
                  <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place Knee center dot</strong>
                  <br />
                  Click at the <strong style={{color}}>CENTER</strong> of the knee (midpoint for leg length)
                </>
              );
            } else if (nextDot.type === "calves") {
              if (nextDot.side === "left" || nextDot.side === "right") {
                return (
                  <>
                    <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place Calves dots (thickness)</strong>
                    <br />
                    Click on the <strong style={{color}}>{nextDot.side.toUpperCase()}</strong> side of the calf ({nextDot.side === "left" ? "first" : "second"} dot)
                  </>
                );
              } else if (nextDot.side === "bottom") {
                return (
                  <>
                    <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place Ankle dot (for length)</strong>
                    <br />
                    Click at the <strong style={{color}}>ANKLE</strong> (bottom of calf, for lower leg length)
                  </>
                );
              }
            } else {
              // Standard width measurements
              const sideText = nextDot.side === "left" ? "LEFT" : "RIGHT";
              return (
                <>
                  <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place {typeNames[nextDot.type]} dots</strong>
                  <br />
                  Click on the <strong style={{color}}>{sideText}</strong> side of the {typeNames[nextDot.type].toLowerCase()} ({nextDot.side === "left" ? "first" : "second"} dot)
                </>
              );
            }
          })()}
          {manualCaptureState === "side-capture" && "📸 Capture or upload your side photo. Calibration starts once both photos are ready."}
          {manualCaptureState === "side-calibration" && "↕️ Drag the blue lines to mark head and heel positions, then lock scale."}
          {manualCaptureState === "side-dots" && (() => {
            const nextDot = getNextSideDot();
            const typeNames = {
              chest: "Chest",
              waist: "Waist",
              hips: "Hips",
              thighs: "Thighs",
              calves: "Calves"
            };
            
            if (!nextDot) {
              return (
                <>
                  <strong style={{color: "#10b981", fontSize: 14}}>✅ All side dots placed!</strong>
                  <br />
                  Drag any dot to adjust, or calculate measurements.
                </>
              );
            }
            
            const sideText = nextDot.side === "front" ? "FRONT" : "BACK";
            const color = getDotColor("side", nextDot.type, nextDot.side);
            
            return (
              <>
                <strong style={{color: "#60a5fa", fontSize: 14}}>📍 Place {typeNames[nextDot.type]} dots</strong>
                <br />
                Click on the <strong style={{color}}>{sideText}</strong> of the {typeNames[nextDot.type].toLowerCase()} ({nextDot.side === "front" ? "first" : "second"} dot)
              </>
            );
          })()}
        </p>
          </>
        )}

        {/* Display segmentation composites (front and side) - Pose Estimation Only */}
        {mode === "pose" && (frontComposite || sideComposite) && (
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
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16}}>
              <h2 style={{margin: 0, fontSize: 20}}>Detected Body Measurements</h2>
              <button
                onClick={() => setUseInches(!useInches)}
                style={{
                  padding: "8px 16px",
                  background: useInches ? "#3b82f6" : "#374151",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: "bold"
                }}
              >
                {useInches ? "Show CM" : "Show Inches"}
              </button>
            </div>
            
            {bodyMeasurements.height && (
              <div style={{marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #374151"}}>
                <strong>Height:</strong> {formatMeasurement(bodyMeasurements.height.cm).main}
                {formatMeasurement(bodyMeasurements.height.cm).sub && (
                  <span style={{opacity: 0.7, fontSize: 12, marginLeft: 8}}>
                    ({formatMeasurement(bodyMeasurements.height.cm).sub})
                  </span>
                )}
              </div>
            )}

            {/* Manual Drawing Mode: Display all measurements */}
            {mode === "manual" && (
              <>
                {/* Display shoulders width (only width, no depth) */}
                {bodyMeasurements.widths?.shoulders && (
                  <div style={{
                    marginBottom: 20,
                    padding: 16,
                    background: "#111827",
                    borderRadius: 8,
                    border: "1px solid #374151"
                  }}>
                    <h3 style={{margin: "0 0 12px 0", fontSize: 16, textTransform: "capitalize"}}>Shoulders</h3>
                    <div>
                      <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Width (Front)</div>
                      <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.widths.shoulders.cm).main}</div>
                      {formatMeasurement(bodyMeasurements.widths.shoulders.cm).sub && (
                        <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.widths.shoulders.cm).sub}</div>
                      )}
                    </div>
                  </div>
                )}

                {["chest", "waist", "hips", "thighs", "calves"].map(landmark => {
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
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.width.cm).main}</div>
                          {formatMeasurement(measurement.width.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.width.cm).sub}</div>
                          )}
                        </div>
                        <div>
                          <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Depth (Side)</div>
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.depth.cm).main}</div>
                          {formatMeasurement(measurement.depth.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.depth.cm).sub}</div>
                          )}
                        </div>
                      </div>
                      
                      {/* 3D Calculations */}
                      <div style={{marginTop: 12, paddingTop: 12, borderTop: "1px solid #374151"}}>
                        <div style={{fontSize: 12, opacity: 0.7, marginBottom: 8}}>3D Measurements</div>
                        <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8}}>
                          <div>
                            <div style={{fontSize: 10, opacity: 0.6}}>Circumference</div>
                            <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.circumference.cm).main}</div>
                            {formatMeasurement(measurement.circumference.cm).sub && (
                              <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.circumference.cm).sub}</div>
                            )}
                          </div>
                          <div>
                            <div style={{fontSize: 10, opacity: 0.6}}>Cross-Section</div>
                            <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area").main}</div>
                            {formatMeasurement(measurement.crossSectionalArea.cm2, "area").sub && (
                              <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area").sub}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Display leg length measurements */}
                {(bodyMeasurements.upperLegLength || bodyMeasurements.lowerLegLength || bodyMeasurements.totalLegLength) && (
                  <div style={{
                    marginBottom: 20,
                    padding: 16,
                    background: "#111827",
                    borderRadius: 8,
                    border: "1px solid #374151"
                  }}>
                    <h3 style={{margin: "0 0 12px 0", fontSize: 16}}>Leg Lengths</h3>
                    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12}}>
                      {bodyMeasurements.upperLegLength && (
                        <div>
                          <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Upper Leg (Thigh to Knee)</div>
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.upperLegLength.cm).main}</div>
                          {formatMeasurement(bodyMeasurements.upperLegLength.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.upperLegLength.cm).sub}</div>
                          )}
                        </div>
                      )}
                      {bodyMeasurements.lowerLegLength && (
                        <div>
                          <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Lower Leg (Knee to Ankle)</div>
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.lowerLegLength.cm).main}</div>
                          {formatMeasurement(bodyMeasurements.lowerLegLength.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.lowerLegLength.cm).sub}</div>
                          )}
                        </div>
                      )}
                      {bodyMeasurements.totalLegLength && (
                        <div>
                          <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Total Leg Length</div>
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.totalLegLength.cm).main}</div>
                          {formatMeasurement(bodyMeasurements.totalLegLength.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.totalLegLength.cm).sub}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(!bodyMeasurements.chest && !bodyMeasurements.waist && !bodyMeasurements.hips && !bodyMeasurements.thighs && !bodyMeasurements.calves) && (
                  <p style={{opacity: 0.7, fontSize: 14, marginTop: 12}}>
                    No measurements calculated. Please place all dots and calculate measurements.
                  </p>
                )}
              </>
            )}

            {/* Pose Estimation Mode: Display all landmarks */}
            {mode === "pose" && (
              <>
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
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.width.cm).main}</div>
                          {formatMeasurement(measurement.width.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.width.cm).sub}</div>
                          )}
                        </div>
                        <div>
                          <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Depth (Side)</div>
                          <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.depth.cm).main}</div>
                          {formatMeasurement(measurement.depth.cm).sub && (
                            <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.depth.cm).sub}</div>
                          )}
                        </div>
                      </div>
                      
                      {/* 3D Calculations */}
                      <div style={{marginTop: 12, paddingTop: 12, borderTop: "1px solid #374151"}}>
                        <div style={{fontSize: 12, opacity: 0.7, marginBottom: 8}}>3D Measurements</div>
                        <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8}}>
                          <div>
                            <div style={{fontSize: 10, opacity: 0.6}}>Circumference</div>
                            <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.circumference.cm).main}</div>
                            {formatMeasurement(measurement.circumference.cm).sub && (
                              <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.circumference.cm).sub}</div>
                            )}
                          </div>
                          <div>
                            <div style={{fontSize: 10, opacity: 0.6}}>Cross-Section</div>
                            <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area").main}</div>
                            {formatMeasurement(measurement.crossSectionalArea.cm2, "area").sub && (
                              <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area").sub}</div>
                            )}
                          </div>
                          <div>
                            <div style={{fontSize: 10, opacity: 0.6}}>Volume</div>
                            <div style={{fontSize: 14, fontWeight: "bold"}}>{measurement.volume.liters} L</div>
                            <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.volume.cm3, "volume").main}</div>
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
