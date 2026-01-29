"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import SidebarPane from "./sidebar/SidebarPane";

const EarthBase = dynamic(() => import("./layers/EarthBase"), {
  ssr: false,
  loading: () => <div style={{ width: "100%", height: "100%" }} />,
});

const HurricanePancake = dynamic(() => import("./layers/HurricanePancake"), {
  ssr: false,
  loading: () => null,
});

const TimeSlider = dynamic(() => import("./TimeSlider"), {
  ssr: false,
  loading: () => <div style={{ height: "100%" }} />,
});

export default function HomeClient() {
  const [datehour, setDatehour] = useState(() => "2012-10-22T00:00");
  const [allReady, setAllReady] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <Analytics />

      {/* Main content column */}
      <div
        style={{
          flex: "0 0 75%",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div style={{ flex: "0 0 80%", position: "relative", minHeight: 0 }}>
          <EarthBase
            timestamp={datehour}
            onAllReadyChange={(ready, timestamp) => {
              // only accept readiness for the currently displayed timestamp
              if (timestamp === datehour) setAllReady(ready);
            }}
          >
            <HurricanePancake />
          </EarthBase>
        </div>

        <div
          style={{
            flex: "0 0 20%",
            borderTop: "1px solid rgba(0,0,0,0.1)",
            minHeight: 0,
          }}
        >
          <TimeSlider
            value={datehour}
            onChange={(next) => {
              setAllReady(false);  // immediately block until new time renders
              setDatehour(next);
            }}
            allReady={allReady}
          />
        </div>
      </div>

      {/* Sidebar */}
      <aside
        style={{
          flex: "0 0 25%",
          width: "25%",
          minWidth: 0,
          height: "100%",
          borderLeft: "1px solid rgba(255,255,255,0.1)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backdropFilter: "blur(6px)",
          background: "rgba(18,18,20,0.55)",
        }}
      >
        <SidebarPane />
      </aside>
    </div>
  );
}
