import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ChangeOut, ObjectChangeOut, RevertConflict } from "@/lib/api";
import { fieldLabel, formatValue, formatWhen, objectTitle } from "./format";

interface Props {
  change: ChangeOut;
  conflicts: RevertConflict[];
  pending?: boolean;
  onCancel: () => void;
  onSafe: () => void;
  onAll: () => void;
}

function ConflictLine({ conflict }: { conflict: RevertConflict }) {
  const title = objectTitle({ kind: conflict.kind as ObjectChangeOut["kind"], name: conflict.name });
  const who = `${conflict.author ?? "ktoś"}${conflict.issued_at ? `, ${formatWhen(conflict.issued_at)}` : ""}`;
  if (conflict.field === "*") {
    return (
      <li>
        <b>{title}</b> zmieniono później w całości — {who}
      </li>
    );
  }
  const field = conflict.field;
  return (
    <li>
      <b>{title}</b> · {fieldLabel(field)} — {who}: <ins className="diff-ins">{formatValue(field, conflict.current)}</ins>; cofnięcie ustawi{" "}
      <del className="diff-del">{formatValue(field, conflict.current)}</del> → <ins className="diff-ins">{formatValue(field, conflict.restored)}</ins>
    </li>
  );
}

export function ConflictDialog({ change, conflicts, pending, onCancel, onSafe, onAll }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            Cofnąć zmianę {change.author} z {formatWhen(change.issued_at)}?
          </DialogTitle>
          <DialogDescription>To pole zmieniono później:</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto rounded-lg bg-secondary p-2 text-sm">
          {conflicts.map((conflict, index) => (
            <ConflictLine key={index} conflict={conflict} />
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Pozostałe pola cofną się bez konfliktu.</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onSafe}>
            Cofnij tylko bez konfliktu
          </Button>
          <Button type="button" disabled={pending} onClick={onAll}>
            Cofnij wszystko
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
