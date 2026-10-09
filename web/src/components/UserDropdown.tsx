import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Props {
  nick: string | null;
  onChangeNick: () => void;
  onLogout: () => void;
}

// Split from UserMenu so the dropdown (Radix menu, Floating UI) loads only for a logged-in editor.
export default function UserDropdown({ nick, onChangeNick, onLogout }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          ● {nick} ▾
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onChangeNick}>Zmień nick</DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>Wyloguj</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
