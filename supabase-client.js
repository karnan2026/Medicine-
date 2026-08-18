// Shared Supabase client — loaded before any page-specific script.
// Uses the publishable key, which is safe to expose in the browser
// because every table is protected by Row Level Security.

const SUPABASE_URL = "https://eblqjcuixrhuzfksnhzi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uQHaspzCH7YDrA7FXzudBQ_lPKGmWp8";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Ensures a `profiles` row exists for the current user (first login after signup).
// Safe to call repeatedly — no-ops if the row already exists.
async function ensureProfile(user, displayName) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from("profiles").insert({
      id: user.id,
      display_name: displayName || user.email.split("@")[0],
    });
  }
}

// Redirects to auth.html if no one is logged in. Call at the top of
// any page that requires a session.
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "auth.html";
    return null;
  }
  return session;
}
