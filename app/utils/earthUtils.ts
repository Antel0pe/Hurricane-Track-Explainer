import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// 1) lat/lon -> world position on your globe (origin-centered)
export function latLonToVec3(latDeg: number, lonDeg: number, radius: number, lonOffsetDeg = 270, latOffsetDeg = 0) {
    const lat = THREE.MathUtils.degToRad(latDeg + latOffsetDeg);
    const lon = THREE.MathUtils.degToRad(-(lonDeg + lonOffsetDeg)); // inverting for threejs coord system
    const x = radius * Math.cos(lat) * Math.cos(lon);
    const y = radius * Math.sin(lat);
    const z = radius * Math.cos(lat) * Math.sin(lon);
    return new THREE.Vector3(x, y, z);
}

// 2) compute globe radius from the ThreeGlobe mesh
export function getGlobeRadius(globe: THREE.Object3D) {
    const sphere = new THREE.Sphere();
    new THREE.Box3().setFromObject(globe).getBoundingSphere(sphere);
    return sphere.radius;
}

// 3) fly the camera to a given lat/lon
export function lookAtLatLon(
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