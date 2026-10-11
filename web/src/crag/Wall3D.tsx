import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildScene, type SceneLine } from "@/crag/scene";
import { useRouteKind } from "@/lib/routeKind";
import {
  buildSurface,
  decodeClasses,
  decodeDepth,
  depthToZ,
  linePoints3D,
  pointOnSurface,
  type Surface,
} from "@/crag/surface";
import { IDENTITY } from "@/crag/view";
import { createHologramMaterial, createPhotoMaterial, usePhoto } from "@/crag/wall3dMaterials";
import type { RouteOut, WallOut } from "@/lib/api";
import { useTheme } from "@/lib/theme";

export type Look = "holo" | "photo";

export interface Wall3DProps {
  wall: WallOut;
  routes: Map<number, RouteOut>;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onSelectRoute: (routeId: number | null) => void;
  onHoverRoute: (routeId: number | null) => void;
  look: Look;
  /** Relief as a fraction of the model width. */
  relief: number;
  /** Depth or segmentation could not be loaded — the viewer falls back to 2D. */
  onFail: () => void;
}

const WIDTH = { normal: 3, dim: 2.5, muted: 2.5, hover: 5, selected: 6 } as const;
const OPACITY = { normal: 1, dim: 0.35, muted: 0.3, hover: 1, selected: 1 } as const;
/** buildScene works in pixels; a 1000×1000 "photo" gives coordinates that divide back to 0–1. */
const UNIT = 1000;
/** A click that moved the pointer further than this (px) was a rotation, not a choice. */
const CLICK_SLOP = 5;
/** Extra distance from the rock per paint layer (fraction of the model width): overlapping lines never z-fight. */
const LAYER_LIFT = 0.0015;

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.arrayBuffer();
}

function useSurface(wall: WallOut, onFail: () => void): Surface | null {
  const [surface, setSurface] = useState<Surface | null>(null);
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wall.depth_url) throw new Error("brak mapy głębi");
      const depth = decodeDepth(await fetchBuffer(wall.depth_url));
      const classes = wall.segments_url ? decodeClasses(await fetchBuffer(wall.segments_url), depth.width, depth.height) : null;
      if (!cancelled) setSurface(buildSurface(depth, classes));
    })().catch(() => {
      if (!cancelled) failRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [wall.depth_url, wall.segments_url]);
  return surface;
}

function SurfaceMesh({ surface, relief, material }: { surface: Surface; relief: number; material: THREE.Material }) {
  const geometry = useMemo(() => {
    const count = surface.depth.length;
    const positions = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      positions[3 * k] = surface.positionsXY[2 * k];
      positions[3 * k + 1] = surface.positionsXY[2 * k + 1];
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    result.setAttribute("uv", new THREE.BufferAttribute(surface.uvs, 2));
    result.setAttribute("depth", new THREE.BufferAttribute(surface.depth, 1));
    result.setAttribute("cls", new THREE.BufferAttribute(surface.cls, 1));
    result.setIndex(new THREE.BufferAttribute(surface.index, 1));
    return result;
  }, [surface]);

  useEffect(() => {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < surface.depth.length; k++) position.setZ(k, depthToZ(surface.depth[k], surface, relief));
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }, [geometry, surface, relief]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} />;
}

/** Frames what is drawn (rock and ground, not the removed sky), whatever the container's shape. */
export function FitCamera({ surface }: { surface: Surface }) {
  const { camera, size, controls } = useThree();
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k of surface.index) {
      const x = surface.positionsXY[2 * k], y = surface.positionsXY[2 * k + 1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return Number.isFinite(minX)
      ? { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY }
      : { cx: 0, cy: 0, width: surface.width, height: surface.height };
  }, [surface]);
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    const distance = 1.1 * Math.max(bounds.height / (2 * halfTan), bounds.width / (2 * halfTan * aspect));
    perspective.position.set(bounds.cx, bounds.cy, distance);
    perspective.updateProjectionMatrix();
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (orbit) {
      orbit.target.set(bounds.cx, bounds.cy, 0);
      orbit.update();
    } else perspective.lookAt(bounds.cx, bounds.cy, 0);
  }, [camera, controls, size.width, size.height, bounds]);
  return null;
}

/** A route number as a sprite drawn on a small canvas: always faces the camera and keeps its size on screen. */
function RouteNumber({ position, layer, text, fill, textColor, opacity, handlers }: {
  position: [number, number, number];
  layer: number;
  text: string;
  fill: string;
  textColor: string;
  opacity: number;
  handlers: object;
}) {
  const { size, camera } = useThree();
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(32, 32, 29, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.font = "600 30px 'IBM Plex Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 32, 34);
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }, [text, fill, textColor]);
  useEffect(() => () => texture.dispose(), [texture]);
  // With sizeAttenuation off, scale is in view units per unit of distance: 22 px on screen whatever the zoom.
  const fov = (camera as THREE.PerspectiveCamera).fov;
  const scale = (22 * 2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / Math.max(1, size.height);
  return (
    <sprite position={position} scale={[scale, scale, 1]} renderOrder={10 + layer} {...handlers}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent opacity={opacity} />
    </sprite>
  );
}

