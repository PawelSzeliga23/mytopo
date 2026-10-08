import { Chip } from "@/components/Chip";
import type { CragDetail } from "@/lib/api";
import { formatDecimal } from "@/lib/format";

export function heightLabel({ height_min: min, height_max: max }: Pick<CragDetail, "height_min" | "height_max">): string | null {
  const low = min ?? max;
  const high = max ?? min;
  if (low === null || high === null) return null;
  return low === high ? `${formatDecimal(low)} m` : `${formatDecimal(low)}–${formatDecimal(high)} m`;
}

function Collapsible({ title, text, open }: { title: string; text: string; open: boolean }) {
  return (
    <details open={open} className="rounded-[10px] bg-secondary/60 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <p className="mt-2 whitespace-pre-line text-muted-foreground">{text}</p>
    </details>
  );
}

export function CragInfo({ crag, descriptionOpen }: { crag: CragDetail; descriptionOpen: boolean }) {
  const height = heightLabel(crag);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {crag.rock_type && <Chip>{crag.rock_type}</Chip>}
        {height && <Chip>{height}</Chip>}
        {crag.aspects.length > 0 && <Chip>{`wystawa ${crag.aspects.join(", ")}`}</Chip>}
        {crag.approach_minutes !== null && <Chip>{`dojście ${crag.approach_minutes} min`}</Chip>}
        {crag.child_friendly && <Chip>dla dzieci</Chip>}
      </div>
      {crag.description && <Collapsible title="Opis" text={crag.description} open={descriptionOpen} />}
      {crag.approach_description && <Collapsible title="Dojście" text={crag.approach_description} open={false} />}
    </div>
  );
}
