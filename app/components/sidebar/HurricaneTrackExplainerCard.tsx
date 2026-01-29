"use client";
import { useState } from "react";

export default function HurricaneTrackExplainerCard() {
    const [open, setOpen] = useState(true);

    return (
        <section
            aria-label="Hurricane track explainer"
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
                <span>Hurricane Sandy (2012) Track Explainer</span>
                <span style={{ opacity: 0.7 }}>{open ? "–" : "+"}</span>
            </button>

            {open && (
                <div style={{ display: "grid", gap: 10 }}>
                    {/* <div style={{ marginBottom: 10, opacity: 0.85, fontWeight: 600 }}>
                        Hurricane Sandy (2012)
                    </div> */}
                    {/* Layers */}
                    <div style={rowStyle()}>
                        <LayerStackIcon />
                        <div>
                            Layers (250–850 hPa)
                            <div style={muted()}>
                                Each “pancake” is a pressure level, roughly spanning ~10–11 km (250 hPa) down to ~1–2 km (850 hPa)
                                above the surface.
                                {/* <span style={{ opacity: 0.85 }}> (Varies with atmosphere.)</span> */}
                            </div>
                        </div>
                    </div>

                    {/* Horizontal extent */}
                    <div style={rowStyle()}>
                        <RingsIcon />
                        <div>
                            Horizontal extent
                            <div style={muted()}>
                                The radius is an approximate “influence size” meaning how far from the storm center are winds meaningfully
                                affected at that level.
                            </div>
                        </div>
                    </div>

                    {/* Steering arrows */}
                    <div style={rowStyle()}>
                        <TripleArrowIcon />
                        <div>
                            Steering flow arrows
                            <div style={muted()}>
                                Three arrows (low / mid / high) show the average wind direction <b>~500 km outside</b> each layer’s
                                radius — a quick read of which way the environment is pushing that part of the storm.
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

function rowStyle() {
    return {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 10,
        alignItems: "center",
    } as const;
}

function muted() {
    return { opacity: 0.7, fontWeight: 400, lineHeight: 1.35 } as const;
}

function iconStroke() {
    return {
        stroke: "rgba(255,255,255,0.28)",
        strokeWidth: 1.2,
    } as const;
}

function iconFill() {
    return {
        fill: "rgba(255,255,255,0.08)",
        stroke: "rgba(255,255,255,0.22)",
        strokeWidth: 1.2,
    } as const;
}

function LayerStackIcon() {
    return (
        <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden>
            {/* subtle base */}
            <circle cx="21" cy="21" r="18" fill="rgba(255,255,255,0.03)" />
            {/* stacked “pancakes” */}
            <ellipse cx="21" cy="15" rx="12" ry="4.2" {...iconFill()} />
            <ellipse cx="21" cy="21" rx="14" ry="4.6" {...iconFill()} />
            <ellipse cx="21" cy="27" rx="16" ry="5.0" {...iconFill()} />
            {/* vertical connector */}
            <line x1="21" y1="9" x2="21" y2="33" {...iconStroke()} />
        </svg>
    );
}

function RingsIcon() {
    return (
        <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden>
            <circle cx="21" cy="21" r="15" {...iconFill()} />
            <circle cx="21" cy="21" r="10" fill="transparent" {...iconStroke()} />
            <circle cx="21" cy="21" r="5" fill="transparent" {...iconStroke()} />
            <circle cx="21" cy="21" r="1.8" fill="rgba(255,255,255,0.35)" />
        </svg>
    );
}

function TripleArrowIcon() {
    return (
        <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden>
            <rect x="6" y="8" width="30" height="26" rx="10" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
            <Arrow x={10} y={14} />
            <Arrow x={10} y={21} />
            <Arrow x={10} y={28} />
        </svg>
    );
}

function Arrow({ x, y }: { x: number; y: number }) {
    // simple right-pointing arrow
    return (
        <g transform={`translate(${x}, ${y})`}>
            <line x1="0" y1="0" x2="18" y2="0" stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" strokeLinecap="round" />
            <path
                d="M18 0 L13 -3 M18 0 L13 3"
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </g>
    );
}
