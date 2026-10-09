import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { Button } from "@/components/ui/button";
import { ChangeEntry } from "@/history/ChangeEntry";
import { useRevert } from "@/history/useRevert";
import { api, type ChangesQuery } from "@/lib/api";
import { useSession } from "@/lib/session";

type Filter = "no-import" | "all" | "deleted";

const FILTERS: { value: Filter; label: string; query: Pick<ChangesQuery, "kind" | "include_import"> }[] = [
  { value: "all", label: "wszystkie", query: { include_import: true } },
  { value: "no-import", label: "bez importu", query: {} },
  { value: "deleted", label: "tylko usunięcia", query: { kind: "deleted" } },
];

function ChangeList({ filter }: { filter: Filter }) {
  const { revert, dialog } = useRevert();
  const query = FILTERS.find((candidate) => candidate.value === filter)!.query;
  const { data, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ["changes", { filter }],
    queryFn: ({ pageParam }) => api.changes({ ...query, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.next_before ?? undefined,
  });
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  // Load the next page when the end of the list scrolls into view; the button below is the fallback.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div>
      {isPending && <p className="text-muted-foreground">Wczytywanie…</p>}
      {error && <p role="alert">{error.message}</p>}
      {data && items.length === 0 && <p className="text-muted-foreground">Brak zmian.</p>}
      {items.map((change) => (
        <ChangeEntry key={change.id} change={change} showCrag onRevert={revert} />
      ))}
      {hasNextPage && (
        <div ref={sentinel} className="py-3">
          <Button type="button" variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Starsze ↓
          </Button>
        </div>
      )}
      {dialog}
    </div>
  );
}

export default function ChangesPage() {
  const { isEditor, reauthenticating } = useSession();
  const [filter, setFilter] = useState<Filter>("no-import");

  useEffect(() => {
    document.title = "Ostatnie zmiany · topo";
    return () => {
      document.title = "topo";
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 lg:px-6">
      <header className="flex items-center justify-between py-3">
        <Link to="/" aria-label="Wróć do mapy">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <UserMenu />
          <ThemeToggle />
        </div>
      </header>
      {isEditor || reauthenticating ? (
        <>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Ostatnie zmiany</h1>
          <div role="group" aria-label="Filtr" className="my-3 flex flex-wrap gap-1.5">
            {FILTERS.map((candidate) => (
              <Button
                key={candidate.value}
                type="button"
                size="sm"
                variant={filter === candidate.value ? "default" : "outline"}
                aria-pressed={filter === candidate.value}
                onClick={() => setFilter(candidate.value)}
              >
                {candidate.label}
              </Button>
            ))}
          </div>
          <ChangeList filter={filter} />
        </>
      ) : (
        <p className="text-muted-foreground">Ostatnie zmiany są widoczne po zalogowaniu. Użyj „✎ Edytuj” u góry.</p>
      )}
    </div>
  );
}
