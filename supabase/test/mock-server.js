// Faux Supabase local pour tester l'application de bout en bout (développement uniquement).
// Imite le sous-ensemble de GoTrue (/auth/v1) et de PostgREST (/rest/v1) utilisé par app/app.js,
// en s'appuyant sur une vraie base PostgreSQL avec les migrations et les règles RLS.
// Usage : PGDATABASE=wtest node mock-server.js <dossier_du_site> <port>
const http = require("http"), fs = require("fs"), path = require("path"), { Pool } = require("pg");
const ROOT = path.resolve(process.argv[2] || "."), PORT = +(process.argv[3] || 8790);
const pool = new Pool({ database: process.env.PGDATABASE || "wtest", user: process.env.PGUSER || "postgres", host: process.env.PGHOST || "/var/run/postgresql" });
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (u) => b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }) + ".sig";
const userObj = u => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: "email" }, created_at: u.created_at, email_confirmed_at: u.created_at, identities: [] });
const session = u => ({ access_token: jwt(u), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r." + u.id, user: userObj(u) });
const idOk = s => /^[a-z_][a-z0-9_]*$/.test(s);
function subOf(req) { const h = req.headers.authorization || ""; const t = h.replace(/^Bearer /, ""); try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub || null; } catch (e) { return null; } }
function send(res, code, body, extra) { res.writeHead(code, Object.assign({ "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" }, extra || {})); res.end(body === undefined ? "" : JSON.stringify(body)); }
async function asUser(sub, fn) { const c = await pool.connect(); try { await c.query("begin"); await c.query(sub ? "set local role authenticated" : "set local role anon"); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [sub || ""]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
function where(params, vals) { const conds = []; for (const [k, v] of params) { if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue; if (!idOk(k)) throw new Error("bad col"); const m = /^(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(v); if (!m) throw new Error("bad filter " + v); const [, op, raw] = m;
  if (op === "in") { const items = raw.replace(/^\(|\)$/g, "").split(",").map(x => x.replace(/^"|"$/g, "")); const ph = items.map(it => { vals.push(it); return "$" + vals.length; }); conds.push(`"${k}" in (${ph.join(",") || "null"})`); }
  else if (op === "is") conds.push(`"${k}" is ${raw === "null" ? "null" : raw === "true" ? "true" : "false"}`);
  else { vals.push(raw); conds.push(`"${k}" ${{ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} $${vals.length}`); } }
  return conds.length ? " where " + conds.join(" and ") : ""; }
const body = req => new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => { try { r(d ? JSON.parse(d) : {}); } catch (e) { r({}); } }); });
async function auth(req, res, p, url) { const b = ["POST", "PUT"].includes(req.method) ? await body(req) : {};
  if (p === "signup") { const ex = await pool.query("select * from auth.users where lower(email)=lower($1)", [b.email]); if (ex.rows.length) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    if ((b.password || "").length < 6) return send(res, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
    const u = (await pool.query("insert into auth.users (email,pw,raw_user_meta_data) values ($1,$2,$3) returning *", [b.email, b.password, b.data || {}])).rows[0]; return send(res, 200, session(u)); }
  if (p === "token") { const gt = url.searchParams.get("grant_type"); let u;
    if (gt === "password") u = (await pool.query("select * from auth.users where lower(email)=lower($1) and pw=$2", [b.email, b.password])).rows[0];
    else u = (await pool.query("select * from auth.users where id::text=$1", [(b.refresh_token || "").slice(2)])).rows[0];
    if (!u) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }); return send(res, 200, session(u)); }
  const sub = subOf(req);
  if (p === "user") { if (!sub) return send(res, 401, { code: 401, msg: "not logged in" }); if (req.method === "PUT" && b.password) await pool.query("update auth.users set pw=$1 where id=$2", [b.password, sub]); const u = (await pool.query("select * from auth.users where id=$1", [sub])).rows[0]; return send(res, 200, userObj(u)); }
  if (p === "logout") return send(res, 204);
  if (p === "recover") return send(res, 200, {});
  send(res, 404, { msg: "not found" }); }
