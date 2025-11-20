import { useState, useEffect } from 'react';

/**
 * Custom hook for tracking device orientation (pitch/roll)
 * @returns {Object} { pitchDeg, rollDeg }
 */
export function useDeviceOrientation() {
  const [pitchDeg, setPitchDeg] = useState(0);
  const [rollDeg, setRollDeg] = useState(0);

  useEffect(() => {
    if (!window.DeviceOrientationEvent) {
      console.warn("Device orientation not supported");
      return;
    }

    const handleOrientation = (e) => {
      // Beta is pitch (forward/back tilt), Gamma is roll (left/right tilt)
      const pitch = e.beta || 0; // -180 to 180
      const roll = e.gamma || 0; // -90 to 90
      
      setPitchDeg(pitch);
      setRollDeg(roll);
    };

    window.addEventListener('deviceorientation', handleOrientation);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  return { pitchDeg, rollDeg };
}


