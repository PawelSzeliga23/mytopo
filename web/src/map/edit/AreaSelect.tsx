import type { ReactNode } from "react";
import type { AreaProps } from "@/lib/api";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  regions: AreaProps[];
  sectors: AreaProps[];
  /** Extra options after the regions (e.g. "new region"). */
  children?: ReactNode;
}

/** Regions with their sectors as option groups; a crag can sit directly in a region or in one of its sectors. */
export function AreaSelect({ id, value, onChange, regions, sectors, children }: Props) {
  const sectorsByRegion = new globalThis.Map<number, AreaProps[]>();
  for (const sector of sectors) sectorsByRegion.set(sector.parent_id ?? 0, [...(sectorsByRegion.get(sector.parent_id ?? 0) ?? []), sector]);
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base md:text-sm">
      {regions.map((region) => (
        <optgroup key={region.id} label={region.name}>
          <option value={region.id}>{region.name} (bezpośrednio w regionie)</option>
          {(sectorsByRegion.get(region.id) ?? []).map((sector) => (
            <option key={sector.id} value={sector.id}>
              {`${region.name} › ${sector.name}`}
            </option>
          ))}
        </optgroup>
      ))}
      {children}
    </select>
  );
}
