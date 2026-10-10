import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildScene } from "@/crag/scene";
import { depthToZ, modelSize, solidIndex, type Surface } from "@/crag/surface";
import { IDENTITY } from "@/crag/view";
import { FitCamera, RouteLines, type Look } from "@/crag/Wall3D";
import { createHologramMaterial, createPhotoMaterial, usePhoto } from "@/crag/wall3dMaterials";
import type { RouteOut, WallOut } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Stroke, type Brush, type ModelGrid, type Patch } from "./grid";

export type ModelTool = "orbit" | Brush;

export interface ModelCanvasProps {
  grid: ModelGrid;
  /** Bumped after every change of the grid outside a running stroke (undo, redo, smooth…). */
  revision: number;
  wall: WallOut;
  routes: Map<number, RouteOut>;
  tool: ModelTool;
  /** Brush radius in grid cells. */
  brush: number;
  look: Look;
  relief: number;
  showRoutes: boolean;
  rockColor: string | null;
  groundColor: string | null;
  onStroke(patch: Patch): void;
}

/** buildScene works in pixels; a 1000×1000 "photo" gives coordinates that divide back to 0–1 (as in Wall3D). */
const UNIT = 1000;

/** The grid as a surface for the 2.5D view helpers (camera framing, routes lying on the model); shares its arrays. */
function surfaceOf(grid: ModelGrid): Surface {
  const size = modelSize(grid.rasterWidth, grid.rasterHeight);
  const nx = grid.gx + 1;
  const positionsXY = new Float32Array(grid.depth.length * 2);
  const uvs = new Float32Array(grid.depth.length * 2);
  for (let j = 0; j <= grid.gy; j++) {
    for (let i = 0; i <= grid.gx; i++) {
      const k = j * nx + i;
      positionsXY[2 * k] = (i / grid.gx - 0.5) * size.width;
      positionsXY[2 * k + 1] = (0.5 - j / grid.gy) * size.height;
      uvs[2 * k] = i / grid.gx;
      uvs[2 * k + 1] = 1 - j / grid.gy;
    }
  }
  return { gx: grid.gx, gy: grid.gy, ...size, depth: grid.depth, cls: grid.cls, positionsXY, uvs, index: solidIndex(grid.cls, grid.gx, grid.gy) };
}

function fullIndex(gx: number, gy: number): Uint32Array {
  const nx = gx + 1;
  const index = new Uint32Array(gx * gy * 6);
  let n = 0;
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const a = j * nx + i;
      index.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], n);
      n += 6;
    }
  }
  return index;
}

