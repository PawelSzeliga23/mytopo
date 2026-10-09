import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

const UserDropdown = lazy(() => import("@/components/UserDropdown"));

export function UserMenu() {
  const { nick, isEditor, logout, requestLogin } = useSession();
  if (!isEditor) {
    return (
      <Button variant="outline" size="sm" onClick={() => void requestLogin()}>
        ✎ Edytuj
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {/* On a phone the tile is the icon alone. */}
      <Button asChild variant="outline" size="sm">
        <Link to="/zmiany" aria-label="Ostatnie zmiany">
          <span aria-hidden>⟲</span>
          <span aria-hidden className="hidden sm:inline">
            Ostatnie zmiany
          </span>
        </Link>
      </Button>
      <Suspense
        fallback={
          <Button variant="ghost" size="sm">
            ● {nick} ▾
          </Button>
        }
      >
        <UserDropdown nick={nick} onChangeNick={() => void requestLogin()} onLogout={() => void logout()} />
      </Suspense>
    </div>
  );
}
