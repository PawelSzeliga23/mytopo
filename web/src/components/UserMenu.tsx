import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/session";

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            ● {nick} ▾
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void requestLogin()}>Zmień nick</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void logout()}>Wyloguj</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
