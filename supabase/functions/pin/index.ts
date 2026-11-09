// Wergui SN — fonction serveur « pin »
// • connexion : sur un poste déclaré, ouvre la session d'un membre après vérification de son code PIN
// • creer_membre : le titulaire crée un compte vendeur sans e-mail (nom + PIN)
// Le PIN est vérifié en base (public.pin_connexion : jeton du poste + PIN, blocage après 5 erreurs).
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_SB, SERVICE, opts);

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") || "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

Deno.serve(async (req) => {
  const h = cors(req);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "Requête invalide" }, 400); }

  try {
    if (b.action === "connexion") {
      if (!b.jeton || !b.user_id || !b.pin) return json({ error: "Informations manquantes" }, 400);
      const { data: r, error } = await admin.rpc("pin_connexion", { p_jeton: b.jeton, p_user: b.user_id, p_pin: String(b.pin) });
      if (error) return json({ error: error.message }, 400);
      if (!r.ok) return json(r);
      const { data: lien, error: e2 } = await admin.auth.admin.generateLink({ type: "magiclink", email: r.email });
      if (e2 || !lien?.properties?.hashed_token) return json({ error: "Connexion impossible pour le moment." }, 500);
      const anon = createClient(URL_SB, ANON, opts);
      const { data: v, error: e3 } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: lien.properties.hashed_token });
      if (e3 || !v.session) return json({ error: "Connexion impossible pour le moment." }, 500);
      return json({ ok: true, session: { access_token: v.session.access_token, refresh_token: v.session.refresh_token } });
    }

    if (b.action === "creer_membre") {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u, error } = await admin.auth.getUser(jwt);
      if (error || !u?.user) return json({ error: "Connexion requise" }, 401);
      const args = { p: b.pharmacy_id, p_demandeur: u.user.id, p_nom: b.nom, p_role: b.role, p_pin: String(b.pin || "") };
      const { error: ev } = await admin.rpc("membre_sans_email_verifier", args);
      if (ev) return json({ error: ev.message }, 400);
      const email = `m.${crypto.randomUUID()}@membres.werguisn.invalid`;
      const { data: cu, error: ec } = await admin.auth.admin.createUser({
        email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true,
        user_metadata: { nom: String(b.nom || "").trim(), sans_email: true },
      });
      if (ec || !cu?.user) return json({ error: "Création du compte impossible : " + (ec?.message || "erreur") }, 400);
      const { error: em } = await admin.rpc("membre_sans_email_creer", { ...args, p_user: cu.user.id });
      if (em) { await admin.auth.admin.deleteUser(cu.user.id); return json({ error: em.message }, 400); }
      return json({ ok: true, user_id: cu.user.id });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: "Erreur du serveur : " + String((e as Error)?.message || e) }, 500);
  }
});
