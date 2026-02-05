"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useEarthLayer } from "./EarthBase"; // adjust path if needed
import { latLonToVec3 } from "@/app/utils/earthUtils"; // adjust path if needed
import { fetchNAJetLines, JetLinesEntry } from "@/app/utils/apiResponses";


type Props = {};

/**
 * Minimal layer:
 * - fetches "lines" from a constant URL (you will set it)
 * - draws each polyline on the globe, slightly lifted above the surface
 * - adds an arrowhead at the end of each polyline (direction = last segment)
 */
export default function ArrowLinesLayer({}: Props) {
  const { engineReady, sceneRef, timestamp, signalReady } = useEarthLayer("arrow-lines");

  const groupRef = useRef<THREE.Group | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // tweak these to match your globe radius / desired lift
  const R = 100;
  const HIGH_OFFSET = R * 0.02; // "high offset" lift above surface

  const lineMatRef = useRef(
    new THREE.LineBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    })
  );

  function clearGroup(g: THREE.Group) {
    // dispose geometries/materials we created
    g.traverse((obj: any) => {
      if (obj.geometry?.dispose) obj.geometry.dispose();
      // material disposal: we reuse lineMatRef, so don't dispose it here
      if (obj.material && obj.material !== lineMatRef.current) {
        if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m?.dispose?.());
        else obj.material?.dispose?.();
      }
    });
    g.clear();
  }

  function buildOnePolyline(latlon: Array<[number, number]>, radius: number) {
    if (latlon.length < 2) return null;

    const pts = latlon.map(([lat, lon]) => latLonToVec3(lat, lon, radius));
    const pos = new Float32Array(pts.length * 3);

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      pos[i * 3 + 0] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.computeBoundingSphere();

    const line = new THREE.Line(geom, lineMatRef.current);
    line.frustumCulled = false;
    line.renderOrder = 50;

    // Arrowhead: last segment direction
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const dir = b.clone().sub(a);

    if (dir.lengthSq() < 1e-12) return { line, arrow: null as THREE.Object3D | null };

    dir.normalize();

    // Arrow origin slightly *after* last point so it doesn't clip into the line
    const origin = b.clone().addScaledVector(b.clone().normalize(), R * 0.001);

    const arrowLen = R * 0.03;
    const headLen = arrowLen * 0.35;
    const headWidth = arrowLen * 0.18;

    const arrow = new THREE.ArrowHelper(dir, origin, arrowLen, 0xffcc00, headLen, headWidth);
    arrow.frustumCulled = false;
    arrow.renderOrder = 60;

    return { line, arrow };
  }

async function fetchLines(ts: string): Promise<JetLinesEntry> {
  abortRef.current?.abort();
  const ac = new AbortController();
  abortRef.current = ac;

  try {
    // Your API route expects datehour like "YYYY-MM-DDTHH:mm"
    // and returns { lines: ... } which matches ApiResp.
    return await fetchNAJetLines(ts);
  } catch (err: any) {
    // Preserve abort behavior
    if (err?.name === "AbortError") throw err;
    throw err;
  }
}


  // init group once
  useEffect(() => {
    if (!engineReady) return;
    if (!sceneRef.current) return;

    const g = new THREE.Group();
    g.name = "arrow-lines-group";
    g.frustumCulled = false;

    groupRef.current = g;
    sceneRef.current.add(g);

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;

      if (groupRef.current) {
        groupRef.current.removeFromParent();
        clearGroup(groupRef.current);
        groupRef.current = null;
      }

      // we created this material once, dispose on unmount
      lineMatRef.current.dispose();
    };
  }, [engineReady, sceneRef.current]);

  // fetch + draw whenever timestamp changes (or just once if your endpoint is static)
  useEffect(() => {
    if (!engineReady) return;
    if (!sceneRef.current) return;
    if (!groupRef.current) return;

    let cancelled = false;
    const ts = timestamp;

    fetchLines(ts)
      .then((data) => {
        if (cancelled) return;

        const g = groupRef.current!;
        clearGroup(g);

        const radius = R + HIGH_OFFSET;

        for (let i = 0; i < data.lines.length; i++) {
          const poly = data.lines[i];
          const built = buildOnePolyline(poly, radius);
          if (!built) continue;

          built.line.name = `arrow-line-${i}`;
          g.add(built.line);

          if (built.arrow) {
            built.arrow.name = `arrow-head-${i}`;
            g.add(built.arrow);
          }
        }

        signalReady(ts);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          signalReady(ts);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [engineReady, timestamp]);

  return null;
}
