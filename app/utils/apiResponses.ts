const API_HOST =
  (process.env.NEXT_PUBLIC_API_HOST ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000").replace(/\/+$/, "");

type HurricaneCoordsResponse = { lat: number; lon: number };

export async function fetchHurricaneBaseLatLon(timestamp: string): Promise<HurricaneCoordsResponse> {
  const url = `${API_HOST}/api/hurricane_coords/${encodeURIComponent(timestamp)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store", // important if your API route is dynamic
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch hurricane coords (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as Partial<HurricaneCoordsResponse>;
  if (typeof data.lat !== "number" || typeof data.lon !== "number") {
    throw new Error(`Invalid hurricane coords payload: ${JSON.stringify(data)}`);
  }

  // keep it clean (optional): round to 2 decimals to match your prior preference
  return {
    lat: Math.round(data.lat * 100) / 100,
    lon: Math.round(data.lon * 100) / 100,
  };
}

export type HurricaneAnalysisLevel = {
  exists: boolean;
  offsetCenter: [number, number]; // [dLonDeg, dLatDeg] per your JSON
  horizontalRadius: number; // km
};

export type HurricaneLayer = { level: number, offX: number; offY: number; value: number };

export type SteeringVec = {
  u_ms: number;
  v_ms: number;
  coherence_to_motion: number;
};

export type SteeringFlow = {
  storm_motion: SteeringVec;
  high: SteeringVec;
  mid: SteeringVec;
  low: SteeringVec;
};

export type HurricaneAnalysisEntry = {
  levels: Record<string, HurricaneAnalysisLevel>; // keyed by pressure level string: "250", "300", ...
  steering_flow: SteeringFlow;
};

export async function fetchHurricaneAnalysis(timestamp: string): Promise<HurricaneAnalysisEntry> {
  const url = `${API_HOST}/api/hurricane_analysis/${encodeURIComponent(timestamp)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed analysis (${res.status}): ${text || res.statusText}`);
  }

  const raw = (await res.json()) as HurricaneAnalysisEntry;

  // Minimal structural sanity checks (keep it lightweight)
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid analysis payload: ${JSON.stringify(raw)}`);
  }
  if (!raw.levels || typeof raw.levels !== "object") {
    throw new Error(`Invalid analysis.levels: ${JSON.stringify(raw)}`);
  }
  if (!raw.steering_flow || typeof raw.steering_flow !== "object") {
    throw new Error(`Invalid analysis.steering_flow: ${JSON.stringify(raw)}`);
  }

  return raw;
}