function ModelScene(props: ModelCanvasProps) {
  const { grid, revision, wall, routes, tool, brush, look, relief, showRoutes, rockColor, groundColor, onStroke } = props;
  const { theme } = useTheme();
  const surface = useMemo(() => surfaceOf(grid), [grid]);
  const { geometry, pick } = useMemo(() => {
    const count = grid.depth.length;
    const positions = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      positions[3 * k] = surface.positionsXY[2 * k];
      positions[3 * k + 1] = surface.positionsXY[2 * k + 1];
    }
    const position = new THREE.BufferAttribute(positions, 3);
    const uv = new THREE.BufferAttribute(surface.uvs, 2);
    const shown = new THREE.BufferGeometry();
    shown.setAttribute("position", position);
    shown.setAttribute("uv", uv);
    shown.setAttribute("depth", new THREE.BufferAttribute(grid.depth, 1));
    shown.setAttribute("cls", new THREE.BufferAttribute(grid.cls, 1));
    // Brushes hit the whole grid, erased places included, so they can be painted back.
    const hits = new THREE.BufferGeometry();
    hits.setAttribute("position", position);
    hits.setAttribute("uv", uv);
    hits.setIndex(new THREE.BufferAttribute(fullIndex(grid.gx, grid.gy), 1));
    return { geometry: shown, pick: hits };
  }, [grid, surface]);
  useEffect(
    () => () => {
      geometry.dispose();
      pick.dispose();
    },
    [geometry, pick],
  );

  // Writes the grid into the geometry: heights, classes and the triangles of rock and ground.
  const reliefRef = useRef(relief);
  const refresh = useMemo(
    () => () => {
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < grid.depth.length; k++) position.setZ(k, depthToZ(grid.depth[k], surface, reliefRef.current));
      position.needsUpdate = true;
      geometry.getAttribute("depth").needsUpdate = true;
      geometry.getAttribute("cls").needsUpdate = true;
      geometry.setIndex(new THREE.BufferAttribute(solidIndex(grid.cls, grid.gx, grid.gy), 1));
      geometry.computeVertexNormals();
      pick.computeBoundingSphere();
      pick.computeBoundingBox();
    },
    [geometry, pick, grid, surface],
  );
  useEffect(() => {
    reliefRef.current = relief;
    refresh();
  }, [refresh, relief, revision]);

  const photo = usePhoto(wall.image_url, look === "photo");
  const hologram = useMemo(() => createHologramMaterial(rockColor, groundColor), [rockColor, groundColor]);
  const photoMaterial = useMemo(() => (photo ? createPhotoMaterial(photo) : null), [photo]);
  useEffect(() => () => hologram.dispose(), [hologram]);
  useEffect(() => () => photoMaterial?.dispose(), [photoMaterial]);
  const hidden = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => hidden.dispose(), [hidden]);

  const items = useMemo(
    () =>
      showRoutes
        ? buildScene({ wall, routes, theme, selectedRouteId: null, hoveredRouteId: null, image: { width: UNIT, height: UNIT }, container: { width: UNIT, height: UNIT }, view: IDENTITY })
        : [],
    // revision: the routes lie on the edited model, so they follow every step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wall, routes, theme, showRoutes, revision],
  );

  // A drag of a brush: dabs change the grid at once (redrawn once per frame), the drag ends as one undo step.
  const stroke = useRef<Stroke | null>(null);
  const frame = useRef(0);
  // Fingers on the screen: a second one turns a brush drag into a pinch (zoom), so the stroke ends there.
  const touches = useRef(0);
  const dab = (event: ThreeEvent<PointerEvent>) => {
    if (!stroke.current || !event.uv || tool === "orbit" || touches.current > 1) return;
    stroke.current.apply(tool, Math.round(event.uv.x * grid.gx), Math.round((1 - event.uv.y) * grid.gy), brush);
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        refresh();
      });
    }
  };
  const end = () => {
    const patch = stroke.current?.finish() ?? null;
    stroke.current = null;
    if (patch) onStroke(patch);
  };
  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touches.current += 1;
      if (touches.current > 1) end();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType === "touch") touches.current = Math.max(0, touches.current - 1);
      end();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <>
      <FitCamera surface={surface} />
      <mesh geometry={geometry} material={look === "photo" && photoMaterial ? photoMaterial : hologram} />
      <mesh
        geometry={pick}
        material={hidden}
        onPointerDown={(event) => {
          // touches counts the fingers already down (the window listener runs after this): only the first one paints.
          if (tool === "orbit" || (event.nativeEvent.pointerType === "touch" && touches.current > 0)) return;
          event.stopPropagation();
          stroke.current = new Stroke(grid);
          dab(event);
        }}
        onPointerMove={dab}
      />
      {showRoutes && <RouteLines items={items} surface={surface} relief={relief} onChoose={() => {}} onHoverRoute={() => {}} />}
      <OrbitControls
        makeDefault
        enableRotate={tool === "orbit"} // brushes keep the zoom (wheel, pinch)
        enablePan={false}
        enableDamping
        minAzimuthAngle={-Math.PI / 6}
        maxAzimuthAngle={Math.PI / 6}
        minPolarAngle={Math.PI / 2 - Math.PI / 9}
        maxPolarAngle={Math.PI / 2 + Math.PI / 9}
        minDistance={0.3}
        maxDistance={6}
      />
    </>
  );
}

/** The 2.5D model being edited: brushes paint on it, the orbit tool turns it; both zoom. */
export function ModelCanvas(props: ModelCanvasProps) {
  return (
    <Canvas
      aria-label="Edytowany model 2.5D"
      camera={{ fov: 40, near: 0.01, far: 100, position: [0, 0, 2.6] }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      style={{ cursor: props.tool === "orbit" ? "grab" : "crosshair", touchAction: "none" }}
    >
      <ModelScene {...props} />
    </Canvas>
  );
}
