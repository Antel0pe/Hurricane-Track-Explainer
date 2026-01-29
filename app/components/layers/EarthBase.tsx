// EarthBase.tsx
"use client";
import { createContext, ReactNode, RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import ThreeGlobe from 'three-globe';
import { lookAtLatLon } from "../../utils/earthUtils";
import { time } from "console";

export type EarthEngine = {
    engineReady: boolean;

    hostRef: RefObject<HTMLDivElement | null>;
    rendererRef: RefObject<THREE.WebGLRenderer | null>;
    sceneRef: RefObject<THREE.Scene | null>;
    cameraRef: RefObject<THREE.PerspectiveCamera | null>;
    controlsRef: RefObject<OrbitControls | null>;
    globeRef: RefObject<ThreeGlobe | null>;

    timestamp: string;

    // readiness coordination
    registerLayer: (key: string) => void;
    unregisterLayer: (key: string) => void;
    signalLayerReady: (ts: string, key: string) => void;

    allLayersReady: boolean;
};

const EarthContext = createContext<EarthEngine | null>(null);

function useEarth() {
    const ctx = useContext(EarthContext);
    if (!ctx) throw new Error("useEarth must be used inside <EarthBase />");
    return ctx;
}

export function useEarthLayer(key: string) {
    const earth = useEarth();

    useEffect(() => {
        earth.registerLayer(key);
        return () => earth.unregisterLayer(key);
        }, [earth.registerLayer, earth.unregisterLayer, key]);

    const signalReady = useCallback(
        (ts: string) => earth.signalLayerReady(ts, key),
        [earth, key]
    );

    return { ...earth, signalReady };
}


type Props = {
    timestamp: string;
    onAllReadyChange?: (ready: boolean, timestamp: string) => void;
    children?: ReactNode;
};

export default function EarthBase({ timestamp, onAllReadyChange, children }: Props) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const globeRef = useRef<ThreeGlobe | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const sunRef = useRef<THREE.DirectionalLight | null>(null);
    const roRef = useRef<ResizeObserver | null>(null);
    const [engineReady, setEngineReady] = useState(false);
    const registeredLayersRef = useRef(new Set<string>());
    const readyLayersRef = useRef(new Set<string>());

    const [allLayersReady, setAllLayersReady] = useState(false);


    // recompute helper
    const recomputeAllReady = useCallback(() => {
        // don't claim readiness before engine/children are live
        if (!engineReady) {
            setAllLayersReady(false);
            return;
        }

        const reg = registeredLayersRef.current;
        const ready = readyLayersRef.current;

        // if no layers are registered, treat as ready
        let ok = true;
        for (const k of reg) {
            if (!ready.has(k)) { ok = false; break; }
        }
        setAllLayersReady(ok);
    }, [engineReady]);

    useEffect(() => {
        readyLayersRef.current.clear();
        recomputeAllReady();
    }, [timestamp, engineReady]);

    const registerLayer = useCallback((key: string) => {
        registeredLayersRef.current.add(key);
        recomputeAllReady();
    }, [recomputeAllReady]);

    const unregisterLayer = useCallback((key: string) => {
        registeredLayersRef.current.delete(key);
        readyLayersRef.current.delete(key);
        recomputeAllReady();
    }, [recomputeAllReady]);

    const signalLayerReady = useCallback((ts: string, key: string) => {
        if (ts !== timestamp) return;

        readyLayersRef.current.add(key);
        recomputeAllReady();
    }, [timestamp, recomputeAllReady]);

    useEffect(() => {
        onAllReadyChange?.(allLayersReady, timestamp);
    }, [allLayersReady, timestamp, onAllReadyChange]);



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

    const earthValue = useMemo(() => ({
        engineReady,
        hostRef,
        rendererRef,
        sceneRef,
        cameraRef,
        controlsRef,
        globeRef,
        timestamp,
        registerLayer,
        unregisterLayer,
        signalLayerReady,
        allLayersReady,
    }), [
        engineReady,
        timestamp,
        allLayersReady,
        registerLayer,
        unregisterLayer,
        signalLayerReady,
    ]);


    // Fill parent, not window
    return (
        <EarthContext.Provider value={earthValue}>
            <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
                {engineReady ? children : null}
            </div>
        </EarthContext.Provider>

    )
}