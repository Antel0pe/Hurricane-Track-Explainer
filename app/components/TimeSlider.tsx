"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// -----------------------------
// Constants
// -----------------------------
const START_STR = "2012-10-22T00:00";
const END_STR = "2012-10-31T12:00";
const MS_PER_HOUR = 3_600_000;
const COMMIT_DELAY_MS = 100;

// -----------------------------
// Date helpers (UTC-only)
// -----------------------------
function parseDateTimeUTC(value: string): Date {
  // Expect "YYYY-MM-DDTHH:mm" interpreted as UTC
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error("Invalid datetime format. Expected YYYY-MM-DDTHH:mm");

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const min = Number(m[5]);

  return new Date(Date.UTC(y, mo, d, h, min, 0));
}

function formatDateTimeUTC(dt: Date): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const h = String(dt.getUTCHours()).padStart(2, "0");
  const min = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${min}`;
}

function formatPrettyUTC(dt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

function prettyFromValueStrUTC(valueStr: string): string {
  return formatPrettyUTC(parseDateTimeUTC(valueStr));
}

// -----------------------------
// Component
// -----------------------------
export interface TimeSliderProps {
  value: string; // "YYYY-MM-DDTHH:mm" (UTC)
  onChange: (next: string) => void;
  allReady: boolean;
}

export default function TimeSlider({ value, onChange, allReady }: TimeSliderProps) {
  const start = useMemo(() => parseDateTimeUTC(START_STR), []);
  const end = useMemo(() => parseDateTimeUTC(END_STR), []);

  // Total slider span in whole hours
  const totalHours = useMemo(() => {
    const spanMs = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(spanMs / MS_PER_HOUR));
  }, [start, end]);

  // Clamp incoming prop value into [start, end], then convert to hour offset
  const currentHours = useMemo(() => {
    let curMs: number;
    try {
      curMs = parseDateTimeUTC(value).getTime();
    } catch {
      curMs = start.getTime();
    }

    const clampedMs = Math.max(start.getTime(), Math.min(end.getTime(), curMs));
    const hrs = Math.floor((clampedMs - start.getTime()) / MS_PER_HOUR);
    return Math.max(0, Math.min(totalHours, hrs));
  }, [value, start, end, totalHours]);

  // Draft (UI) state
  const [draftHours, setDraftHours] = useState<number>(currentHours);

  // Refs to avoid stale closures in event handlers / timers
  const totalHoursRef = useRef<number>(totalHours);
  const draftHoursRef = useRef<number>(draftHours);
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    totalHoursRef.current = totalHours;
  }, [totalHours]);

  useEffect(() => {
    draftHoursRef.current = draftHours;
  }, [draftHours]);

  // Commit draft -> onChange (UTC string)
  const commitHours = useCallback(
    (hours: number) => {
      const dt = new Date(start.getTime() + hours * MS_PER_HOUR);
      onChange(formatDateTimeUTC(dt));
    },
    [onChange, start]
  );

  // Debounced commit while dragging / holding keys
  const scheduleCommit = useCallback(
    (hours: number) => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);

      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        commitHours(hours);
      }, COMMIT_DELAY_MS);
    },
    [commitHours]
  );

  // One helper for “update UI + schedule commit”
  const setDraftAndSchedule = useCallback(
    (hours: number) => {
      const clamped = Math.max(0, Math.min(totalHoursRef.current, hours));
      setDraftHours(clamped);
      scheduleCommit(clamped);
    },
    [scheduleCommit]
  );

  // Keyboard stepping
  const step = useCallback(
    (delta: -1 | 1) => {
      setDraftAndSchedule(draftHoursRef.current + delta);
    },
    [setDraftAndSchedule]
  );

  // Keyboard listeners (ArrowLeft/ArrowRight)
  useEffect(() => {
    const isTypingTarget = (el: Element | null) => {
      if (!el) return false;
      const node = el as HTMLElement;
      const tag = node.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;

      if (e.key === "ArrowLeft") {
        setIsPlaying(false);
        step(-1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setIsPlaying(false);
        step(1);
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        commitHours(draftHoursRef.current); // commit immediately on release
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [step, commitHours]);

  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef<number | null>(null);

  // keep latest values in refs to avoid stale closures
  const allReadyRef = useRef(allReady);
  useEffect(() => { allReadyRef.current = allReady; }, [allReady]);

  const currentHoursRef = useRef(currentHours);
  useEffect(() => { currentHoursRef.current = currentHours; }, [currentHours]);

  useEffect(() => {
    if (!isPlaying) return;

    // Don't advance until the scene reports ready for the current timestamp
    if (!allReadyRef.current) return;

    // After ready, wait 200ms, then advance by 1 hour
    playTimerRef.current = window.setTimeout(() => {
      const next = Math.min(totalHoursRef.current, currentHoursRef.current + 1);

      // stop at end
      if (next === currentHoursRef.current) {
        setIsPlaying(false);
        return;
      }

      // advance UI immediately so slider moves
      setDraftHours(next);

      // commit the timestamp change (this will flip allReady false in HomeClient per your wiring)
      commitHours(next);
    }, 700);

    return () => {
      if (playTimerRef.current !== null) {
        window.clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, commitHours]);


  // Cleanup any pending timer on unmount
  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    };
  }, []);

  // Display value (based on draftHours)
  const displayValueStr = useMemo(() => {
    const dt = new Date(start.getTime() + draftHours * MS_PER_HOUR);
    return formatDateTimeUTC(dt);
  }, [start, draftHours]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, width: "100%", height: "100%", justifyContent: "center" }}>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
        }}
      >
        <div style={{ flex: 1, textAlign: "left" }}>
          {prettyFromValueStrUTC(START_STR)} UTC
        </div>

        <button
          onClick={() => setIsPlaying((p) => !p)}
          disabled={!allReady}
          title={allReady ? (isPlaying ? "Pause" : "Play") : "Waiting for render..."}
          aria-label={isPlaying ? "Pause" : "Play"}
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.35)",
            color: "white",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: allReady ? "pointer" : "not-allowed",
            opacity: allReady ? 1 : 0.5,
            userSelect: "none",
            lineHeight: 1,
            padding: 0,
            flex: "0 0 auto",
          }}
        >
          <span style={{ fontSize: 14, transform: isPlaying ? "none" : "translateX(1px)" }}>
            {isPlaying ? "❚❚" : "▶"}
          </span>
        </button>

        <div style={{ flex: 1, textAlign: "right" }}>
          {prettyFromValueStrUTC(END_STR)} UTC
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={totalHours}
        step={1}
        value={draftHours}
        onChange={(e) => {
          setIsPlaying(false);
          const h = Number(e.target.value);
          setDraftHours(h);  // smooth UI updates
          scheduleCommit(h); // commits when user pauses
        }}
        style={{ width: "100%" }}
      />

      <div style={{ textAlign: "center", fontSize: 12 }}>
        {formatPrettyUTC(parseDateTimeUTC(displayValueStr))} UTC
      </div>
    </div>
  );
}
