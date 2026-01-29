"use client";
import { useState } from "react";

export default function ControlsHelp() {
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label="Keyboard & mouse help"
      style={{
        margin: 8,
        padding: 12,
        borderRadius: 12,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#e9eef7",
        font: "500 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          padding: 0,
          marginBottom: open ? 10 : 0,
          fontWeight: 700,
          letterSpacing: ".02em",
          textTransform: "uppercase",
          opacity: 0.9,
        }}
      >
        <span>Controls</span>
        <span style={{ opacity: 0.7 }}>{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div style={{ display: "grid", gap: 10 }}>
          {/* WASD */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
            <WASDKeys />
            <div>
              Move / pan
              <div style={{ opacity: 0.7, fontWeight: 400 }}>W/A/S/D</div>
            </div>
          </div>

          {/* Shift / Space */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
            <ShiftSpace />
            <div>
              Altitude
              <div style={{ opacity: 0.7, fontWeight: 400 }}>Shift = up, Space = down</div>
            </div>
          </div>

          {/* Mouse */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
            <MouseIcon />
            <div>
              Look around
              <div style={{ opacity: 0.7, fontWeight: 400 }}>
                  Click the globe to enter free fly. Move your mouse left and right to turn your view, and up or down to tilt it toward the horizon or ground.  
    Press <b>Q</b> or <b>Esc</b> to exit.

              
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function keyStyle() {
  return {
    fill: "rgba(255,255,255,0.1)",
    stroke: "rgba(255,255,255,0.25)",
    strokeWidth: 1.2,
    rx: 6,
  } as const;
}

function labelStyle() {
  return {
    fill: "#e9eef7",
    fontSize: 10,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
    fontWeight: 700,
    textAnchor: "middle" as const,
    dominantBaseline: "middle" as const,
  };
}

function WASDKeys() {
  return (
    <svg width="84" height="54" viewBox="0 0 84 54" aria-hidden>
      {/* W */}
      <rect x="30" y="2" width="24" height="16" {...keyStyle()} />
      <text x="42" y="10" style={labelStyle()}>W</text>
      {/* A S D */}
      <rect x="6"  y="22" width="24" height="16" {...keyStyle()} />
      <rect x="30" y="22" width="24" height="16" {...keyStyle()} />
      <rect x="54" y="22" width="24" height="16" {...keyStyle()} />
      <text x="18" y="30" style={labelStyle()}>A</text>
      <text x="42" y="30" style={labelStyle()}>S</text>
      <text x="66" y="30" style={labelStyle()}>D</text>
    </svg>
  );
}

function ShiftSpace() {
  return (
    <svg width="120" height="34" viewBox="0 0 120 34" aria-hidden>
      <rect x="2" y="2" width="52" height="20" {...keyStyle()} />
      <text x="28" y="12" style={labelStyle()}>Shift</text>
      <rect x="66" y="2" width="52" height="20" {...keyStyle()} />
      <text x="92" y="12" style={labelStyle()}>Space</text>
    </svg>
  );
}

function MouseIcon() {
  return (
    <svg width="40" height="50" viewBox="0 0 40 50" aria-hidden>
      <rect x="8" y="4" width="24" height="36" rx="12" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />
      <line x1="20" y1="8" x2="20" y2="18" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
    </svg>
  );
}