import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  url && anonKey && anonKey !== 'replace-with-your-anon-public-key'
);

if (!isSupabaseConfigured) {
  // Fail loudly (in the console) but NOT by throwing — the real
  // supabase-js createClient() throws on an empty/invalid URL, and since
  // this module is imported at the very top of the app, an uncaught throw
  // here crashes React before it ever mounts, producing a blank white page
  // with no visible error. Fall back to a harmless placeholder URL instead
  // so the app can boot and show a real "not configured" screen (see
  // isSupabaseConfigured usage in App.tsx).
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env in the project root, fill in your Supabase project values, then restart the dev server.'
  );
}

export const supabase = createClient(
  isSupabaseConfigured ? (url as string) : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? (anonKey as string) : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

/** Base URL for this project's Edge Functions. */
export const FUNCTIONS_URL = isSupabaseConfigured ? `${url}/functions/v1` : '';
