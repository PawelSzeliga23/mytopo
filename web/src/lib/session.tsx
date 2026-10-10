import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LoginDialog } from "@/components/LoginDialog";
import { api, ApiError } from "@/lib/api";

const ME_KEY = ["me"] as const;

interface Session {
  nick: string | null;
  isEditor: boolean;
  /** The login dialog is open (e.g. after a 401): screens keep what they show so nothing typed is lost. */
  reauthenticating: boolean;
  login: (password: string, nick: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Opens the login dialog; resolves true once logged in, false when cancelled. */
  requestLogin: () => Promise<boolean>;
}

const SessionContext = createContext<Session | null>(null);

async function fetchMe(): Promise<{ nick: string } | null> {
  try {
    const me = await api.me();
    return me.nick ? { nick: me.nick } : null; // { nick: null } = not logged in
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { data: me } = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: Infinity });
  const [dialogOpen, setDialogOpen] = useState(false);
  const waiting = useRef<((loggedIn: boolean) => void)[]>([]);

  const login = useCallback(
    async (password: string, nick: string) => {
      const result = await api.login(password, nick);
      client.setQueryData(ME_KEY, { nick: result.nick });
    },
    [client],
  );

  const logout = useCallback(async () => {
    await api.logout();
    client.setQueryData(ME_KEY, null);
  }, [client]);

  const requestLogin = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        waiting.current.push(resolve);
        setDialogOpen(true);
      }),
    [],
  );

  const settle = useCallback((loggedIn: boolean) => {
    const resolvers = waiting.current;
    waiting.current = [];
    setDialogOpen(false);
    for (const resolve of resolvers) resolve(loggedIn);
  }, []);

  const value = useMemo<Session>(
    () => ({ nick: me?.nick ?? null, isEditor: !!me, reauthenticating: dialogOpen, login, logout, requestLogin }),
    [me, dialogOpen, login, logout, requestLogin],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      <LoginDialog open={dialogOpen} onLogin={login} onDone={settle} />
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession wymaga SessionProvider");
  return session;
}

interface EditorMutationOptions<V, R> {
  onSuccess?: (result: R, variables: V) => void;
  invalidate?: QueryKey[];
  /** Success toast; false when the caller shows its own. */
  successToast?: string | false;
}

/**
 * A write that needs a session. A 401 (expired session, changed password) opens the login dialog and, once logged in,
 * repeats the write with the same data, so a form held by the caller is never reset on the way.
 */
export function useEditorMutation<V, R>(fn: (variables: V) => Promise<R>, options: EditorMutationOptions<V, R> = {}) {
  const { requestLogin } = useSession();
  const client = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: async (variables) => {
      try {
        return await fn(variables);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        client.setQueryData(ME_KEY, null);
        if (await requestLogin()) return fn(variables);
        throw error;
      }
    },
    onSuccess: (result, variables) => {
      for (const queryKey of options.invalidate ?? []) void client.invalidateQueries({ queryKey });
      // Every editor write is a transaction, so the history lists are stale.
      void client.invalidateQueries({ queryKey: ["changes"] });
      if (options.successToast !== false) toast.success(options.successToast ?? "Zapisano");
      options.onSuccess?.(result, variables);
    },
    onError: (error) => {
      // Conflicts are shown by the caller: a revert's list of fields, a topo save's "someone saved meanwhile" dialog.
      if (error instanceof ApiError && (error.code === "revert_conflict" || error.code === "version_conflict")) return;
      toast.error(error.message);
    },
  });
}

/**
 * For reads that need a session: on a 401 the session is dropped, the login dialog opens and, once logged in, `retry`
 * repeats the read. Returns true while the error is a 401, so the caller shows a prompt instead of the raw message.
 */
export function useLoginOnUnauthorized(error: Error | null, retry: () => void): boolean {
  const { requestLogin } = useSession();
  const client = useQueryClient();
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const unauthorized = error instanceof ApiError && error.status === 401;
  useEffect(() => {
    if (!unauthorized) return;
    client.setQueryData(ME_KEY, null);
    void requestLogin().then((loggedIn) => loggedIn && retryRef.current());
  }, [unauthorized, error, client, requestLogin]);
  return unauthorized;
}
