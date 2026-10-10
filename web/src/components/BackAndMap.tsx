import { Link, useLocation, useNavigate } from "react-router";

/**
 * Start of a page's breadcrumb: "←" is one step back in the history (shown when there is one in the app),
 * "Mapa" always opens the map at `mapHref`.
 */
export function BackAndMap({ mapHref }: { mapHref: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      {location.key !== "default" && (
        <>
          <button type="button" aria-label="Wstecz" onClick={() => navigate(-1)} className="uppercase hover:text-foreground">
            ←
          </button>{" "}
        </>
      )}
      <Link to={mapHref} className="uppercase hover:text-foreground">
        Mapa
      </Link>
    </>
  );
}
