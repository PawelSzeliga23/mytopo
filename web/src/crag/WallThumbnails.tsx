import type { WallOut } from "@/lib/api";

export const wallLabel = (wall: WallOut, index: number) => wall.name ?? `Zdjęcie ${index + 1}`;

export function WallThumbnails({ walls, activeId, onSelect }: { walls: WallOut[]; activeId: number | null; onSelect: (wallId: number) => void }) {
  return (
    <div role="group" aria-label="Zdjęcia ścian" className="flex gap-2 overflow-x-auto pb-1">
      {walls.map((wall, index) => (
        <button
          key={wall.id}
          type="button"
          aria-pressed={wall.id === activeId}
          title={wallLabel(wall, index)}
          onClick={() => onSelect(wall.id)}
          className="h-16 w-20 shrink-0 overflow-hidden rounded-md border-2 border-transparent bg-secondary text-xs aria-pressed:border-brand"
        >
          {wall.thumb_url ? <img src={wall.thumb_url} alt={wallLabel(wall, index)} loading="lazy" className="size-full object-cover" /> : wallLabel(wall, index)}
        </button>
      ))}
    </div>
  );
}
