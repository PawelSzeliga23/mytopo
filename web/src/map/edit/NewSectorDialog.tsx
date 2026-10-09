import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type AreaCreate, type AreaProps } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";

export interface SectorCrag {
  id: number;
  name: string;
  /** Name of the sector the crag leaves; null when it sits directly in the region. */
  fromSector: string | null;
}

interface Props {
  region: AreaProps;
  crags: SectorCrag[];
  onBack: () => void;
  onCreated: () => void;
}

export function NewSectorDialog({ region, crags, onBack, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useEditorMutation((body: AreaCreate) => api.createArea(body), {
    invalidate: [["map"], ["crag"]],
    successToast: "Utworzono sektor",
    onSuccess: onCreated,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    create.mutate({
      kind: "sektor",
      parent_id: region.id,
      name: name.trim(),
      description: description.trim() === "" ? null : description,
      crag_ids: crags.map((crag) => crag.id),
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onBack()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Nowy sektor</DialogTitle>
            <DialogDescription>Wybrane skały przejdą do nowego sektora; można to cofnąć w Ostatnich zmianach.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>Region</Label>
            <p className="text-sm">{region.name} (ustalony)</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sector-name">Nazwa sektora</Label>
            <Input id="sector-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sector-description">Opis (opcjonalnie)</Label>
            <Textarea id="sector-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Skały</Label>
            <ul aria-label="Skały sektora" className="flex flex-col gap-0.5 text-sm">
              {crags.map((crag) => (
                <li key={crag.id}>
                  {crag.name}
                  {crag.fromSector && <span className="text-muted-foreground">{` (przejdzie z sektora „${crag.fromSector}”)`}</span>}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onBack}>
              Wstecz
            </Button>
            <Button type="submit" disabled={name.trim() === "" || create.isPending}>
              Utwórz sektor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
