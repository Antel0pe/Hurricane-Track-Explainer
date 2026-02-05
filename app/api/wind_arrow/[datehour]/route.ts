// app/api/wind_arrow/[datehour]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parse a datehour string in the format: "YYYY-MM-DDTHH:mm"
 * Interprets the input as UTC (same convention as your reference snippet).
 *
 * Examples:
 *  - "2012-10-22T00:00"
 */
function parseDatehour(datehour: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(datehour);
  if (!m) throw new Error("Invalid datehour");

  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) {
    throw new Error("Invalid datehour ranges");
  }

  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Validate normalization didn’t occur (e.g., Feb 30)
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day ||
    dt.getUTCHours() !== hour ||
    dt.getUTCMinutes() !== minute
  ) {
    throw new Error("Invalid datehour calendar");
  }

  return dt;
}

/**
 * File keys look like: "2012-10-22T00:00:00"
 * We accept datehour to minute, but your file is on an exact cadence;
 * per your note, assume the request uses the same convention and we form the key as seconds=00.
 */
function toFileKey(dt: Date): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const h = String(dt.getUTCHours()).padStart(2, "0");
  const mi = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00`;
}

// --------------------
// Types for this schema
// --------------------
//
// {
//   "2012-10-22T00:00:00": {
//     "lines": [
//       [ [lat, lon], [lat, lon], ... ],
//       ...
//     ]
//   },
//   ...
// }

type LatLon = [number, number]; // [lat, lon]
type Line = LatLon[];
type Entry = { lines: Line[] };
type JetLinesDB = Record<string, Entry>;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ datehour: string }> }
) {
  const { datehour } = await context.params;

  let target: Date;
  try {
    target = parseDatehour(datehour);
  } catch {
    return NextResponse.json(
      { error: "Invalid datehour format" },
      { status: 400 }
    );
  }

  const key = toFileKey(target);

  const jsonPath = path.join(
    process.cwd(),
    "public",
    "na_jet_lines_2012-10-22_to_2012-10-31_6h.json"
  );

  let db: JetLinesDB;
  try {
    const txt = await readFile(jsonPath, "utf8");
    db = JSON.parse(txt) as JetLinesDB;
  } catch {
    return NextResponse.json(
      { error: "jet lines file missing or unreadable" },
      { status: 500 }
    );
  }

  if (!db || typeof db !== "object") {
    return NextResponse.json(
      { error: "invalid jet lines json" },
      { status: 500 }
    );
  }

  // Bounds check (lexicographic sort works for ISO-like keys)
  const keys = Object.keys(db).sort();
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "no jet lines data available" },
      { status: 500 }
    );
  }

  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];

  if (key < firstKey || key > lastKey) {
    return NextResponse.json(
      { error: "no such time exists" },
      { status: 404 }
    );
  }

  // Snap to closest 6h cadence (00/06/12/18). Assume no gaps.
  const cadenceHours = [0, 6, 12, 18];
  const h = target.getUTCHours();

  let bestHour = cadenceHours[0];
  let bestDist = Math.abs(h - bestHour);
  for (const ch of cadenceHours) {
    const dist = Math.abs(h - ch);
    if (dist < bestDist) {
      bestDist = dist;
      bestHour = ch;
    }
  }

  const y = target.getUTCFullYear();
  const mo = String(target.getUTCMonth() + 1).padStart(2, "0");
  const d = String(target.getUTCDate()).padStart(2, "0");
  const hh = String(bestHour).padStart(2, "0");
  const snappedKey = `${y}-${mo}-${d}T${hh}:00:00`;

  const entry = db[snappedKey];
  if (!entry) {
    return NextResponse.json({ error: "no such time exists" }, { status: 404 });
  }

  return NextResponse.json({ lines: entry.lines });

}
