import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface SaveButtonProps {
  count: number;
  /** Why saving is blocked (e.g. a line with one point); shown as the button's hint. */
  blocked: string | null;
  pending: boolean;
  onSave(comment: string | null): void;
  /** Title of the comment dialog. */
  title?: string;
}

const changesLabel = (count: number) => (count === 1 ? "1 zmiana" : count < 5 ? `${count} zmiany` : `${count} zmian`);

/** "Zapisz (n zmian)": asks for an optional comment, then saves the whole photo as one history entry. */
export function SaveButton({ count, blocked, pending, onSave, title = "Zapisać topo?" }: SaveButtonProps) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const disabled = count === 0 || blocked !== null || pending;
  return (
    <>
      <Button size="sm" disabled={disabled} title={blocked ?? undefined} onClick={() => setOpen(true)}>
        {count > 0 ? `Zapisz (${changesLabel(count)})` : "Zapisz"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{changesLabel(count)} trafi do historii jako jeden wpis.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOpen(false);
              onSave(comment.trim() || null);
              setComment("");
            }}
          >
            <Input
              aria-label="Komentarz"
              placeholder="Komentarz (opcjonalnie)…"
              maxLength={500}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Anuluj
              </Button>
              <Button type="submit">Zapisz</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
