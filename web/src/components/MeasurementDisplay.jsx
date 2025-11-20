import React from 'react';
import { formatMeasurement } from '../utils/formatUtils';

export default function MeasurementDisplay({ bodyMeasurements, mode, useInches, setUseInches }) {
  if (!bodyMeasurements) return null;

  return (
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
          <strong>Height:</strong> {formatMeasurement(bodyMeasurements.height.cm, "length", useInches).main}
          {formatMeasurement(bodyMeasurements.height.cm, "length", useInches).sub && (
            <span style={{opacity: 0.7, fontSize: 12, marginLeft: 8}}>
              ({formatMeasurement(bodyMeasurements.height.cm, "length", useInches).sub})
            </span>
          )}
        </div>
      )}

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
                <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.widths.shoulders.cm, "length", useInches).main}</div>
                {formatMeasurement(bodyMeasurements.widths.shoulders.cm, "length", useInches).sub && (
                  <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.widths.shoulders.cm, "length", useInches).sub}</div>
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
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.width.cm, "length", useInches).main}</div>
                    {formatMeasurement(measurement.width.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.width.cm, "length", useInches).sub}</div>
                    )}
                  </div>
                  <div>
                    <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Depth (Side)</div>
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.depth.cm, "length", useInches).main}</div>
                    {formatMeasurement(measurement.depth.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.depth.cm, "length", useInches).sub}</div>
                    )}
                  </div>
                </div>
                
                {/* 3D Calculations */}
                <div style={{marginTop: 12, paddingTop: 12, borderTop: "1px solid #374151"}}>
                  <div style={{fontSize: 12, opacity: 0.7, marginBottom: 8}}>3D Measurements</div>
                  <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8}}>
                    <div>
                      <div style={{fontSize: 10, opacity: 0.6}}>Circumference</div>
                      {measurement.circumference && isFinite(measurement.circumference.cm) && measurement.circumference.cm > 0 ? (
                        <>
                          <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.circumference.cm, "length", useInches).main}</div>
                          {formatMeasurement(measurement.circumference.cm, "length", useInches).sub && (
                            <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.circumference.cm, "length", useInches).sub}</div>
                          )}
                        </>
                      ) : (
                        <div style={{fontSize: 14, fontWeight: "bold", color: "#ef4444"}}>—</div>
                      )}
                    </div>
                    <div>
                      <div style={{fontSize: 10, opacity: 0.6}}>Cross-Section</div>
                      <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area", useInches).main}</div>
                      {formatMeasurement(measurement.crossSectionalArea.cm2, "area", useInches).sub && (
                        <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area", useInches).sub}</div>
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
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.upperLegLength.cm, "length", useInches).main}</div>
                    {formatMeasurement(bodyMeasurements.upperLegLength.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.upperLegLength.cm, "length", useInches).sub}</div>
                    )}
                  </div>
                )}
                {bodyMeasurements.lowerLegLength && (
                  <div>
                    <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Lower Leg (Knee to Ankle)</div>
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.lowerLegLength.cm, "length", useInches).main}</div>
                    {formatMeasurement(bodyMeasurements.lowerLegLength.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.lowerLegLength.cm, "length", useInches).sub}</div>
                    )}
                  </div>
                )}
                {bodyMeasurements.totalLegLength && (
                  <div>
                    <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Total Leg Length</div>
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(bodyMeasurements.totalLegLength.cm, "length", useInches).main}</div>
                    {formatMeasurement(bodyMeasurements.totalLegLength.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(bodyMeasurements.totalLegLength.cm, "length", useInches).sub}</div>
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
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.width.cm, "length", useInches).main}</div>
                    {formatMeasurement(measurement.width.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.width.cm, "length", useInches).sub}</div>
                    )}
                  </div>
                  <div>
                    <div style={{fontSize: 11, opacity: 0.7, marginBottom: 4}}>Depth (Side)</div>
                    <div style={{fontSize: 18, fontWeight: "bold"}}>{formatMeasurement(measurement.depth.cm, "length", useInches).main}</div>
                    {formatMeasurement(measurement.depth.cm, "length", useInches).sub && (
                      <div style={{fontSize: 11, opacity: 0.6}}>{formatMeasurement(measurement.depth.cm, "length", useInches).sub}</div>
                    )}
                  </div>
                </div>
                
                {/* 3D Calculations */}
                <div style={{marginTop: 12, paddingTop: 12, borderTop: "1px solid #374151"}}>
                  <div style={{fontSize: 12, opacity: 0.7, marginBottom: 8}}>3D Measurements</div>
                  <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8}}>
                    <div>
                      <div style={{fontSize: 10, opacity: 0.6}}>Circumference</div>
                      {measurement.circumference && isFinite(measurement.circumference.cm) && measurement.circumference.cm > 0 ? (
                        <>
                          <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.circumference.cm, "length", useInches).main}</div>
                          {formatMeasurement(measurement.circumference.cm, "length", useInches).sub && (
                            <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.circumference.cm, "length", useInches).sub}</div>
                          )}
                        </>
                      ) : (
                        <div style={{fontSize: 14, fontWeight: "bold", color: "#ef4444"}}>—</div>
                      )}
                    </div>
                    <div>
                      <div style={{fontSize: 10, opacity: 0.6}}>Cross-Section</div>
                      <div style={{fontSize: 14, fontWeight: "bold"}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area", useInches).main}</div>
                      {formatMeasurement(measurement.crossSectionalArea.cm2, "area", useInches).sub && (
                        <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.crossSectionalArea.cm2, "area", useInches).sub}</div>
                      )}
                    </div>
                    <div>
                      <div style={{fontSize: 10, opacity: 0.6}}>Volume</div>
                      <div style={{fontSize: 14, fontWeight: "bold"}}>{measurement.volume.liters} L</div>
                      <div style={{fontSize: 9, opacity: 0.5}}>{formatMeasurement(measurement.volume.cm3, "volume", useInches).main}</div>
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
  );
}

