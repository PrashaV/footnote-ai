// AuthContext — wraps Supabase Auth and exposes the current session/user
// to every component in the tree via React context.
//
// Supabase SQL to run for RLS (optional, run in Supabase SQL Editor):
//
//   -- Add user_id column to sessions (if upgrading from anonymous):
//   ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
//
//   -- Enable RLS:
//   ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users can read their own sessions"
//     ON sessions FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
//   CREATE POLICY "Users can insert their own sessions"
//     ON sessions FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
//
//   -- Same for integrity_reports:
//   CREATE TABLE IF NOT EXISTS integrity_reports (
//     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id     uuid        REFERENCES auth.users(id),
//     title       text,
//     created_at  timestamptz NOT NULL DEFAULT now(),
//     report      jsonb       NOT NULL
//   );
//   CREATE INDEX IF NOT EXISTS integrity_reports_user_id_idx ON integrity_reports(user_id);
//   ALTER TABLE integrity_reports ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users can read their own reports"
//     ON integrity_reports FOR SELECT USING (auth.uid() = user_id);
//   CREATE POLICY "Users can insert their own reports"
//     ON integrity_reports FOR INSERT WITH CHECK (auth.uid() = user_id);

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FC,
  type ReactNode,
} from "react";
import { createClient, type SupabaseClient, type User, type Session } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) {
    return null;
  }
  if (!_supabase) {
    _supabase = createClient(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  /** Sign in with magic link (passwordless). */
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  /** Sign in with email + password. */
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Sign up with email + password. */
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  isLoading: true,
  signInWithEmail: async () => ({ error: "Supabase not configured" }),
  signInWithPassword: async () => ({ error: "Supabase not configured" }),
  signUp: async () => ({ error: "Supabase not configured" }),
  signOut: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const client = getSupabaseClient();

  useEffect(() => {
    if (!client) {
      setIsLoading(false);
      return;
    }

    // Listen for auth state changes first so we never miss an event.
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      // If we were loading and a session arrived via auth callback, stop loading.
      setIsLoading(false);
    });

    // Handle PKCE magic-link / OTP callback:
    // Supabase redirects back to the app with ?code=<pkce_code> in the URL.
    // We must exchange that code for a session explicitly; then clean the URL
    // so a page refresh doesn't try to re-exchange the (already-used) code.
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");

    if (code) {
      client.auth
        .exchangeCodeForSession(code)
        .then(({ data, error }) => {
          if (error) {
            console.error("[auth] PKCE code exchange failed:", error.message);
          } else if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
          }
          // Remove ?code=… from the URL so a refresh doesn't re-attempt exchange.
          const cleanUrl =
            window.location.pathname +
            (window.location.hash || "");
          window.history.replaceState({}, "", cleanUrl);
        })
        .finally(() => setIsLoading(false));
    } else {
      // Normal startup — restore session from storage (or hash token on older flows).
      client.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setIsLoading(false);
      });
    }

    return () => subscription.unsubscribe();
  }, [client]);

  const signInWithEmail = async (email: string) => {
    if (!client) return { error: "Supabase is not configured." };
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        // Redirect back to whichever origin sent the magic link
        // (localhost in dev, production URL on Vercel)
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error?.message ?? null };
  };

  const signInWithPassword = async (email: string, password: string) => {
    if (!client) return { error: "Supabase is not configured." };
    const { error } = await client.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string) => {
    if (!client) return { error: "Supabase is not configured." };
    const { error } = await client.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    if (!client) return;
    await client.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, isLoading, signInWithEmail, signInWithPassword, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
