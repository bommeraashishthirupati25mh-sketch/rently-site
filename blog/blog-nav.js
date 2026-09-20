// Blog pages are static HTML (deliberately, for SEO) with no server-side session awareness.
// The blog is student-facing only: if the viewer turns out to be signed in as staff
// (admin/transporter/partner), send them back to the app's home instead of showing it.
// Logged-out visitors and students (the actual SEO audience) are never affected - this only
// ever redirects after an async role lookup, and fails silently if anything doesn't match.
(function () {
  var SUPABASE_URL = "https://vbkmzsneryyjtjmjeynj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZia216c25lcnl5anRqbWpleW5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMzM4MDcsImV4cCI6MjEwNDYwOTgwN30.P6QJkXdaeRCrdBvwqdhincaUmWadxusDCVEqQ-GT2Jw";
  var STORAGE_KEY = "sb-vbkmzsneryyjtjmjeynj-auth-token";

  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var session = JSON.parse(raw);
    var accessToken = session && session.access_token;
    var uid = session && session.user && session.user.id;
    if (!accessToken || !uid) return;

    fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(uid) + "&select=role", {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + accessToken },
    })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        var role = rows && rows[0] && rows[0].role;
        if (role === "admin" || role === "transporter" || role === "partner") window.location.replace("/");
      })
      .catch(function () {});
  } catch (e) {}
})();
