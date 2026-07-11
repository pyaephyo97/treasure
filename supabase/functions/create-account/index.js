// Edge Function: create-account
//
// Provisions User / Partner accounts (by an Admin) or Admin accounts (by
// Master Admin). Uses the SERVICE ROLE key because it needs
// supabase.auth.admin.createUser(), which a normal user JWT can never call.
//
// AUTH STRATEGY ASSUMPTION (flagged, not yet confirmed with product owner):
// non-master-admin roles log in with username + password only (per spec
// §2.2), but Supabase Auth requires an email. This function synthesizes
// one as "<username>@users.treasure.internal" and marks it pre-confirmed
// (email_confirm: true) so no verification email is ever sent for these
// roles. The client-side login form should only ever collect a username;
// it derives the same synthetic email client-side (or via a lookup) before
// calling supabase.auth.signInWithPassword(). Master Admin accounts are
// NOT created through this function — they are seeded manually (see the
// note at the bottom of 20260707120000_init_schema.sql) using a real email
// and Supabase's normal verification flow.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, handleOptions } from "../_shared/http.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function synthesizeEmail(username) {
  return `${username.toLowerCase()}@users.treasure.internal`;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");

  if (!callerToken) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerAuth, error: callerAuthError } = await admin.auth.getUser(callerToken);
  if (callerAuthError || !callerAuth || !callerAuth.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  const { data: callerAccount, error: callerAccountError } = await admin
    .from("accounts")
    .select("id, role, username")
    .eq("auth_user_id", callerAuth.user.id)
    .maybeSingle();

  if (callerAccountError || !callerAccount) {
    return jsonResponse({ error: "Caller account not found" }, 403);
  }

  if (callerAccount.role !== "admin" && callerAccount.role !== "master_admin") {
    return jsonResponse({ error: "Only admin or master_admin can create accounts" }, 403);
  }

  let body;
  try {
    body = await req.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const {
    role,
    username,
    password,
    commissionRate = 0,
    payoutRate = 0,
    dataSharePercentage = null,
  } = body || {};

  if (!role || !username || !password) {
    return jsonResponse({ error: "role, username, and password are required" }, 400);
  }

  if (role === "master_admin") {
    return jsonResponse(
      { error: "master_admin accounts are seeded manually, not created via this function" },
      400
    );
  }

  if (callerAccount.role === "admin" && role !== "user" && role !== "partner") {
    return jsonResponse({ error: "Admins can only create user or partner accounts" }, 403);
  }

  // Master Admin is a superuser: it may create admin, user, or partner
  // accounts directly (no restriction beyond the master_admin-role check
  // above, which already rejects role === "master_admin" itself).

  if (role === "partner" && (dataSharePercentage === null || dataSharePercentage === undefined)) {
    return jsonResponse({ error: "dataSharePercentage is required for partner accounts" }, 400);
  }

  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return jsonResponse(
      { error: "username must be 3-32 characters: letters, numbers, underscore only" },
      400
    );
  }

  if (typeof password !== "string" || password.length < 8) {
    return jsonResponse({ error: "password must be at least 8 characters" }, 400);
  }

  const { data: existing, error: existingError } = await admin
    .from("accounts")
    .select("id")
    .ilike("username", username)
    .maybeSingle();

  if (existingError) {
    return jsonResponse({ error: existingError.message }, 500);
  }
  if (existing) {
    return jsonResponse({ error: "Username already taken" }, 409);
  }

  const email = synthesizeEmail(username);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created || !created.user) {
    return jsonResponse(
      { error: (createError && createError.message) || "Failed to create auth user" },
      500
    );
  }

  const { data: accountRow, error: insertError } = await admin
    .from("accounts")
    .insert({
      auth_user_id: created.user.id,
      role,
      username,
      commission_rate: commissionRate,
      payout_rate: payoutRate,
      data_share_percentage: role === "partner" ? dataSharePercentage : null,
      created_by: callerAccount.id,
    })
    .select("id, role, username, commission_rate, payout_rate, data_share_percentage, is_active, created_at")
    .single();

  if (insertError) {
    // Compensating rollback: don't leave an orphaned auth.users row behind.
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonResponse({ error: insertError.message }, 500);
  }

  return jsonResponse({ account: accountRow }, 201);
});
