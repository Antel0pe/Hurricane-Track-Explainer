"use client";

import React, { useMemo, useEffect, useRef, useCallback } from "react";

export interface TimeSliderProps {
  value: string; // "YYYY-MM-DDTHH:mm" (UTC)
  onChange: (next: string) => void;
}

const START_STR = "2012-10-22T00:00";
const END_STR = "2012-10-31T12:00";

function parseDateTime(value: string): Date {
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

function formatDateTime(dt: Date): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const h = String(dt.getUTCHours()).padStart(2, "0");
  const min = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${min}`;
}

export default function TimeSlider({ value, onChange }: TimeSliderProps) {
  const start = useMemo(() => parseDateTime(START_STR), []);
  const end = useMemo(() => parseDateTime(END_STR), []);

  const totalHours = useMemo(() => {
    const spanMs = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(spanMs / 3_600_000));
  }, [start, end]);

  const currentHours = useMemo(() => {
    let curMs: number;
    try {
      curMs = parseDateTime(value).getTime();
    } catch {
      curMs = start.getTime();
    }

    const clampedMs = Math.max(start.getTime(), Math.min(end.getTime(), curMs));
    return Math.max(0, Math.min(totalHours, Math.floor((clampedMs - start.getTime()) / 3_600_000)));
  }, [value, start, end, totalHours]);

  const currentHoursRef = useRef<number>(currentHours);
  useEffect(() => {
    currentHoursRef.current = currentHours;
  }, [currentHours]);

  const totalHoursRef = useRef<number>(totalHours);
  useEffect(() => {
    totalHoursRef.current = totalHours;
  }, [totalHours]);

  const step = useCallback(
    (delta: -1 | 1) => {
      const nextHours = Math.max(0, Math.min(totalHoursRef.current, currentHoursRef.current + delta));
      if (nextHours === currentHoursRef.current) return;

      const dt = new Date(start.getTime() + nextHours * 3_600_000);
      onChange(formatDateTime(dt));
    },
    [onChange, start]
  );

  useEffect(() => {
    const held = { left: false, right: false };
    let timer: number | null = null;

    const startTimer = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        const dir = held.right && !held.left ? 1 : held.left && !held.right ? -1 : 0;
        if (dir === 0) {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
          return;
        }
        step(dir as -1 | 1);
      }, 100);
    };

    const stopTimer = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const isTypingTarget = (el: Element | null) => {
      if (!el) return false;
      const node = el as HTMLElement;
      const tag = node.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;

      if (e.key === "ArrowLeft") {
        if (!held.left) {
          held.left = true;
          step(-1);
        }
        startTimer();
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        if (!held.right) {
          held.right = true;
          step(1);
        }
        startTimer();
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") held.left = false;
      if (e.key === "ArrowRight") held.right = false;
      if (!held.left && !held.right) stopTimer();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      stopTimer();
    };
  }, [step]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hours = Number(e.target.value);
    const dt = new Date(start.getTime() + hours * 3_600_000);
    onChange(formatDateTime(dt));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, width: "100%", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span>{START_STR}Z</span>
        <span>{END_STR}Z</span>
      </div>

      <input
        type="range"
        min={0}
        max={totalHours}
        step={1}
        value={currentHours}
        onChange={handleInput}
        style={{ width: "100%" }}
      />

      <div style={{ textAlign: "center", fontSize: 12 }}>{value}Z</div>
    </div>
  );
}
