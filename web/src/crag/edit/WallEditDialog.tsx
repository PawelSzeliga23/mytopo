import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type WallOut, type WallPatch } from "@/lib/api";
import { changedFields } from "@/lib/patch";
import { useEditorMutation } from "@/lib/session";

interface WallDraft {
  name: string;
  description: string;
  sort_order: string;
}

export function WallEditDialog({ wall, onClose }: { wall: WallOut; onClose: () => void }) {
  const original: WallDraft = { name: wall.name ?? "", description: wall.description ?? "", sort_order: String(wall.sort_order) };
  const [draft, setDraft] = useState(original);
  const save = useEditorMutation((patch: WallPatch) => api.patchWall(wall.id, patch), { invalidate: [["crag"]], onSuccess: onClose });

  function submit(event: FormEvent) {
    event.preventDefault();
    const changed = changedFields(original, draft);
    if (Object.keys(changed).length === 0) return onClose();
    const patch: WallPatch = {};
    if ("name" in changed) patch.name = draft.name.trim();
    if ("description" in changed) patch.description = draft.description.trim() === "" ? null : draft.description;
    if ("sort_order" in changed) patch.sort_order = Number(draft.sort_order);
    save.mutate(patch);
  }

  const set = (key: keyof WallDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Ściana: nazwa i opis</DialogTitle>
            <DialogDescription>Zmiany trafią do historii skały.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wall-name">Nazwa ściany</Label>
            <Input id="wall-name" value={draft.name} onChange={(event) => set("name")(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wall-description">Opis ściany</Label>
            <Textarea id="wall-description" value={draft.description} onChange={(event) => set("description")(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wall-order">Kolejność</Label>
            <Input id="wall-order" type="number" value={draft.sort_order} onChange={(event) => set("sort_order")(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Zapisz
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
