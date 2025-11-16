import React, { useRef, useEffect, useState } from "react";

export default function App() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);

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
  const [segmenter, setSegmenter] = useState(null);

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
    import("@mediapipe/tasks-vision").then(async (vision) => {
      const { FilesetResolver, ImageSegmenter } = vision;
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      try {
        const loadedSegmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "/path/to/local/selfie_segmenter.tflite", // Replace with a valid local or hosted path
          },
          outputCategoryMask: true,
          runningMode: "IMAGE",
          categoryAllowlist: ["person"],
        });
        setSegmenter(loadedSegmenter);
      } catch (error) {
        console.error("Failed to load segmentation model:", error);
      }
    });
  }, []);

  // ---- draw overlay (lines + level bubble + scale readout) ----
  useEffect(() => {
    const cvs = overlayRef.current, vid = videoRef.current;
    if (!cvs || !vid) return;
    const ctx = cvs.getContext("2d");
    let raf;
    const draw = () => {
      const w = (cvs.width = vid.clientWidth);
      const h = (cvs.height = vid.clientHeight);
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

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [headY, heelY, scaleMmPerPx, pitchDeg, rollDeg]);

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

  // ---- capture handlers ----
  const captureFront = () => {
    if (!scaleMmPerPx || !segmenter) return;
    // Placeholder for capturing and processing the front view
    console.log("Capture FRONT triggered");
  };

  const captureSide = () => {
    if (!scaleMmPerPx || !segmenter) return;
    // Placeholder for capturing and processing the side view
    console.log("Capture SIDE triggered");
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

        <div style={{display:"flex", gap:12, margin:"12px 0"}}>
          <button disabled={!scaleMmPerPx} onClick={captureFront}>
            Capture FRONT
          </button>
          <button disabled={!scaleMmPerPx} onClick={captureSide}>
            Capture SIDE
          </button>
        </div>

        <div style={{position:"relative", width:"100%", aspectRatio:"16/9", background:"black", borderRadius:12, overflow:"hidden"}}>
          <video ref={videoRef} className="video" style={{width:"100%", height:"100%", objectFit:"contain"}} playsInline muted />
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
