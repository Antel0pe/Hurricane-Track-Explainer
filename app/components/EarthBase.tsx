// EarthBase.tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import ThreeGlobe from 'three-globe';
import { fetchHurricaneAnalysis, fetchHurricaneBaseLatLon, HurricaneAnalysisEntry, HurricaneLayer, SteeringFlow, SteeringVec } from "../utils/apiResponses";

// 1) lat/lon -> world position on your globe (origin-centered)
function latLonToVec3(latDeg: number, lonDeg: number, radius: number, lonOffsetDeg = 270, latOffsetDeg = 0) {
    const lat = THREE.MathUtils.degToRad(latDeg + latOffsetDeg);
    const lon = THREE.MathUtils.degToRad(-(lonDeg + lonOffsetDeg)); // inverting for threejs coord system
    const x = radius * Math.cos(lat) * Math.cos(lon);
    const y = radius * Math.sin(lat);
    const z = radius * Math.cos(lat) * Math.sin(lon);
    return new THREE.Vector3(x, y, z);
}

// 2) compute globe radius from the ThreeGlobe mesh
function getGlobeRadius(globe: THREE.Object3D) {
    const sphere = new THREE.Sphere();
    new THREE.Box3().setFromObject(globe).getBoundingSphere(sphere);
    return sphere.radius;
}

// 3) fly the camera to a given lat/lon
function lookAtLatLon(
    lat: number,
    lon: number,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    globe: THREE.Object3D,
    altitude = 0 // extra distance above surface, in world units
) {
    const R = getGlobeRadius(globe);
    const target = latLonToVec3(lat, lon, R);      // point on surface
    const normal = target.clone().normalize();

    // keep roughly the same viewing distance unless you specify altitude
    const keepDist = camera.position.distanceTo(controls.target);
    const dist = altitude > 0 ? altitude : keepDist;

    const newPos = normal.clone().multiplyScalar(R + dist);

    // snap (or tween if you prefer)
    controls.target.copy(target);
    camera.position.copy(newPos);
    camera.lookAt(controls.target);
    controls.update();
}

type Props = {
    timestamp: string
};

