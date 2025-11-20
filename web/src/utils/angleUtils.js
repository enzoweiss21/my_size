// Angle helper functions
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const deg2rad = (d) => d * Math.PI / 180;
export const rad2deg = (r) => r * 180 / Math.PI;

// Smooth angle with sanity bounds and EMA
// Guards angle inputs and keeps a small EMA so single bad frames don't swing outputs
export const smoothAngle = (prevRad, nextRad, alpha = 0.6, maxAbs = deg2rad(20)) => {
  const n = clamp(nextRad, -maxAbs, maxAbs);
  return prevRad == null ? n : alpha * n + (1 - alpha) * prevRad;
};

// Estimate pitch from pose landmarks (lean forward/back)
// Uses shoulder->hip vertical slope
export const estimatePitchFromPose = (pose) => {
  if (!pose || !pose.landmarks || pose.landmarks.length < 33) return 0;
  
  const lm = pose.landmarks; // MediaPipe 33 landmarks (normalized [0..1])
  
  // Use average left/right shoulder and hip
  // MediaPipe indices: 11=left_shoulder, 12=right_shoulder, 23=left_hip, 24=right_hip
  const shY = (lm[11]?.y + lm[12]?.y) * 0.5; // shoulders
  const hpY = (lm[23]?.y + lm[24]?.y) * 0.5; // hips
  
  if (!shY || !hpY) return 0;
  
  // Crude pitch proxy: vertical delta mapped to angle
  const dy = (hpY - shY); // screen space (normalized)
  const dx = 0.30; // nominal torso width in normalized units
  let pitch = Math.atan2(dy, dx); // radians
  
  pitch = clamp(pitch, -deg2rad(25), deg2rad(25));
  return pitch;
};

// Moving average helper for smoothing
const movingAvg = (prev, next, alpha = 0.5) => {
  return prev == null ? next : (alpha * next + (1 - alpha) * prev);
};

// Estimate yaw from front image pose (rotation around vertical axis)
// Compares shoulder x to hip x (horizontal offset)
export const estimateYawFromPose = (pose) => {
  if (!pose || !pose.landmarks || pose.landmarks.length < 33) return 0;
  
  const lm = pose.landmarks;
  const shX = (lm[11]?.x + lm[12]?.x) * 0.5;
  const hpX = (lm[23]?.x + lm[24]?.x) * 0.5;
  
  if (!shX || !hpX) return 0;
  
  // Horizontal displacement relative to nominal torso height
  const shY = (lm[11]?.y + lm[12]?.y) * 0.5;
  const hpY = (lm[23]?.y + lm[24]?.y) * 0.5;
  const torsoH = Math.abs(shY - hpY) + 1e-6;
  
  let yaw = Math.atan2(hpX - shX, torsoH); // radians
  yaw = clamp(yaw, -deg2rad(30), deg2rad(30));
  return yaw;
};

// Smoother, more stable yaw estimate with tighter bounds
export const estimateYawFromPoseStable = (pose, prevYaw = 0) => {
  if (!pose || !pose.landmarks || pose.landmarks.length < 33) return prevYaw;
  
  const lm = pose.landmarks;
  // PCA proxy: vector shoulder-mid → hip-mid; compare x-offset to y-extent
  const sh = { x: (lm[11]?.x + lm[12]?.x) / 2, y: (lm[11]?.y + lm[12]?.y) / 2 };
  const hp = { x: (lm[23]?.x + lm[24]?.x) / 2, y: (lm[23]?.y + lm[24]?.y) / 2 };
  
  if (!sh.x || !hp.x || !sh.y || !hp.y) return prevYaw;
  
  const dy = (hp.y - sh.y);
  const dx = (hp.x - sh.x);
  let yaw = Math.atan2(dx, Math.abs(dy) + 1e-6); // radians
  
  // Clamp tighter; yaw beyond ~20° from a "front" shot is unlikely usable
  const max = deg2rad(20);
  yaw = clamp(yaw, -max, max);
  
  // Smooth with moving average (60% new, 40% old)
  return movingAvg(prevYaw, yaw, 0.6);
};

