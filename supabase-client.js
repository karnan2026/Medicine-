// Shared Supabase client — loaded before any page-specific script.
// Uses the publishable key, which is safe to expose in the browser
// because every table is protected by Row Level Security.
//
// NOTE: the client is named `db`, not `supabase` — the CDN library
// itself occupies the global name `supabase`, so reusing that name
// for our instance causes a silent conflict where code ends up
// calling methods on the wrong object.

const SUPABASE_URL = "https://eblqjcuixrhuzfksnhzi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uQHaspzCH7YDrA7FXzudBQ_lPKGmWp8";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Ensures a `profiles` row exists for the current user (first login after signup).
// Safe to call repeatedly — no-ops if the row already exists.
async function ensureProfile(user, displayName) {
  const { data: existing } = await db
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    const googleName = user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name);
    await db.from("profiles").insert({
      id: user.id,
      display_name: displayName || googleName || user.email.split("@")[0],
    });
  }
}

// Redirects to auth.html if no one is logged in. Call at the top of
// any page that requires a session. Also ensures a `profiles` row
// exists — a safety net in case signup ever completed without one
// (e.g. email confirmation interrupting the original signup flow).
async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = "auth.html";
    return null;
  }
  await ensureProfile(session.user);

  const { data: profile } = await db
    .from("profiles")
    .select("is_approved")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profile && profile.is_approved === false) {
    window.location.href = "pending.html";
    return null;
  }

  return session;
}

// Renders the shared top nav into #nav. `activePage` is one of
// "feed" | "systems" — used to highlight the current link.
async function renderNav(activePage) {
  const navEl = document.getElementById("nav");
  if (!navEl) return;

  const { data: { session } } = await db.auth.getSession();

  let userHtml;
  if (session) {
    await ensureProfile(session.user);
    const { data: profile } = await db
      .from("profiles")
      .select("display_name, role, is_approved")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profile && profile.is_approved === false) {
      window.location.href = "pending.html";
      return;
    }

    const name = profile ? profile.display_name : session.user.email;
    const isAdmin = profile && profile.role === "admin";
    userHtml = `
      <a href="new-topic.html" class="btn-new">+ New topic</a>
      <div class="nav-user">
        ${isAdmin ? `<a href="admin.html" style="${activePage === 'admin' ? 'color:var(--teal);' : ''}">Admin</a>` : ''}
        <span>${name}</span>
        <button id="signOutBtn">Sign out</button>
      </div>`;
  } else {
    userHtml = `<div class="nav-user"><a href="auth.html">Sign in</a></div>`;
  }

  navEl.innerHTML = `
    <div class="nav-brand">
      <span class="eyebrow display" style="font-size:16px;">Medicine</span>
    </div>
    <div class="nav-links">
      <a href="index.html" class="${activePage === 'feed' ? 'active' : ''}">Today's feed</a>
      <a href="systems.html" class="${activePage === 'systems' ? 'active' : ''}">Browse by system</a>
    </div>
    ${userHtml}
  `;

  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      await db.auth.signOut();
      window.location.href = "index.html";
    });
  }
}

// Formats a timestamp into a friendly date-group label:
// "Today", "Yesterday", or "12 Aug 2026".
function dateGroupLabel(isoString) {
  const d = new Date(isoString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Formats a timestamp as a short time, e.g. "2:41 PM".
function timeLabel(isoString) {
  return new Date(isoString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
