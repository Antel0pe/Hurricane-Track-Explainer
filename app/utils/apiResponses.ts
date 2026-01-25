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

type HurricaneAnalysisLevel = {
  exists: boolean;
  offsetCenter: [number, number]; // [dLatUnits, dLonUnits] per your JSON
  horizontalRadius: number;
};

export type HurricaneAnalysisResponse = Record<string, HurricaneAnalysisLevel>;

export type HurricaneLayer = { offX: number; offY: number; value: number };

const LEVEL_ORDER_DESC = [850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250] as const;

export async function fetchHurricaneAnalysis(timestamp: string): Promise<HurricaneAnalysisResponse> {
  const url = `${API_HOST}/api/hurricane_analysis/${encodeURIComponent(timestamp)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed analysis (${res.status}): ${text || res.statusText}`);
  }

  const raw = (await res.json()) as HurricaneAnalysisResponse;
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid analysis payload: ${JSON.stringify(raw)}`);
  }
  return raw;
}
