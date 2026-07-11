// Edge Function: calculate-pnl
//
// Thin wrapper around the calculate_pnl() Postgres RPC (see
// 20260707130000_rpc_functions.sql for the two flagged assumptions on how
// Admin's commission base and payout are computed — please confirm those).
//
// Accepts GET (query params) or POST (JSON body):
//   sessionId  - required
//   accountId  - optional; defaults to the caller's own account. An admin
//                may pass a partner/user id they manage to view that
//                account's P&L instead of their own.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, handleOptions } from "../_shared/http.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  let sessionId;
  let accountId;

  if (req.method === "GET") {
    const url = new URL(req.url);
    sessionId = url.searchParams.get("sessionId");
    accountId = url.searchParams.get("accountId") || null;
  } else {
    let body;
    try {
      body = await req.json();
    } catch (_err) {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    sessionId = body ? body.sessionId : undefined;
    accountId = (body && body.accountId) || null;
  }

  if (!sessionId) {
    return jsonResponse({ error: "sessionId is required" }, 400);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.rpc("calculate_pnl", {
    p_session_id: sessionId,
    p_account_id: accountId,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse(data, 200);
});
