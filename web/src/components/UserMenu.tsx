import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

const UserDropdown = lazy(() => import("@/components/UserDropdown"));

/** "Ostatnie zmiany" for everyone; on a phone the tile is the icon alone. */
function ChangesLink() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/zmiany" aria-label="Ostatnie zmiany">
        <span aria-hidden>⟲</span>
        <span aria-hidden className="hidden sm:inline">
          Ostatnie zmiany
        </span>
      </Link>
    </Button>
  );
}

export function UserMenu() {
  const { nick, isEditor, logout, requestLogin } = useSession();
  return (
    <div className="flex items-center gap-1.5">
      <ChangesLink />
      {isEditor ? (
        <Suspense
          fallback={
            <Button variant="ghost" size="sm">
              ● {nick} ▾
            </Button>
          }
        >
          <UserDropdown nick={nick} onChangeNick={() => void requestLogin()} onLogout={() => void logout()} />
        </Suspense>
      ) : (
        <Button variant="outline" size="sm" onClick={() => void requestLogin()}>
          ✎ Edytuj
        </Button>
      )}
    </div>
  );
}
