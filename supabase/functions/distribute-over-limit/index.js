// Edge Function: distribute-over-limit
//
// Thin wrapper around the distribute_over_limit() Postgres RPC. Supports a
// dryRun mode so the client can show the full per-partner breakdown in a
// confirmation modal (spec §5.2.5 / §6.4) BEFORE actually writing the
// irreversible share_history / over_limit_records / partner_shares rows.
//
// Expected request body:
//   {
//     "sessionId": "<uuid>",
//     "shareMethod": "percentage" | "equally",
//     "setLimit": 5000,
//     "partnerIds": ["<uuid>", ...],   // required only for "equally"
//     "dryRun": true | false
//   }
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

  const {
    sessionId,
    shareMethod,
    setLimit,
    partnerIds = null,
    dryRun = false,
  } = body || {};

  if (!sessionId || !shareMethod || typeof setLimit !== "number") {
    return jsonResponse({ error: "sessionId, shareMethod, and setLimit are required" }, 400);
  }

  if (shareMethod !== "percentage" && shareMethod !== "equally") {
    return jsonResponse({ error: "shareMethod must be 'percentage' or 'equally'" }, 400);
  }

  if (shareMethod === "equally" && (!Array.isArray(partnerIds) || partnerIds.length === 0)) {
    return jsonResponse({ error: "partnerIds is required for equal-split sharing" }, 400);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.rpc("distribute_over_limit", {
    p_session_id: sessionId,
    p_share_method: shareMethod,
    p_set_limit: setLimit,
    p_partner_ids: partnerIds,
    p_dry_run: dryRun,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse(data, 200);
});
