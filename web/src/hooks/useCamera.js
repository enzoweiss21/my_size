import { useRef, useEffect } from 'react';

/**
 * Custom hook for managing camera stream
 * @returns {Object} { videoRef, streamRef, initialized }
 */
export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        console.error("Camera initialization error:", err);
      }
    };

    initCamera();

    return () => {
      // Cleanup: stop all tracks when component unmounts
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return { videoRef, streamRef };
}