async function rest(req, res, p, url) { const sub = subOf(req), single = /vnd\.pgrst\.object/.test(req.headers.accept || ""), params = [...url.searchParams.entries()];
  try {
    if (p.startsWith("rpc/")) { const fn = p.slice(4); if (!idOk(fn)) throw new Error("bad fn"); const b = await body(req), keys = Object.keys(b), vals = keys.map(k => { const v = b[k]; return v === null ? null : typeof v === "object" ? JSON.stringify(v) : String(v); });
      const r = await asUser(sub, c => c.query(`select public."${fn}"(${keys.map((k, i) => `"${k}" => $${i + 1}`).join(",")}) as r`, vals)); return send(res, 200, r.rows[0].r); }
    const t = p; if (!idOk(t)) throw new Error("bad table");
    const vals = [], w = where(params, vals);
    if (req.method === "GET") { let sql = `select * from public."${t}"${w}`; const o = url.searchParams.get("order"); if (o) sql += " order by " + o.split(",").map(x => { const [c, d] = x.split("."); if (!idOk(c)) throw new Error("bad order"); return `"${c}" ${d === "desc" ? "desc" : "asc"}`; }).join(","); const lim = url.searchParams.get("limit"), off = url.searchParams.get("offset"); if (lim) sql += " limit " + (+lim); if (off) sql += " offset " + (+off);
      const r = await asUser(sub, c => c.query(sql, vals)); if (single) return r.rows.length === 1 ? send(res, 200, r.rows[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }); return send(res, 200, r.rows); }
    const b = await body(req);
    if (req.method === "POST") { const rows = Array.isArray(b) ? b : [b], cols = Object.keys(rows[0]).filter(idOk), v2 = [], tuples = rows.map(row => "(" + cols.map(c => { v2.push(row[c] === undefined ? null : (row[c] !== null && typeof row[c] === "object" && !Array.isArray(row[c]) ? JSON.stringify(row[c]) : row[c])); return "$" + v2.length; }).join(",") + ")");
      const r = await asUser(sub, c => c.query(`insert into public."${t}" (${cols.map(c => `"${c}"`).join(",")}) values ${tuples.join(",")} returning *`, v2)); return send(res, 201, single ? r.rows[0] : r.rows); }
    if (req.method === "PATCH") { const cols = Object.keys(b).filter(idOk), set = cols.map(c => { vals.push(b[c] !== null && typeof b[c] === "object" && !Array.isArray(b[c]) ? JSON.stringify(b[c]) : b[c]); return `"${c}" = $${vals.length}`; });
      const r = await asUser(sub, c => c.query(`update public."${t}" set ${set.join(",")}${w} returning *`, vals)); if (single) return r.rows.length === 1 ? send(res, 200, r.rows[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }); return send(res, 200, r.rows); }
    if (req.method === "DELETE") { await asUser(sub, c => c.query(`delete from public."${t}"${w}`, vals)); return send(res, 204); }
    send(res, 405, { message: "method" });
  } catch (e) { send(res, e.code === "42501" ? 403 : 400, { code: e.code || "MOCK", message: e.message, details: e.detail || null, hint: e.hint || null }); } }
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => { const url = new URL(req.url, "http://x"); if (req.method === "OPTIONS") return send(res, 204);
  try {
    if (url.pathname.startsWith("/sb/auth/v1/")) return await auth(req, res, url.pathname.slice(12), url);
    if (url.pathname.startsWith("/sb/rest/v1/")) return await rest(req, res, url.pathname.slice(12), url);
    if (url.pathname === "/app/config.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(`window.WERGUI_CONFIG={supabaseUrl:"http://localhost:${PORT}/sb",supabaseAnonKey:"anon",medicamentsUrl:"/medicaments.json",contactWhatsApp:"221770000000"};`); }
    let f = path.join(ROOT, decodeURIComponent(url.pathname)); if (!f.startsWith(ROOT)) return send(res, 403); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) return send(res, 404, { message: "not found" }); res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 500, { message: e.message }); } }).listen(PORT, () => console.log("mock supabase on " + PORT));
