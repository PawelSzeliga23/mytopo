import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/crag/edit/ConfirmDialog";
import { api, type AreaPatch, type AreaProps } from "@/lib/api";
import { changedFields } from "@/lib/patch";
import { useEditorMutation } from "@/lib/session";

interface Props {
  area: AreaProps;
  onClose: () => void;
  /** The area was changed or deleted; the card showing it is stale. */
  onDone: () => void;
}

interface Draft {
  name: string;
  description: string;
}

function AreaForm({ area, description, onClose, onDone }: Props & { description: string }) {
  const [original] = useState<Draft>({ name: area.name, description });
  const [draft, setDraft] = useState(original);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useEditorMutation((patch: AreaPatch) => api.patchArea(area.id, patch), { invalidate: [["map"], ["area"]], onSuccess: onDone });
  const remove = useEditorMutation(() => api.deleteArea(area.id), {
    invalidate: [["map"]],
    successToast: `Usunięto ${area.name}`,
    onSuccess: onDone,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const changed = changedFields(original, draft);
    const patch: AreaPatch = {};
    if ("name" in changed) {
      if (draft.name.trim() === "") return;
      patch.name = draft.name.trim();
    }
    if ("description" in changed) patch.description = draft.description.trim() === "" ? null : draft.description;
    if (Object.keys(patch).length === 0) return onClose();
    save.mutate(patch);
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{area.kind === "sektor" ? "Sektor: nazwa i opis" : "Region: nazwa i opis"}</DialogTitle>
          <DialogDescription>Zmiany trafią do historii.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="area-name">Nazwa</Label>
          <Input id="area-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="area-description">Opis</Label>
          <Textarea id="area-description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
            Usuń obszar
          </Button>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Zapisz
            </Button>
          </span>
        </DialogFooter>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        title="Usunąć obszar?"
        description={`Usunąć ${area.name}? Działa tylko dla pustego obszaru. Można to cofnąć w Ostatnich zmianach.`}
        confirmLabel="Usuń"
        destructive
        pending={remove.isPending}
        // A failed delete (the area is not empty) shows its message; the question closes with it.
        onConfirm={() => remove.mutate(undefined, { onError: () => setConfirmDelete(false) })}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

export function AreaEditDialog(props: Props) {
  // The map only carries name and counts; the description comes from the area endpoint, and the form starts once it is here.
  const detail = useQuery({ queryKey: ["area", props.area.slug], queryFn: () => api.area(props.area.slug), gcTime: 0 });
  return (
    <Dialog open onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent>
        {detail.data ? (
          <AreaForm {...props} description={detail.data.description ?? ""} />
        ) : (
          <DialogHeader>
            <DialogTitle>{props.area.name}</DialogTitle>
            <DialogDescription>{detail.error ? detail.error.message : "Wczytywanie…"}</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}