export default function HeightMesh_Shaders({ timestamp }: Props) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const globeRef = useRef<ThreeGlobe | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const sunRef = useRef<THREE.DirectionalLight | null>(null);
    const roRef = useRef<ResizeObserver | null>(null);
    const [engineReady, setEngineReady] = useState(false);

    const hurricaneMeshRef = useRef<THREE.Mesh | null>(null);
    const hurricaneRingsRef = useRef<THREE.Group | null>(null);
    const hurricaneArrowsRef = useRef<THREE.Group | null>(null);


    const render = useCallback(() => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) return;

        renderer.render(scene, camera);
    }, []);

    useEffect(() => {
        const host = hostRef.current!;
        const getSize = () => {
            const r = host.getBoundingClientRect();
            return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
        };
        const { w, h } = getSize();

        // --- renderer / scene / camera ---
        const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2 });
        renderer.autoClear = false;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
        renderer.setSize(w, h);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b0c10);

        const globe = new ThreeGlobe()
            .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-day.jpg');
        globeRef.current = globe;
        scene.add(globe);

        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1e9);
        camera.up.set(0, 1, 0);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        // let three globe load in
        camera.position.set(0, -300, 150);  // any non-zero radius > 100 works
        controls.target.set(0, 0, 0);
        controls.update();
        renderer.render(scene, camera);

        lookAtLatLon(25, -65, camera, controls, globe, 100);

        scene.add(new THREE.AmbientLight(0xffffff, 2));
        const sun = null;
        // const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        // sun.position.set(1.5, 1.0, 2.0).multiplyScalar(1000);
        // scene.add(sun);

        // --- render-on-demand (guarded; no recursive re-entry) ---
        let rafId: number | null = null;

        // ===== Hover-to-rotate (no mousedown) with light inertia =====
        controls.enableRotate = false; // avoid built-in drag rotation (we'll do it)
        controls.minPolarAngle = 0.0001;
        controls.maxPolarAngle = Math.PI - 0.0001;
        controls.minAzimuthAngle = -Infinity;
        controls.maxAzimuthAngle = Infinity;

        // Helper: recompute local frame, build F/R, make quaternion, and log
        function previewCameraOrientationFromYawPitch(yaw: number, pitch: number) {
            // 1) Local frame at current camera position
            const U = new THREE.Vector3().copy(camera.position).sub(CENTER).normalize();
            const ref = Math.abs(U.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
            const E = new THREE.Vector3().crossVectors(ref, U).normalize();
            const N = new THREE.Vector3().crossVectors(U, E).normalize();

            // (a) pre-tilt base forward to effective band
            const N_p = new THREE.Vector3().copy(N).applyAxisAngle(E, pitch);

            // (b) yaw around gravity at that band
            const F = new THREE.Vector3().copy(N_p).applyAxisAngle(U, yaw);

            // 3) Build a no-roll basis *around* the pitched F (keep F as-is)
            const G = U; // gravity (local radial up)
            const R = new THREE.Vector3().copy(F).cross(G).normalize();     // sideways, level w.r.t gravity
            const U_cam = new THREE.Vector3().copy(R).cross(F).normalize(); // camera up, orthogonal to F & R

            // 4) Convert {R, U_cam, F} -> quaternion (camera looks down -Z, so Z = -F)
            const Z = new THREE.Vector3().copy(F).negate();
            const rot = new THREE.Matrix4().makeBasis(R, U_cam, Z);
            const qCam = new THREE.Quaternion().setFromRotationMatrix(rot);

            return { U, E, N, F, R, U_cam, qCam };
        }


        // ---- add this block: preview yaw/pitch from mouse, no camera change ----
        const elem = renderer.domElement;

        // --- pointer lock helpers ---
        function onPointerLockChange() {
            const locked = document.pointerLockElement === elem;

            // Visual hint
            elem.style.cursor = locked ? "none" : "grab";

            // Only track mouse when locked
            if (locked) {
                elem.addEventListener("mousemove", onMouseMove);
            } else {
                elem.removeEventListener("mousemove", onMouseMove);
            }
        }

        function onPointerLockError() {
            console.warn("[PointerLock] request failed (browser/permission)");
        }

        // Click to lock (or right after a key press if you prefer)
        function onCanvasClick(e: MouseEvent) {
            // optional: left button only
            if (e.button === 0) {
                // Required by some browsers: must be in a user gesture handler
                elem.requestPointerLock();
            }
        }

        // Optional: provide a manual release shortcut in addition to Esc
        function onReleaseKey(e: KeyboardEvent) {
            // Esc already works automatically; this is just a manual override on 'q'
            if (e.key.toLowerCase() === "q" && document.pointerLockElement === elem) {
                document.exitPointerLock();
            }
        }

        // Hook up events
        elem.addEventListener("click", onCanvasClick);
        document.addEventListener("pointerlockchange", onPointerLockChange);
        document.addEventListener("pointerlockerror", onPointerLockError);
        window.addEventListener("keydown", onReleaseKey);

        function onMouseMove(e: MouseEvent) {
            // 1) integrate yaw/pitch from mouse deltas (no frame-time scaling on purpose)
            const dx = e.movementX || 0;
            const dy = e.movementY || 0;
            yaw -= dx * MOUSE_SENS;
            pitch = THREE.MathUtils.clamp(pitch - dy * MOUSE_SENS, -PITCH_MAX, PITCH_MAX);

            // Build camera basis & quaternion from current yaw/pitch at THIS position
            const { F, U_cam, qCam } = previewCameraOrientationFromYawPitch(yaw, pitch);
            camera.up.copy(U_cam);
            // 1) Apply orientation
            camera.quaternion.copy(qCam);

            // 2) Keep OrbitControls happy: aim its target where we're looking
            controls.target.copy(camera.position).add(F);

        }

        // ------------------ WASD: walk by camera heading on the globe ------------------
        const CENTER = new THREE.Vector3(0, 0, 0);
        const pressed = new Set<string>();
        let moving = false;
        let lastT = performance.now();

        const SURFACE_SPEED = 200; // world units/sec along the surface

        // scratch
        const n = new THREE.Vector3();
        const fwdT = new THREE.Vector3();
        const rightT = new THREE.Vector3();
        const axis = new THREE.Vector3();
        const q = new THREE.Quaternion();

        // ---- add these: local tangent frame scratch ----
        const east = new THREE.Vector3();   // +longitude tangent
        const north = new THREE.Vector3();  // +latitude (toward N pole)
        const refAxis = new THREE.Vector3();// degeneracy helper near poles

        // ---- add these: mouse-look "state" and preview scratch ----
        let yaw = 0;                        // radians
        const PITCH_MAX = THREE.MathUtils.degToRad(89.99); // clamp so we never flip
        let pitch = -(PITCH_MAX - 1e-4);                      // radians
        const MOUSE_SENS = 0.002;           // radians per pixel (tune later)

        function onKeyDown(e: KeyboardEvent) {
            const k = e.key.toLowerCase();
            if ([" "].includes(k)) e.preventDefault();
            pressed.add(k);
            startMoveLoop();
        }

        function onKeyUp(e: KeyboardEvent) {
            pressed.delete(e.key.toLowerCase());
        }

        function startMoveLoop() {
            if (moving) return;
            moving = true;
            lastT = performance.now();

            const step = () => {
                if (!moving) return;
                if (pressed.size === 0) { moving = false; return; }

                const now = performance.now();
                const dt = Math.min(0.05, (now - lastT) / 1000);
                lastT = now;

                // local radial up at current spot
                n.copy(camera.position).sub(CENTER).normalize();

                // --- correct camera-space axes in world space ---
                const viewFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); // look dir
                const viewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);  // screen right

                // --- project them onto the local tangent plane (remove vertical along n) ---
                function tangentProject(v: THREE.Vector3, up: THREE.Vector3, out: THREE.Vector3) {
                    // out = v - (v·up) up
                    return out.copy(v).addScaledVector(up, -v.dot(up));
                }

                tangentProject(viewFwd, n, fwdT);
                tangentProject(viewRight, n, rightT);

                // normalize & guard degeneracies
                if (fwdT.lengthSq() < 1e-12) {
                    // if we're looking exactly radial, fall back to previous fwd or rebuild from right
                    fwdT.copy(rightT);
                }
                fwdT.normalize();

                if (rightT.lengthSq() < 1e-12) {
                    // rebuild right as tangent orthogonal to fwd
                    rightT.crossVectors(n, fwdT).normalize();
                } else {
                    rightT.normalize();
                }

                // combine keys into tangent direction
                const dir = new THREE.Vector3();
                if (pressed.has("w")) dir.add(fwdT);
                if (pressed.has("s")) dir.sub(fwdT);
                if (pressed.has("d")) dir.add(rightT);
                if (pressed.has("a")) dir.sub(rightT);

                // optional altitude: space up, shift down (purely radial)
                const radial = (pressed.has(" ") ? +1 : 0) + (pressed.has("shift") ? -1 : 0);

                let didMove = false;

                // walk the surface by rotating around axis = n × dir
                if (dir.lengthSq() > 1e-10) {
                    dir.normalize();
                    const R = camera.position.distanceTo(CENTER);
                    const angle = (SURFACE_SPEED / Math.max(1e-6, R)) * dt; // radians = arc/R
                    axis.crossVectors(n, dir).normalize();
                    q.setFromAxisAngle(axis, angle);
                    camera.position.sub(CENTER).applyQuaternion(q).add(CENTER);
                    didMove = true;
                }

                // altitude change (optional)
                if (radial !== 0) {
                    const climb = (SURFACE_SPEED * 0.5) * dt * radial;
                    const newPos = camera.position.clone().add(n.clone().multiplyScalar(climb));

                    const R = newPos.length();              // new radius from center
                    const Rmin = 115;                       // set your min altitude (world units)
                    const Rmax = 500;                      // set your max altitude

                    // clamp radius and reproject onto that sphere
                    const Rclamped = THREE.MathUtils.clamp(R, Rmin, Rmax);
                    camera.position.copy(newPos.normalize().multiplyScalar(Rclamped));

                    didMove = true;
                }

                if (didMove) {
                    // --- recompute local UP at the NEW position ---
                    n.copy(camera.position).sub(CENTER).normalize();

                    // --- build local tangent frame (EAST/NORTH) at this spot ---
                    // pick a stable reference axis to cross with UP; swap near poles to avoid tiny cross products
                    if (Math.abs(n.y) > 0.99) {
                        refAxis.set(1, 0, 0);  // near poles, use world X as reference
                    } else {
                        refAxis.set(0, 1, 0);  // otherwise, use world Y as reference
                    }
                    east.crossVectors(refAxis, n).normalize();   // E = normalize(ref × U)
                    north.crossVectors(n, east).normalize();     // N = normalize(U × E)


                    // Rebuild view from the SAME yaw/pitch at the NEW position
                    const { F, U_cam, qCam } = previewCameraOrientationFromYawPitch(yaw, pitch);
                    camera.up.copy(U_cam);
                    // 1) Apply orientation
                    camera.quaternion.copy(qCam);

                    // 2) Sync OrbitControls to this new forward
                    controls.target.copy(camera.position).add(F);
                    // console.log("camera.position.length() =", camera.position.length());
                }


                requestAnimationFrame(step);
            };

            requestAnimationFrame(step);
        }

        window.addEventListener("keydown", onKeyDown, { passive: false });
        window.addEventListener("keyup", onKeyUp);
        // ---------------- end WASD ----------------

        // Resize to parent
        const ro = new ResizeObserver(() => {
            const { w, h } = getSize();
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        });
        ro.observe(host);

        // Stash refs for reuse
        rendererRef.current = renderer;
        sceneRef.current = scene;
        cameraRef.current = camera;
        controlsRef.current = controls;
        sunRef.current = sun;
        roRef.current = ro;

        setEngineReady(true);

        // Cleanup
        return () => {
            setEngineReady(false);
            if (rafId != null) cancelAnimationFrame(rafId);
            ro.disconnect();
            controls.dispose();

            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);

            renderer.dispose();
            if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);

            // If still locked, release
            if (document.pointerLockElement === elem) document.exitPointerLock();

            elem.removeEventListener("click", onCanvasClick);
            document.removeEventListener("pointerlockchange", onPointerLockChange);
            document.removeEventListener("pointerlockerror", onPointerLockError);
            window.removeEventListener("keydown", onReleaseKey);
            elem.removeEventListener("mousemove", onMouseMove);
        };
    }, []);

    useEffect(() => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;

        if (!renderer || !scene || !camera || !controls) return;

        let running = true;

        const loop = () => {
            if (!running) return;

            // stash viewport/scissor once
            const prevViewport = new THREE.Vector4();
            const prevScissor = new THREE.Vector4();
            const prevScissorTest = renderer.getScissorTest();
            renderer.getViewport(prevViewport);
            renderer.getScissor(prevScissor);

            // restore viewport/scissor exactly
            renderer.setViewport(prevViewport.x, prevViewport.y, prevViewport.z, prevViewport.w);
            renderer.setScissor(prevScissor.x, prevScissor.y, prevScissor.z, prevScissor.w);
            renderer.setScissorTest(prevScissorTest);

            controls.update();
            // renderer.render(scene, camera);
            render();

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
        return () => { running = false; };

    }, [engineReady]);



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

        demo(sceneRef.current, timestamp)
            .then(({ mesh, layerRings, arrows }) => {
                if (cancelled) {
                    // if we were already cleaned up, remove immediately
                    mesh.removeFromParent();
                    layerRings.removeFromParent();
                    arrows.removeFromParent();
                    return;
                }
                createdMesh = mesh;
                createdRings = layerRings;
                createdArrows = arrows;


                hurricaneMeshRef.current = mesh;
                hurricaneRingsRef.current = layerRings;
                hurricaneArrowsRef.current = arrows;
            })
            .catch(console.error);

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

    // Fill parent, not window
    return <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
        {engineReady && (
            <></>
        )}
    </div>;
}