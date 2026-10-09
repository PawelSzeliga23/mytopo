import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LoginDialog } from "@/components/LoginDialog";
import { api, ApiError } from "@/lib/api";

const ME_KEY = ["me"] as const;

interface Session {
  nick: string | null;
  isEditor: boolean;
  login: (password: string, nick: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Opens the login dialog; resolves true once logged in, false when cancelled. */
  requestLogin: () => Promise<boolean>;
}

const SessionContext = createContext<Session | null>(null);

async function fetchMe(): Promise<{ nick: string } | null> {
  try {
    return await api.me();
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
    () => ({ nick: me?.nick ?? null, isEditor: !!me, login, logout, requestLogin }),
    [me, login, logout, requestLogin],
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
      toast.success("Zapisano");
      options.onSuccess?.(result, variables);
    },
    onError: (error) => {
      // A revert conflict is shown by the caller, with the list of fields.
      if (error instanceof ApiError && error.code === "revert_conflict") return;
      toast.error(error.message);
    },
  });
}
