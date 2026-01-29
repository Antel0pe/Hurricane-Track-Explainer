import {
  HurricaneLayer,
  SteeringFlow,
  SteeringVec,
  HurricaneAnalysisEntry,
  fetchHurricaneBaseLatLon,
  fetchHurricaneAnalysis,
} from "@/app/utils/apiResponses";
import { latLonToVec3 } from "@/app/utils/earthUtils";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useEarthLayer } from "./EarthBase";

type Props = {};

export default function HurricanePancake({}: Props) {
  const { engineReady, sceneRef, globeRef, timestamp, signalReady } = useEarthLayer("hurricane-pancake");
  const hurricaneMeshRef = useRef<THREE.Mesh | null>(null);
  const hurricaneRingsRef = useRef<THREE.Group | null>(null);
  const hurricaneArrowsRef = useRef<THREE.Group | null>(null);

  /**
   * Given a point on/near a sphere, build an orthonormal tangent frame:
   * - up: outward normal from globe center
   * - east/north: tangent directions
   */
  function tangentFrame(centerOnSphere: THREE.Vector3) {
    const up = centerOnSphere.clone().normalize();

    // pick a stable "worldUp" that won't be parallel to up
    const worldUp = Math.abs(up.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);

    const east = new THREE.Vector3().crossVectors(worldUp, up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();

    return { up, east, north };
  }

  /**
   * Build the “stack of pancakes but connected” mesh.
   * - Each layer i has its own center lat/lon (base + scaled offsets)
   * - Each layer i has its own horizontal extent (scaled value -> ring radius in world units)
   * - Each layer i is placed at radius (R + i * LAYER_SPACING)
   */
  function buildHurricaneStackMesh(params: {
    baseLat: number;
    baseLon: number;
    layers: HurricaneLayer[];
    steeringFlow: SteeringFlow;
    scene?: THREE.Scene;
  }) {
    const { baseLat, baseLon, layers, scene, steeringFlow } = params;
    let R = 100;

    const LAYER_SPACING = R * 0.01;
    const OFFSET_LAT_DEG_PER_UNIT = 0.15;
    const OFFSET_LON_DEG_PER_UNIT = 0.15;
    const EXTENT_RADIUS_PER_VALUE = R * 0.0001;
    const SEGMENTS = 64;
    const BASE_CLEARANCE = 0.001;

    const layerCount = layers.length;
    const vertsPerLayer = SEGMENTS;
    const positions = new Float32Array(layerCount * vertsPerLayer * 3);

    for (let i = 0; i < layerCount; i++) {
      const { offX, offY, value } = layers[i];

      const dLat = offY * OFFSET_LAT_DEG_PER_UNIT;
      const dLon = offX * OFFSET_LON_DEG_PER_UNIT;

      const layerLat = baseLat + dLat;
      const layerLon = baseLon + dLon;

      const layerRadius = R + BASE_CLEARANCE + i * LAYER_SPACING;

      const center = latLonToVec3(layerLat, layerLon, layerRadius);
      const { east, north } = tangentFrame(center);

      const ringRadius = Math.max(0.0001, value * EXTENT_RADIUS_PER_VALUE);

      for (let k = 0; k < SEGMENTS; k++) {
        const t = (k / SEGMENTS) * Math.PI * 2;

        const offset = east
          .clone()
          .multiplyScalar(Math.cos(t) * ringRadius)
          .add(north.clone().multiplyScalar(Math.sin(t) * ringRadius));

        const p = center.clone().add(offset);
        p.normalize().multiplyScalar(layerRadius);

        const idx = (i * SEGMENTS + k) * 3;
        positions[idx + 0] = p.x;
        positions[idx + 1] = p.y;
        positions[idx + 2] = p.z;
      }
    }

    const quads = (layerCount - 1) * SEGMENTS;
    const indices = new Uint32Array(quads * 6);

    let w = 0;
    for (let i = 0; i < layerCount - 1; i++) {
      const baseA = i * SEGMENTS;
      const baseB = (i + 1) * SEGMENTS;

      for (let k = 0; k < SEGMENTS; k++) {
        const k1 = (k + 1) % SEGMENTS;

        const a = baseA + k;
        const b = baseA + k1;
        const c = baseB + k;
        const d = baseB + k1;

        indices[w++] = a;
        indices[w++] = c;
        indices[w++] = b;
        indices[w++] = b;
        indices[w++] = c;
        indices[w++] = d;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      transparent: false,
      opacity: 1.0,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = "hurricane-mesh";
    mesh.frustumCulled = false;

    // layer rings
    const layerRings = new THREE.Group();
    layerRings.name = "hurricane-layer-rings";

    const ringMat = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    });

    const LINE_LIFT = R * 0.0002;

    for (let i = 0; i < layerCount; i++) {
      const ringPos = new Float32Array(SEGMENTS * 3);

      for (let k = 0; k < SEGMENTS; k++) {
        const src = (i * SEGMENTS + k) * 3;
        const x = positions[src + 0];
        const y = positions[src + 1];
        const z = positions[src + 2];

        const p = new THREE.Vector3(x, y, z);
        const lifted = p.clone().normalize().multiplyScalar(p.length() + LINE_LIFT);

        const dst = k * 3;
        ringPos[dst + 0] = lifted.x;
        ringPos[dst + 1] = lifted.y;
        ringPos[dst + 2] = lifted.z;
      }

      const ringGeom = new THREE.BufferGeometry();
      ringGeom.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));

      const loop = new THREE.LineLoop(ringGeom, ringMat);
      loop.renderOrder = 10;
      layerRings.add(loop);
    }

    const STEER_LAYER = { low: 750, mid: 550, high: 350 } as const;

    function localDirFromUV(
      u_ms: number,
      v_ms: number,
      east: THREE.Vector3,
      north: THREE.Vector3,
      up: THREE.Vector3,
      tiltUp = 0.10
    ) {
      const dir = east.clone().multiplyScalar(u_ms).add(north.clone().multiplyScalar(v_ms));
      if (dir.lengthSq() < 1e-12) return up.clone();
      dir.normalize();
      if (tiltUp !== 0) dir.addScaledVector(up, tiltUp).normalize();
      return dir;
    }

    function addSteeringArrowAtLayer(label: "low" | "mid" | "high", vec: SteeringVec, pressureLevel: number, color: number) {
      const i = layers.findIndex((L) => L.level === pressureLevel);
      if (i < 0) return null;

      const { offX, offY } = layers[i];

      const dLat = offY * OFFSET_LAT_DEG_PER_UNIT;
      const dLon = offX * OFFSET_LON_DEG_PER_UNIT;

      const layerLat = baseLat + dLat;
      const layerLon = baseLon + dLon;

      const layerRadius = R + BASE_CLEARANCE + i * LAYER_SPACING;
      const center = latLonToVec3(layerLat, layerLon, layerRadius);

      const { east, north } = tangentFrame(center);
      const up = center.clone().normalize();

      const dir = localDirFromUV(vec.u_ms, vec.v_ms, east, north, up, 0.12);

      let bestK = 0;
      let bestDot = -Infinity;

      for (let k = 0; k < SEGMENTS; k++) {
        const src = (i * SEGMENTS + k) * 3;
        const p = new THREE.Vector3(positions[src + 0], positions[src + 1], positions[src + 2]);

        const radialOnRing = p.clone().sub(center).normalize();
        const d = radialOnRing.dot(dir);
        if (d > bestDot) {
          bestDot = d;
          bestK = k;
        }
      }

      const src = (i * SEGMENTS + bestK) * 3;
      const ringPoint = new THREE.Vector3(positions[src + 0], positions[src + 1], positions[src + 2]);

      const arrowPos = ringPoint.clone().normalize().multiplyScalar(ringPoint.length() + LINE_LIFT);

      const speed = Math.hypot(vec.u_ms, vec.v_ms);
      const baseLen = R * 0.06;
      const arrowLen = baseLen * (0.5 + Math.min(speed / 20, 1.5));

      const ah = new THREE.ArrowHelper(dir, arrowPos, arrowLen, color, arrowLen * 0.25, arrowLen * 0.12);
      ah.name = `steering-${label}-${pressureLevel}`;
      ah.renderOrder = 20;
      ah.frustumCulled = false;

      return ah;
    }

    const arrows = new THREE.Group();
    arrows.name = "steering-arrows";

    const a1 = addSteeringArrowAtLayer("low", steeringFlow.low, STEER_LAYER.low, 0xff0000);
    const a2 = addSteeringArrowAtLayer("mid", steeringFlow.mid, STEER_LAYER.mid, 0x00ff00);
    const a3 = addSteeringArrowAtLayer("high", steeringFlow.high, STEER_LAYER.high, 0x0000ff);

    if (a1) arrows.add(a1);
    if (a2) arrows.add(a2);
    if (a3) arrows.add(a3);

    // store minimal constants needed for in-place updates
    mesh.userData.__hurricane = {
      R,
      LAYER_SPACING,
      OFFSET_LAT_DEG_PER_UNIT,
      OFFSET_LON_DEG_PER_UNIT,
      EXTENT_RADIUS_PER_VALUE,
      SEGMENTS,
      BASE_CLEARANCE,
      LINE_LIFT,
      layerCount,
    };

    if (scene) scene.add(mesh);
    if (scene) scene.add(arrows);
    if (scene) scene.add(layerRings);

    return { mesh, layerRings, arrows };
  }

  function analysisToLayers(analysis: HurricaneAnalysisEntry): HurricaneLayer[] {
    const levelsObj = analysis.levels;

    const levelsDesc = Object.keys(levelsObj)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);

    const layers: HurricaneLayer[] = [];

    for (const lvl of levelsDesc) {
      const rec = levelsObj[String(lvl)];
      if (!rec || rec.exists !== true) continue;

      const [dLonDeg, dLatDeg] = rec.offsetCenter;

      layers.push({
        level: lvl,
        offX: dLonDeg,
        offY: dLatDeg,
        value: rec.horizontalRadius,
      });
    }

    return layers;
  }

  async function demo(scene: THREE.Scene, ts: string) {
    const [{ lat, lon }, analysis] = await Promise.all([fetchHurricaneBaseLatLon(ts), fetchHurricaneAnalysis(ts)]);
    const layers = analysisToLayers(analysis);

    return buildHurricaneStackMesh({
      baseLat: lat,
      baseLon: lon,
      layers,
      scene,
      steeringFlow: analysis.steering_flow,
    });
  }

  // in-place update (reuses existing mesh/rings/arrows)
  function updateHurricaneObjects(params: {
    mesh: THREE.Mesh;
    layerRings: THREE.Group;
    arrows: THREE.Group;
    baseLat: number;
    baseLon: number;
    layers: HurricaneLayer[];
    steeringFlow: SteeringFlow;
  }) {
    const { mesh, layerRings, arrows, baseLat, baseLon, layers, steeringFlow } = params;
    const u = mesh.userData.__hurricane;
    if (!u) return;

    const {
      R,
      LAYER_SPACING,
      OFFSET_LAT_DEG_PER_UNIT,
      OFFSET_LON_DEG_PER_UNIT,
      EXTENT_RADIUS_PER_VALUE,
      SEGMENTS,
      BASE_CLEARANCE,
      LINE_LIFT,
      layerCount: existingLayerCount,
    } = u as {
      R: number;
      LAYER_SPACING: number;
      OFFSET_LAT_DEG_PER_UNIT: number;
      OFFSET_LON_DEG_PER_UNIT: number;
      EXTENT_RADIUS_PER_VALUE: number;
      SEGMENTS: number;
      BASE_CLEARANCE: number;
      LINE_LIFT: number;
      layerCount: number;
    };

    const layerCount = layers.length;

    // if topology differs, we cannot update in-place without also rebuilding indices + children counts
    if (layerCount !== existingLayerCount) {
      return;
    }

    const geom = mesh.geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    // recompute positions into existing array
    for (let i = 0; i < layerCount; i++) {
      const { offX, offY, value } = layers[i];

      const dLat = offY * OFFSET_LAT_DEG_PER_UNIT;
      const dLon = offX * OFFSET_LON_DEG_PER_UNIT;

      const layerLat = baseLat + dLat;
      const layerLon = baseLon + dLon;

      const layerRadius = R + BASE_CLEARANCE + i * LAYER_SPACING;

      const center = latLonToVec3(layerLat, layerLon, layerRadius);
      const { east, north } = tangentFrame(center);

      const ringRadius = Math.max(0.0001, value * EXTENT_RADIUS_PER_VALUE);

      for (let k = 0; k < SEGMENTS; k++) {
        const t = (k / SEGMENTS) * Math.PI * 2;

        const offset = east
          .clone()
          .multiplyScalar(Math.cos(t) * ringRadius)
          .add(north.clone().multiplyScalar(Math.sin(t) * ringRadius));

        const p = center.clone().add(offset);
        p.normalize().multiplyScalar(layerRadius);

        const idx = (i * SEGMENTS + k) * 3;
        posArray[idx + 0] = p.x;
        posArray[idx + 1] = p.y;
        posArray[idx + 2] = p.z;
      }
    }

    posAttr.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();

    // update rings (assumes one LineLoop per layer, same SEGMENTS)
    for (let i = 0; i < layerCount; i++) {
      const loop = layerRings.children[i] as THREE.LineLoop | undefined;
      if (!loop) continue;

      const ringGeom = loop.geometry as THREE.BufferGeometry;
      const ringPosAttr = ringGeom.getAttribute("position") as THREE.BufferAttribute;
      const ringPosArray = ringPosAttr.array as Float32Array;

      for (let k = 0; k < SEGMENTS; k++) {
        const src = (i * SEGMENTS + k) * 3;
        const x = posArray[src + 0];
        const y = posArray[src + 1];
        const z = posArray[src + 2];

        const p = new THREE.Vector3(x, y, z);
        const lifted = p.clone().normalize().multiplyScalar(p.length() + LINE_LIFT);

        const dst = k * 3;
        ringPosArray[dst + 0] = lifted.x;
        ringPosArray[dst + 1] = lifted.y;
        ringPosArray[dst + 2] = lifted.z;
      }

      ringPosAttr.needsUpdate = true;
      ringGeom.computeBoundingSphere();
    }

    // update arrows (assumes these three exist and names match)
    const STEER_LAYER = { low: 750, mid: 550, high: 350 } as const;

    function localDirFromUV(u_ms: number, v_ms: number, east: THREE.Vector3, north: THREE.Vector3, up: THREE.Vector3, tiltUp = 0.10) {
      const dir = east.clone().multiplyScalar(u_ms).add(north.clone().multiplyScalar(v_ms));
      if (dir.lengthSq() < 1e-12) return up.clone();
      dir.normalize();
      if (tiltUp !== 0) dir.addScaledVector(up, tiltUp).normalize();
      return dir;
    }

    function updateArrow(label: "low" | "mid" | "high", vec: SteeringVec, pressureLevel: number) {
      const ah = arrows.getObjectByName(`steering-${label}-${pressureLevel}`) as THREE.ArrowHelper | null;
      if (!ah) return;

      const i = layers.findIndex((L) => L.level === pressureLevel);
      if (i < 0) {
        ah.visible = false;
        return;
      }
      ah.visible = true;

      const { offX, offY } = layers[i];

      const dLat = offY * OFFSET_LAT_DEG_PER_UNIT;
      const dLon = offX * OFFSET_LON_DEG_PER_UNIT;

      const layerLat = baseLat + dLat;
      const layerLon = baseLon + dLon;

      const layerRadius = R + BASE_CLEARANCE + i * LAYER_SPACING;
      const center = latLonToVec3(layerLat, layerLon, layerRadius);

      const { east, north } = tangentFrame(center);
      const up = center.clone().normalize();

      const dir = localDirFromUV(vec.u_ms, vec.v_ms, east, north, up, 0.12);

      // pick ring vertex most aligned with dir
      let bestK = 0;
      let bestDot = -Infinity;

      for (let k = 0; k < SEGMENTS; k++) {
        const src = (i * SEGMENTS + k) * 3;
        const p = new THREE.Vector3(posArray[src + 0], posArray[src + 1], posArray[src + 2]);

        const radialOnRing = p.clone().sub(center).normalize();
        const d = radialOnRing.dot(dir);
        if (d > bestDot) {
          bestDot = d;
          bestK = k;
        }
      }

      const src = (i * SEGMENTS + bestK) * 3;
      const ringPoint = new THREE.Vector3(posArray[src + 0], posArray[src + 1], posArray[src + 2]);
      const arrowPos = ringPoint.clone().normalize().multiplyScalar(ringPoint.length() + LINE_LIFT);

      const speed = Math.hypot(vec.u_ms, vec.v_ms);
      const baseLen = R * 0.06;
      const arrowLen = baseLen * (0.5 + Math.min(speed / 20, 1.5));

      ah.position.copy(arrowPos);
      ah.setDirection(dir);
      ah.setLength(arrowLen, arrowLen * 0.25, arrowLen * 0.12);
    }

    updateArrow("low", steeringFlow.low, STEER_LAYER.low);
    updateArrow("mid", steeringFlow.mid, STEER_LAYER.mid);
    updateArrow("high", steeringFlow.high, STEER_LAYER.high);
  }

  async function fetchData(ts: string) {
    const [{ lat, lon }, analysis] = await Promise.all([fetchHurricaneBaseLatLon(ts), fetchHurricaneAnalysis(ts)]);
    return {
      baseLat: lat,
      baseLon: lon,
      layers: analysisToLayers(analysis),
      steeringFlow: analysis.steering_flow,
    };
  }

  // init once (create objects), dispose once on unmount
  useEffect(() => {
    if (!engineReady) return;
    if (!sceneRef.current || !globeRef.current) return;

    let cancelled = false;

    const scene = sceneRef.current;
    const ts = timestamp;

    demo(scene, ts)
      .then(({ mesh, layerRings, arrows }) => {
        if (cancelled) {
          mesh.removeFromParent();
          layerRings.removeFromParent();
          arrows.removeFromParent();

          // dispose immediately since we won't keep them
          mesh.geometry.dispose();
          const m = mesh.material;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else (m as THREE.Material).dispose();

          layerRings.traverse((o: any) => {
            o.geometry?.dispose?.();
            const mat = o.material;
            if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
            else mat?.dispose?.();
          });
          layerRings.clear();

          arrows.traverse((o: any) => {
            o.geometry?.dispose?.();
            const mat = o.material;
            if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
            else mat?.dispose?.();
          });
          (arrows as any).clear?.();

          signalReady(ts);
          return;
        }

        hurricaneMeshRef.current = mesh;
        hurricaneRingsRef.current = layerRings;
        hurricaneArrowsRef.current = arrows;

        signalReady(ts);
      })
      .catch((err) => {
        console.error(err);
        signalReady(ts);
      });

    return () => {
      cancelled = true;

      const mesh = hurricaneMeshRef.current;
      const rings = hurricaneRingsRef.current;
      const arrows = hurricaneArrowsRef.current;

      hurricaneMeshRef.current = null;
      hurricaneRingsRef.current = null;
      hurricaneArrowsRef.current = null;

      if (mesh) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else (m as THREE.Material).dispose();
      }

      if (rings) {
        rings.removeFromParent();
        rings.traverse((o: any) => {
          o.geometry?.dispose?.();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
          else mat?.dispose?.();
        });
        rings.clear();
      }

      if (arrows) {
        arrows.removeFromParent();
        arrows.traverse((o: any) => {
          o.geometry?.dispose?.();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
          else mat?.dispose?.();
        });
        (arrows as any).clear?.();
      }
    };
  }, [engineReady, sceneRef.current, globeRef.current]);

  // update on timestamp (reuse existing objects)
  useEffect(() => {
    if (!engineReady) return;
    if (!sceneRef.current || !globeRef.current) return;

    const mesh = hurricaneMeshRef.current;
    const rings = hurricaneRingsRef.current;
    const arrows = hurricaneArrowsRef.current;

    // if not initialized yet, init effect will create; we do nothing here
    if (!mesh || !rings || !arrows) return;

    let cancelled = false;
    const ts = timestamp;

    fetchData(ts)
      .then(({ baseLat, baseLon, layers, steeringFlow }) => {
        if (cancelled) return;

        // try in-place update
        updateHurricaneObjects({ mesh, layerRings: rings, arrows, baseLat, baseLon, layers, steeringFlow });

        // if the layerCount changed, we must rebuild (minimal necessary fallback)
        const u = mesh.userData.__hurricane;
        if (u && typeof u.layerCount === "number" && u.layerCount !== layers.length && sceneRef.current) {
          // remove + dispose old
          mesh.removeFromParent();
          rings.removeFromParent();
          arrows.removeFromParent();

          mesh.geometry.dispose();
          const m = mesh.material;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else (m as THREE.Material).dispose();

          rings.traverse((o: any) => {
            o.geometry?.dispose?.();
            const mat = o.material;
            if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
            else mat?.dispose?.();
          });
          rings.clear();

          arrows.traverse((o: any) => {
            o.geometry?.dispose?.();
            const mat = o.material;
            if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
            else mat?.dispose?.();
          });
          (arrows as any).clear?.();

          // build new and replace refs
          const built = buildHurricaneStackMesh({
            baseLat,
            baseLon,
            layers,
            scene: sceneRef.current,
            steeringFlow,
          });

          hurricaneMeshRef.current = built.mesh;
          hurricaneRingsRef.current = built.layerRings;
          hurricaneArrowsRef.current = built.arrows;
        }

        signalReady(ts);
      })
      .catch((err) => {
        console.error(err);
        signalReady(ts);
      });

    return () => {
      cancelled = true;
    };
  }, [engineReady, timestamp]);

  return null;
}
