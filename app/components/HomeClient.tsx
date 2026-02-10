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

const WindArrow = dynamic(() => import("./layers/WindArrow"), {
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
          width: "100%",
          height: "100%",
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
            {/* <WindArrow /> */}
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
      {/* <aside
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
      </aside> */}
      {/* Top-right toggle button */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? "Close info" : "Open info"}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          zIndex: 50,
          width: sidebarOpen ? 34 : 100,
          height: sidebarOpen ? 34 : 50,
          borderRadius: 12,
          background: "rgba(70, 140, 255, 0.24)",
          border: "1px solid rgba(140, 190, 255, 0.32)",

          color: "white",
          cursor: "pointer",
          backdropFilter: "blur(10px)",
          display: "grid",
          placeItems: "center",
          userSelect: "none",
          boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}
      >
        <span style={{ fontSize: sidebarOpen ? 22 : 14, fontWeight: 600, lineHeight: 1, opacity: 0.95 }}>
          {sidebarOpen ? "×" : "Explain"}
        </span>
      </button>


      {/* Optional: click-away scrim when open */}
      <div
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 40,
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      />

      {/* Sidebar overlay drawer */}
      <aside
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: 420,
          maxWidth: "92vw", // prevents weirdness on small screens
          zIndex: 45,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          backdropFilter: "blur(6px)",
          background: "rgba(18,18,20,0.55)",
          borderLeft: "1px solid rgba(255,255,255,0.12)",
          transform: sidebarOpen ? "translateX(0)" : "translateX(110%)",
          transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          boxShadow: "0 0 0 rgba(0,0,0,0)", // optional
        }}
      >
        <SidebarPane />
      </aside>
    </div>
  );
}
