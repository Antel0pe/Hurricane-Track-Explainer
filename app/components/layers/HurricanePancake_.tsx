import { HurricaneLayer, SteeringFlow, SteeringVec, HurricaneAnalysisEntry, fetchHurricaneBaseLatLon, fetchHurricaneAnalysis } from "@/app/utils/apiResponses";
import { latLonToVec3 } from "@/app/utils/earthUtils";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useEarthLayer } from "./EarthBase";

type Props = {

};

export default function HurricanePancake({ }: Props) {
    const { engineReady, sceneRef, globeRef, timestamp, signalReady } = useEarthLayer('hurricane-pancake');
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
        baseLat: number; // 14.3
        baseLon: number; // -77.4
        layers: HurricaneLayer[]; // your 1..10 entries
        steeringFlow: SteeringFlow,
        scene?: THREE.Scene; // optional: if you want to auto-add
    }) {
        const { baseLat, baseLon, layers, scene, steeringFlow } = params;
        let R = 100;

        // ----------------------------
        // Clearly-defined constants
        // ----------------------------

        // Vertical spacing between consecutive layers (world units).
        // Interpret as “constant distance between pancakes”.
        const LAYER_SPACING = R * 0.01;

        // Convert your (x,y) offsets into lat/lon degree offsets.
        // offY -> latitude delta, offX -> longitude delta
        const OFFSET_LAT_DEG_PER_UNIT = 0.15;
        const OFFSET_LON_DEG_PER_UNIT = 0.15;

        // Convert your "value" into a horizontal ring radius (world units).
        // If your values are 0..10-ish, this gives something visually reasonable.
        const EXTENT_RADIUS_PER_VALUE = R * 0.0001;

        // How smooth each ring is.
        const SEGMENTS = 64;

        // Optional: lift the whole structure off the globe slightly so it doesn't z-fight.
        const BASE_CLEARANCE = 0.001;
        // ----------------------------
        // Build vertex positions
        // ----------------------------

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

            // Center of this layer on the sphere shell
            const center = latLonToVec3(layerLat, layerLon, layerRadius);
            const { east, north } = tangentFrame(center);

            // Horizontal extent -> ring radius in world units
            const ringRadius = Math.max(0.0001, value * EXTENT_RADIUS_PER_VALUE);

            for (let k = 0; k < SEGMENTS; k++) {
                const t = (k / SEGMENTS) * Math.PI * 2;

                // Start with a tangent-plane circle around the center
                const offset = east.clone().multiplyScalar(Math.cos(t) * ringRadius)
                    .add(north.clone().multiplyScalar(Math.sin(t) * ringRadius));

                const p = center.clone().add(offset);

                // Project back to the spherical shell at this layerRadius
                p.normalize().multiplyScalar(layerRadius);

                const idx = (i * SEGMENTS + k) * 3;
                positions[idx + 0] = p.x;
                positions[idx + 1] = p.y;
                positions[idx + 2] = p.z;
            }
        }

        // ----------------------------
        // Build indices that stitch layers
        // ----------------------------

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

                // Two triangles per quad. Winding chosen to generally face outward.
                indices[w++] = a; indices[w++] = c; indices[w++] = b;
                indices[w++] = b; indices[w++] = c; indices[w++] = d;
            }
        }

        // ----------------------------
        // Geometry + material
        // ----------------------------

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
        mesh.name = 'hurricane-mesh'
        mesh.frustumCulled = false; // optional: avoids popping if bounding sphere is weird


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

        // tiny lift for the lines so they don’t z-fight with the surface
        const LINE_LIFT = R * 0.0002;

        for (let i = 0; i < layerCount; i++) {
            // Extract this layer’s ring vertices from the big `positions` array
            const ringPos = new Float32Array(SEGMENTS * 3);

            for (let k = 0; k < SEGMENTS; k++) {
                const src = (i * SEGMENTS + k) * 3;
                const x = positions[src + 0];
                const y = positions[src + 1];
                const z = positions[src + 2];

                // Nudge outward along radial direction (from origin)
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
            loop.renderOrder = 10; // render after the translucent mesh
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
            // u = eastward, v = northward
            const dir = east.clone().multiplyScalar(u_ms).add(north.clone().multiplyScalar(v_ms));

            // handle near-zero vector gracefully
            if (dir.lengthSq() < 1e-12) return up.clone();

            dir.normalize();
            if (tiltUp !== 0) dir.addScaledVector(up, tiltUp).normalize();
            return dir;
        }

        function addSteeringArrowAtLayer(
            label: "low" | "mid" | "high",
            vec: SteeringVec,
            pressureLevel: number,
            color: number
        ) {
            // 1) find the layer index for this pressure level
            const i = layers.findIndex((L) => L.level === pressureLevel);
            // if (i < 0) return null; // level missing at this hour

            // 2) compute that layer's center (same as your mesh loop)
            const { offX, offY } = layers[i];

            const dLat = offY * OFFSET_LAT_DEG_PER_UNIT;
            const dLon = offX * OFFSET_LON_DEG_PER_UNIT;

            const layerLat = baseLat + dLat;
            const layerLon = baseLon + dLon;

            const layerRadius = R + BASE_CLEARANCE + i * LAYER_SPACING;
            const center = latLonToVec3(layerLat, layerLon, layerRadius);

            const { east, north } = tangentFrame(center);
            const up = center.clone().normalize();

            // 3) direction from uv (u=east, v=north)
            const dir = localDirFromUV(vec.u_ms, vec.v_ms, east, north, up, 0.12);

            // 4) place arrow slightly offset from center
            // const arrowPos = center.clone().addScaledVector(dir, R * 0.02);
            // pick a point on the ring (use ring vertex aligned with dir in tangent plane)
            let bestK = 0;
            let bestDot = -Infinity;

            for (let k = 0; k < SEGMENTS; k++) {
                const src = (i * SEGMENTS + k) * 3;
                const p = new THREE.Vector3(
                    positions[src + 0],
                    positions[src + 1],
                    positions[src + 2],
                );

                // direction from center to ring point (radially outward in tangent plane)
                const radialOnRing = p.clone().sub(center).normalize();
                const d = radialOnRing.dot(dir); // alignment with steering dir
                if (d > bestDot) {
                    bestDot = d;
                    bestK = k;
                }
            }

            // start arrow at the *outer edge* of the ring, lifted like your ring lines
            const src = (i * SEGMENTS + bestK) * 3;
            const ringPoint = new THREE.Vector3(
                positions[src + 0],
                positions[src + 1],
                positions[src + 2],
            );

            const arrowPos = ringPoint
                .clone()
                .normalize()
                .multiplyScalar(ringPoint.length() + LINE_LIFT);

            // 5) scale length by speed (optional)
            const speed = Math.hypot(vec.u_ms, vec.v_ms);
            const baseLen = R * 0.06;
            const arrowLen = baseLen * (0.5 + Math.min(speed / 20, 1.5));

            const ah = new THREE.ArrowHelper(
                dir,
                arrowPos,
                arrowLen,
                color,
                arrowLen * 0.25,
                arrowLen * 0.12
            );

            ah.name = `steering-${label}-${pressureLevel}`;
            ah.renderOrder = 20;
            ah.frustumCulled = false;
            // scene?.add(ah);

            return ah;
        }

        // usage:
        const arrows = new THREE.Group();
        arrows.name = "steering-arrows";

        arrows.add(addSteeringArrowAtLayer("low", steeringFlow.low, STEER_LAYER.low, 0xff0000));
        arrows.add(addSteeringArrowAtLayer("mid", steeringFlow.mid, STEER_LAYER.mid, 0x00ff00));
        arrows.add(addSteeringArrowAtLayer("high", steeringFlow.high, STEER_LAYER.high, 0x0000ff));


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
            .sort((a, b) => b - a); // descending: 850 -> 250

        const layers: HurricaneLayer[] = [];

        for (const lvl of levelsDesc) {
            const rec = levelsObj[String(lvl)];
            if (!rec || rec.exists !== true) continue;

            const [dLonDeg, dLatDeg] = rec.offsetCenter;

            layers.push({
                level: lvl,
                offX: dLonDeg,               // lon offset
                offY: dLatDeg,               // lat offset
                value: rec.horizontalRadius, // km
            });
        }

        return layers;
    }


    async function demo(scene: THREE.Scene, timestamp: string) {
        const [{ lat, lon }, analysis] = await Promise.all([
            fetchHurricaneBaseLatLon(timestamp),
            fetchHurricaneAnalysis(timestamp),
        ]);

        const layers = analysisToLayers(analysis);

        return buildHurricaneStackMesh({
            baseLat: lat,
            baseLon: lon,
            layers,
            scene,
            steeringFlow: analysis.steering_flow,
        });
    }

    useEffect(() => {
        if (!sceneRef.current || !globeRef.current) return;

        let cancelled = false;

        // track what THIS effect invocation created
        let createdMesh: THREE.Mesh | null = null;
        let createdRings: THREE.Group | null = null;
        let createdArrows: THREE.Group | null = null;

        const ts = timestamp;


        demo(sceneRef.current, timestamp)
            .then(({ mesh, layerRings, arrows }) => {
                if (cancelled) {
                    // if we were already cleaned up, remove immediately
                    mesh.removeFromParent();
                    layerRings.removeFromParent();
                    arrows.removeFromParent();
                    signalReady(ts);
                    return;
                }
                createdMesh = mesh;
                createdRings = layerRings;
                createdArrows = arrows;


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

            // remove whatever THIS run created (works for StrictMode + timestamp changes)
            if (createdMesh) {
                createdMesh.removeFromParent();
                createdMesh.geometry.dispose();
                const m = createdMesh.material;
                if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
                else (m as THREE.Material).dispose();
                createdMesh = null;
            }

            if (createdRings) {
                createdRings.removeFromParent();
                createdRings.traverse((o: any) => {
                    o.geometry?.dispose?.();
                    const mat = o.material;
                    if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
                    else mat?.dispose?.();
                });
                createdRings.clear();
                createdRings = null;
            }

            if (createdArrows) {
                createdArrows.removeFromParent();
                createdArrows.traverse((o: any) => {
                    o.geometry?.dispose?.();
                    const mat = o.material;
                    if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
                    else mat?.dispose?.();
                });
                // optional: if it's a Group
                (createdArrows as any).clear?.();
                createdArrows = null;
            }

            // optional: clear refs if they still point at these objects
            if (hurricaneMeshRef.current === createdMesh) hurricaneMeshRef.current = null;
            if (hurricaneRingsRef.current === createdRings) hurricaneRingsRef.current = null;
            if (hurricaneArrowsRef.current === createdArrows) hurricaneArrowsRef.current = null;
        };
    }, [sceneRef.current, globeRef.current, timestamp]);

    return null;
}