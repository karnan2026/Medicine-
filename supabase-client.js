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

// Uploads one image to the topic-images bucket, then records it in the
// given table (topic_images or answer_images). Uploading is really two
// separate network calls — the file upload, then the database row that
// points to it — and either can fail independently, especially on a
// slow or unstable connection. Retries each step once before giving up,
// and returns false (rather than silently succeeding) if the row never
// got recorded, even if the file itself made it to storage.
async function uploadPostImage(file, userId, table, foreignKeyColumn, foreignKeyValue, sortOrder) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/${Date.now()}-${sortOrder}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  async function attemptUpload() {
    const { error } = await db.storage
      .from("topic-images")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    return !error;
  }

  let uploaded = await attemptUpload();
  if (!uploaded) uploaded = await attemptUpload();
  if (!uploaded) return false;

  const { data: publicUrlData } = db.storage.from("topic-images").getPublicUrl(path);

  async function attemptInsert() {
    const { error } = await db.from(table).insert({
      [foreignKeyColumn]: foreignKeyValue,
      image_url: publicUrlData.publicUrl,
      sort_order: sortOrder,
    });
    return !error;
  }

  let inserted = await attemptInsert();
  if (!inserted) inserted = await attemptInsert();

  return inserted;
}

// Registers the service worker (enables "Add to Home Screen" / install
// prompts and a basic offline shell). Safe to call on every page load —
// the browser no-ops if it's already registered and unchanged.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Installability just won't be offered if this fails (e.g. served
      // over plain HTTP) — the rest of the site still works normally.
    });
  });
}

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

// Sets/clears the installed app's icon badge to the count of signups
// awaiting approval. Only meaningful for admins — everyone else gets
// it cleared. Note: this only runs while the app is actually open;
// browsers can't update a badge in the background without a push
// server, so it reflects the count "as of your last visit," not a
// live push like the Telegram alerts.
async function updateAdminBadge(isAdmin) {
  if (!("setAppBadge" in navigator)) return;
  if (!isAdmin) {
    navigator.clearAppBadge().catch(() => {});
    return;
  }
  const { count } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_approved", false);

  if (count && count > 0) {
    navigator.setAppBadge(count).catch(() => {});
  } else {
    navigator.clearAppBadge().catch(() => {});
  }
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
    updateAdminBadge(isAdmin);
    userHtml = `
      <a href="new-topic.html" class="btn-new">+ New topic</a>
      <div class="nav-user">
        ${isAdmin ? `<a href="admin.html" style="${activePage === 'admin' ? 'color:var(--teal);' : ''}">Admin</a>` : ''}
        <span>${name}</span>
        <button id="signOutBtn">Sign out</button>
      </div>`;
  } else {
    updateAdminBadge(false);
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
