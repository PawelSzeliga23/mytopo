import { Chip } from "@/components/Chip";
import { GradeBar } from "@/components/GradeBar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { countLabel, DROGI, SKALY } from "@/lib/plural";
import { useIsDesktop } from "@/lib/useMediaQuery";
import type { Selection } from "@/map/selection";

type BBox = [number, number, number, number];

interface BodyProps {
  selection: Selection;
  onZoom: (bbox: BBox) => void;
  onOpenCrag: (slug: string) => void;
}

const KIND_LABEL = { region: "Region", sektor: "Sektor", crag: "Skała" } as const;

export function DetailCardBody({ selection, onZoom, onOpenCrag }: BodyProps) {
  const name = selection.type === "crag" ? selection.crag.name : selection.area.name;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{KIND_LABEL[selection.type]}</p>
      <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight">{name}</h2>
      <div className="flex flex-wrap gap-1.5">
        {selection.type === "crag" ? (
          <Chip>{countLabel(selection.crag.route_count, DROGI)}</Chip>
        ) : (
          <>
            <Chip>{countLabel(selection.area.crag_count, SKALY)}</Chip>
            <Chip>{countLabel(selection.area.route_count, DROGI)}</Chip>
          </>
        )}
      </div>
      <GradeBar bands={selection.type === "crag" ? selection.crag.grade_bands : selection.bands} />
      {selection.type === "crag" ? (
        <Button className="mt-2" onClick={() => onOpenCrag(selection.crag.slug)}>
          Otwórz skałę
        </Button>
      ) : (
        <Button className="mt-2" onClick={() => onZoom(selection.area.bbox)}>
          Przybliż
        </Button>
      )}
    </div>
  );
}

interface CardProps extends Omit<BodyProps, "selection"> {
  selection: Selection | null;
  onClose: () => void;
}

export function DetailCard({ selection, onClose, onZoom, onOpenCrag }: CardProps) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    if (selection === null) return null;
    return (
      <aside className="absolute right-3 top-3 z-20 w-80 rounded-[10px] bg-background p-4 shadow-[0_4px_14px_rgba(43,36,32,0.18)]">
        <button type="button" aria-label="Zamknij" onClick={onClose} className="absolute right-3 top-2 text-lg text-muted-foreground hover:text-foreground">
          ×
        </button>
        <DetailCardBody selection={selection} onZoom={onZoom} onOpenCrag={onOpenCrag} />
      </aside>
    );
  }
  return (
    <Drawer open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="px-4 pb-6">
        <DrawerTitle className="sr-only">Szczegóły</DrawerTitle>
        <DrawerDescription className="sr-only">Informacje o wybranym miejscu na mapie</DrawerDescription>
        {selection && <DetailCardBody selection={selection} onZoom={onZoom} onOpenCrag={onOpenCrag} />}
      </DrawerContent>
    </Drawer>
  );
}
