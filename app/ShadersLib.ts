export const min_max_gph_ranges_glsl = `
uniform float uPressure;
void getGphRange(float pressure, out float minRange, out float maxRange) {
    if (pressure == 250.0) {
        minRange = 9600.0;
        maxRange = 11200.0;
    } else if (pressure == 500.0) {
        minRange = 4600.0;
        maxRange = 6000.0;
    } else if (pressure == 850.0) {
        minRange = 1200.0;
        maxRange = 1600.0;
    } else {
        // Default/fallback values
        minRange = 0.0;
        maxRange = 0.0;
    }
}
`;


// Shared GLSL utilities reused by vertex shaders
export const get_position_z_shared_glsl = `
  ${min_max_gph_ranges_glsl}

  float decodeElevation(vec3 rgb) {
    float R = floor(rgb.r * 255.0 + 0.5);
    float G = floor(rgb.g * 255.0 + 0.5);
    float B = floor(rgb.b * 255.0 + 0.5);
    return (R * 65536.0 + G * 256.0 + B) * 0.1 - 10000.0;
  }

  float get_position_z(sampler2D tex, vec2 uv, float exaggeration) {
    float minGPHRange, maxGPHRange;
    getGphRange(uPressure, minGPHRange, maxGPHRange);

    float elev = decodeElevation(texture2D(tex, uv).rgb);
    float t = clamp((elev - minGPHRange) / (maxGPHRange - minGPHRange), 0.0, 1.0);
    return exaggeration * t;
  }
`;


export const GET_POSITION_Z_SHARED_GLSL3 = `
  ${min_max_gph_ranges_glsl}
  float decodeElevation(vec3 rgb) {
    float R = floor(rgb.r * 255.0 + 0.5);
    float G = floor(rgb.g * 255.0 + 0.5);
    float B = floor(rgb.b * 255.0 + 0.5);
    return (R * 65536.0 + G * 256.0 + B) * 0.1 - 10000.0;
  }
  float get_position_z_glsl3(sampler2D tex, vec2 uv, float exaggeration) {
    float minGPHRange, maxGPHRange;
    getGphRange(uPressure, minGPHRange, maxGPHRange);

    float elev = decodeElevation(texture(tex, uv).rgb);
    float t = clamp((elev - minGPHRange) / (maxGPHRange - minGPHRange), 0.0, 1.0);
    return exaggeration * t;
  }
`;

export const getWindMotionRangesPerPressureLevel = `
// tiny tolerance to avoid float == pitfalls
const float WIND_PRESSURE_LEVEL_EPS = 0.5;

void getUVRange(float pressure, out float minU, out float maxU, out float minV, out float maxV) {
  // UV_RANGES_MPS:
  //  850: (-60, 60)
  //  500: (-80, 80)
  //  250: (-120,120)
  if (abs(pressure - 250.0) < WIND_PRESSURE_LEVEL_EPS) {
    minU = -120.0; maxU = 120.0;
    minV = -120.0; maxV = 120.0;
  } else if (abs(pressure - 500.0) < WIND_PRESSURE_LEVEL_EPS) {
    minU =  -80.0; maxU =  80.0;
    minV =  -80.0; maxV =  80.0;
  } else if (abs(pressure - 850.0) < WIND_PRESSURE_LEVEL_EPS) {
    minU =  -60.0; maxU =  60.0;
    minV =  -60.0; maxV =  60.0;
  } else {
    // fallback: conservative
    minU = -80.0; maxU = 80.0;
    minV = -80.0; maxV = 80.0;
  }
}

void getZRange(out float minW, out float maxW) {
  // Z_RANGE_MPS = (-5, 5)
  minW = -5.0;
  maxW =  5.0;
}
`

export const getTemperatureRangesPerPressureLevel = `
// tiny tolerance to avoid float == pitfalls
const float TEMP_PRESSURE_LEVEL_EPS = 0.5;

void getTempRange(float pressure, out float minT, out float maxT) {
  // TEMP_RANGES_C:
  //  850: (-40, 35)
  //  500: (-70, 0)
  //  250: (-80, -25)
  if (abs(pressure - 250.0) < TEMP_PRESSURE_LEVEL_EPS) {
    minT = -80.0; maxT = -25.0;
  } else if (abs(pressure - 500.0) < TEMP_PRESSURE_LEVEL_EPS) {
    minT = -70.0; maxT =  0.0;
  } else if (abs(pressure - 850.0) < TEMP_PRESSURE_LEVEL_EPS) {
    minT = -40.0; maxT = 35.0;
  } else {
    // fallback: conservative global temperature range
    minT = -80.0; maxT = 35.0;
  }
}
`