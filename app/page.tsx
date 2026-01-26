"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Analytics } from '@vercel/analytics/next';

const EarthBase = dynamic(() => import("./components/EarthBase"), { ssr: false });
const TimeSlider = dynamic(() => import("./components/TimeSlider"), { ssr: false });

export default function Home() {
  const initial = useMemo(() => "2012-10-22T00:00", []);
  const [datehour, setDatehour] = useState<string>(initial);

  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100vw", height: "100vh", overflow: "hidden", }}>
      <Analytics />
      {/* Main content column (80% width) */}
      <div style={{ flex: "0 0 100%", display: "flex", flexDirection: "column", minWidth: 0, }}>
        <div style={{ flex: "0 0 80%", position: "relative" }}>
          <EarthBase
            timestamp={datehour}
          />
        </div>
        <div style={{ flex: "0 0 20%", borderTop: "1px solid rgba(0,0,0,0.1)" }}>
          <TimeSlider value={datehour} onChange={setDatehour} />
        </div>
      </div>

    </div>
  );
}