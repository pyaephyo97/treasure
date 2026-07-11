// Edge Function: validate-bet-entry
//
// Thin wrapper around the submit_bet_entries() Postgres RPC, which does the
// actual atomic, race-safe limit checking and insertion (see
// 20260707130000_rpc_functions.sql). This function forwards the caller's
// own JWT (not the service role key) so auth.uid() resolves correctly
// inside the RPC's RLS-bypassing but still identity-aware logic.
//
// Expected request body:
//   { "sessionId": "<uuid>", "entries": [{ "number": "46", "amount": 500 }, ...] }
//
// The client is expected to have already expanded R-format lines
// (e.g. "46R1000" -> 46=1000 and 64=1000) before calling this — that
// expansion is pure client-side text parsing with no server dependency.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, handleOptions } from "../_shared/http.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { sessionId, entries } = body || {};

  if (!sessionId || !Array.isArray(entries) || entries.length === 0) {
    return jsonResponse({ error: "sessionId and a non-empty entries array are required" }, 400);
  }

  for (const entry of entries) {
    if (typeof entry.number !== "string" || typeof entry.amount !== "number") {
      return jsonResponse(
        { error: "Each entry must be { number: string, amount: number }" },
        400
      );
    }
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.rpc("submit_bet_entries", {
    p_session_id: sessionId,
    p_entries: entries,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse(data, 200);
});
