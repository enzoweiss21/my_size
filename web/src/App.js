import React, { useRef, useEffect, useState } from "react";
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

export default function App() {
  const videoRef = useRef(null);
  const displayRef = useRef(null); // video or captured image
  const overlayRef = useRef(null);
  const segRef = useRef(null);
  const capturedCanvasRef = useRef(null); // offscreen canvas of captured photo

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
  // captured still photo for calibration
  const [capturedDataUrl, setCapturedDataUrl] = useState(null);
  // countdown before photo capture
  const [countdown, setCountdown] = useState(null); // 3..2..1 or null

  // ---- camera init ----
  useEffect(() => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      videoRef.current.srcObject = stream;
      videoRef.current.onloadeddata = () => {
        videoRef.current.play().catch((err) => console.error("Video play error:", err));
      };
    })();
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
  }, [headY, heelY, scaleMmPerPx, pitchDeg, rollDeg, capturedDataUrl, countdown]);

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

  // ---- compute scale ----
  const lockScale = () => {
    const spanPx = Math.abs(heelY - headY);
    if (spanPx < 200) return alert("Subject too small in frame. Step back.");
    if (Math.abs(pitchDeg) > 2 || Math.abs(rollDeg) > 2) return alert("Hold phone level (|pitch|,|roll| < 2°).");
    setScaleMmPerPx((heightCm * 10) / spanPx); // mm per pixel
  };

  // ---- capture still photo for calibration ----
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return alert("Camera not ready yet.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    capturedCanvasRef.current = canvas;
    setCapturedDataUrl(canvas.toDataURL("image/jpeg", 0.9));
  };

  const startCountdownAndCapture = () => {
    if (typeof countdown === "number") return;
    setScaleMmPerPx(null); // reset any prior calibration when taking a new photo
    let t = 3;
    setCountdown(t);
    const interval = setInterval(() => {
      t -= 1;
      if (t <= 0) {
        clearInterval(interval);
        setCountdown(null);
        // Slight delay to allow last frame draw
        setTimeout(() => capturePhoto(), 50);
      } else {
        setCountdown(t);
      }
    }, 1000);
  };

  const retakePhoto = () => {
    capturedCanvasRef.current = null;
    setCapturedDataUrl(null);
    setScaleMmPerPx(null);
  };

  // ---- capture and segment handlers ----
  async function captureSegment(label) {
    if (!isModelReady) return alert("Segmentation model not ready");
    // Use captured still if available, else grab from live video
    let canvas = capturedCanvasRef.current;
    if (!canvas) {
      const video = videoRef.current;
      if (!video || !video.videoWidth) {
        return alert("No frame available.");
      }
      canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);
    }

    const result = await segRef.current.segment(canvas);
    const mask = result.categoryMask;

    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    const data = octx.createImageData(out.width, out.height);
    const mdata = mask.getAsUint8Array();

    for (let i = 0; i < mdata.length; i++) {
      const j = i * 4;
      data.data[j + 3] = mdata[i] > 127 ? 255 : 0; // Alpha channel
    }
    octx.putImageData(data, 0, 0);

    document.body.appendChild(out); // Preview the mask
    console.log(`${label} captured`, out);
  }

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

        <div style={{display:"flex", gap:12, margin:"12px 0"}}>
        {!capturedDataUrl ? (
          <button onClick={typeof countdown === "number"} disabled={typeof countdown === "number"} onClick={startCountdownAndCapture}>
            {typeof countdown === "number" ? `Capturing in ${countdown}...` : "Capture Photo"}
          </button>
        ) : (
          <button onClick={retakePhoto} disabled={typeof countdown === "number"}>Retake Photo</button>
        )}
          <button disabled={!scaleMmPerPx || !isModelReady} onClick={() => captureSegment("Front")}>
            Capture FRONT
          </button>
          <button disabled={!scaleMmPerPx || !isModelReady} onClick={() => captureSegment("Side")}>
            Capture SIDE
          </button>
        </div>

        <div style={{position:"relative", width:"100%", aspectRatio:"16/9", background:"black", borderRadius:12, overflow:"hidden"}}>
        {!capturedDataUrl ? (
          <video ref={(el)=>{videoRef.current=el; displayRef.current=el;}} className="video" style={{width:"100%", height:"100%", objectFit:"contain"}} playsInline muted />
        ) : (
          <img ref={displayRef} src={capturedDataUrl} alt="Captured" style={{width:"100%", height:"100%", objectFit:"contain"}} />
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
      </div>
    </div>
  );
}