export function RouteLines({ items, surface, relief, onChoose, onHoverRoute }: {
  items: SceneLine[];
  surface: Surface;
  relief: number;
  onChoose: (routeId: number | null) => void;
  onHoverRoute: (routeId: number | null) => void;
}) {
  const unit = (values: number[]) => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < values.length; i += 2) points.push({ x: values[i] / UNIT, y: values[i + 1] / UNIT });
    return points;
  };
  return (
    <>
      {items.map((item) => {
        const lift = LAYER_LIFT * item.layer;
        const flat = linePoints3D(unit(item.points), surface, relief, 2, 0.004 + lift);
        if (flat.length < 6) return null;
        const points: [number, number, number][] = [];
        for (let i = 0; i < flat.length; i += 3) points.push([flat[i], flat[i + 1], flat[i + 2]]);
        const handlers = {
          onClick: (event: { delta: number; stopPropagation: () => void }) => {
            event.stopPropagation();
            if (event.delta <= CLICK_SLOP) onChoose(item.routeId);
          },
          onPointerOver: () => onHoverRoute(item.routeId),
          onPointerOut: () => onHoverRoute(null),
        };
        return (
          <group key={item.lineId}>
            <Line points={points} color={item.color} lineWidth={WIDTH[item.emphasis]} transparent opacity={OPACITY[item.emphasis]} renderOrder={item.layer} />
            {/* Invisible wide copy: a 3 px line is too hard to hit. */}
            <Line points={points} color={item.color} lineWidth={18} transparent opacity={0} depthWrite={false} {...handlers} />
            {item.marks.map((mark, index) => (
              <mesh key={index} renderOrder={item.layer} position={pointOnSurface({ x: mark.x / UNIT, y: mark.y / UNIT }, surface, relief, 0.006 + lift)}>
                <sphereGeometry args={[mark.kind === "stanowisko" ? 0.009 : 0.006, 12, 8]} />
                <meshBasicMaterial color={mark.kind === "stanowisko" ? item.color : "#ffffff"} transparent opacity={OPACITY[item.emphasis]} />
              </mesh>
            ))}
            {item.label && (
              <RouteNumber
                position={pointOnSurface({ x: item.label.x / UNIT, y: item.label.y / UNIT }, surface, relief, 0.012 + lift)}
                layer={item.layer}
                text={item.label.text}
                fill={item.label.fill}
                textColor={item.label.textColor}
                opacity={OPACITY[item.emphasis]}
                handlers={handlers}
              />
            )}
          </group>
        );
      })}
    </>
  );
}

/** The wall as a 2.5D model: rock cut out of its background, routes lying on the surface. */
export default function Wall3D({ wall, routes, selectedRouteId, hoveredRouteId, onSelectRoute, onHoverRoute, look, relief, onFail }: Wall3DProps) {
  const { theme } = useTheme();
  const surface = useSurface(wall, onFail);
  const photo = usePhoto(wall.image_url, look === "photo");
  const hologram = useMemo(() => createHologramMaterial(wall.rock_color, wall.ground_color), [wall.rock_color, wall.ground_color]);
  const { kind } = useRouteKind();
  const photoMaterial = useMemo(() => (photo ? createPhotoMaterial(photo) : null), [photo]);
  useEffect(() => () => hologram.dispose(), [hologram]);
  useEffect(() => () => photoMaterial?.dispose(), [photoMaterial]);
  const items = useMemo(
    () =>
      buildScene({
        wall, routes, theme, selectedRouteId, hoveredRouteId, kind,
        image: { width: UNIT, height: UNIT }, container: { width: UNIT, height: UNIT }, view: IDENTITY,
      }),
    [wall, routes, theme, selectedRouteId, hoveredRouteId, kind],
  );
  const down = useRef<{ x: number; y: number } | null>(null);

  const choose = (routeId: number | null) => {
    if (routeId === null) return;
    onSelectRoute(routeId === selectedRouteId ? null : routeId);
  };

  if (!surface) {
    return <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Wczytywanie modelu 2.5D…</p>;
  }
  return (
    <Canvas
      aria-label="Model 2.5D ściany"
      camera={{ fov: 40, near: 0.01, far: 100, position: [0, 0, 2.6] }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{ cursor: hoveredRouteId !== null ? "pointer" : "grab" }}
      onPointerDown={(event) => (down.current = { x: event.clientX, y: event.clientY })}
      onPointerMissed={(event) => {
        const start = down.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_SLOP) onSelectRoute(null);
      }}
    >
      <FitCamera surface={surface} />
      <SurfaceMesh surface={surface} relief={relief} material={look === "photo" && photoMaterial ? photoMaterial : hologram} />
      <RouteLines items={items} surface={surface} relief={relief} onChoose={choose} onHoverRoute={onHoverRoute} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minAzimuthAngle={-Math.PI / 6}
        maxAzimuthAngle={Math.PI / 6}
        minPolarAngle={Math.PI / 2 - Math.PI / 9}
        maxPolarAngle={Math.PI / 2 + Math.PI / 9}
        minDistance={0.5}
        maxDistance={6}
      />
    </Canvas>
  );
}
