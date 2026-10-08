import type Konva from "konva";
import { useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, RegularPolygon, Stage, Text } from "react-konva";
import { buildScene, type SceneLine, type SceneMark } from "@/crag/scene";
import { clampView, IDENTITY, panBy, toScreen, zoomAt, type Point, type Size, type View } from "@/crag/view";
import type { RouteOut, WallOut } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface WallCanvasProps {
  image: HTMLImageElement;
  wall: WallOut;
  routes: Map<number, RouteOut>;
  size: Size;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onSelectRoute: (routeId: number | null) => void;
  onHoverRoute: (routeId: number | null) => void;
}

const WIDTH = { normal: 3, dim: 2.5, hover: 5, selected: 6 } as const;
const OPACITY = { normal: 1, dim: 0.35, hover: 1, selected: 1 } as const;
const HALO = "rgba(0,0,0,0.45)";
const WHEEL_STEP = 1.2;
/** Pointer travel (px) after which a gesture counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;

type KonvaEvent = Konva.KonvaEventObject<MouseEvent | TouchEvent>;

const center = (points: Point[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});
const spread = ([a, b]: Point[]) => Math.hypot(a.x - b.x, a.y - b.y);

function Mark({ mark, color }: { mark: SceneMark; color: string }) {
  const common = { x: mark.x, y: mark.y, listening: false };
  switch (mark.kind) {
    case "stanowisko":
      return <Circle {...common} radius={5} fill={color} stroke="#FFFFFF" strokeWidth={1.5} />;
    case "hak":
      return <RegularPolygon {...common} sides={3} radius={5} fill="#FFFFFF" stroke={color} strokeWidth={1.5} />;
    case "ucho":
      return <Circle {...common} radius={4} stroke="#FFFFFF" strokeWidth={2} />;
    case "ogranicznik":
      return <Rect x={mark.x - 6} y={mark.y - 1.5} width={12} height={3} fill="#FFFFFF" stroke={color} strokeWidth={1} listening={false} />;
    default:
      return <Circle {...common} radius={3.5} fill="#FFFFFF" stroke={color} strokeWidth={1.5} />;
  }
}

export function WallCanvas({ image, wall, routes, size, selectedRouteId, hoveredRouteId, onSelectRoute, onHoverRoute }: WallCanvasProps) {
  const { theme } = useTheme();
  const [rawView, setView] = useState<View>(IDENTITY);
  const view = clampView(rawView, size);
  const gesture = useRef<{ last: Point; spread: number | null; travel: number } | null>(null);
  const dragged = useRef(false);

  const imageSize = { width: image.naturalWidth || wall.image_width || 1, height: image.naturalHeight || wall.image_height || 1 };
  const scene = buildScene({ wall, routes, image: imageSize, container: size, view, theme, selectedRouteId, hoveredRouteId });
  const topLeft = toScreen({ x: 0, y: 0 }, imageSize, size, view);
  const bottomRight = toScreen({ x: 1, y: 1 }, imageSize, size, view);

  function pointsOf(event: KonvaEvent): Point[] {
    const stage = event.target.getStage();
    if (!stage) return [];
    if ("touches" in event.evt) {
      const rect = stage.container().getBoundingClientRect();
      return Array.from(event.evt.touches).map((touch) => ({ x: touch.clientX - rect.left, y: touch.clientY - rect.top }));
    }
    const pointer = stage.getPointerPosition();
    return pointer ? [pointer] : [];
  }

  function start(points: Point[]) {
    if (points.length === 0) return;
    gesture.current = { last: center(points), spread: points.length > 1 ? spread(points) : null, travel: 0 };
    dragged.current = false;
  }

  function move(event: KonvaEvent) {
    const state = gesture.current;
    const points = pointsOf(event);
    if (!state || points.length === 0) return;
    const mid = center(points);
    const dx = mid.x - state.last.x;
    const dy = mid.y - state.last.y;
    const ratio = state.spread !== null && points.length > 1 ? spread(points) / state.spread : 1;
    if (view.zoom > 1 || points.length > 1) event.evt.preventDefault();
    setView((current) => zoomAt(panBy(current, dx, dy, size), mid, ratio, size));
    state.travel += Math.hypot(dx, dy);
    if (state.travel > DRAG_THRESHOLD) dragged.current = true;
    state.last = mid;
    if (points.length > 1) state.spread = spread(points);
  }

  function end(event: KonvaEvent) {
    const remaining = pointsOf(event);
    if (remaining.length > 0) start(remaining);
    else gesture.current = null;
  }

  function chooseLine(routeId: number | null, event: Konva.KonvaEventObject<Event>) {
    event.cancelBubble = true;
    if (dragged.current || routeId === null) return;
    onSelectRoute(routeId === selectedRouteId ? null : routeId);
  }

  const lineHandlers = (item: SceneLine) => ({
    onClick: (event: Konva.KonvaEventObject<Event>) => chooseLine(item.routeId, event),
    onTap: (event: Konva.KonvaEventObject<Event>) => chooseLine(item.routeId, event),
    onMouseEnter: () => onHoverRoute(item.routeId),
    onMouseLeave: () => onHoverRoute(null),
  });

  const zoomButton = (factor: number) => setView((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, factor, size));

  return (
    <>
      <Stage
        width={size.width}
        height={size.height}
        style={{ cursor: hoveredRouteId !== null ? "pointer" : view.zoom > 1 ? "grab" : "default" }}
        onWheel={(event) => {
          event.evt.preventDefault();
          const pointer = event.target.getStage()?.getPointerPosition();
          if (pointer) setView((current) => zoomAt(current, pointer, event.evt.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, size));
        }}
        onMouseDown={(event) => start(pointsOf(event))}
        onMouseMove={(event) => {
          if (gesture.current) move(event);
        }}
        onMouseUp={() => {
          gesture.current = null;
        }}
        onMouseLeave={() => {
          gesture.current = null;
        }}
        onTouchStart={(event) => start(pointsOf(event))}
        onTouchMove={move}
        onTouchEnd={end}
        onClick={() => {
          if (!dragged.current) onSelectRoute(null);
        }}
        onTap={() => {
          if (!dragged.current) onSelectRoute(null);
        }}
        onDblClick={() => setView(IDENTITY)}
        onDblTap={() => setView(IDENTITY)}
      >
        <Layer>
          <KonvaImage image={image} x={topLeft.x} y={topLeft.y} width={bottomRight.x - topLeft.x} height={bottomRight.y - topLeft.y} />
          {scene.map((item) => (
            <Group key={item.lineId} opacity={OPACITY[item.emphasis]}>
              <Line points={item.points} stroke={HALO} strokeWidth={WIDTH[item.emphasis] + 3} tension={0.3} lineCap="round" lineJoin="round" listening={false} />
              <Line points={item.points} stroke={item.color} strokeWidth={WIDTH[item.emphasis]} tension={0.3} lineCap="round" lineJoin="round" hitStrokeWidth={18} {...lineHandlers(item)} />
              {item.marks.map((mark, index) => (
                <Mark key={index} mark={mark} color={item.color} />
              ))}
              {item.label && (
                <Group x={item.label.x} y={item.label.y} {...lineHandlers(item)}>
                  <Circle radius={11} fill={item.label.fill} stroke="#FFFFFF" strokeWidth={1.5} />
                  <Text text={item.label.text} fontFamily="IBM Plex Sans" fontStyle="600" fontSize={11} fill={item.label.textColor} width={22} height={22} offsetX={11} offsetY={11} align="center" verticalAlign="middle" />
                </Group>
              )}
            </Group>
          ))}
        </Layer>
      </Stage>
      <div className="absolute bottom-2 right-2 flex gap-1">
        {[
          { label: "Przybliż zdjęcie", text: "+", onClick: () => zoomButton(1.5) },
          { label: "Oddal zdjęcie", text: "−", onClick: () => zoomButton(1 / 1.5) },
          { label: "Całe zdjęcie", text: "⤢", onClick: () => setView(IDENTITY) },
        ].map((button) => (
          <button key={button.label} type="button" aria-label={button.label} title={button.label} onClick={button.onClick} className="size-8 rounded-md bg-background/90 text-sm font-semibold shadow-float hover:bg-background">
            {button.text}
          </button>
        ))}
      </div>
    </>
  );
}
