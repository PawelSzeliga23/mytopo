import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AreaProps } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";
import { nearestSector } from "./geo";
import type { LngLat } from "./mode";

const NEW_REGION = "new";

export function AddCragBar({ onCancel }: { onCancel: () => void }) {
  return (
    <div role="status" className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 rounded-[10px] bg-background px-3 py-2 text-sm shadow-float lg:right-auto lg:w-[520px]">
      <span>Kliknij na mapie, gdzie stoi skała.</span>
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        Anuluj
      </Button>
    </div>
  );
}

interface Props {
  point: LngLat;
  regions: AreaProps[];
  sectors: AreaProps[];
  onClose: () => void;
}

interface NewCrag {
  name: string;
  /** An existing region or sector id, or NEW_REGION together with `regionName`. */
  target: string;
  regionName: string;
}

/** The sector the crag most likely belongs to, else the region of the nearest sector (or the nearest region). */
function defaultTarget(point: LngLat, regions: AreaProps[], sectors: AreaProps[]): { target: string; region: AreaProps | null } {
  const near = nearestSector(point, sectors);
  if (near) return { target: String(near.id), region: regions.find((region) => region.id === near.parent_id) ?? null };
  const nearest = nearestSector(point, sectors, Infinity);
  const region = (nearest && regions.find((candidate) => candidate.id === nearest.parent_id)) ?? nearestSector(point, regions, Infinity);
  return { target: region ? String(region.id) : "", region };
}

export function AddCragDialog({ point, regions, sectors, onClose }: Props) {
  const navigate = useNavigate();
  const [initial] = useState(() => defaultTarget(point, regions, sectors));
  const [draft, setDraft] = useState<NewCrag>({ name: "", target: initial.target, regionName: "" });
  // A new region is created right before the crag; if the write is repeated after a re-login it must not be created twice.
  const createdRegion = useRef<{ name: string; id: number } | null>(null);
  const regionParent = initial.region?.parent_id ?? null;

  const create = useEditorMutation(
    async (crag: NewCrag) => {
      let areaId = Number(crag.target);
      if (crag.target === NEW_REGION) {
        const name = crag.regionName.trim();
        if (createdRegion.current?.name !== name) {
          const region = await api.createArea({ kind: "region", parent_id: regionParent!, name });
          createdRegion.current = { name, id: region.id };
        }
        areaId = createdRegion.current.id;
      }
      return api.createCrag({ name: crag.name.trim(), area_id: areaId, location: point });
    },
    {
      invalidate: [["map"]],
      successToast: "Dodano skałę",
      onSuccess: (result) => {
        onClose();
        navigate(`/skaly/${result.slug}`);
      },
    },
  );

  const sectorsByRegion = new globalThis.Map<number, AreaProps[]>();
  for (const sector of sectors) sectorsByRegion.set(sector.parent_id ?? 0, [...(sectorsByRegion.get(sector.parent_id ?? 0) ?? []), sector]);
  const valid = draft.name.trim() !== "" && draft.target !== "" && (draft.target !== NEW_REGION || draft.regionName.trim() !== "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) create.mutate(draft);
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Nowa skała</DialogTitle>
            <DialogDescription>{`${point[1].toFixed(5)}, ${point[0].toFixed(5)}`}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-crag-name">Nazwa</Label>
            <Input id="new-crag-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-crag-area">Region / sektor</Label>
            <select
              id="new-crag-area"
              value={draft.target}
              onChange={(event) => setDraft({ ...draft, target: event.target.value })}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            >
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
              {regionParent !== null && <option value={NEW_REGION}>+ Nowy region…</option>}
            </select>
          </div>
          {draft.target === NEW_REGION && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-region-name">Nazwa nowego regionu</Label>
              <Input id="new-region-name" value={draft.regionName} onChange={(event) => setDraft({ ...draft, regionName: event.target.value })} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Dodaj i otwórz
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
