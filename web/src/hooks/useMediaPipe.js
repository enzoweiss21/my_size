import { useRef, useEffect, useState } from 'react';
import { FilesetResolver, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";

/**
 * Custom hook for loading MediaPipe models
 * @returns {Object} { segRef, poseRef, isModelReady, isPoseReady }
 */
export function useMediaPipe() {
  const segRef = useRef(null);
  const poseRef = useRef(null);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isPoseReady, setIsPoseReady] = useState(false);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );

        // Load segmentation model
        const imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
            delegate: "GPU"
          },
          outputCategoryMask: true,
          outputConfidenceMasks: false
        });
        segRef.current = imageSegmenter;
        setIsModelReady(true);
        console.log("Segmentation model loaded");

        // Load pose landmarker
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU"
          },
          runningMode: "IMAGE",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        poseRef.current = poseLandmarker;
        setIsPoseReady(true);
        console.log("Pose landmarker loaded");
      } catch (err) {
        console.error("Failed to load MediaPipe models:", err);
      }
    };

    loadModels();
  }, []);

  return { segRef, poseRef, isModelReady, isPoseReady };
}


