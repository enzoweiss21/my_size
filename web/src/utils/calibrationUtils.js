// Sub-pixel edge snap: refine user-dragged head/heel to nearest strong horizontal edge
export const refineEdgeY = (ctx, y, x0 = null, x1 = null) => {
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

// Get Y position at same physical height ratio from head
export const rowAtRatio = (headY, heelY, r) => {
  return headY + r * (heelY - headY); // r = 0..1 from head
};

// Co-register Y position: compute ratio from front photo and apply to side photo
// This ensures front and side measurements are at the same physical height
export const coRegisterY = (yFrontPx, frontHead, frontHeel, sideHead, sideHeel) => {
  const r = (yFrontPx - frontHead) / (frontHeel - frontHead + 1e-6);
  return rowAtRatio(sideHead, sideHeel, r);
};

// Hard co-registration: snap the measured side pair to target Y before computing depth
export const snapPairToY = (pFront, pBack, yTarget) => {
  const f = pFront ? { ...pFront, y: yTarget } : null;
  const b = pBack ? { ...pBack, y: yTarget } : null;
  return [f, b];
};

