import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type CragDetail, type WallOut } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

interface Props {
  crag: CragDetail;
  /** The wall whose photo is replaced; without it a new wall is added. */
  wall?: WallOut | null;
  onClose: () => void;
}

/** Adds a wall with a photo or replaces a wall's photo, then opens the topo editor of that wall. */
export function PhotoUploadDialog({ crag, wall, onClose }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const upload = useEditorMutation((form: FormData) => (wall ? api.replaceWallImage(wall.id, form) : api.createWall(crag.id, form)), {
    successToast: wall ? "Zdjęcie podmienione" : "Dodano ścianę",
    onSuccess: async (result) => {
      // The editor reads the crag from the cache: it must already have the new photo.
      await client.invalidateQueries({ queryKey: ["crag", crag.slug] });
      onClose();
      navigate(`/skaly/${crag.slug}/topo/${result.id}`);
    },
  });

  function choose(next: File | undefined) {
    const large = !!next && next.size > MAX_PHOTO_BYTES;
    setTooLarge(large);
    setFile(next && !large ? next : null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (!wall && name.trim()) form.append("name", name.trim());
    if (comment.trim()) form.append("comment", comment.trim());
    upload.mutate(form);
  }

  const replacing = !!wall?.image_url;
  const title = !wall ? "Dodaj ścianę" : replacing ? "Podmień zdjęcie" : "Dodaj zdjęcie";
  return (
    <Dialog open onOpenChange={(next) => !next && !upload.isPending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {replacing
                ? "Linie dróg zostaną — po wgraniu otworzy się edytor, żeby je dopasować."
                : "Po wgraniu otworzy się edytor topo, żeby narysować drogi."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo-file">Zdjęcie (JPEG, PNG albo WebP, do 30 MB)</Label>
            <Input id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choose(event.target.files?.[0])} />
            {tooLarge && (
              <p role="alert" className="text-xs text-destructive">
                Zdjęcie jest większe niż 30 MB
              </p>
            )}
          </div>
          {preview && <img src={preview} alt="Podgląd zdjęcia" className="max-h-60 w-full rounded-md bg-secondary object-contain" />}
          {!wall && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="photo-name">Nazwa ściany (opcjonalnie)</Label>
              <Input id="photo-name" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="photo-comment">Komentarz do zmiany (opcjonalnie)</Label>
            <Input id="photo-comment" value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={upload.isPending}>
              Anuluj
            </Button>
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? "Wysyłanie…" : "Wyślij"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
