// app/api/hurricane_coords/[datehour]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

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
  // Strict format: 2012-10-21T18:00
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(datehour);
  if (!m) throw new Error("Invalid datehour");

  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  // Basic range validation
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) {
    throw new Error("Invalid datehour ranges");
  }

  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Validate that Date didn't normalize something invalid (e.g., Feb 30)
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

type Row = { tMs: number; lat: number; lon: number };

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

  const csvPath = path.join(
    process.cwd(),
    "public",
    "hurricane_coords",
    "sandy2012-coords.csv"
  );

  let rows: Row[] = [];
  try {
    const csvText = await readFile(csvPath, "utf8");

    const records = parse(csvText, {
      columns: true,          // uses header row: datetime,lat,lon
      skip_empty_lines: true,
      trim: true,
    }) as Array<{ datetime: string; lat: string; lon: string }>;

    for (const r of records) {
      if (!r?.datetime) continue;

      let dt: Date;
      try {
        dt = parseDatehour(r.datetime);
      } catch {
        continue; // ignore malformed rows
      }

      const lat = Number(r.lat);
      const lon = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      rows.push({ tMs: dt.getTime(), lat, lon });
    }

    rows.sort((a, b) => a.tMs - b.tMs);
  } catch {
    return NextResponse.json(
      { error: "coords file missing or unreadable" },
      { status: 500 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "no coords available" }, { status: 500 });
  }

  const t = target.getTime();
  const first = rows[0].tMs;
  const last = rows[rows.length - 1].tMs;

  if (t < first || t > last) {
    return NextResponse.json(
      { error: "no such coord exists" },
      { status: 404 }
    );
  }

  // Binary search for exact match or bracketing indices.
  let lo = 0;
  let hi = rows.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tm = rows[mid].tMs;

    if (tm === t) {
      return NextResponse.json({ lat: rows[mid].lat, lon: rows[mid].lon });
    }
    if (tm < t) lo = mid + 1;
    else hi = mid - 1;
  }

  // After loop: hi = index of greatest < t, lo = index of smallest > t
  const i0 = hi;
  const i1 = lo;

  if (i0 < 0 || i1 >= rows.length) {
    return NextResponse.json(
      { error: "no such coord exists" },
      { status: 404 }
    );
  }

  const r0 = rows[i0];
  const r1 = rows[i1];
  const span = r1.tMs - r0.tMs;

  if (span <= 0) {
    return NextResponse.json(
      { error: "invalid coords time ordering" },
      { status: 500 }
    );
  }

  const frac = (t - r0.tMs) / span;
  const lat = r0.lat + frac * (r1.lat - r0.lat);
  const lon = r0.lon + frac * (r1.lon - r0.lon);

  const round2 = (x: number) => Math.round(x * 100) / 100;

  return NextResponse.json({ lat: round2(lat), lon: round2(lon) });
}
