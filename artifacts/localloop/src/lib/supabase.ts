import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      global: {
        headers: {
          "X-Client-Info": "localloop-web",
        },
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "LocalLoop is not connected to Supabase. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to this Replit project's Secrets.",
    );
  }
  return supabase;
}

export function getSupabasePublicConfig() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "LocalLoop is not connected to Supabase. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to this Replit project's Secrets.",
    );
  }
  return { url: supabaseUrl!, anonKey: supabaseAnonKey! };
}

export const storageLimits = {
  avatarBytes: 5 * 1024 * 1024,
  eventImageBytes: 8 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
} as const;
