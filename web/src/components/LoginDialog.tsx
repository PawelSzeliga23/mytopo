import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NICK_KEY = "topo-nick";

function lastNick(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberNick(nick: string): void {
  try {
    localStorage.setItem(NICK_KEY, nick);
  } catch {
    // blocked storage: the nick is just not prefilled next time
  }
}

interface Props {
  open: boolean;
  onLogin: (password: string, nick: string) => Promise<void>;
  /** Called with true after a successful login, false when the dialog is cancelled. */
  onDone: (loggedIn: boolean) => void;
}

export function LoginDialog({ open, onLogin, onDone }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDone(false)}>
      <DialogContent showCloseButton={false}>
        <LoginForm onLogin={onLogin} onDone={onDone} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so every opening starts with empty fields and no error.
function LoginForm({ onLogin, onDone }: Pick<Props, "onLogin" | "onDone">) {
  const [password, setPassword] = useState("");
  const [nick, setNick] = useState(lastNick);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(password, nick);
      rememberNick(nick.trim());
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zalogować");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <DialogHeader>
        <DialogTitle className="font-display text-xl font-extrabold">Tryb edycji</DialogTitle>
        <DialogDescription>Zapamiętamy na tym urządzeniu przez rok.</DialogDescription>
      </DialogHeader>
      {/* One shared password: the hidden user name lets password managers file it. */}
      <input type="text" name="username" autoComplete="username" value="topo" readOnly hidden />
      <div className="grid gap-1.5">
        <Label htmlFor="login-password">Hasło</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="login-nick">Twój nick (podpis w historii)</Label>
        <Input
          id="login-nick"
          autoComplete="nickname"
          required
          minLength={2}
          maxLength={40}
          value={nick}
          onChange={(event) => setNick(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone(false)}>
          Anuluj
        </Button>
        <Button type="submit" disabled={busy}>
          Wejdź
        </Button>
      </DialogFooter>
    </form>
  );
}
