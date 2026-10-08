import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link, useParams } from "react-router";
import { Chip } from "@/components/Chip";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, ApiError } from "@/lib/api";

export default function CragPage() {
  const { slug = "" } = useParams();
  const { data: crag, error, isPending } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <Link to="/" aria-label="Wróć do mapy">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      {isPending && <p className="text-muted-foreground">Wczytywanie…</p>}
      {error && (
        <p role="alert">{error instanceof ApiError && error.status === 404 ? "Nie znaleziono skały" : error.message}</p>
      )}
      {crag && (
        <>
          <nav className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Link to="/">← Mapa</Link>
            {crag.path.map((area) => (
              <Fragment key={area.id}>
                {" · "}
                <span>{area.name}</span>
              </Fragment>
            ))}
          </nav>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">{crag.name}</h1>
          <div className="flex flex-wrap gap-1.5">
            {crag.rock_type && <Chip>{crag.rock_type}</Chip>}
            {crag.height_min !== null && crag.height_max !== null && <Chip>{`${crag.height_min}–${crag.height_max} m`}</Chip>}
            {crag.aspects.length > 0 && <Chip>{crag.aspects.join(", ")}</Chip>}
            {crag.approach_minutes !== null && <Chip>{`dojście ${crag.approach_minutes} min`}</Chip>}
            {crag.child_friendly && <Chip>dla dzieci</Chip>}
          </div>
          <p className="rounded-[10px] bg-secondary p-4 text-sm text-muted-foreground">
            Topo tej skały (zdjęcia ścian z drogami) pojawi się w kolejnym etapie.
          </p>
        </>
      )}
    </div>
  );
}
