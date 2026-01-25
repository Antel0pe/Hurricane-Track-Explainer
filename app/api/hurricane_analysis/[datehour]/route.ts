// app/api/hurricane_analysis/[datehour]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parse a datehour string in the format: "YYYY-MM-DDTHH:mm"
 * Interprets the input as UTC.
 *
 * Examples:
 *  - "2012-10-21T18:00"
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
 * Your JSON keys look like: "2012-10-22T00:00:00Z"
 * We accept datehour to minute, but the data is hourly; we snap to the hour.
 */
function toHourlyKey(dt: Date): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const h = String(dt.getUTCHours()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:00:00Z`;
}

// Shape:
// {
//   "2012-10-22T00:00:00Z": {
//     "250": { exists: true, offsetCenter: [1.55, 1.85], horizontalRadius: 62.5 },
//     ...
//   },
//   ...
// }
type LevelValue = {
  exists: boolean;
  offsetCenter: [number, number];
  horizontalRadius: number;
};
type TimeBlock = Record<string, LevelValue>;
type InfluenceDB = Record<string, TimeBlock>;

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

  // Snap to hour since the dataset is hourly.
  const key = toHourlyKey(target);

  const jsonPath = path.join(
    process.cwd(),
    "public",
    "storm_influence_by_time_level.json"
  );

  let db: InfluenceDB;
  try {
    const txt = await readFile(jsonPath, "utf8");
    db = JSON.parse(txt) as InfluenceDB;
  } catch {
    return NextResponse.json(
      { error: "influence file missing or unreadable" },
      { status: 500 }
    );
  }

  if (!db || typeof db !== "object") {
    return NextResponse.json(
      { error: "invalid influence json" },
      { status: 500 }
    );
  }

  // Bounds check: outside range => error
  // (Compute min/max key once per request; OK for modest file sizes.
  //  If it gets big, cache keys in module scope.)
  const keys = Object.keys(db).sort(); // ISO UTC strings sort lexicographically by time
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "no influence data available" },
      { status: 500 }
    );
  }

  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];

  if (key < firstKey || key > lastKey) {
    return NextResponse.json(
      { error: "no such hour exists" },
      { status: 404 }
    );
  }

  const block = db[key];
  if (!block) {
    // Inside global bounds but missing this hour
    return NextResponse.json(
      { error: "no such hour exists" },
      { status: 404 }
    );
  }

  // Return the full object for that hour (all levels).
  return NextResponse.json(block);
}
