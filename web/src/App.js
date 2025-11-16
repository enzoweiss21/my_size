import "./App.css";
import React, { useRef, useState } from "react";
import Webcam from "react-webcam";

function App() {
  const webcamRef = useRef(null);
  const [hasPermission, setHasPermission] = useState(null);

  const videoConstraints = {
    facingMode: "user",
  };

  return (
    <div className="App">
      <header className="App-header">
        <p>My Size AI</p>

        {hasPermission === false && (
          <div className="webcam-fallback">
            Camera access denied or unavailable.
          </div>
        )}

        <Webcam
          audio={false}
          ref={webcamRef}
          mirrored={true}
          screenshotFormat="image/jpeg"
          videoConstraints={videoConstraints}
          className="webcam"
          onUserMedia={() => setHasPermission(true)}
          onUserMediaError={() => setHasPermission(false)}
        />
      </header>
    </div>
  );
}

export default App;
