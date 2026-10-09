import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenLatest(): void;
  onOverwrite(): void;
  onCancel(): void;
}

/** 409 on a topo save: someone saved this photo meanwhile. Overwriting needs a second confirmation. */
export function ConflictTopoDialog({ open, onOpenLatest, onOverwrite, onCancel }: Props) {
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
    onCancel();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{confirming ? "Na pewno nadpisać?" : "Ktoś zapisał topo w międzyczasie"}</DialogTitle>
          <DialogDescription>
            {confirming
              ? "Twoja wersja zastąpi zapisaną — cudze zmiany zostaną tylko w historii."
              : "Twój szkic zostaje na tym urządzeniu. Możesz otworzyć najnowszą wersję albo nadpisać ją swoją."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Anuluj
          </Button>
          {confirming ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onOverwrite();
              }}
            >
              Nadpisz
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onOpenLatest}>
                Otwórz najnowszą
              </Button>
              <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
                Nadpisz moją
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
