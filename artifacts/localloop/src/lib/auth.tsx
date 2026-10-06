import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isSupabaseConfigured, requireSupabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const profileQueryKey = (userId: string | undefined) => ["profile", userId] as const;

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

function getAppRedirectUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const previousUserId = useRef<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      setAuthLoading(false);
      return;
    }

    const client = requireSupabase();
    let mounted = true;

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (previousUserId.current !== nextUserId) {
        queryClient.clear();
        previousUserId.current = nextUserId;
      }
      if (mounted) {
        setSession(nextSession);
        setAuthLoading(false);
      }
    });

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setSession(null);
        } else {
          setSession(data.session);
          previousUserId.current = data.session?.user.id ?? null;
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setAuthLoading(false);
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const user = session?.user ?? null;
  const profileQuery = useQuery({
    queryKey: profileQueryKey(user?.id),
    queryFn: () => loadProfile(user!.id),
    enabled: isSupabaseConfigured && !!user,
    staleTime: 30_000,
    retry: 1,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile: profileQuery.data ?? null,
      isLoading: authLoading || (!!user && profileQuery.isLoading),
      isConfigured: isSupabaseConfigured,
      signIn: async (email, password) => {
        const { error } = await requireSupabase().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      },
      signUp: async (email, password, fullName) => {
        const { data, error } = await requireSupabase().auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: getAppRedirectUrl(),
          },
        });
        if (error) throw error;
        return { needsEmailConfirmation: !data.session };
      },
      signOut: async () => {
        const { error } = await requireSupabase().auth.signOut();
        if (error) throw error;
      },
      resetPassword: async (email) => {
        const { error } = await requireSupabase().auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: getAppRedirectUrl() },
        );
        if (error) throw error;
      },
    }),
    [authLoading, profileQuery.data, profileQuery.isLoading, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
