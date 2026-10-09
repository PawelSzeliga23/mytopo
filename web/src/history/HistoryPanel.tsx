import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, type CragDetail } from "@/lib/api";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { ChangeEntry } from "./ChangeEntry";
import { useRevert } from "./useRevert";

interface Props {
  crag: Pick<CragDetail, "id" | "name">;
  onClose: () => void;
}

function HistoryList({ crag }: Pick<Props, "crag">) {
  const { revert, dialog } = useRevert();
  // The import entry is included, greyed out, so the crag's whole story is visible.
  const { data, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ["changes", { crag: crag.id }],
    queryFn: ({ pageParam }) => api.changes({ crag: crag.id, include_import: true, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.next_before ?? undefined,
  });
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {isPending && <p className="text-sm text-muted-foreground">Wczytywanie…</p>}
      {error && <p role="alert" className="text-sm">{error.message}</p>}
      {data && items.length === 0 && <p className="text-sm text-muted-foreground">Brak zmian.</p>}
      {items.map((change) => (
        <ChangeEntry key={change.id} change={change} onRevert={revert} />
      ))}
      {hasNextPage && (
        <Button type="button" variant="outline" size="sm" className="mt-2" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Starsze ↓
        </Button>
      )}
      {dialog}
    </div>
  );
}

/** The crag's history: a sheet on the right that leaves the topo visible, a drawer from the bottom on phones. */
export function HistoryPanel({ crag, onClose }: Props) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <Sheet open modal={false} onOpenChange={(open) => !open && onClose()}>
        <SheetContent showOverlay={false} className="w-[400px] sm:max-w-[400px]" onInteractOutside={(event) => event.preventDefault()}>
          <SheetHeader>
            <SheetTitle>Historia</SheetTitle>
            <SheetDescription>{crag.name}</SheetDescription>
          </SheetHeader>
          <HistoryList crag={crag} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Historia</DrawerTitle>
          <DrawerDescription>{crag.name}</DrawerDescription>
        </DrawerHeader>
        <HistoryList crag={crag} />
      </DrawerContent>
    </Drawer>
  );
}
