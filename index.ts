// supabase/functions/get-ip/index.ts
// returns the caller's real ip. deploy with --no-verify-jwt, login.html
// calls this before there's a session
//
// heads up: x-forwarded-for can be spoofed, taking the first entry would
// let anyone fake their ip to dodge a ban. cf-connecting-ip is set by
// cloudflare itself so use that first, last x-forwarded-for entry as fallback

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  let ip = req.headers.get("cf-connecting-ip");

  if (!ip) {
    const xff = req.headers.get("x-forwarded-for") || "";
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    ip = parts.length ? parts[parts.length - 1] : null;
  }

  return new Response(JSON.stringify({ ip: ip || "unknown" }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
