// Unit conversion helpers
export const mm = (px, mmPerPx) => px * mmPerPx;
export const cm = (mm) => mm / 10;
export const inches = (mm) => mm / 25.4;

// Convert cm to inches (1 cm = 0.393701 inches)
export const cmToInches = (cm) => {
  return Math.round((cm * 0.393701) * 10) / 10;
};

// Format measurement display based on unit preference
export const formatMeasurement = (cmValue, unit = "length", useInches = false) => {
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

