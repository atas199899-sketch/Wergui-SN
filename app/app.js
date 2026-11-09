/* Wergui SN — application reliée à Supabase (sans étape de compilation). */
"use strict";
const CFG = window.WERGUI_CONFIG || {};
const APP_URL = location.origin + location.pathname;

/* ================================================================ outils */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => Math.round(n || 0).toLocaleString("fr-FR") + " F";
const nb = n => (+n || 0).toLocaleString("fr-FR", {maximumFractionDigits: 1});
const pd = s => { const [a, b, c] = String(s).slice(0, 10).split("-").map(Number); return new Date(a, b - 1, c); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const dj = s => Math.round((pd(s) - today()) / 864e5);
const dfr = s => { const d = pd(s); return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear(); };
const hm = s => { const d = new Date(s); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const pl = (n, w, wp) => n + " " + (n > 1 ? (wp || w + "s") : w);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
function toast(t, bad) { document.querySelectorAll(".toast").forEach(x => x.remove()); const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); if (bad) el.style.background = "var(--bad)"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), bad ? 6000 : 3600); }
function closeLayer() { $("#layer").innerHTML = ""; }
function layer(html, center) { $("#layer").innerHTML = `<div class="overlay ${center ? "center" : ""}" data-close="1">${html}</div>`; cards($("#layer")); const f = $("#layer .x"); f && f.focus(); }
function errMsg(e) { const m = (e && (e.message || e.error_description || e.msg)) || String(e); if (/Invalid login credentials/i.test(m)) return "E-mail ou mot de passe incorrect."; if (/Email not confirmed/i.test(m)) return "Confirmez d'abord votre e-mail (lien reçu par e-mail)."; if (/User already registered/i.test(m)) return "Un compte existe déjà avec cet e-mail : connectez-vous."; if (/Password should be at least|weak/i.test(m)) return "Mot de passe trop court ou trop simple (8 caractères minimum)."; if (/Failed to fetch|NetworkError/i.test(m)) return "Pas de connexion internet. Réessayez."; return m; }
async function run(btn, fn) { if (btn) btn.classList.add("busy"); try { return await fn(); } catch (e) { console.warn(e); toast(errMsg(e), true); } finally { if (btn) btn.classList.remove("busy"); } }
function cards(root) { (root || document).querySelectorAll(".tw table").forEach(t => { t.classList.add("cards"); const h = [...t.querySelectorAll("thead th")].map(x => x.textContent.trim()); t.querySelectorAll("tbody tr,tfoot tr").forEach(tr => { let i = 0; [...tr.children].forEach(td => { if (!td.hasAttribute("data-l")) td.setAttribute("data-l", td.colSpan > 1 ? "" : (h[i] || "")); i += td.colSpan || 1; }); }); }); }
const normPhone = t => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 9) d = "221" + d; return d; };

/* ================================================================ accès aux données (Supabase) */
const sb = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
const COLS = { produits: "id,pharmacy_id,nom,presentation,rayon_id,fournisseur_id,prix_vente,seuil,codes,actif,created_at", vente_lignes: "id,vente_id,pharmacy_id,produit_id,lot_id,quantite,prix_unitaire,created_at" };
async function all(table, build) { // lit toutes les lignes, par pages de 1000
  let out = [], from = 0;
  for (;;) { const rows = await q(build(sb.from(table).select(COLS[table] || "*")).range(from, from + 999)); out = out.concat(rows); if (rows.length < 1000) return out; from += 1000; }
}
const rpc = (fn, args) => q(sb.rpc(fn, args));
const API = {
  async session() { const { data } = await sb.auth.getSession(); return data.session; },
  signIn: (email, password) => q(sb.auth.signInWithPassword({ email, password })),
  signUp: (email, password, data) => q(sb.auth.signUp({ email, password, options: { data, emailRedirectTo: APP_URL } })),
  signOut: () => sb.auth.signOut(),
  recover: email => q(sb.auth.resetPasswordForEmail(email, { redirectTo: APP_URL })),
  setPassword: password => q(sb.auth.updateUser({ password })),
  memberships: uid => q(sb.from("membres").select("*").eq("user_id", uid).eq("actif", true)),
  pharmacies: ids => ids.length ? q(sb.from("pharmacies").select("*").in("id", ids)) : [],
  async load(pid) {
    const since = new Date(Date.now() - 31 * 864e5).toISOString(), month = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const [ph, membres, rayons, fours, produits, lots, ventes, lignes, mvts] = await Promise.all([
      q(sb.from("pharmacies").select("*").eq("id", pid).single()),
      all("membres", b => b.eq("pharmacy_id", pid)),
      all("rayons", b => b.eq("pharmacy_id", pid).order("nom")),
      all("fournisseurs", b => b.eq("pharmacy_id", pid).order("nom")),
      all("produits", b => b.eq("pharmacy_id", pid).order("nom")),
      all("lots", b => b.eq("pharmacy_id", pid).gt("quantite", 0)),
      all("ventes", b => b.eq("pharmacy_id", pid).gte("created_at", since).order("created_at", { ascending: false })),
      all("vente_lignes", b => b.eq("pharmacy_id", pid).gte("created_at", since)),
      all("mouvements", b => b.eq("pharmacy_id", pid).gte("created_at", month))
    ]);
    let cmds = [], cmdLignes = [];
    try { cmds = await all("commandes", b => b.eq("pharmacy_id", pid).eq("statut", "envoyee")); cmdLignes = cmds.length ? await all("commande_lignes", b => b.in("commande_id", cmds.map(c => c.id))) : []; } catch (e) { /* pas de droit commandes */ }
    const couts = await rpc("couts_achat", { p: pid }), cm = new Map(couts.map(c => [c.id, c.prix_achat])); // vide sans le droit « Prix d'achat »
    produits.forEach(p => p.prix_achat = cm.get(p.id) || 0);
    const vids = new Set(ventes.map(v => v.id));
    let caisse = null; try { caisse = (await q(sb.from("caisses").select("id,fond,ouverte_par,ouverte_le,statut").eq("pharmacy_id", pid).eq("statut", "ouverte")))[0] || null; } catch (e) {}
    return { caisse, ph, membres, rayons, fours, produits, lots, ventes, lignes: lignes.filter(l => vids.has(l.vente_id)), mvts, cmds, cmdLignes };
  },
  signOutAll: () => sb.auth.signOut({ scope: "global" }),
  supprimerCompte: (avecPharmacies) => rpc("supprimer_mon_compte", { p_supprimer_pharmacies: avecPharmacies }),
  supprimerPharmacie: (p, nom) => rpc("supprimer_pharmacie", { p, p_nom: nom }),
  transferer: (p, user) => rpc("transferer_titulaire", { p, p_user: user }),
  suisAdmin: () => rpc("suis_admin", {}),
  adminPharmacies: () => rpc("admin_pharmacies", {}),
  adminDefinir: (p, formule, statut, paye) => rpc("admin_definir_abonnement", { p, p_formule: formule, p_statut: statut, p_paye_jusqu: paye || null }),
  toutesVentes: async pid => { const v = await all("ventes", b => b.eq("pharmacy_id", pid).order("created_at", { ascending: false })), l = await all("vente_lignes", b => b.eq("pharmacy_id", pid)); return { v, l }; },
  creerPharmacie: (nom, ville, tel, titulaire) => rpc("creer_pharmacie", { p_nom: nom, p_ville: ville, p_telephone: tel, p_nom_titulaire: titulaire }),
  vendre: (p, lignes, mode, remise, organisme) => rpc("enregistrer_vente", { p, p_lignes: lignes, p_mode: mode, p_remise_pct: remise, p_organisme: organisme }),
  ajouterLot: (p, produit, numero, peremption, quantite) => rpc("ajouter_lot", { p, p_produit: produit, p_numero: numero, p_peremption: peremption, p_quantite: quantite }),
  sortirLot: (lot, type) => rpc("sortir_lot", { p_lot: lot, p_type: type }),
  inventaire: (p, produit, compte) => rpc("ajuster_inventaire", { p, p_produit: produit, p_compte: compte }),
  creerCommande: (p, four, lignes) => rpc("creer_commande", { p, p_fournisseur: four, p_lignes: lignes }),
  receptionner: (c, lignes) => rpc("receptionner_commande", { p_commande: c, p_lignes: lignes }),
  ajouterMembre: (p, email, nom, role, droits) => rpc("ajouter_membre", { p, p_email: email, p_nom: nom, p_role: role, p_droits: droits }),
  modifierMembre: (p, user, nom, role, droits, actif) => rpc("modifier_membre", { p, p_user: user, p_nom: nom, p_role: role, p_droits: droits, p_actif: actif }),
  insert: (t, row) => q(sb.from(t).insert(row).select(COLS[t] || "*").single()),
  update: (t, id, patch) => q(sb.from(t).update(patch).eq("id", id).select(COLS[t] || "*").single()),
  remove: (t, id) => q(sb.from(t).delete().eq("id", id)),
  priorite: (lot, v) => q(sb.from("lots").update({ prioritaire: v }).eq("id", lot)),
  ouvrirCaisse: (p, fond) => rpc("ouvrir_caisse", { p, p_fond: fond }),
  fermerCaisse: (p, compte) => rpc("fermer_caisse", { p, p_compte: compte }),
  caisseAttendue: p => rpc("caisse_attendue", { p }),
  creerBordereau: (p, org) => rpc("creer_bordereau", { p, p_organisme: org }),
  majBordereau: (b, envoye, encaisse) => rpc("maj_bordereau", { b, p_envoye: envoye, p_encaisse: encaisse }),
  payerFacture: (f, montant, avoir) => rpc("payer_facture", { f, p_montant: montant, p_avoir: avoir }),
  ventesBordereau: b => q(sb.from("ventes").select("id,created_at,part_assurance").eq("bordereau_id", b).order("created_at")),
  ventesDepuis: (p, d) => all("ventes", b => b.eq("pharmacy_id", p).gte("created_at", d).order("created_at")),
  async finances(p) {
    const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1), m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1), d = x => iso(x);
    const [caisses, depenses, bordereaux, factures, avoirs, attendu, resA, resB, nonFact] = await Promise.all([
      q(sb.from("caisses").select("*").eq("pharmacy_id", p).order("ouverte_le", { ascending: false }).limit(40)),
      q(sb.from("depenses").select("*").eq("pharmacy_id", p).gte("date_depense", d(new Date(now.getFullYear(), now.getMonth() - 3, 1))).order("date_depense", { ascending: false }).order("created_at", { ascending: false })),
      q(sb.from("bordereaux").select("*").eq("pharmacy_id", p).order("created_at", { ascending: false })),
      q(sb.from("factures").select("*").eq("pharmacy_id", p).order("echeance")),
      rpc("avoirs_grossistes", { p }), rpc("caisse_attendue", { p }),
      rpc("resultat_mois", { p, p_debut: d(m0) }), rpc("resultat_mois", { p, p_debut: d(m1) }),
      all("ventes", b => b.eq("pharmacy_id", p).gt("part_assurance", 0).is("bordereau_id", null))
    ]);
    const af = {}; nonFact.forEach(v => { const k = v.organisme || "Assurance", x = af[k] = af[k] || { o: k, m: 0, n: 0 }; x.m += v.part_assurance; x.n++; });
    const one = r => Object.fromEntries(Object.entries((Array.isArray(r) ? r[0] : r) || {}).map(([k, v]) => [k, +v || 0]));
    return { caisses, ouverte: caisses.find(c => c.statut === "ouverte") || null, depenses, bordereaux, factures, avoirs, attendu, res: [one(resA), one(resB)], aFacturer: Object.values(af) };
  }
};

/* ================================================================ état */
const S = { user: null, pid: null, phs: [], mems: [], view: "accueil", cart: [], pay: null, remise: 0, org: "", q: "", fcat: "", fst: "", perTab: "perimes", couv: null, cmdQ: {}, invCat: null, inv: {}, setTab: "pharmacie", scanMode: "entree", finTab: "caisse", fin: null, cur: null, cam: null, scans: [] };
let D = null; // données de la pharmacie ouverte
const PERMS = [["dash","Voir le tableau de bord et les chiffres du jour","Tableau de bord"],["achat","Voir les prix d'achat et les marges","Prix d'achat"],["remise","Accorder des remises en caisse","Remises"],["per","Retirer des lots périmés et préparer les retours","Retraits et retours"],["recep","Réceptionner les livraisons et entrer du stock","Réceptions"],["cmd","Passer les commandes aux grossistes","Commandes"],["inv","Faire les inventaires","Inventaires"],["prod","Créer et modifier les produits et les prix","Produits et prix"],["fin","Voir les finances et clôturer la caisse","Finances"]];
const ROLES = { adjoint: { n: "Pharmacien adjoint", perm: ["dash","achat","remise","per","recep","cmd","inv","prod","fin"] }, vendeur: { n: "Vendeur", perm: ["per","recep"] }, stagiaire: { n: "Stagiaire", perm: [] } };
const permOf = r => Object.fromEntries(PERMS.map(([k]) => [k, (ROLES[r] || { perm: [] }).perm.includes(k)]));
const me = () => D && D.membres.find(m => m.user_id === S.user.id);
const isTit = () => me() && me().role === "titulaire";
const can = k => isTit() || !!(me() && me().droits && me().droits[k]);
const roleName = r => r === "titulaire" ? "Titulaire" : (ROLES[r] || {}).n || r;
const premium = () => D.ph.formule === "officine" || D.ph.statut === "essai";
const essaiReste = () => D.ph.statut === "essai" ? dj(D.ph.essai_fin) : null;
const CONTACT_MAIL = CFG.contactEmail || "contact.werguisn@gmail.com";
function contactLien(msg) { return CFG.contactWhatsApp ? `https://wa.me/${normPhone(CFG.contactWhatsApp)}?text=${encodeURIComponent(msg)}` : `mailto:${CONTACT_MAIL}?subject=${encodeURIComponent("Wergui SN – " + D.ph.nom)}&body=${encodeURIComponent(msg)}`; }
function bandeau() { const p = D.ph, r = essaiReste();
  if (p.statut === "suspendu") return `<p class="err" role="alert">Abonnement suspendu : les ventes et entrées de stock sont bloquées, vos données restent consultables. ${isTit() ? `<a href="${contactLien("Bonjour, je souhaite réactiver l'abonnement de " + p.nom)}" target="_blank" rel="noopener">Réactiver</a>` : "Prévenez le titulaire."}</p>`;
  if (r != null && r < 0) return `<p class="err" role="alert">Votre période d'essai est terminée. ${isTit() ? `<button class="linkbtn" data-go="abonnement">Choisir une formule</button>` : "Prévenez le titulaire."}</p>`;
  if (r != null && r <= 7 && isTit()) return `<p class="info">Essai gratuit : ${pl(r, "jour restant", "jours restants")}. <button class="linkbtn" data-go="abonnement">Choisir une formule</button></p>`;
  return ""; }
const R = () => Object.assign({ alerte_jours: 90, securite_jours: 4, couverture_jours: 14, reception_mois: 6, tiers_payant: 80, paiements: ["Espèces","Wave","Orange Money","Assurance"], organismes: ["IPM","Mutuelle","CMU"] }, (D && D.ph.reglages) || {});

/* ================================================================ calculs « pensés pharmacie » */
const byId = id => D.produits.find(p => p.id === id);
const fourOf = p => D.fours.find(f => f.id === p.fournisseur_id) || { nom: "—", delai_jours: 2, reprend_produits: false };
const rayonOf = p => (D.rayons.find(r => r.id === p.rayon_id) || {}).nom || "Sans rayon";
const lotsOf = p => D.lots.filter(l => l.produit_id === p.id && l.quantite > 0);
const live = p => lotsOf(p).filter(l => dj(l.peremption) >= 0).sort((a, b) => a.peremption < b.peremption ? -1 : 1);
const dead = p => lotsOf(p).filter(l => dj(l.peremption) < 0);
const stock = p => live(p).reduce((s, l) => s + l.quantite, 0);
let VJ = {}; // ventes moyennes par jour, sur 30 jours
function computeVJ() { VJ = {}; D.lignes.forEach(l => { VJ[l.produit_id] = (VJ[l.produit_id] || 0) + l.quantite; }); Object.keys(VJ).forEach(k => VJ[k] = VJ[k] / 30); }
const vj = p => VJ[p.id] || 0;
const seuil = p => p.seuil != null ? p.seuil : Math.ceil(vj(p) * (fourOf(p).delai_jours + R().securite_jours));
const jours = p => vj(p) ? Math.floor(stock(p) / vj(p)) : null;
function etat(p) { const s = stock(p); return s === 0 ? ["Rupture", "bad"] : (seuil(p) && s < seuil(p)) ? ["Sous le seuil", "warn"] : ["En stock", "ok"]; }
function invendus(p) { let c = 0; const v = vj(p); return live(p).map(l => { const cap = Math.max(0, Math.floor(v * dj(l.peremption)) - c), sold = Math.min(l.quantite, cap); c += sold; return { p, l, u: l.quantite - sold }; }).filter(x => x.u > 0 && v > 0); }
const enCommande = pid => D.cmdLignes.filter(l => l.produit_id === pid).reduce((s, l) => s + l.quantite, 0);
function sugg(p) { const s = stock(p) + enCommande(p.id), se = seuil(p); if (!se || s >= se) return 0; const couv = S.couv || R().couverture_jours; const cible = Math.max(p.seuil != null ? p.seuil * 2 : 0, Math.ceil(vj(p) * (fourOf(p).delai_jours + couv))); return Math.max(1, cible - s); }
const qCmd = p => S.cmdQ[p.id] != null ? S.cmdQ[p.id] : sugg(p);
const allLots = () => D.lots.filter(l => l.quantite > 0).map(l => ({ p: byId(l.produit_id), l, d: dj(l.peremption) })).filter(x => x.p);
const perimes = () => allLots().filter(x => x.d < 0);
const sous = (a, b) => allLots().filter(x => x.d >= a && x.d < b).sort((x, y) => x.d - y.d);
const valStock = () => D.produits.reduce((s, p) => s + stock(p) * p.prix_achat, 0);
const ventesJour = () => { const t = iso(today()); return D.ventes.filter(v => iso(new Date(v.created_at)) === t); };
const sugList = () => D.produits.filter(p => p.actif && sugg(p) > 0);
const nomMembre = uid => (D.membres.find(m => m.user_id === uid) || {}).nom || "—";

/* ================================================================ icônes et navigation */
const ICO = { accueil: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>', caisse: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h4M14 13h3M7 17h4M14 17h3"/>', scanner: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 16h3"/>', stock: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', peremption: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>', commandes: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>', inventaire: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10l2 2 4-4M9 16h6"/>', parametres: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>', finances: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', console: '<path d="M4 5h16v10H4zM8 19h8M12 15v4"/>', deconnexion: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', abonnement: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>', plus: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>' };
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;
const SHORT = { accueil: "Accueil", caisse: "Caisse", scanner: "Scanner", stock: "Stock", peremption: "Péremptions", commandes: "Commandes", inventaire: "Inventaire", finances: "Finances", parametres: "Paramètres", abonnement: "Abonnement", console: "Console" };
function navItems() {
  const per = perimes().length + sous(0, 30).length, sg = can("cmd") ? sugList().length : 0, rec = D.cmds.length;
  const all = [["accueil","Tableau de bord"],["caisse","Caisse"],["scanner","Scanner"],["stock","Stock"],["peremption","Péremptions",per],["commandes","Commandes",sg + rec],["inventaire","Inventaire"],["finances","Finances"],["parametres","Paramètres"],["abonnement","Abonnement"]];
  if (S.admin) all.push(["console","Console Wergui SN"]);
  const ok = { accueil: can("dash"), finances: can("fin"), commandes: can("cmd") || can("recep"), inventaire: can("inv"), parametres: isTit(), abonnement: isTit() };
  return all.filter(i => ok[i[0]] !== false);
}
const mainTabs = () => can("dash") ? ["accueil","caisse","scanner","stock"] : ["caisse","scanner","stock","peremption"];
function shell() {
  $("#root").innerHTML = `<div class="app"><aside class="side"><div class="brand"><svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="8" fill="currentColor" opacity=".16"/><path d="M12 6h6v6h6v6h-6v6h-6v-6H6v-6h6z" fill="currentColor"/></svg><div><b>Wergui SN</b><small>Stock pharmacie</small></div></div>
    <button class="mrole" id="mrole" data-act="compte" aria-label="Mon compte"></button>
    <div class="role"><span class="lbl" style="color:inherit;opacity:.8;font-size:.7rem">Connecté</span><button class="who" id="role" data-act="compte" aria-label="Mon compte"></button></div>
    <nav class="nav" id="nav" aria-label="Sections"></nav><div class="foot" id="foot"></div></aside>
    <main id="main"></main><nav class="tabbar" id="tabbar" aria-label="Navigation"></nav></div>`;
}
function nav() {
  const items = navItems(); if (!items.some(i => i[0] === S.view)) S.view = items[0][0];
  $("#nav").innerHTML = items.map(([k, l, n]) => `<button data-go="${k}" ${S.view === k ? 'aria-current="page"' : ""}><span class="ico">${svg(k)}${l}</span>${n ? `<span class="pill">${n}</span>` : ""}</button>`).join("");
  const mt = mainTabs(), rest = items.filter(i => !mt.includes(i[0])), restN = rest.reduce((a, i) => a + (i[2] || 0), 0), tb = $("#tabbar");
  tb.style.setProperty("--n", mt.length + (rest.length ? 1 : 0));
  tb.innerHTML = mt.filter(k => items.some(i => i[0] === k)).map(k => { const it = items.find(i => i[0] === k); return k === "scanner" ? `<button class="scan" data-go="scanner" ${S.view === k ? 'aria-current="page"' : ""}><span class="b">${svg(k)}</span><small>Scanner</small></button>` : `<button data-go="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${svg(k)}<span>${SHORT[k]}</span>${it && it[2] ? `<span class="dot">${it[2]}</span>` : ""}</button>`; }).join("") + (rest.length ? `<button data-act="more" ${rest.some(i => i[0] === S.view) ? 'aria-current="page"' : ""}>${svg("plus")}<span>Plus</span>${restN ? `<span class="dot">${restN}</span>` : ""}</button>` : "");
  const m = me(), ini = esc(m.nom.replace(/^Dr\s+/, "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase());
  $("#role").innerHTML = `<span class="av">${ini}</span><span class="nm"><b>${esc(m.nom)}</b><small>${roleName(m.role)} · ${esc(D.ph.nom)}</small></span><span class="chev">▾</span>`;
  $("#mrole").innerHTML = `<span class="av">${ini}</span><span>${esc(m.nom.split(" ")[0])}</span>`;
  $("#foot").innerHTML = `${esc(D.ph.nom)}<br>${D.ph.statut === "essai" ? "Période d'essai" : D.ph.statut === "suspendu" ? "Abonnement suspendu" : (D.ph.formule === "officine" ? "Formule Officine" : "Formule Petite officine")}<br><button class="linkbtn" data-act="logout" style="color:inherit;margin-top:8px">Se déconnecter</button>`;
}
function more() { const items = navItems(), mt = mainTabs(); layer(`<div class="sheet" role="dialog" aria-modal="true" aria-label="Plus"><div class="grab"></div>${items.filter(i => !mt.includes(i[0])).map(([k, l, n]) => `<button class="it" data-go="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${svg(k)}${l}${n ? `<span class="pill">${n}</span>` : ""}</button>`).join("")}<button class="it" data-act="compte">${svg("plus")}Mon compte</button><button class="it" data-act="logout">${svg("deconnexion")}Se déconnecter</button></div>`); }
function render(keep) { stopCam(); nav(); const y = window.scrollY; $("#main").innerHTML = bandeau() + V[S.view](); if (S.view === "stock") fillStock(); if (S.view === "caisse") fillRes(); if (S.view === "inventaire") invTotals(); if (S.view === "scanner") { V_scanRes(); V_scanList(); loadMed(); } cards(); window.scrollTo(0, keep ? y : 0); }
let LAST = Date.now();
["click","keydown","touchstart","scroll"].forEach(ev => document.addEventListener(ev, () => { LAST = Date.now(); }, { passive: true }));
setInterval(async () => { if (!D) return; const min = +R().deconnexion_min || 0; if (min && Date.now() - LAST > min * 60000) { stopCam(); await API.signOut(); D = null; S.pid = null; closeLayer(); authScreen("login", `Déconnecté après ${min} minutes d'inactivité.`); } }, 30000);
function confirmerTexte(t) { return S._confirm === t ? (S._confirm = null, true) : (S._confirm = t, toast(t + " Touchez à nouveau pour confirmer."), false); }
function go(v) { S.view = v; S.q = ""; if (v === "finances") S.fin = null; closeLayer(); render(); }
const head = (t, s, right = "") => `<div class="top"><div><h1>${t}</h1><p>${s}</p></div><div class="row">${right}</div></div>`;
async function reload(keep) { D = await API.load(S.pid); computeVJ(); if (!S.invCat) S.invCat = (D.rayons[0] || {}).id || ""; render(keep); }

/* ================================================================ écrans de connexion */
function authScreen(mode, msg, err) {
  stopCam();
  const f = { login: `<form data-form="login"><div class="field"><label for="ae">E-mail</label><input id="ae" type="email" autocomplete="email" required></div><div class="field"><label for="ap">Mot de passe</label><input id="ap" type="password" autocomplete="current-password" required></div><button class="btn pri">Se connecter</button></form>
      <div class="row" style="justify-content:space-between"><button class="linkbtn" data-auth="creer">Créer ma pharmacie</button><button class="linkbtn" data-auth="oubli">Mot de passe oublié ?</button></div><button class="linkbtn" data-auth="rejoindre">Je travaille dans une pharmacie déjà inscrite</button>`,
    creer: `<p class="muted">Créez le compte du pharmacien titulaire. Votre pharmacie est prête en 1 minute, en période d'essai gratuite.</p><form data-form="creer"><div class="field"><label for="cn">Votre nom</label><input id="cn" required placeholder="Dr Aïssatou Ndiaye" autocomplete="name"></div><div class="field"><label for="cph">Nom de la pharmacie</label><input id="cph" required placeholder="Pharmacie …"></div><div class="row"><div class="field" style="flex:1"><label for="cv">Ville</label><input id="cv" placeholder="Dakar"></div><div class="field" style="flex:1"><label for="ct">Téléphone</label><input id="ct" type="tel" placeholder="77 …"></div></div><div class="field"><label for="ce">E-mail</label><input id="ce" type="email" required autocomplete="email"></div><div class="field"><label for="cp">Mot de passe (8 caractères minimum)</label><input id="cp" type="password" minlength="8" required autocomplete="new-password"></div><label class="row" style="gap:8px;flex-wrap:nowrap;align-items:flex-start;font-size:.88rem"><input type="checkbox" id="ccgu" required style="width:20px;height:20px;flex:none"> <span>J'accepte les <a href="../conditions/" target="_blank">conditions d'utilisation</a> et la <a href="../confidentialite/" target="_blank">politique de confidentialité</a>.</span></label><button class="btn pri">Créer ma pharmacie</button></form><button class="linkbtn" data-auth="login">J'ai déjà un compte</button>`,
    rejoindre: `<p class="muted">Créez votre compte personnel. Ensuite, donnez votre e-mail au pharmacien titulaire : il vous ajoute à l'équipe depuis ses paramètres.</p><form data-form="rejoindre"><div class="field"><label for="rn">Votre nom</label><input id="rn" required autocomplete="name"></div><div class="field"><label for="re">E-mail</label><input id="re" type="email" required autocomplete="email"></div><div class="field"><label for="rp">Mot de passe (8 caractères minimum)</label><input id="rp" type="password" minlength="8" required autocomplete="new-password"></div><label class="row" style="gap:8px;flex-wrap:nowrap;align-items:flex-start;font-size:.88rem"><input type="checkbox" id="rcgu" required style="width:20px;height:20px;flex:none"> <span>J'accepte les <a href="../conditions/" target="_blank">conditions d'utilisation</a> et la <a href="../confidentialite/" target="_blank">politique de confidentialité</a>.</span></label><button class="btn pri">Créer mon compte</button></form><button class="linkbtn" data-auth="login">J'ai déjà un compte</button>`,
    oubli: `<p class="muted">Recevez un lien par e-mail pour choisir un nouveau mot de passe.</p><form data-form="oubli"><div class="field"><label for="oe">E-mail</label><input id="oe" type="email" required autocomplete="email"></div><button class="btn pri">Envoyer le lien</button></form><button class="linkbtn" data-auth="login">Retour à la connexion</button>`,
    nouveau: `<p class="muted">Choisissez votre nouveau mot de passe.</p><form data-form="nouveau"><div class="field"><label for="np">Nouveau mot de passe</label><input id="np" type="password" minlength="8" required autocomplete="new-password"></div><button class="btn pri">Enregistrer</button></form>` };
  const t = { login: "Connexion", creer: "Créer ma pharmacie", rejoindre: "Rejoindre une pharmacie", oubli: "Mot de passe oublié", nouveau: "Nouveau mot de passe" }[mode];
  $("#root").innerHTML = `<div class="auth"><div class="authcard"><div class="logo"><svg width="34" height="34" viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="8" fill="currentColor" opacity=".16"/><path d="M12 6h6v6h6v6h-6v6h-6v-6H6v-6h6z" fill="currentColor"/></svg><b>Wergui SN</b></div><h1>${t}</h1>${err ? `<p class="err">${esc(err)}</p>` : ""}${msg ? `<p class="info">${esc(msg)}</p>` : ""}${f[mode]}<p class="muted" style="font-size:.8rem"><a href="../">Accueil</a> · <a href="../demo/">Voir la démo</a> · <a href="../confidentialite/">Confidentialité</a> · <a href="../conditions/">Conditions</a></p></div></div>`;
  const i = $("#root input"); i && i.focus();
}
async function onForm(form) {
  const v = id => (document.getElementById(id) || {}).value?.trim() || "", btn = form.querySelector("button");
  const k = form.dataset.form;
  await run(btn, async () => {
    if (k === "login") { await API.signIn(v("ae"), document.getElementById("ap").value); await boot(); }
    else if (k === "creer") { const r = await API.signUp(v("ce"), document.getElementById("cp").value, { nom: v("cn"), intent: "creer", cgu_acceptees: new Date().toISOString(), pharmacie: { nom: v("cph"), ville: v("cv"), telephone: v("ct") } }); if (r.session) await boot(); else authScreen("login", "Compte créé. Ouvrez l'e-mail que nous venons d'envoyer et cliquez sur le lien pour l'activer, puis connectez-vous."); }
    else if (k === "rejoindre") { const r = await API.signUp(v("re"), document.getElementById("rp").value, { nom: v("rn"), intent: "rejoindre", cgu_acceptees: new Date().toISOString() }); if (r.session) await boot(); else authScreen("login", "Compte créé. Activez-le avec le lien reçu par e-mail, puis donnez votre e-mail au titulaire de la pharmacie."); }
    else if (k === "oubli") { await API.recover(v("oe")); authScreen("login", "Si un compte existe avec cet e-mail, vous allez recevoir un lien pour changer le mot de passe."); }
    else if (k === "nouveau") { await API.setPassword(document.getElementById("np").value); toast("Mot de passe changé."); await boot(); }
    else if (k === "pharma") { const id = await API.creerPharmacie(v("pn"), v("pv"), v("pt"), v("pt2") || (S.user.user_metadata || {}).nom || ""); S.pid = id; store.set("wergui.pid", id); await boot(); }
  });
}
function noPharmacy() {
  const meta = S.user.user_metadata || {};
  $("#root").innerHTML = `<div class="auth"><div class="authcard"><div class="logo"><b>Wergui SN</b></div><h1>Bienvenue ${esc(meta.nom || "")}</h1>
    <p class="note-box">Vous n'êtes membre d'aucune pharmacie pour l'instant. <b>Vous travaillez dans une pharmacie ?</b> Donnez cet e-mail au titulaire : <b>${esc(S.user.email)}</b>. Il vous ajoute depuis Paramètres → Équipe, puis touchez « Actualiser ».</p>
    <button class="btn" data-act="boot">Actualiser</button>
    <h2>Ou créez votre pharmacie</h2>
    <form data-form="pharma"><div class="field"><label for="pt2">Votre nom</label><input id="pt2" value="${esc(meta.nom || "")}"></div><div class="field"><label for="pn">Nom de la pharmacie</label><input id="pn" required></div><div class="row"><div class="field" style="flex:1"><label for="pv">Ville</label><input id="pv"></div><div class="field" style="flex:1"><label for="pt">Téléphone</label><input id="pt" type="tel"></div></div><button class="btn pri">Créer ma pharmacie</button></form>
    <button class="linkbtn" data-act="logout">Se déconnecter</button></div></div>`;
}
function pickPharmacy() {
  $("#root").innerHTML = `<div class="auth"><div class="authcard"><div class="logo"><b>Wergui SN</b></div><h1>Choisir la pharmacie</h1><div style="display:flex;flex-direction:column;gap:8px">${S.phs.map(p => { const m = S.mems.find(x => x.pharmacy_id === p.id); return `<button class="pick" data-pid="${p.id}"><span class="nm"><b>${esc(p.nom)}</b><small>${esc(p.ville || "")} · ${roleName(m.role)}</small></span></button>`; }).join("")}</div><button class="linkbtn" data-act="logout">Se déconnecter</button></div></div>`;
}
async function boot() {
  if (!sb) { $("#root").innerHTML = `<div class="auth"><div class="authcard"><div class="logo"><b>Wergui SN</b></div><h1>Bientôt disponible</h1><p class="muted">L'application est en cours de mise en service. En attendant, essayez la démo.</p><a class="btn pri" href="../demo/" style="text-align:center;text-decoration:none">Voir la démo</a></div></div>`; return; }
  const ses = await API.session();
  if (!ses) { authScreen(location.hash === "#creer" ? "creer" : location.hash === "#rejoindre" ? "rejoindre" : "login"); return; }
  S.user = ses.user;
  S.mems = await API.memberships(S.user.id);
  if (!S.mems.length) {
    const meta = S.user.user_metadata || {};
    if (meta.intent === "creer" && meta.pharmacie && meta.pharmacie.nom && !store.get("wergui.created." + S.user.id)) {
      store.set("wergui.created." + S.user.id, "1");
      try { const id = await API.creerPharmacie(meta.pharmacie.nom, meta.pharmacie.ville || "", meta.pharmacie.telephone || "", meta.nom || ""); S.pid = id; store.set("wergui.pid", id); return boot(); } catch (e) { toast(errMsg(e), true); }
    }
    noPharmacy(); return;
  }
  S.phs = await API.pharmacies(S.mems.map(m => m.pharmacy_id));
  const last = S.pid || store.get("wergui.pid");
  if (last && S.mems.some(m => m.pharmacy_id === last)) S.pid = last;
  else if (S.mems.length === 1) S.pid = S.mems[0].pharmacy_id;
  else { pickPharmacy(); return; }
  store.set("wergui.pid", S.pid);
  $("#root").innerHTML = `<div class="loading"><div><div class="spin"></div>Chargement de la pharmacie…</div></div>`;
  try { S.admin = await API.suisAdmin(); } catch (e) { S.admin = false; }
  D = await API.load(S.pid); computeVJ(); S.invCat = (D.rayons[0] || {}).id || ""; S.couv = R().couverture_jours;
  if (location.hash === "#console" && S.admin) S.view = "console";
  shell(); render();
}
function compte() {
  const m = me();
  layer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Mon compte"><div class="top"><div><h2>${esc(m.nom)}</h2><p>${esc(S.user.email)} · ${roleName(m.role)}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  ${S.mems.length > 1 ? `<div class="field"><label>Pharmacie</label><div style="display:flex;flex-direction:column;gap:8px">${S.phs.map(p => `<button class="pick" data-pid="${p.id}" aria-current="${p.id === S.pid}"><span class="nm"><b>${esc(p.nom)}</b><small>${esc(p.ville || "")}</small></span></button>`).join("")}</div></div>` : ""}
  <div class="field"><label for="npw">Changer de mot de passe</label><div class="row"><input id="npw" type="password" minlength="8" placeholder="Nouveau mot de passe" style="flex:1"><button class="btn" data-act="setpw">Enregistrer</button></div></div>
  <div class="row"><button class="btn" data-act="refresh">Actualiser les données</button><button class="btn" data-act="mesdonnees">Télécharger mes données</button></div>
  <div class="row"><button class="btn" data-act="logout">Se déconnecter</button><button class="btn" data-act="logoutall">Se déconnecter de tous les appareils</button></div>
  <p class="muted" style="font-size:.82rem"><a href="../confidentialite/" target="_blank">Politique de confidentialité</a> · <a href="../conditions/" target="_blank">Conditions d'utilisation</a></p>
  <details><summary class="muted" style="cursor:pointer">Supprimer mon compte</summary><p class="muted" style="font-size:.88rem;margin:8px 0">Votre compte et vos accès sont supprimés définitivement. Les ventes que vous avez faites restent dans la pharmacie, sans votre nom.</p><button class="btn bad" data-act="delcompte">Supprimer mon compte…</button></details></div>`, true);
}
function delCompte() { const tits = S.mems.filter(m => m.role === "titulaire").map(m => S.phs.find(p => p.id === m.pharmacy_id)).filter(Boolean);
  layer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Supprimer mon compte"><div class="top"><div><h2>Supprimer mon compte</h2><p>${esc(S.user.email)}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <p class="err">Cette action est définitive.</p>
  ${tits.length ? `<p class="note-box">Vous êtes titulaire de : <b>${tits.map(p => esc(p.nom)).join(", ")}</b>. Pour garder la pharmacie, transférez d'abord le rôle de titulaire à un membre (Paramètres → Pharmacie). Sinon, cochez la case ci-dessous : la pharmacie et toutes ses données (stock, ventes, équipe) seront supprimées.</p>
  <label class="row" style="gap:8px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="delph" style="width:20px;height:20px;flex:none"> <span>Supprimer aussi ${tits.length > 1 ? "ces pharmacies" : "cette pharmacie"} et toutes ses données</span></label>` : ""}
  <div class="field"><label for="delconf">Tapez SUPPRIMER pour confirmer</label><input id="delconf" autocomplete="off"></div>
  <div class="row"><button class="btn bad" data-act="delcompteok">Supprimer définitivement</button><button class="btn" data-close="1">Annuler</button></div></div>`, true); }
function telecharger(nom, texte, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([texte], { type: type || "text/plain;charset=utf-8" })); a.download = nom; document.body.appendChild(a); a.click(); a.remove(); }
const csv = rows => "\ufeff" + rows.map(r => r.map(c => { c = c == null ? "" : String(c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(";")).join("\r\n");
async function exporterPharmacie(btn) { await run(btn, async () => { const { v, l } = await API.toutesVentes(S.pid), d = iso(today());
  telecharger(`wergui-stock-${d}.csv`, csv([["Produit","Présentation","Rayon","Grossiste","Prix de vente","Prix d'achat","Lot","Péremption","Quantité"]].concat(D.produits.flatMap(p => { const ls = lotsOf(p); return (ls.length ? ls : [null]).map(x => [p.nom, p.presentation, rayonOf(p), fourOf(p).nom, p.prix_vente, can("achat") ? p.prix_achat : "", x ? x.numero : "", x ? dfr(x.peremption) : "", x ? x.quantite : 0]); }))), "text/csv;charset=utf-8");
  setTimeout(() => telecharger(`wergui-ventes-${d}.csv`, csv([["Date","Heure","Ticket","Produit","Quantité","Prix unitaire","Total du ticket","Paiement","Organisme","Vendeur"]].concat(v.flatMap(x => l.filter(y => y.vente_id === x.id).map(y => [dfr(x.created_at), hm(x.created_at), x.id.slice(0, 8), (byId(y.produit_id) || { nom: "Produit supprimé" }).nom, y.quantite, y.prix_unitaire, x.total, x.mode, x.organisme, nomMembre(x.user_id)])))), "text/csv;charset=utf-8"), 600);
  toast("Deux fichiers téléchargés (stock et ventes), à ouvrir dans Excel."); }); }

/* ================================================================ tableau de bord */
const V = {};
V.accueil = () => {
  const A = R().alerte_jours, per = perimes(), s30 = sous(0, 30), sA = sous(0, A), risk = sA.reduce((s, x) => s + x.l.quantite * x.p.prix_achat, 0), rup = D.produits.filter(p => p.actif && stock(p) === 0 && (vj(p) || p.seuil)), bas = D.produits.filter(p => etat(p)[1] === "warn"), sg = sugList(), vjr = ventesJour(), inv = D.produits.flatMap(invendus), invVal = inv.reduce((s, x) => s + x.u * x.p.prix_achat, 0), pertes = D.mvts.filter(m => m.type === "retrait").reduce((s, m) => s + m.valeur, 0), retours = D.mvts.filter(m => m.type === "retour").reduce((s, m) => s + m.valeur, 0);
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(today() - i * 864e5), k = iso(d); days.push([d, D.ventes.filter(v => iso(new Date(v.created_at)) === k).reduce((s, v) => s + v.total, 0)]); }
  const mx = Math.max(1, ...days.map(x => x[1])), todo = [];
  if (!D.produits.length) todo.push(["ok", "1", "Ajoutez vos produits", "Scannez les boîtes de chaque rayon : nom, lot et date se remplissent seuls", "scanner"]);
  if (per.length) todo.push(["bad", "!", `Retirer ${pl(per.length, "lot périmé", "lots périmés")}`, `Bloqués à la caisse · ${fmt(per.reduce((s, x) => s + x.l.quantite * x.p.prix_achat, 0))} au prix d'achat`, "peremption", "perimes"]);
  if (s30.length) todo.push(["warn", s30.length, `${pl(s30.length, "lot expire", "lots expirent")} dans moins de 30 jours`, "Retour au grossiste ou vente en priorité", "peremption", "30"]);
  if (rup.length) todo.push(["bad", rup.length, `${pl(rup.length, "produit")} en rupture`, rup.slice(0, 5).map(p => p.nom).join(", ") + (rup.length > 5 ? "…" : ""), can("cmd") ? "commandes" : "stock"]);
  if (sg.length && can("cmd")) todo.push(["warn", sg.length, `Commander ${pl(sg.length, "produit")}`, "Quantités calculées à partir de vos ventes", "commandes"]);
  if (D.cmds.length && can("recep")) todo.push(["ok", "↓", `Réceptionner ${pl(D.cmds.length, "livraison")}`, D.cmds.map(c => (D.fours.find(f => f.id === c.fournisseur_id) || {}).nom || "Grossiste").join(", "), "commandes"]);
  if (inv.length) todo.push(["warn", "~", `${pl(inv.length, "lot")} ne ser${inv.length > 1 ? "ont" : "a"} pas vendu${inv.length > 1 ? "s" : ""} à temps`, `Au rythme actuel, ${fmt(invVal)} finiront à la poubelle`, "peremption", "inv"]);
  return head("Bonjour " + esc(me().nom.split(" ").slice(0, 2).join(" ")), `${esc(D.ph.nom)} · ${today().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`, `<button class="btn pri" data-go="caisse">Nouvelle vente</button>`) +
  `<div class="kpis"><button class="kpi" data-go="caisse"><span>Ventes du jour</span><b class="num">${fmt(vjr.reduce((s, v) => s + v.total, 0))}</b><em>${pl(vjr.length, "ticket")}</em></button>
  <button class="kpi" data-go="stock"><span>Valeur du stock</span><b class="num">${can("achat") ? fmt(valStock()) : "—"}</b><em>${pl(D.produits.length, "référence")} · prix d'achat</em></button>
  <button class="kpi ${per.length ? "alert" : ""}" data-go="peremption"><span>À périmer sous ${A} j</span><b class="num">${can("achat") ? fmt(risk) : sA.length + " lots"}</b><em>${pl(sA.length, "lot")} · ${per.length} déjà périmé${per.length > 1 ? "s" : ""}</em></button>
  <button class="kpi" data-go="${can("cmd") ? "commandes" : "stock"}"><span>Ruptures · seuil bas</span><b class="num">${rup.length} · ${bas.length}</b><em>${pl(sg.length, "produit")} à commander</em></button></div>
  <div class="grid2"><section class="panel"><header><div><h2>À faire aujourd'hui</h2><p>Wergui SN regarde tout le stock et vous dit quoi faire.</p></div></header><div class="list">${todo.map(([c, i, t, s, v, tab]) => `<div class="li"><span class="ic ${c}">${i}</span><div class="grow"><b>${t}</b><small>${esc(s)}</small></div><button class="btn sm" data-go="${v}" ${tab ? `data-tab="${tab}"` : ""}>Voir</button></div>`).join("") || '<p class="empty">Rien d\'urgent. Bonne journée !</p>'}</div></section>
  <section class="panel"><header><div><h2>Péremptions ce mois-ci</h2></div></header><div class="list"><div class="li"><span>Jeté (retiré du stock)</span><b class="num" style="color:var(--bad)">${fmt(pertes)}</b></div><div class="li"><span>Rendu aux grossistes</span><b class="num" style="color:var(--ok)">${fmt(retours)}</b></div><div class="li"><span>Encore récupérable (lots &lt; ${A} j)</span><b class="num">${fmt(risk)}</b></div></div></section></div>
  <section class="panel"><header><div><h2>Ventes des 14 derniers jours</h2><p>Total : ${fmt(days.reduce((s, x) => s + x[1], 0))}</p></div></header><div class="bars" role="img" aria-label="Ventes par jour">${days.map(([d, t], i) => `<div class="${i === 13 ? "today" : ""}" style="height:${Math.max(2, t / mx * 100)}%" title="${d.toLocaleDateString("fr-FR")} : ${fmt(t)}"></div>`).join("")}</div><div class="axis"><span>${days[0][0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span><span>Aujourd'hui</span></div></section>`;
};

/* ================================================================ caisse */
const brut = () => S.cart.reduce((s, c) => s + c.q * byId(c.pid).prix_vente, 0);
const net = () => Math.round(brut() * (100 - S.remise) / 100);
V.caisse = () => { const top = Object.entries(VJ).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => byId(id)).filter(Boolean), vjr = ventesJour();
  return head("Caisse", "Les lots qui périment en premier sortent en premier. Un lot périmé ne peut pas être vendu.", `<button class="btn" data-go="scanner" data-mode="vente">Scanner une boîte</button>`) + caissePanel() +
  `<div class="grid2"><section class="panel"><input type="search" id="cq" class="search" placeholder="Nom du médicament" value="${esc(S.q)}" autocomplete="off" aria-label="Rechercher un produit">
   ${top.length ? `<div class="chips">${top.map(p => `<button class="chip" data-add="${p.id}">${esc(p.nom)}</button>`).join("")}</div>` : ""}
   <div class="tw"><table><thead><tr><th>Produit</th><th class="r">Stock</th><th class="r">Prix</th><th></th></tr></thead><tbody id="res"></tbody></table></div></section>
   <section class="panel ticket" id="ticket" aria-label="Ticket en cours"><header><h2>Ticket</h2>${S.cart.length ? '<button class="btn sm" data-act="vider">Vider</button>' : ""}</header>${ticket()}</section></div>
  <section class="panel"><header><div><h2>Tickets du jour</h2><p>${pl(vjr.length, "vente")} · ${fmt(vjr.reduce((s, v) => s + v.total, 0))}</p></div></header>
  <div class="tw"><table><thead><tr><th>Heure</th><th>Produits</th><th>Vendeur</th><th>Paiement</th><th class="r">Montant</th></tr></thead><tbody>
  ${vjr.map(v => `<tr><td class="num">${hm(v.created_at)}</td><td>${D.lignes.filter(l => l.vente_id === v.id).map(l => l.quantite + " × " + esc((byId(l.produit_id) || { nom: "Produit supprimé" }).nom)).join(", ")}${v.remise_pct ? ` <span class="st acc">−${v.remise_pct} %</span>` : ""}</td><td>${esc(nomMembre(v.user_id))}</td><td><span class="st n">${esc(v.mode)}${v.organisme ? " · " + esc(v.organisme) : ""}</span></td><td class="r num">${fmt(v.total)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">Aucune vente aujourd\'hui.</td></tr>'}</tbody></table></div></section>` +
  (S.cart.length ? `<div class="cartbar"><div><small>${pl(S.cart.reduce((a, c) => a + c.q, 0), "article")}</small><br><b class="num">${fmt(net())}</b></div><button class="btn" data-act="toticket">Voir le ticket · encaisser</button></div>` : ""); };
function ticket() { if (!S.cart.length) return '<p class="empty">Ajoutez des produits depuis la recherche, ou scannez une boîte.</p>';
  const modes = R().paiements.filter(m => m !== "Assurance" || premium()); if (!modes.includes(S.pay)) S.pay = modes[0];
  const tot = net(), ass = S.pay === "Assurance", tp = R().tiers_payant / 100;
  return S.cart.map(c => { const p = byId(c.pid), l = live(p)[0]; return `<div class="tl"><div><b>${esc(p.nom)}</b><small>${esc(p.presentation || "")}${l ? ` · lot <span class="lot">${esc(l.numero)}</span> · exp. ${dfr(l.peremption)}` : ""}</small></div><div class="qty"><button data-q="${c.pid}|-1" aria-label="Moins">−</button><span class="num">${c.q}</span><button data-q="${c.pid}|1" aria-label="Plus">+</button></div><b class="num">${fmt(c.q * p.prix_vente)}</b></div>`; }).join("") +
  (can("remise") ? `<div class="row"><span class="lbl">Remise</span><div class="seg" role="group" aria-label="Remise">${[0, 5, 10].map(r => `<button data-rem="${r}" aria-pressed="${S.remise === r}">${r} %</button>`).join("")}</div>${S.remise ? `<span class="muted">− ${fmt(brut() - tot)}</span>` : ""}</div>` : "") +
  `<div class="total"><span>Total</span><b class="num">${fmt(tot)}</b></div>
  ${ass ? `<div class="field"><label for="org">Organisme</label><select id="org">${R().organismes.map(o => `<option ${S.org === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div><div class="note-box">Tiers payant : part assurance ${R().tiers_payant} % = <b class="num">${fmt(tot * tp)}</b>. Le patient paie <b class="num">${fmt(tot - Math.round(tot * tp))}</b>.</div>` : ""}
  <div class="methods" role="group" aria-label="Moyen de paiement">${modes.map(m => `<button data-pay="${esc(m)}" aria-pressed="${S.pay === m}">${esc(m)}</button>`).join("")}</div>
  <button class="btn pri" data-act="encaisser" style="padding:12px">Encaisser ${fmt(ass ? tot - Math.round(tot * tp) : tot)}</button>`; }
function fillRes() { const el = $("#res"); if (!el) return; const q = S.q.trim().toLowerCase();
  const list = (q ? D.produits.filter(p => p.actif && (p.nom + " " + (p.presentation || "")).toLowerCase().includes(q)) : D.produits.filter(p => p.actif && stock(p)).sort((a, b) => vj(b) - vj(a))).slice(0, 12);
  el.innerHTML = list.map(p => { const s = stock(p), l = live(p)[0], d = dead(p).length, inCart = (S.cart.find(c => c.pid === p.id) || {}).q || 0;
    const tags = (l && (l.prioritaire || dj(l.peremption) < R().alerte_jours) ? ` <span class="st acc">À vendre en priorité</span>` : "") + (d ? ` <span class="st bad">${pl(d, "lot périmé bloqué", "lots périmés bloqués")}</span>` : "");
    return `<tr><td><b>${esc(p.nom)}</b>${tags}<small>${esc(p.presentation || "")}${l ? ` · lot ${esc(l.numero)}, exp. ${dfr(l.peremption)}` : ""}</small></td><td class="r num">${s}</td><td class="r num">${fmt(p.prix_vente)}</td><td class="r">${s > inCart ? `<button class="btn sm" data-add="${p.id}">Ajouter</button>` : `<span class="st bad">${s ? "Plus de stock" : "Rupture"}</span>`}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty">${D.produits.length ? "Aucun produit trouvé." : "Aucun produit : ajoutez-les avec le scanner."}</td></tr>`;
  cards(el.closest(".tw").parentNode); }
function addCart(pid, silent) { const p = byId(pid), c = S.cart.find(x => x.pid === pid), q = c ? c.q : 0; if (q >= stock(p)) { toast(stock(p) ? `Plus que ${stock(p)} en stock.` : `${p.nom} : rupture de stock.`, true); return false; } c ? c.q++ : S.cart.push({ pid, q: 1 }); if (silent) { nav(); return true; } render(true); return true; }
async function encaisser(btn) { await run(btn, async () => {
  const lignes = S.cart.map(c => ({ produit_id: c.pid, quantite: c.q })), mode = S.pay, tot = net(), items = S.cart.map(c => ({ p: byId(c.pid), q: c.q }));
  await API.vendre(S.pid, lignes, mode, S.remise, mode === "Assurance" ? (S.org || R().organismes[0]) : null);
  printTicket(items, tot, mode); S.cart = []; S.remise = 0; S.q = ""; await reload();
  toast(`Vente enregistrée : ${fmt(tot)} (${mode}).`); }); }
function printTicket(items, tot, mode) { $("#print").innerHTML = `<h3>${esc(D.ph.nom)}</h3><div>${esc(D.ph.adresse || "")} ${esc(D.ph.telephone || "")}</div><div>${new Date().toLocaleString("fr-FR")}</div><hr>${items.map(i => `<div class="l"><span>${i.q} × ${esc(i.p.nom)}</span><span>${fmt(i.q * i.p.prix_vente)}</span></div>`).join("")}<hr><div class="l"><b>Total</b><b>${fmt(tot)}</b></div><div>Paiement : ${esc(mode)}</div><div>Vendeur : ${esc(me().nom)}</div><p>${esc(D.ph.message_ticket || "")}</p>`; }

/* ================================================================ stock et produits */
V.stock = () => head("Stock", `${pl(D.produits.length, "référence")}. Touchez un produit pour voir ses lots.`, can("prod") ? `<button class="btn pri" data-act="newprod">Nouveau produit</button>` : "") +
  `<section class="panel"><div class="row"><input type="search" id="sq" placeholder="Rechercher" value="${esc(S.q)}" style="flex:1;min-width:180px" aria-label="Rechercher dans le stock">
  <select id="scat" aria-label="Rayon"><option value="">Tous les rayons</option>${D.rayons.map(r => `<option value="${r.id}" ${S.fcat === r.id ? "selected" : ""}>${esc(r.nom)}</option>`).join("")}</select>
  <select id="sst" aria-label="État"><option value="">Tous les états</option>${[["bad","Rupture"],["warn","Sous le seuil"],["exp","Lot à périmer bientôt"]].map(([v, l]) => `<option value="${v}" ${S.fst === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
  <div class="tw"><table><thead><tr><th>Produit</th><th>Rayon</th><th class="r">Stock</th><th class="r">Jours</th><th>Prochaine péremption</th><th>État</th></tr></thead><tbody id="stb"></tbody></table></div></section>`;
function fillStock() { const el = $("#stb"); if (!el) return; const q = S.q.trim().toLowerCase(), A = R().alerte_jours;
  const list = D.produits.filter(p => (!q || (p.nom + " " + (p.presentation || "")).toLowerCase().includes(q)) && (!S.fcat || p.rayon_id === S.fcat) && (!S.fst || (S.fst === "exp" ? lotsOf(p).some(l => dj(l.peremption) < A) : etat(p)[1] === S.fst))).slice(0, 400);
  el.innerHTML = list.map(p => { const [e, c] = etat(p), n = lotsOf(p).sort((a, b) => a.peremption < b.peremption ? -1 : 1)[0], d = n ? dj(n.peremption) : null, j = jours(p);
    return `<tr class="click" data-prod="${p.id}" tabindex="0"><td><b>${esc(p.nom)}</b><small>${esc(p.presentation || "")}</small></td><td>${esc(rayonOf(p))}</td><td class="r num">${stock(p)}</td><td class="r num">${j == null ? "—" : j}</td><td>${n ? `<span class="num">${dfr(n.peremption)}</span> ${d < 0 ? '<span class="st bad">Périmé</span>' : d < 30 ? `<span class="st bad">${d} j</span>` : d < A ? `<span class="st warn">${d} j</span>` : ""}` : "—"}</td><td><span class="st ${c}">${e}</span></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">${D.produits.length ? "Aucun produit." : "Aucun produit : utilisez le scanner (Entrée en stock) ou « Nouveau produit »."}</td></tr>`;
  cards(el.closest(".tw").parentNode); }
function fiche(id) { const p = byId(id), [e, c] = etat(p), inv = invendus(p), A = R().alerte_jours, f = fourOf(p);
  layer(`<div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.nom)}"><div class="top"><div><h2>${esc(p.nom)}</h2><p>${esc(p.presentation || "")} · ${esc(rayonOf(p))}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="kpi"><span>Stock vendable</span><b class="num">${stock(p)}</b><em><span class="st ${c}">${e}</span>${seuil(p) ? " seuil : " + seuil(p) : ""}</em></div>
  <div class="kpi"><span>Ventes moyennes</span><b class="num">${nb(vj(p))} / jour</b><em>${jours(p) != null ? "Tient environ " + jours(p) + " jours" : "Pas encore de ventes"}</em></div>
  <div class="kpi"><span>Prix de vente</span><b class="num">${fmt(p.prix_vente)}</b><em>${can("achat") ? `Achat ${fmt(p.prix_achat)}${p.prix_vente ? " · marge " + Math.round((p.prix_vente - p.prix_achat) / p.prix_vente * 100) + " %" : ""}` : ""}</em></div>
  <div class="kpi"><span>Grossiste</span><b>${esc(f.nom)}</b><em>Livré en ${f.delai_jours} j${enCommande(p.id) ? ` · ${enCommande(p.id)} en commande` : ""}</em></div></div>
  <section class="panel"><header><h3>Lots en stock</h3><p>Ordre de sortie : le plus proche de sa date d'abord</p></header><div class="tw"><table><thead><tr><th>Lot</th><th>Péremption</th><th class="r">Qté</th><th>État</th></tr></thead><tbody>
  ${lotsOf(p).sort((a, b) => a.peremption < b.peremption ? -1 : 1).map(l => { const d = dj(l.peremption), u = inv.find(x => x.l === l); return `<tr><td class="lot">${esc(l.numero)}</td><td class="num">${dfr(l.peremption)}</td><td class="r num">${l.quantite}</td><td>${d < 0 ? '<span class="st bad">Périmé · bloqué</span>' : d < 30 ? `<span class="st bad">Dans ${d} j</span>` : d < A ? `<span class="st warn">Dans ${d} j</span>` : '<span class="st ok">OK</span>'}${u ? ` <span class="st acc">${u.u} invendables</span>` : ""}</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">Aucun lot en stock.</td></tr>'}</tbody></table></div></section>
  <div class="row">${can("recep") ? `<button class="btn" data-go="scanner" data-mode="entree">Entrer du stock</button>` : ""}${can("prod") ? `<button class="btn" data-editprod="${p.id}">Modifier le produit</button>` : ""}</div></div>`); }
function editProd(id, preset) { const p = id ? byId(id) : Object.assign({ nom: "", presentation: "", prix_vente: "", prix_achat: "", seuil: null, codes: [] }, preset || {});
  layer(`<div class="drawer" role="dialog" aria-modal="true" aria-label="Produit"><div class="top"><div><h2>${id ? "Modifier le produit" : "Nouveau produit"}</h2><p>${id ? esc(p.nom) : "Les lots s'ajoutent ensuite par le scanner ou la réception."}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <div class="form"><div class="field full"><label for="pnom">Nom</label><input type="text" id="pnom" value="${esc(p.nom)}" placeholder="ex. Paracétamol 1000 mg"></div>
  <div class="field full"><label for="ppres">Présentation</label><input type="text" id="ppres" value="${esc(p.presentation || "")}" placeholder="ex. boîte de 8 cp"></div>
  <div class="field"><label for="pcat">Rayon</label><select id="pcat"><option value="">Sans rayon</option>${D.rayons.map(r => `<option value="${r.id}" ${p.rayon_id === r.id ? "selected" : ""}>${esc(r.nom)}</option>`).join("")}</select></div>
  <div class="field"><label for="pfour">Grossiste</label><select id="pfour"><option value="">—</option>${D.fours.map(f => `<option value="${f.id}" ${p.fournisseur_id === f.id ? "selected" : ""}>${esc(f.nom)}</option>`).join("")}</select></div>
  <div class="field"><label for="ppv">Prix de vente (F)</label><input type="number" id="ppv" min="0" inputmode="numeric" value="${p.prix_vente}"></div>
  ${can("achat") || !id ? `<div class="field"><label for="ppa">Prix d'achat (F)</label><input type="number" id="ppa" min="0" inputmode="numeric" value="${p.prix_achat}"></div>` : ""}
  <div class="field"><label for="pseuil">Seuil d'alerte (boîtes)</label><input type="number" id="pseuil" min="0" inputmode="numeric" value="${p.seuil ?? ""}" placeholder="automatique"></div>
  <div class="field"><label for="pcode">Code-barres / CIP</label><input type="text" id="pcode" inputmode="numeric" value="${esc((p.codes[0] || "").replace(/^0/, ""))}"></div></div>
  <p class="note-box">Laissez le seuil vide : Wergui SN le calcule à partir des ventes et du délai du grossiste.</p>
  <div class="row"><button class="btn pri" data-saveprod="${id || ""}">${id ? "Enregistrer" : "Créer le produit"}</button><button class="btn" data-close="1">Annuler</button>${id && !lotsOf(p).length ? `<button class="btn bad" data-delprod="${id}">Supprimer</button>` : ""}</div></div>`); }
async function saveProd(id, btn) { const g = k => (document.getElementById(k) || { value: "" }).value.trim(), nom = g("pnom"), pv = parseInt(g("ppv")) || 0, code = g("pcode").replace(/\D/g, "");
  if (!nom) return toast("Indiquez le nom du produit.", true); if (!pv) return toast("Indiquez le prix de vente.", true);
  const row = { nom, presentation: g("ppres") || null, rayon_id: g("pcat") || null, fournisseur_id: g("pfour") || null, prix_vente: pv, seuil: g("pseuil") === "" ? null : parseInt(g("pseuil")) };
  if (document.getElementById("ppa")) row.prix_achat = parseInt(g("ppa")) || Math.round(pv / 1.3);
  const old = id ? byId(id) : null, g14 = code.length >= 8 ? code.padStart(14, "0") : null; row.codes = old ? old.codes.slice() : []; if (g14 && !row.codes.includes(g14)) row.codes.unshift(g14);
  await run(btn, async () => { if (id) await API.update("produits", id, row); else await API.insert("produits", Object.assign({ pharmacy_id: S.pid }, row)); closeLayer(); await reload(true); toast(id ? `${nom} enregistré.` : `${nom} créé. Ajoutez ses lots avec le scanner (Entrée en stock).`); }); }

/* ================================================================ péremptions */
V.peremption = () => { const A = R().alerte_jours, tabs = [["perimes","Périmés",perimes()],["30","Moins de 30 jours",sous(0, 30)],["90",`30 à ${A} jours`,sous(30, A)],["inv","Invendables prévus",D.produits.flatMap(invendus)]], cur = tabs.find(t => t[0] === S.perTab) || tabs[0], rows = cur[2], val = rows.reduce((s, x) => s + (S.perTab === "inv" ? x.u : x.l.quantite) * x.p.prix_achat, 0);
  const intro = { perimes: "Ces lots sont bloqués à la caisse. Retirez-les des rayons et mettez-les en destruction.", 30: "Dernière chance : retour au grossiste ou vente en priorité au comptoir.", 90: "Il est encore temps de les écouler normalement. Wergui SN les propose en premier à la caisse.", inv: "Ce qui restera en rayon à la date de péremption si le rythme des ventes ne change pas." }[cur[0]];
  return head("Péremptions", `Chaque lot est suivi avec sa date. Les alertes partent ${A} jours avant.`) + `<div class="seg" role="group" aria-label="Horizon">${tabs.map(([k, l, r]) => `<button data-per="${k}" aria-pressed="${cur[0] === k}">${l} (${r.length})</button>`).join("")}</div>
  <section class="panel"><header><div><h2>${cur[1]}</h2><p>${intro}</p></div>${can("achat") ? `<b class="num">${fmt(val)}</b>` : ""}</header><div class="tw"><table><thead><tr><th>Produit</th><th>Lot</th><th>Péremption</th><th class="r">${S.perTab === "inv" ? "Invendables" : "Qté"}</th><th></th></tr></thead><tbody>
  ${rows.map(x => { const d = dj(x.l.peremption), q = S.perTab === "inv" ? x.u : x.l.quantite, f = fourOf(x.p);
    return `<tr><td><b>${esc(x.p.nom)}</b><small>${esc(x.p.presentation || "")} · ${esc(f.nom)}</small></td><td class="lot">${esc(x.l.numero)}</td><td><span class="num">${dfr(x.l.peremption)}</span><small>${d < 0 ? "il y a " + (-d) + " j" : "dans " + d + " j"}</small></td><td class="r num">${q}${S.perTab === "inv" ? ` <small>sur ${x.l.quantite}</small>` : ""}</td>
    <td class="r"><div class="row" style="justify-content:flex-end;gap:6px">${d < 0 ? (can("per") ? `<button class="btn sm bad" data-sortir="${x.l.id}|retrait">Retirer du stock</button>` : '<span class="muted">À signaler au pharmacien</span>') : (can("per") ? `<button class="btn sm" data-sortir="${x.l.id}|retour" ${f.reprend_produits ? "" : `disabled title="${esc(f.nom)} ne reprend pas les produits"`}>Retour grossiste</button>` : "") + `<button class="btn sm" data-prio="${x.l.id}">${x.l.prioritaire ? "✓ En priorité" : "Vendre en priorité"}</button>`}</div></td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">Aucun lot dans cette catégorie.</td></tr>'}</tbody></table></div></section>`; };

/* ================================================================ commandes */
V.commandes = () => { const sg = can("cmd") ? sugList() : [], fids = [...new Set(sg.map(p => p.fournisseur_id || ""))];
  return head("Commandes", "Quantités calculées à partir de vos ventes réelles, du stock et du délai de chaque grossiste.", can("cmd") ? `<span class="lbl">Couvrir</span><div class="seg" role="group" aria-label="Couverture">${[7, 14, 30].map(n => `<button data-couv="${n}" aria-pressed="${S.couv === n}">${n} jours</button>`).join("")}</div>` : "") +
  (D.cmds.length ? `<section class="panel"><header><div><h2>Livraisons attendues</h2><p>Saisissez les lots et dates à la réception : les alertes de péremption en dépendent.</p></div></header><div class="list">${D.cmds.map(c => `<div class="li"><div class="grow"><b>${esc((D.fours.find(f => f.id === c.fournisseur_id) || {}).nom || "Grossiste")} · BC-${c.numero}</b><small>Commandé le ${dfr(c.created_at)} · ${D.cmdLignes.filter(l => l.commande_id === c.id).map(l => l.quantite + " × " + esc((byId(l.produit_id) || {}).nom || "?")).join(", ")}</small></div>${can("recep") ? `<button class="btn pri sm" data-recv="${c.id}">Réceptionner</button>` : ""}</div>`).join("")}</div></section>` : "") +
  (!can("cmd") ? "" : fids.length ? fids.map(fid => { const f = D.fours.find(x => x.id === fid), items = sg.filter(p => (p.fournisseur_id || "") === fid), tot = items.reduce((s, p) => s + qCmd(p) * p.prix_achat, 0);
    return `<section class="panel"><header><div><h2>${f ? esc(f.nom) : "Sans grossiste"}</h2><p>${f ? `Livré en ${pl(f.delai_jours, "jour")} · ` : "Attribuez un grossiste à ces produits · "}${pl(items.length, "produit")}</p></div><div class="row">${can("achat") ? `<b class="num">${fmt(tot)}</b>` : ""}${f ? `<button class="btn wa" data-send="${f.id}">Envoyer le bon de commande</button>` : ""}</div></header>
    <div class="tw"><table><thead><tr><th>Produit</th><th>Pourquoi</th><th class="r">Quantité</th></tr></thead><tbody>${items.map(p => `<tr><td><b>${esc(p.nom)}</b><small>${esc(p.presentation || "")}</small></td><td><small style="color:var(--fg)">${vj(p) ? `Vend ${nb(vj(p))}/jour · ` : ""}reste ${stock(p)}${stock(p) ? (jours(p) != null ? ` (${jours(p)} j)` : "") : " · <b style='color:var(--bad)'>rupture</b>"}${enCommande(p.id) ? ` · ${enCommande(p.id)} déjà en route` : ""}</small><small>Seuil : ${seuil(p)} · suggestion : ${sugg(p)}</small></td><td class="r"><input type="number" min="0" class="qin" data-cq="${p.id}" value="${qCmd(p)}" aria-label="Quantité ${esc(p.nom)}"></td></tr>`).join("")}</tbody></table></div></section>`; }).join("") : `<section class="panel"><p class="empty">${D.produits.length ? `Tout est couvert pour ${S.couv} jours. Aucune commande à passer.` : "Ajoutez vos produits pour recevoir des suggestions de commande."}</p></section>`); };
function bonText(f, items) { return `Bon de commande – ${D.ph.nom}\n${new Date().toLocaleDateString("fr-FR")}\n\n` + items.map(p => `• ${qCmd(p)} × ${p.nom}${p.presentation ? " (" + p.presentation + ")" : ""}`).join("\n") + `\n\nMerci de livrer des lots à péremption longue (> 12 mois).`; }
function envoyer(fid) { const f = D.fours.find(x => x.id === fid), items = sugList().filter(p => p.fournisseur_id === fid && qCmd(p) > 0); if (!items.length) return toast("Toutes les quantités sont à zéro.", true); const t = bonText(f, items);
  layer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Bon de commande"><div class="top"><div><h2>Envoyer à ${esc(f.nom)}</h2><p>${f.whatsapp ? "Le bon s'ouvre dans WhatsApp, prêt à envoyer." : "Ajoutez le WhatsApp du commercial dans Paramètres → Grossistes pour l'envoi direct."}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <div class="wa-wrap"><div class="bubble">${esc(t)}</div></div><div class="row"><button class="btn wa" data-confirm="${f.id}">${f.whatsapp ? "Enregistrer et ouvrir WhatsApp" : "Enregistrer la commande"}</button><button class="btn" data-act="copybon">Copier le texte</button><button class="btn" data-close="1">Annuler</button></div></div>`, true); S._bon = t; }
async function confirmer(fid, btn) { const f = D.fours.find(x => x.id === fid), items = sugList().filter(p => p.fournisseur_id === fid && qCmd(p) > 0), t = bonText(f, items), w = f.whatsapp ? window.open("about:blank", "_blank") : null;
  await run(btn, async () => { await API.creerCommande(S.pid, fid, items.map(p => ({ produit_id: p.id, quantite: qCmd(p) }))); if (w) w.location = `https://wa.me/${normPhone(f.whatsapp)}?text=${encodeURIComponent(t)}`; items.forEach(p => delete S.cmdQ[p.id]); closeLayer(); await reload(); toast(`Commande enregistrée pour ${f.nom}. Elle apparaît dans les livraisons attendues.`); }); }
function recevoir(cid) { const c = D.cmds.find(x => x.id === cid), lines = D.cmdLignes.filter(l => l.commande_id === cid), def = iso(new Date(today().getFullYear() + 2, today().getMonth(), 1));
  layer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Réception"><div class="top"><div><h2>Réception BC-${c.numero}</h2><p>Vérifiez les quantités, notez le n° de lot et la date de péremption de chaque produit.</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <div class="tw"><table><thead><tr><th>Produit</th><th class="r">Reçu</th><th>N° de lot</th><th>Péremption</th></tr></thead><tbody>${lines.map((l, i) => `<tr><td><b>${esc((byId(l.produit_id) || {}).nom || "?")}</b><small>Commandé : ${l.quantite}</small></td><td class="r"><input type="number" min="0" class="qin" id="rq${i}" value="${l.quantite}" aria-label="Quantité reçue"></td><td><input type="text" class="lotin" id="rl${i}" aria-label="Numéro de lot" placeholder="Lot"></td><td><input type="date" id="re${i}" value="${def}" aria-label="Date de péremption"></td></tr>`).join("")}</tbody></table></div>
  <p class="note-box" id="rwarn">Vérifiez chaque date sur la boîte.</p><div class="row"><button class="btn pri" data-recok="${cid}">Valider la réception</button><button class="btn" data-close="1">Annuler</button></div></div>`, true); }
async function valRecep(cid, btn) { const lines = D.cmdLignes.filter(l => l.commande_id === cid), out = [];
  for (let i = 0; i < lines.length; i++) { const q = parseInt(document.getElementById("rq" + i).value) || 0, n = document.getElementById("rl" + i).value.trim(), e = document.getElementById("re" + i).value; if (!q) continue; if (!n || !e) return toast("Indiquez le n° de lot et la date pour chaque produit reçu.", true); if (dj(e) < 0) return toast("Une date est dépassée : ce lot ne peut pas entrer en stock.", true); out.push({ produit_id: lines[i].produit_id, quantite: q, numero: n, peremption: e }); }
  await run(btn, async () => { const n = await API.receptionner(cid, out); closeLayer(); await reload(); toast(`${pl(n, "boîte entrée", "boîtes entrées")} en stock, avec leurs lots et dates.`); }); }

/* ================================================================ inventaire */
V.inventaire = () => { const items = D.produits.filter(p => (p.rayon_id || "") === S.invCat);
  return head("Inventaire tournant", "Un rayon à la fois, sans fermer la pharmacie. Le stock théorique est mis à jour par la caisse.") +
  `<section class="panel"><div class="row"><label class="lbl" for="icat">Rayon</label><select id="icat">${D.rayons.map(r => `<option value="${r.id}" ${S.invCat === r.id ? "selected" : ""}>${esc(r.nom)}</option>`).join("")}<option value="" ${S.invCat === "" ? "selected" : ""}>Sans rayon</option></select><span class="muted">${pl(items.length, "produit")}</span></div>
  <div class="tw"><table><thead><tr><th>Produit</th><th class="r">Théorique</th><th class="r">Compté</th><th class="r">Écart</th></tr></thead><tbody>
  ${items.map(p => { const t = lotsOf(p).reduce((s, l) => s + l.quantite, 0); return `<tr><td><b>${esc(p.nom)}</b><small>${esc(p.presentation || "")}${dead(p).length ? " · dont lots périmés à sortir" : ""}</small></td><td class="r num">${t}</td><td class="r"><input type="number" min="0" class="qin" data-inv="${p.id}" value="${S.inv[p.id] ?? ""}" placeholder="${t}" aria-label="Compté ${esc(p.nom)}"></td><td class="r num" id="ie${p.id}">—</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">Aucun produit dans ce rayon.</td></tr>'}
  </tbody><tfoot><tr><td colspan="3">Écart total du rayon</td><td class="r num" id="iet">0</td></tr></tfoot></table></div>
  <div class="row"><button class="btn" data-act="toutok">Tout est conforme</button><button class="btn pri" data-act="valinv">Valider l'inventaire du rayon</button></div></section>`; };
function invTotals() { let te = 0; D.produits.filter(p => (p.rayon_id || "") === S.invCat).forEach(p => { const t = lotsOf(p).reduce((s, l) => s + l.quantite, 0), v = S.inv[p.id], e = document.getElementById("ie" + p.id); if (!e) return; if (v == null || v === "") { e.textContent = "—"; e.style.color = ""; return; } const d = v - t; te += d; e.textContent = (d > 0 ? "+" : "") + d; e.style.color = d < 0 ? "var(--bad)" : d > 0 ? "var(--ok)" : ""; }); const a = $("#iet"); if (a) a.textContent = (te > 0 ? "+" : "") + te; }
async function valInv(btn) { const items = D.produits.filter(p => (p.rayon_id || "") === S.invCat && S.inv[p.id] != null && S.inv[p.id] !== ""); if (!items.length) return toast("Saisissez au moins une quantité comptée.", true);
  await run(btn, async () => { let ec = 0; for (const p of items) { ec += Math.abs(await API.inventaire(S.pid, p.id, S.inv[p.id])); delete S.inv[p.id]; } await reload(); toast(`Inventaire validé : ${pl(items.length, "produit")}, ${ec} unités d'écart corrigées.`); }); }

/* ================================================================ paramètres (titulaire) */
const sw = (attr, on, label) => `<label class="switch"><input type="checkbox" ${attr} ${on ? "checked" : ""} aria-label="${esc(label)}"><span></span></label>`;
V.parametres = () => { const T = [["pharmacie","Pharmacie"],["equipe","Équipe"],["rayons","Rayons"],["grossistes","Grossistes"],["regles","Règles"]];
  return head("Paramètres", "Réservé au titulaire. Chaque réglage s'applique tout de suite à toute la pharmacie.") + `<div class="seg" role="group" aria-label="Rubrique">${T.map(([k, l]) => `<button data-stab="${k}" aria-pressed="${S.setTab === k}">${l}</button>`).join("")}</div>` + SET[S.setTab](); };
const SET = {};
SET.pharmacie = () => { const p = D.ph; return `<section class="panel"><header><div><h2>La pharmacie</h2><p>Ces informations apparaissent sur les tickets et les bons de commande.</p></div></header><div class="form">
  <div class="field full"><label for="cnom">Nom de la pharmacie</label><input type="text" id="cnom" value="${esc(p.nom)}"></div><div class="field full"><label for="cadr">Adresse</label><input type="text" id="cadr" value="${esc(p.adresse || "")}"></div>
  <div class="field"><label for="cville">Ville</label><input type="text" id="cville" value="${esc(p.ville || "")}"></div><div class="field"><label for="ctel">Téléphone</label><input type="tel" id="ctel" value="${esc(p.telephone || "")}"></div>
  <div class="field"><label for="cwa">WhatsApp du titulaire</label><input type="tel" id="cwa" value="${esc(p.whatsapp || "")}"></div><div class="field full"><label for="cticket">Message en bas des tickets</label><input type="text" id="cticket" value="${esc(p.message_ticket || "")}"></div></div>
  <div class="row"><button class="btn pri" data-act="savepharma">Enregistrer</button></div></section>
  <section class="panel"><header><div><h2>Données de la pharmacie</h2><p>Vos données vous appartiennent : téléchargez-les à tout moment (stock avec lots, et toutes les ventes).</p></div></header><div class="row"><button class="btn" data-act="exportph">Exporter en Excel (CSV)</button></div></section>
  <section class="panel"><header><div><h2>Transférer le rôle de titulaire</h2><p>Le nouveau titulaire aura l'accès complet. Vous deviendrez pharmacien adjoint.</p></div></header>
  ${D.membres.filter(m => m.actif && m.user_id !== S.user.id).length ? `<div class="row"><select id="trto" style="flex:1 1 200px">${D.membres.filter(m => m.actif && m.user_id !== S.user.id).map(m => `<option value="${m.user_id}">${esc(m.nom)} · ${roleName(m.role)}</option>`).join("")}</select><button class="btn" data-act="transfert">Transférer</button></div>` : '<p class="muted">Ajoutez d\'abord un membre à l\'équipe.</p>'}</section>
  <section class="panel scanbad"><header><div><h2>Supprimer la pharmacie</h2><p>Supprime définitivement la pharmacie et toutes ses données : stock, ventes, commandes, équipe. Pensez à exporter vos données avant.</p></div></header>
  <div class="row"><input id="delphnom" placeholder="Tapez le nom exact : ${esc(p.nom)}" style="flex:1 1 220px" autocomplete="off"><button class="btn bad" data-act="delpharma">Supprimer la pharmacie</button></div></section>`; };
SET.equipe = () => `<section class="panel"><header><div><h2>L'équipe</h2><p>Chaque membre a son compte et ses droits. Les ventes sont enregistrées au nom de la personne connectée.</p></div><button class="btn pri" data-member="">Ajouter un membre</button></header>
  <div>${D.membres.map(m => `<div class="member ${m.actif ? "" : "off"}"><span class="av">${esc(m.nom.replace(/^Dr\s+/, "").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase())}</span><div class="grow" style="flex:1;min-width:0"><b>${esc(m.nom)}</b>${m.user_id === S.user.id ? ' <span class="st ok">vous</span>' : ""}<small class="muted" style="display:block">${roleName(m.role)}${m.actif ? "" : " · désactivé"}</small><small class="muted" style="display:block">${m.role === "titulaire" ? "Accès complet, paramètres et abonnement" : PERMS.filter(([k]) => m.droits && m.droits[k]).map(x => x[2]).join(" · ") || "Caisse, scanner et stock uniquement"}</small></div><button class="btn sm" data-member="${m.user_id}">Modifier</button></div>`).join("")}</div></section>
  ${premium() ? "" : `<p class="note-box">Formule Petite officine : 1 membre en plus du titulaire, avec les droits du rôle choisi. <button class="linkbtn" data-go="abonnement">Passer à Officine</button> pour une équipe illimitée et des droits sur mesure.</p>`}
  <p class="note-box">Pour ajouter quelqu'un : il crée d'abord son compte sur cette page (« Je travaille dans une pharmacie déjà inscrite »), puis vous l'ajoutez ici avec son e-mail.</p>`;
function member(uid) { const m = uid ? D.membres.find(x => x.user_id === uid) : { nom: "", role: "vendeur", droits: permOf("vendeur"), actif: true }, tit = m.role === "titulaire";
  layer(`<div class="drawer" role="dialog" aria-modal="true" aria-label="Membre"><div class="top"><div><h2>${uid ? "Modifier " + esc(m.nom) : "Ajouter un membre"}</h2><p>${tit ? "Titulaire : accès complet." : "Choisissez un rôle, puis ajustez les droits si besoin."}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <div class="form"><div class="field full"><label for="unom">Nom</label><input type="text" id="unom" value="${esc(m.nom)}"></div>${uid ? "" : `<div class="field full"><label for="uemail">E-mail de son compte Wergui SN</label><input type="email" id="uemail"></div>`}
  ${tit ? "" : `<div class="field full"><label for="urole">Rôle</label><select id="urole">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${m.role === k ? "selected" : ""}>${r.n}</option>`).join("")}</select></div>`}</div>
  ${tit ? "" : `<section class="panel"><header><h3>Droits</h3><p>Caisse, scanner, stock et péremptions : toujours ouverts.</p></header>${premium() ? "" : '<p class="muted" style="font-size:.85rem">Formule Petite officine : les droits suivent le rôle. Droits sur mesure avec la formule Officine.</p>'}<div class="perms">${PERMS.map(([k, l]) => `<label><input type="checkbox" data-perm="${k}" ${m.droits && m.droits[k] ? "checked" : ""} ${premium() ? "" : "disabled"}> ${l}</label>`).join("")}</div></section>
  ${uid ? `<label class="row" style="gap:8px"><input type="checkbox" id="uactif" ${m.actif ? "checked" : ""} style="width:20px;height:20px"> Compte actif</label>` : ""}`}
  <div class="row"><button class="btn pri" data-saveuser="${uid || ""}">${uid ? "Enregistrer" : "Ajouter"}</button><button class="btn" data-close="1">Annuler</button></div></div>`); }
async function saveUser(uid, btn) { const g = k => (document.getElementById(k) || { value: "" }).value.trim(), droits = Object.fromEntries(PERMS.map(([k]) => [k, !!(document.querySelector(`[data-perm="${k}"]`) || {}).checked])), nom = g("unom");
  if (!nom) return toast("Indiquez le nom.", true);
  await run(btn, async () => { if (uid) { const m = D.membres.find(x => x.user_id === uid); await API.modifierMembre(S.pid, uid, nom, m.role === "titulaire" ? "adjoint" : g("urole"), droits, m.role === "titulaire" ? true : !!(document.getElementById("uactif") || {}).checked); }
    else { if (!g("uemail")) return toast("Indiquez son e-mail.", true); await API.ajouterMembre(S.pid, g("uemail"), nom, g("urole"), droits); }
    closeLayer(); await reload(true); toast(uid ? `${nom} : modifications enregistrées.` : `${nom} ajouté à l'équipe.`); }); }
SET.rayons = () => `<section class="panel"><header><div><h2>Les rayons</h2><p>Organisez le stock comme vos étagères. Ils servent aux filtres et à l'inventaire.</p></div></header>
  <div>${D.rayons.map(r => { const n = D.produits.filter(p => p.rayon_id === r.id).length; return `<div class="set"><input type="text" data-ray="${r.id}" value="${esc(r.nom)}" aria-label="Nom du rayon" style="flex:1;min-width:0"><span class="muted" style="white-space:nowrap">${pl(n, "produit")}</span><button class="btn sm bad" data-delray="${r.id}">Supprimer</button></div>`; }).join("")}</div>
  <div class="row"><input type="text" id="newcat" placeholder="Nouveau rayon, ex. Dermatologie" style="flex:1 1 220px"><button class="btn pri" data-act="addcat">Ajouter le rayon</button></div></section><p class="note-box">Supprimer un rayon ne supprime pas ses produits : ils passent « sans rayon ».</p>`;
SET.grossistes = () => `<section class="panel"><header><div><h2>Les grossistes</h2><p>Le délai de livraison sert à calculer les commandes. Le WhatsApp reçoit les bons de commande.</p></div></header>
  <div>${D.fours.map(f => { const n = D.produits.filter(p => p.fournisseur_id === f.id).length; return `<div class="set" style="flex-wrap:wrap"><div class="field" style="flex:1 1 160px"><label>Nom</label><input type="text" data-four="${f.id}|nom" value="${esc(f.nom)}"></div><div class="field"><label>Livré en (jours)</label><input type="number" class="qin" min="0" max="60" data-four="${f.id}|delai_jours" value="${f.delai_jours}"></div><div class="field" style="flex:1 1 140px"><label>WhatsApp du commercial</label><input type="tel" data-four="${f.id}|whatsapp" value="${esc(f.whatsapp || "")}" placeholder="77 …"></div><div class="field"><label>Reprend les produits</label>${sw(`data-fret="${f.id}"`, f.reprend_produits, "Reprend les produits")}</div><span class="muted">${pl(n, "produit")}</span>${n ? "" : `<button class="btn sm bad" data-delfour="${f.id}">Supprimer</button>`}</div>`; }).join("")}</div>
  <div class="row"><input type="text" id="newfour" placeholder="Nouveau grossiste" style="flex:1 1 220px"><button class="btn pri" data-act="addfour">Ajouter le grossiste</button></div></section>`;
SET.regles = () => { const c = R(), num = (k, l, h, min, max, unit) => `<div class="set"><div class="grow"><b>${l}</b><small>${h}</small></div><span class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" class="qin" data-cfg="${k}" min="${min}" max="${max}" value="${c[k]}" aria-label="${esc(l)}"><span class="muted">${unit}</span></span></div>`, modes = ["Espèces","Wave","Orange Money","Free Money","Assurance"];
  return `<section class="panel"><header><div><h2>Péremptions et stock</h2></div></header>${num("alerte_jours","Alerter avant la péremption","Les lots entrent dans les alertes ce nombre de jours avant leur date.",15,365,"jours")}${num("reception_mois","Péremption courte à la réception","En dessous, Wergui SN conseille de refuser le lot.",1,24,"mois")}${num("securite_jours","Stock de sécurité","Jours de ventes gardés en plus du délai du grossiste.",0,30,"jours")}${num("couverture_jours","Commandes : couvrir","Jours de ventes couverts par une commande suggérée.",3,60,"jours")}</section>
  <section class="panel"><header><div><h2>Caisse</h2></div></header>${num("tiers_payant","Part prise en charge par l'assurance","Taux par défaut du tiers payant.",0,100,"%")}${num("deconnexion_min","Déconnexion automatique","Après ce nombre de minutes sans activité (0 = jamais). Conseillé sur un téléphone partagé au comptoir.",0,480,"min")}
  <div class="set"><div class="grow"><b>Organismes</b><small>Séparés par des virgules (IPM, mutuelles, CMU…)</small></div><input type="text" id="orgs" value="${esc(c.organismes.join(", "))}" style="flex:1;min-width:0"></div>
  ${modes.map(m => `<div class="set"><div class="grow"><b>${m}</b><small>${m === "Assurance" ? "Tiers payant" : "Moyen de paiement accepté en caisse"}</small></div>${sw(`data-paym="${m}"`, c.paiements.includes(m), m)}</div>`).join("")}</section>`; };
async function saveReglages(patch) { const reglages = Object.assign({}, R(), patch); await API.update("pharmacies", S.pid, { reglages }); D.ph.reglages = reglages; }

const FORMULES = [
  { k: "petite", n: "Petite officine", prix: 15000, inst: 35000, items: ["Toutes les fonctions de base : stock par lot, alertes de péremption, scanner, caisse, commandes, inventaire", "1 membre en plus du titulaire", "Jusqu'à 1 500 références"] },
  { k: "officine", n: "Officine", prix: 25000, inst: 50000, items: ["Tout ce qui est dans Petite officine", "Tiers payant : IPM, mutuelles, CMU", "Finances : clôture de caisse, bordereaux d'assurance, factures grossistes, dépenses, résultat du mois et export comptable", "Équipe illimitée et droits sur mesure", "Références illimitées"] }];
V.abonnement = () => { const p = D.ph, r = essaiReste(), cur = FORMULES.find(f => f.k === p.formule);
  const etat = p.statut === "suspendu" ? '<span class="st bad">Suspendu</span>' : p.statut === "essai" ? `<span class="st acc">Essai${r != null ? (r >= 0 ? " · " + pl(r, "jour restant", "jours restants") : " terminé") : ""}</span>` : '<span class="st ok">Actif</span>';
  return head("Abonnement", "Prix TTC, payés chaque mois par Wave ou Orange Money. En paiement annuel : 2 mois et l'installation offerts.") +
  `<section class="panel"><header><div><h2>${p.statut === "essai" ? "Période d'essai : toutes les fonctions" : "Formule " + cur.n}</h2><p>${p.statut === "essai" ? `Jusqu'au ${dfr(p.essai_fin)}. Choisissez ensuite votre formule.` : `${fmt(cur.prix)} par mois${p.paye_jusqu ? " · payé jusqu'au " + dfr(p.paye_jusqu) : ""}`}</p></div>${etat}</header></section>
  <div class="plans">${FORMULES.map(f => `<section class="plan ${f.k === "officine" ? "cur" : "alt"}">${f.k === "officine" ? '<span class="tagp">Premium</span>' : ""}<span class="lbl">${f.n}</span><div><span class="price">${nb(f.prix)} F</span> <span class="muted">/ mois</span></div><ul class="grow">${f.items.map(i => `<li>${i}</li>`).join("")}</ul><div class="inst">Installation : ${fmt(f.inst)}, payable en 3 fois</div>
    ${p.statut !== "essai" && p.formule === f.k ? '<span class="st ok" style="align-self:flex-start">Votre formule</span>' : `<a class="btn ${f.k === "officine" ? "pri" : ""}" style="text-decoration:none;text-align:center" href="${contactLien(`Bonjour, je souhaite la formule ${f.n} (${nb(f.prix)} F/mois) pour ${p.nom}.`)}" target="_blank" rel="noopener">Choisir ${f.n}</a>`}</section>`).join("")}</div>
  <p class="note-box">Le paiement se fait par Wave ou Orange Money. Après réception, Wergui SN active votre formule (en général le jour même). Contact : ${esc(CFG.contactWhatsApp ? "WhatsApp +" + normPhone(CFG.contactWhatsApp) : CONTACT_MAIL)}.</p>`; };

/* ================================================================ console Wergui SN (administrateurs) */
V.console = () => { if (!S.adminList) { API.adminPharmacies().then(r => { S.adminList = r; if (S.view === "console") render(true); }).catch(e => toast(errMsg(e), true)); return head("Console Wergui SN", "Chargement…"); }
  const L = S.adminList, actifs = L.filter(x => x.statut === "actif"), mrr = actifs.reduce((s, x) => s + (x.formule === "officine" ? 25000 : 15000), 0);
  return head("Console Wergui SN", "Réservée aux administrateurs. Abonnements des pharmacies : aucune donnée de stock ni de vente n'est visible ici.", `<button class="btn" data-act="consolerefresh">Actualiser</button>`) +
  `<div class="kpis"><div class="kpi"><span>Pharmacies</span><b class="num">${L.length}</b><em>${L.filter(x => x.statut === "essai").length} en essai</em></div><div class="kpi"><span>Abonnées</span><b class="num">${actifs.length}</b><em>${actifs.filter(x => x.formule === "officine").length} Officine</em></div><div class="kpi"><span>Revenu mensuel</span><b class="num">${fmt(mrr)}</b><em>abonnements actifs</em></div><div class="kpi"><span>Suspendues</span><b class="num">${L.filter(x => x.statut === "suspendu").length}</b><em>&nbsp;</em></div></div>
  <section class="panel"><div class="tw"><table><thead><tr><th>Pharmacie</th><th>Titulaire</th><th>Activité</th><th>Formule</th><th>Statut</th><th>Payé jusqu'au</th><th></th></tr></thead><tbody>
  ${L.map(x => `<tr><td><b>${esc(x.nom)}</b><small>${esc(x.ville || "")} ${esc(x.telephone || "")} · inscrite le ${dfr(x.created_at)}${x.statut === "essai" ? " · essai jusqu'au " + dfr(x.essai_fin) : ""}</small></td><td>${esc(x.titulaire || "—")}</td><td><small style="color:var(--fg)">${x.membres} membres · ${x.produits} produits · ${x.ventes_30j} ventes/30 j</small></td>
  <td><select id="af-${x.id}">${["petite","officine"].map(f => `<option value="${f}" ${x.formule === f ? "selected" : ""}>${f === "officine" ? "Officine" : "Petite officine"}</option>`).join("")}</select></td>
  <td><select id="as-${x.id}">${["essai","actif","suspendu"].map(f => `<option ${x.statut === f ? "selected" : ""}>${f}</option>`).join("")}</select></td>
  <td><input type="date" id="ap-${x.id}" value="${x.paye_jusqu || ""}"></td><td><button class="btn sm pri" data-admsave="${x.id}">Enregistrer</button></td></tr>`).join("") || '<tr><td colspan="7" class="empty">Aucune pharmacie inscrite.</td></tr>'}</tbody></table></div></section>`; };

/* ================================================================ scanner (DataMatrix, QR, code-barres) */
const LIB = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/dist/iife/ponyfill.js", WASM = "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/reader/", FORMATS = ["data_matrix","qr_code","ean_13","ean_8","code_128"];
let MEDP = null; const loadMed = () => MEDP || (MEDP = fetch(CFG.medicamentsUrl || "../medicaments.json").then(r => r.ok ? r.json() : null).catch(() => null));
const cipOf = g => g && g.length === 14 && g.startsWith("0340") ? g.slice(1) : null;
const findGtin = g => g && D.produits.find(p => p.codes.includes(g));
function gs1(raw) { let s = String(raw).trim().replace(/^\](d2|C1|Q3|e0)/, "").replace(/^\x1D/, "");
  if (s.startsWith("(")) { const o = {}; s.replace(/\((\d{2,4})\)([^(]*)/g, (m, a, v) => { o[a] = v.trim(); }); return Object.keys(o).length ? o : null; }
  if (!/^(00|01|02|10|11|17|21)\d/.test(s)) return null;
  const FIX = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 }, o = {}; let i = 0;
  while (i < s.length) { const a2 = s.substr(i, 2); if (FIX[a2]) { o[a2] = s.substr(i + 2, FIX[a2]); i += 2 + FIX[a2]; continue; }
    const ai = ["240","241","710","711","712","713","714"].find(a => s.startsWith(a, i)) || (["10","21","22"].includes(a2) ? a2 : null); if (!ai) break;
    const st = i + ai.length; let e = s.indexOf("\x1D", st); if (e < 0) e = s.length; o[ai] = s.slice(st, e); i = e + 1; }
  return o["01"] || o["17"] || o["10"] ? o : null; }
function gsDate(v) { if (!/^\d{6}$/.test(v || "")) return ""; const y = 2000 + +v.slice(0, 2), m = +v.slice(2, 4); let d = +v.slice(4, 6); if (!d) d = new Date(y, m, 0).getDate(); return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"); }
function lire(raw, fmtName) { const r = { raw, fmt: fmtName || "", gtin: "", lot: "", exp: "", serie: "" }, g = gs1(raw);
  if (g) { r.kind = "DataMatrix GS1"; r.gtin = g["01"] || ""; r.lot = g["10"] || ""; r.exp = gsDate(g["17"]); r.serie = g["21"] || ""; }
  else if (/^\d{8}$|^\d{12,14}$/.test(raw)) { r.kind = "Code-barres"; r.gtin = raw.padStart(14, "0"); } else r.kind = "Autre code";
  r.pid = (findGtin(r.gtin) || {}).id || null; r.dup = !!(r.serie && S.scans.some(x => x.key === r.gtin + "|" + r.serie)); return r; }
V.scanner = () => head("Scanner", "Le DataMatrix (petit carré à points) remplit seul le produit, le n° de lot et la date de péremption.") +
  `<div class="seg" role="group" aria-label="Que faire de la boîte ?">${[["entree","Entrée en stock"],["vente","Vente"],["verif","Vérifier une boîte"]].filter(x => x[0] !== "entree" || can("recep") || can("prod")).map(([k, l]) => `<button data-smode="${k}" aria-pressed="${S.scanMode === k}">${l}</button>`).join("")}</div>
  <div class="grid2 eq"><section class="panel"><header><div><h2>Caméra</h2><p id="camst">Visez le code : il est lu tout seul.</p></div></header>
  <div class="reader" id="reader"><div class="ph">La caméra s'ouvre ici.</div></div>
  <div class="row"><button class="btn pri" data-act="camon" id="camon">Ouvrir la caméra</button><button class="btn" data-act="camoff" id="camoff" hidden>Arrêter</button><label class="btn" id="photobtn" style="cursor:pointer">Prendre une photo du code<input type="file" id="scanfile" accept="image/*" capture="environment" hidden></label><button class="btn" data-act="scanmanual">Pas de code : saisir à la main</button></div></section>
  <section class="panel" id="scanres" aria-live="polite"></section></div>
  <section class="panel"><header><div><h2>Boîtes scannées</h2><p>Au démarrage, scannez chaque rayon : le stock se crée avec ses dates.</p></div></header><div class="list" id="scanlist"></div></section>`;
function V_scanRes() { const r = S.cur, el = $("#scanres"); if (!el) return; if (S.scanMode === "entree" && !(can("recep") || can("prod"))) S.scanMode = "vente";
  if (!r) { el.className = "panel"; el.innerHTML = `<p class="empty">Scannez une boîte : le produit, le lot et la date s'affichent ici.</p>`; return; }
  const p = r.pid ? byId(r.pid) : null, d = r.exp ? dj(r.exp) : null, bad = d != null && d < 0, warn = d != null && d >= 0 && d < R().reception_mois * 30, m = S.scanMode, msgs = [];
  if (r.dup) msgs.push(["bad", `Cette boîte (n° de série ${esc(r.serie)}) a déjà été scannée : double saisie ou boîte suspecte.`]);
  if (bad) msgs.push(["bad", `Périmé depuis ${-d} jours. ${m === "vente" ? "Vente bloquée." : "Refusez ce lot ou mettez-le en destruction."}`]); else if (warn) msgs.push(["warn", `Péremption courte : dans ${d} jours.`]);
  if (r.kind === "Code-barres") msgs.push(["warn", "Code-barres simple : il donne le produit, pas le lot ni la date. Saisissez-les ci-dessous."]);
  if (!p && r.medLoading) msgs.push(["n", "Recherche du nom dans la base des médicaments…"]);
  else if (!p && r.med) msgs.push(["ok", m === "entree" ? "Trouvé dans la base publique des médicaments. Indiquez le prix de vente : Wergui SN crée la fiche." : "Trouvé dans la base des médicaments, mais pas encore dans votre stock."]);
  else if (!p && !r.manual && r.kind !== "Autre code") msgs.push(["warn", "Code inconnu : choisissez le produit ou créez-le. Wergui SN retiendra ce code."]);
  el.className = "panel " + (bad || r.dup ? "scanbad" : msgs.length ? "scanwarn" : "scanok");
  const sel = `<select id="sp" aria-label="Produit"><option value="">${m === "entree" ? "— Nouveau produit —" : "— Choisir le produit —"}</option>${D.produits.map(x => `<option value="${x.id}">${esc(x.nom)}${x.presentation ? " · " + esc(x.presentation) : ""}</option>`).join("")}</select>`;
  el.innerHTML = `<header><div><h2>${p ? esc(p.nom) : r.med ? esc(r.med[0]) : r.manual ? "Saisie manuelle" : "Produit à identifier"}</h2><p>${p ? esc(p.presentation || "") : r.med ? esc(r.med[2] || r.med[1]) : r.kind}${r.fmt ? " · lu : " + esc(r.fmt) : ""}</p></div>${p && r.exp ? (bad ? '<span class="st bad">Périmé</span>' : warn ? `<span class="st warn">Dans ${d} j</span>` : '<span class="st ok">Date OK</span>') : ""}</header>
  ${msgs.map(([c, t]) => `<p class="st ${c}" style="white-space:normal;border-radius:8px;padding:8px 10px;font-size:.85rem">${t}</p>`).join("")}
  <dl class="kv">${r.gtin ? `<dt>Code produit</dt><dd class="num">${r.gtin}</dd>` : ""}${r.serie ? `<dt>N° de série</dt><dd class="num">${esc(r.serie)}</dd>` : ""}${p && m !== "entree" ? `<dt>En stock</dt><dd>${stock(p)} boîtes</dd><dt>Prix</dt><dd>${fmt(p.prix_vente)}</dd>` : ""}</dl>
  ${!p ? `<div class="field"><label for="sp">${m === "entree" ? "Produit de votre stock" : "Produit"}</label>${sel}</div>${m === "entree" ? `<div class="row"><div class="field" style="flex:1 1 200px"><label for="snom">Nom du nouveau produit</label><input type="text" id="snom" value="${esc(r.med ? r.med[0] : "")}"></div><div class="field"><label for="spv">Prix de vente (F)</label><input type="number" id="spv" class="qin" min="0" inputmode="numeric"></div><div class="field"><label for="sray">Rayon</label><select id="sray"><option value="">—</option>${D.rayons.map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join("")}</select></div></div>` : ""}` : ""}
  ${m !== "vente" ? `<div class="row"><div class="field"><label for="slot">N° de lot</label><input type="text" id="slot" class="lotin" value="${esc(r.lot)}" style="width:140px"></div><div class="field"><label for="sexp">Péremption</label><input type="date" id="sexp" value="${r.exp}"></div>${m === "entree" ? `<div class="field"><label for="sq2">Boîtes identiques</label><input type="number" id="sq2" class="qin" min="1" value="1"></div>` : ""}</div>` : ""}
  <div class="row">${m === "entree" ? `<button class="btn pri" data-act="scanadd" ${bad ? "disabled" : ""}>Ajouter au stock</button>` : m === "vente" ? (r.done ? '<span class="st ok">Ajouté au ticket ✓</span>' : `<button class="btn pri" data-act="scansell" ${bad || r.dup ? "disabled" : ""}>Ajouter au ticket</button>`) + `<button class="btn" data-go="caisse">Voir le ticket (${S.cart.reduce((a, c) => a + c.q, 0)})</button>` : ""}<button class="btn" data-act="scannext">Boîte suivante</button></div>`; }
function V_scanList() { const el = $("#scanlist"); if (!el) return; el.innerHTML = S.scans.length ? S.scans.slice().reverse().map(x => `<div class="li"><div class="grow"><b>${esc(x.nom)}</b><small>${esc(x.txt)}</small></div><span class="st ${x.c}">${esc(x.st)}</span></div>`).join("") : '<p class="empty">Aucune boîte scannée pour l\'instant.</p>'; }
async function onCode(raw, f) { const r = lire(raw, f); S.cur = r; if (S.cam) S.cam.paused = true; try { navigator.vibrate && navigator.vibrate(60); } catch (e) {}
  const cip = !r.pid && cipOf(r.gtin); if (cip) { r.medLoading = true; V_scanRes(); const M = await loadMed(); r.medLoading = false; if (S.cur !== r) return; r.med = M && M[cip] || null; }
  if (S.scanMode === "vente" && r.pid && !(r.exp && dj(r.exp) < 0) && !r.dup && addCart(r.pid, true)) { logScan(r, "Vendu", "ok", "ajouté au ticket"); r.done = true; setTimeout(resumeCam, 1500); }
  V_scanRes(); const rs = $("#scanres"); if (rs && window.innerWidth < 980 && !r.done) rs.scrollIntoView({ behavior: "smooth", block: "start" }); }
function logScan(r, st, c, txt) { S.scans.push({ key: r.serie ? r.gtin + "|" + r.serie : null, nom: (byId(r.pid) || {}).nom || "Produit", st, c, txt: (r.lot ? "lot " + r.lot : "") + (r.exp ? " · exp. " + dfr(r.exp) : "") + (txt ? " · " + txt : "") }); V_scanList(); }
async function scanAdd(btn) { const r = S.cur, g = k => (document.getElementById(k) || { value: "" }).value.trim(), lot = g("slot"), exp = g("sexp"), q = Math.max(1, parseInt(g("sq2")) || 1);
  if (!lot || !exp) return toast("Indiquez le n° de lot et la date de péremption.", true); if (dj(exp) < 0) return toast("Lot périmé : il ne peut pas entrer en stock.", true);
  await run(btn, async () => { let pid = r.pid || g("sp");
    if (!pid) { const nom = g("snom"), pv = parseInt(g("spv")) || 0; if (!nom) return toast("Choisissez le produit ou indiquez le nom du nouveau produit.", true); if (!pv) return toast("Indiquez le prix de vente.", true);
      const row = await API.insert("produits", { pharmacy_id: S.pid, nom, presentation: r.med ? r.med[2] : null, rayon_id: g("sray") || null, prix_vente: pv, prix_achat: Math.round(pv / 1.3), codes: r.gtin ? [r.gtin] : [] }); D.produits.push(row); pid = row.id; }
    else if (r.gtin && !findGtin(r.gtin) && can("prod")) { const p = byId(pid); await API.update("produits", pid, { codes: [r.gtin].concat(p.codes) }); p.codes.unshift(r.gtin); }
    await API.ajouterLot(S.pid, pid, lot, exp, q); r.pid = pid; logScan(r, "+" + q + " en stock", "ok", ""); const nom = (byId(pid) || {}).nom; S.cur = null;
    D = await API.load(S.pid); computeVJ(); nav(); V_scanRes(); resumeCam(); toast(`${q} × ${nom} (lot ${lot.toUpperCase()}, exp. ${dfr(exp)}) ajouté au stock.`); }); }
function scanSell() { const r = S.cur, pid = r.pid || (document.getElementById("sp") || {}).value; if (!pid) return toast("Choisissez d'abord le produit.", true); r.pid = pid; if (addCart(pid, true)) { logScan(r, "Vendu", "ok", "ajouté au ticket"); toast(`${byId(pid).nom} ajouté au ticket.`); S.cur = null; V_scanRes(); resumeCam(); } }
const resumeCam = () => { if (S.cam) S.cam.paused = false; };
let DET = null;
async function detector() { if (DET) return DET;
  if ("BarcodeDetector" in window) { try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes("data_matrix")) { DET = new BarcodeDetector({ formats: FORMATS.filter(x => f.includes(x)) }); return DET; } } catch (e) {} }
  if (!window.BarcodeDetectionAPI) await new Promise((ok, ko) => { const s = document.createElement("script"); s.src = LIB; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  const A = window.BarcodeDetectionAPI; A.setZXingModuleOverrides({ locateFile: (f, pre) => f.endsWith(".wasm") ? WASM + f : pre + f }); DET = new A.BarcodeDetector({ formats: FORMATS }); return DET; }
const fmtName = f => ({ data_matrix: "DataMatrix", qr_code: "QR code", ean_13: "EAN-13", ean_8: "EAN-8", code_128: "Code 128" }[f] || f || "");
async function camOn() { const st = $("#camst"), el = $("#reader"); st.textContent = "Ouverture de la caméra…";
  try { if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("nocam");
    const [det, stream] = await Promise.all([detector(), navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })]);
    if (S.view !== "scanner") { stream.getTracks().forEach(t => t.stop()); return; }
    el.innerHTML = '<video playsinline muted autoplay></video><div class="aim" id="aim"></div><div class="tip">Le carré DataMatrix dans le cadre, à 10–15 cm</div>';
    const v = el.querySelector("video"); v.srcObject = stream; await v.play().catch(() => {}); try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) {}
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true }), cam = { stream, paused: false, busy: false, n: 0, timer: 0 }; S.cam = cam;
    const tick = async () => { if (S.cam !== cam) return; if (!cam.paused && !cam.busy && v.readyState >= 2 && v.videoWidth) { cam.busy = true; cam.n++;
      try { const W = v.videoWidth, H = v.videoHeight; let sx = 0, sy = 0, sw2 = W, sh = H; if (cam.n % 2) { const z = Math.round(Math.min(W, H) * .62); sx = (W - z) >> 1; sy = (H - z) >> 1; sw2 = sh = z; }
        cv.width = sw2; cv.height = sh; cx.drawImage(v, sx, sy, sw2, sh, 0, 0, sw2, sh); const r = await det.detect(cv);
        if (r && r.length && S.cam === cam && !cam.paused) { const a = $("#aim"); a && a.classList.add("hit"); setTimeout(() => a && a.classList.remove("hit"), 600); onCode(r[0].rawValue, fmtName(r[0].format)); } } catch (e) {} cam.busy = false; }
      cam.timer = setTimeout(tick, 120); };
    tick(); st.textContent = "Visez le code : il est lu tout seul."; $("#camon").hidden = true; $("#camoff").hidden = false; }
  catch (e) { stopCam(); const camErr = e && (/NotAllowed|NotFound|NotReadable|Security/.test(e.name) || e.message === "nocam"); if (el) el.innerHTML = `<div class="ph">${camErr ? "Utilisez « Prendre une photo du code »." : "Lecteur indisponible."}</div>`; st.textContent = camErr ? "Caméra bloquée ou refusée. Utilisez « Prendre une photo du code »." : "Le lecteur n'a pas pu se charger (pas d'internet ?)."; } }
function stopCam() { const c = S.cam; S.cam = null; if (c) { clearTimeout(c.timer); try { c.stream.getTracks().forEach(t => t.stop()); } catch (e) {} } }
async function scanPhoto(file) { const st = $("#camst"); st.textContent = "Lecture de la photo…";
  try { const det = await detector(); let img; try { img = await createImageBitmap(file); } catch (e) { img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); }); }
    let r = await det.detect(img); if (!r.length) { const W = img.width, H = img.height, z = Math.round(Math.min(W, H) * .6), cv = document.createElement("canvas"); cv.width = cv.height = z; cv.getContext("2d").drawImage(img, (W - z) >> 1, (H - z) >> 1, z, z, 0, 0, z, z); r = await det.detect(cv); }
    if (!r.length) { st.textContent = "Aucun code lu. Rapprochez-vous (10–15 cm), avec une bonne lumière."; return; } st.textContent = "Code lu sur la photo."; onCode(r[0].rawValue, fmtName(r[0].format)); }
  catch (e) { st.textContent = "Le lecteur n'a pas pu se charger (pas d'internet ?)."; } }

/* ================================================================ finances (formule Officine) */
const DEPCATS = ["Loyer","Salaires","Électricité et eau","Gardiennage","Transport","Fournitures","Impôts et taxes","Autre"];
const DEPMODES = ["Espèces caisse","Wave","Orange Money","Banque","Chèque"];
const moisDe = d => new Date(d.getFullYear(), d.getMonth(), 1);
const nomMois = d => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const resteF = x => x.montant - x.paye, resteB = b => b.montant - b.paye;
const ageJ = d => d ? -dj(d) : 0;
function finCharger() { if (S.finLoading) return; S.finLoading = true;
  API.finances(S.pid).then(r => { S.fin = r; S.finLoading = false; if (S.view === "finances") render(true); }).catch(e => { S.finLoading = false; toast(errMsg(e), true); }); }
async function finReload() { S.fin = await API.finances(S.pid); D.caisse = S.fin.ouverte; render(true); }
function caissePanel() { if (!premium()) return "";
  const c = D.caisse;
  if (!c) return `<section class="panel caissebar"><div class="row" style="justify-content:space-between"><div><b>Caisse fermée</b><small class="muted" style="display:block">Ouvrez la caisse en début de journée avec le fond de caisse.</small></div>
    <div class="row"><input type="number" id="fond" class="qin" style="width:130px" inputmode="numeric" min="0" placeholder="Fond (F)" aria-label="Fond de caisse"><button class="btn pri" data-act="ouvrircaisse">Ouvrir la caisse</button></div></div></section>`;
  return `<section class="panel caissebar"><div class="row" style="justify-content:space-between"><div><b>Caisse ouverte</b> <span class="st ok">depuis ${hm(c.ouverte_le)}</span><small class="muted" style="display:block">Par ${esc(nomMembre(c.ouverte_par))} · fond de caisse ${fmt(c.fond)}</small></div>
    <button class="btn" data-act="cloturer">Clôturer la caisse</button></div></section>`; }
async function cloturer() { let att = null; if (can("fin")) { try { att = await API.caisseAttendue(S.pid); } catch (e) {} }
  layer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Clôture de caisse"><div class="top"><div><h2>Clôturer la caisse</h2><p>Comptez les espèces du tiroir (fond compris), puis saisissez le total.</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  ${att != null ? `<p class="note-box">Espèces attendues : <b class="num">${fmt(att)}</b> (fond + ventes en espèces + part patient des ventes assurance − dépenses payées en espèces).</p>` : `<p class="note-box">Le montant attendu n'est pas affiché : c'est une clôture « à l'aveugle ». Le titulaire verra l'écart éventuel.</p>`}
  <div class="field"><label for="compte">Espèces comptées (F)</label><input type="number" id="compte" inputmode="numeric" min="0" autofocus></div>
  <div class="row"><button class="btn pri" data-act="cloturerok">Clôturer</button><button class="btn" data-close="1">Annuler</button></div></div>`, true); }

V.finances = () => {
  if (!premium()) return head("Finances", "Caisse du jour, créances des assurances, factures des grossistes, dépenses et résultat du mois.") +
    `<section class="panel"><h2>Disponible avec la formule Officine</h2><p>Clôture de caisse à l'aveugle avec écart, bordereaux pour les IPM, mutuelles et la CMU, suivi des factures et des avoirs des grossistes, dépenses, résultat du mois et export pour le comptable.</p>
    ${isTit() ? `<div class="row"><button class="btn pri" data-go="abonnement">Voir les formules</button></div>` : "<p class=\"muted\">Parlez-en au titulaire.</p>"}</section>`;
  if (!S.fin) { finCharger(); return head("Finances", "Chargement…"); }
  const F = S.fin, T = [["caisse","Caisse"],["assur","Assurances"],["gross","Grossistes"],["dep","Dépenses"],["res","Résultat"]];
  const cre = F.bordereaux.reduce((s, b) => s + resteB(b), 0) + F.aFacturer.reduce((s, x) => s + x.m, 0);
  const avTot = F.avoirs.reduce((s, a) => s + Math.max(0, a.disponible), 0), det = F.factures.reduce((s, x) => s + resteF(x), 0);
  const r0 = F.res[0] || {};
  return head("Finances", "Caisse, créances des assurances, dettes grossistes, dépenses et résultat. Un export prêt pour votre comptable.", `<button class="btn" data-act="exportfin">Exporter pour le comptable</button>`) +
  `<div class="kpis">
    <button class="kpi" data-ftab="caisse"><span>Caisse ${F.ouverte ? "ouverte" : "fermée"}</span><b class="num">${F.attendu != null ? fmt(F.attendu) : "—"}</b><em>${F.ouverte ? "espèces attendues" : "ouvrez-la depuis la Caisse"}</em></button>
    <button class="kpi" data-ftab="assur"><span>Les assurances vous doivent</span><b class="num">${fmt(cre)}</b><em>${pl(F.bordereaux.filter(b => resteB(b) && b.envoye_le && ageJ(b.envoye_le) > 60).length, "bordereau en retard", "bordereaux en retard")}</em></button>
    <button class="kpi" data-ftab="gross"><span>Vous devez aux grossistes</span><b class="num">${fmt(Math.max(0, det - avTot))}</b><em>${pl(F.factures.filter(x => resteF(x) && dj(x.echeance) < 0).length, "facture échue", "factures échues")}</em></button>
    <button class="kpi" data-ftab="res"><span>Résultat de ${nomMois(moisDe(today())).split(" ")[0]}</span><b class="num">${fmt(r0.resultat)}</b><em>après achats, pertes et dépenses</em></button>
  </div>
  <div class="seg" role="group" aria-label="Rubrique">${T.map(([k, l]) => `<button data-ftab="${k}" aria-pressed="${S.finTab === k}">${l}</button>`).join("")}</div>` + FV[S.finTab](); };
const FV = {};
FV.caisse = () => { const F = S.fin, c = F.ouverte, vj = c ? D.ventes.filter(v => v.created_at >= c.ouverte_le) : ventesJour();
  const par = m => vj.filter(v => v.mode === m).reduce((s, v) => s + v.total, 0), patient = vj.filter(v => v.mode === "Assurance").reduce((s, v) => s + v.total - v.part_assurance, 0);
  const depC = c ? F.depenses.filter(d => d.mode === "Espèces caisse" && d.created_at >= c.ouverte_le).reduce((s, d) => s + d.montant, 0) : 0;
  const parV = {}; vj.forEach(v => { const k = nomMembre(v.user_id), x = parV[k] = parV[k] || { n: 0, t: 0, e: 0 }; x.n++; x.t += v.total; if (v.mode === "Espèces") x.e += v.total; if (v.mode === "Assurance") x.e += v.total - v.part_assurance; });
  return `<div class="grid2"><section class="panel"><header><div><h2>${c ? "Caisse ouverte" : "Caisse fermée"}</h2><p>${c ? `Depuis ${hm(c.ouverte_le)} le ${dfr(c.ouverte_le)}, par ${esc(nomMembre(c.ouverte_par))}` : "Ouvrez la caisse depuis l'écran Caisse."}</p></div><span class="st ${c ? "ok" : "n"}">${c ? "Ouverte" : "Fermée"}</span></header>
    ${c ? `<div class="list"><div class="li"><span>Fond de caisse</span><b class="num">${fmt(c.fond)}</b></div><div class="li"><span>Ventes en espèces</span><b class="num">+ ${fmt(par("Espèces"))}</b></div>
    <div class="li"><span>Part patient des ventes assurance</span><b class="num">+ ${fmt(patient)}</b></div><div class="li"><span>Dépenses payées en espèces</span><b class="num">− ${fmt(depC)}</b></div>
    <div class="li"><b>Espèces attendues dans le tiroir</b><b class="num">${fmt(F.attendu)}</b></div></div><div class="row"><button class="btn pri" data-act="cloturer">Clôturer la caisse</button></div>` : ""}</section>
  <section class="panel"><header><div><h2>Mobile Money et assurances</h2><p>${c ? "Depuis l'ouverture" : "Aujourd'hui"} · à comparer avec vos relevés marchands.</p></div></header>
    <div class="list">${R().paiements.filter(m => m !== "Espèces" && m !== "Assurance").map(m => `<div class="li"><span>${esc(m)}</span><b class="num">${fmt(par(m))}</b></div>`).join("")}
    <div class="li"><span>Part assurance, à réclamer</span><b class="num">${fmt(vj.reduce((s, v) => s + (v.part_assurance || 0), 0))}</b></div></div></section></div>
  <section class="panel"><header><div><h2>Par vendeur</h2><p>Chaque vente est enregistrée au nom de la personne connectée.</p></div></header>
    <div class="tw"><table><thead><tr><th>Vendeur</th><th class="r">Tickets</th><th class="r">Ventes</th><th class="r">Dont espèces</th></tr></thead><tbody>
    ${Object.entries(parV).map(([n, x]) => `<tr><td><b>${esc(n)}</b></td><td class="r num">${x.n}</td><td class="r num">${fmt(x.t)}</td><td class="r num">${fmt(x.e)}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Aucune vente.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><header><div><h2>Clôtures précédentes</h2><p>Un écart qui revient souvent avec la même personne mérite une discussion.</p></div></header>
    <div class="tw"><table><thead><tr><th>Jour</th><th>Clôturée par</th><th class="r">Attendu</th><th class="r">Compté</th><th class="r">Écart</th></tr></thead><tbody>
    ${F.caisses.filter(x => x.statut === "fermee").map(x => `<tr><td class="num">${dfr(x.fermee_le)} ${hm(x.fermee_le)}</td><td>${esc(nomMembre(x.fermee_par))}</td><td class="r num">${fmt(x.attendu)}</td><td class="r num">${fmt(x.compte)}</td><td class="r"><span class="st ${x.ecart < 0 ? "bad" : x.ecart > 0 ? "warn" : "ok"}">${x.ecart ? (x.ecart > 0 ? "+ " : "− ") + fmt(Math.abs(x.ecart)) : "Juste"}</span></td></tr>`).join("") || '<tr><td colspan="5" class="empty">Aucune clôture pour l\'instant.</td></tr>'}</tbody></table></div></section>`; };
FV.assur = () => { const F = S.fin, orgs = [...new Set(R().organismes.concat(F.aFacturer.map(x => x.o), F.bordereaux.map(b => b.organisme)))];
  return `<p class="note-box">Chaque vente au tiers payant est mise de côté pour son organisme. Quand vous voulez facturer (en fin de mois, en général), créez le bordereau : il regroupe toutes les ventes pas encore facturées. Suivez ensuite l'envoi et les paiements.</p>` +
  orgs.map(o => { const bs = F.bordereaux.filter(b => b.organisme === o), af = (F.aFacturer.find(x => x.o === o) || { m: 0, n: 0 }), du = bs.reduce((s, b) => s + resteB(b), 0) + af.m;
    if (!bs.length && !af.m) return "";
    return `<section class="panel"><header><div><h2>${esc(o)}</h2><p>${af.m ? `${pl(af.n, "vente")} à facturer : ${fmt(af.m)} · ` : ""}${pl(bs.filter(b => resteB(b)).length, "bordereau")} à encaisser</p></div><div class="row"><b class="num">${fmt(du)}</b>${af.m ? `<button class="btn sm pri" data-mkbord="${esc(o)}">Créer le bordereau</button>` : ""}</div></header>
    ${bs.length ? `<div class="tw"><table><thead><tr><th>Bordereau</th><th>Créé le</th><th>Statut</th><th class="r">Montant</th><th class="r">Reste dû</th><th></th></tr></thead><tbody>
    ${bs.map(b => { const r = resteB(b), a = ageJ(b.envoye_le), st = !r ? '<span class="st ok">Payé</span>' : !b.envoye_le ? '<span class="st n">À envoyer</span>' : a > 60 ? `<span class="st bad">En retard · ${a} j</span>` : `<span class="st warn">Envoyé il y a ${a} j</span>`;
      return `<tr><td class="lot">B-${b.numero}</td><td class="num">${dfr(b.created_at)}</td><td>${st}${b.paye && r ? ` <small>déjà reçu ${fmt(b.paye)}</small>` : ""}</td><td class="r num">${fmt(b.montant)}</td><td class="r num">${fmt(r)}</td>
      <td class="r"><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn sm" data-bprint="${b.id}">Imprimer</button>${!r ? "" : !b.envoye_le ? `<button class="btn sm pri" data-bsend="${b.id}">Marquer envoyé</button>` : `<button class="btn sm" data-bpay="${b.id}">Paiement reçu</button>`}</div></td></tr>`; }).join("")}</tbody></table></div>` : ""}</section>`; }).join("") || '<section class="panel"><p class="empty">Aucune vente au tiers payant pour l\'instant.</p></section>'; };
FV.gross = () => { const F = S.fin, fs = D.fours.filter(f => F.factures.some(x => x.fournisseur_id === f.id) || F.avoirs.some(a => a.fournisseur_id === f.id && a.disponible > 0));
  return `<section class="panel"><header><div><h2>Ajouter une facture</h2><p>Les commandes réceptionnées créent leur facture toutes seules. Ajoutez ici les autres factures.</p></div></header>
    <div class="form"><div class="field"><label for="ffour">Grossiste</label><select id="ffour">${D.fours.map(f => `<option value="${f.id}">${esc(f.nom)}</option>`).join("")}</select></div>
    <div class="field"><label for="fnum">N° de facture</label><input id="fnum" autocomplete="off"></div>
    <div class="field"><label for="fmontant">Montant (F)</label><input type="number" id="fmontant" inputmode="numeric" min="0"></div>
    <div class="field"><label for="fech">Échéance</label><input type="date" id="fech" value="${iso(new Date(Date.now() + 30 * 864e5))}"></div></div>
    <div class="row"><button class="btn pri" data-act="addfact">Ajouter la facture</button></div></section>` +
  fs.map(f => { const xs = F.factures.filter(x => x.fournisseur_id === f.id), av = Math.max(0, (F.avoirs.find(a => a.fournisseur_id === f.id) || {}).disponible || 0), du = xs.reduce((s, x) => s + resteF(x), 0);
    return `<section class="panel"><header><div><h2>${esc(f.nom)}</h2><p>${pl(xs.filter(x => resteF(x)).length, "facture")} à payer${av ? ` · avoir de retours ${fmt(av)} à déduire` : ""}</p></div><b class="num">${fmt(Math.max(0, du - av))}</b></header>
    <div class="tw"><table><thead><tr><th>Facture</th><th>Reçue le</th><th>Échéance</th><th class="r">Montant</th><th class="r">Reste</th><th></th></tr></thead><tbody>
    ${xs.map(x => { const r = resteF(x), d = dj(x.echeance); return `<tr><td class="lot">${esc(x.numero || "—")}</td><td class="num">${dfr(x.date_facture)}</td><td>${!r ? '<span class="st ok">Payée</span>' : d < 0 ? `<span class="st bad">Échue depuis ${-d} j</span>` : d <= 7 ? `<span class="st warn">Dans ${d} j</span>` : `<span class="num">${dfr(x.echeance)}</span>`}</td>
      <td class="r num">${fmt(x.montant)}</td><td class="r num">${fmt(r)}</td><td class="r"><div class="row" style="justify-content:flex-end;gap:6px">${r ? `<button class="btn sm" data-fpay="${x.id}">Payer</button>` : ""}${!x.paye ? `<button class="btn sm" data-delfact="${x.id}" aria-label="Supprimer la facture">Supprimer</button>` : ""}</div></td></tr>`; }).join("") || '<tr><td colspan="6" class="empty">Aucune facture.</td></tr>'}</tbody></table></div></section>`; }).join(""); };
FV.dep = () => { const F = S.fin, m0 = iso(moisDe(today())), m1 = iso(moisDe(new Date(today().getFullYear(), today().getMonth() - 1, 1)));
  return `<section class="panel"><header><div><h2>Ajouter une dépense</h2><p>Une dépense payée en espèces est retirée des espèces attendues dans la caisse.</p></div></header>
  <div class="form"><div class="field full"><label for="dlib">Libellé</label><input type="text" id="dlib" maxlength="160" placeholder="ex. Facture Senelec, transport livraison…"></div>
  <div class="field"><label for="dcat">Catégorie</label><select id="dcat">${DEPCATS.map(c => `<option>${c}</option>`).join("")}</select></div>
  <div class="field"><label for="dmt">Montant (F)</label><input type="number" id="dmt" inputmode="numeric" min="1"></div>
  <div class="field"><label for="dmode">Payé par</label><select id="dmode">${DEPMODES.map(m => `<option>${m}</option>`).join("")}</select></div>
  <div class="field"><label for="ddate">Date</label><input type="date" id="ddate" value="${iso(today())}"></div></div>
  <div class="row"><button class="btn pri" data-act="adddep">Ajouter</button></div></section>
  <section class="panel"><header><div><h2>Dépenses récentes</h2><p>Ce mois : ${fmt(F.depenses.filter(x => x.date_depense >= m0).reduce((s, x) => s + x.montant, 0))} · mois dernier : ${fmt(F.depenses.filter(x => x.date_depense < m0 && x.date_depense >= m1).reduce((s, x) => s + x.montant, 0))}</p></div></header>
  <div class="tw"><table><thead><tr><th>Dépense</th><th>Date</th><th>Catégorie</th><th>Payé par</th><th class="r">Montant</th><th></th></tr></thead><tbody>
  ${F.depenses.map(x => `<tr><td><b>${esc(x.libelle)}</b></td><td class="num">${dfr(x.date_depense)}</td><td>${esc(x.categorie)}</td><td>${esc(x.mode)}</td><td class="r num">${fmt(x.montant)}</td><td class="r"><button class="btn sm" data-deldep="${x.id}">Supprimer</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Aucune dépense saisie.</td></tr>'}</tbody></table></div></section>`; };
FV.res = () => { const [a, b] = S.fin.res, mA = moisDe(today()), mB = new Date(mA.getFullYear(), mA.getMonth() - 1, 1);
  const row = (l, k, neg) => `<tr><td>${l}</td><td class="r num">${neg ? "− " : ""}${fmt(b[k])}</td><td class="r num">${neg ? "− " : ""}${fmt(a[k])}</td></tr>`;
  return `<section class="panel"><header><div><h2>Résultat simplifié</h2><p>Ce que la pharmacie a vraiment gagné : ventes, moins le prix d'achat des produits vendus, les produits jetés et les dépenses saisies.</p></div></header>
  <div class="tw"><table><thead><tr><th>Poste</th><th class="r">${nomMois(mB)}</th><th class="r">${nomMois(mA)} (en cours)</th></tr></thead><tbody>
  ${row("Ventes", "ventes")}${row("Coût d'achat des produits vendus", "achats", 1)}
  <tr><td><b>Marge brute</b>${b.ventes ? ` <small>${Math.round(b.marge / b.ventes * 100)} % des ventes le mois dernier</small>` : ""}</td><td class="r num"><b>${fmt(b.marge)}</b></td><td class="r num"><b>${fmt(a.marge)}</b></td></tr>
  ${row("Produits jetés (péremption)", "pertes", 1)}${row("Dépenses", "depenses", 1)}
  </tbody><tfoot><tr><td>Résultat</td><td class="r num" style="color:${b.resultat >= 0 ? "var(--ok)" : "var(--bad)"}">${fmt(b.resultat)}</td><td class="r num">${fmt(a.resultat)}</td></tr></tfoot></table></div>
  ${a.retours || b.retours ? `<p class="muted">Retours aux grossistes (avoirs) : ${fmt(b.retours)} le mois dernier, ${fmt(a.retours)} ce mois.</p>` : ""}
  <p class="note-box">C'est un résultat de gestion, pas le résultat comptable officiel : amortissements, impôts et charges sociales sont faits par votre comptable. L'export lui donne les ventes, les achats, les dépenses et les créances.</p></section>`; };
function payModal(kind, id) { const F = S.fin, x = kind === "f" ? F.factures.find(z => z.id === id) : F.bordereaux.find(z => z.id === id), reste = kind === "f" ? resteF(x) : resteB(x);
  const av = kind === "f" ? Math.min(reste, Math.max(0, (F.avoirs.find(a => a.fournisseur_id === x.fournisseur_id) || {}).disponible || 0)) : 0;
  layer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Paiement"><div class="top"><div><h2>${kind === "f" ? "Payer la facture " + esc(x.numero || "") : "Paiement reçu · B-" + x.numero}</h2><p>${kind === "f" ? esc((D.fours.find(f => f.id === x.fournisseur_id) || { nom: "" }).nom) : esc(x.organisme)} · reste ${fmt(reste)}</p></div><button class="x" data-close="1" aria-label="Fermer">×</button></div>
  <div class="form"><div class="field"><label for="pmt">${kind === "f" ? "Montant payé" : "Montant reçu"} (F)</label><input type="number" id="pmt" inputmode="numeric" min="0" value="${reste - av}"></div>
  ${kind === "f" && av ? `<div class="field"><label for="pav">Avoir déduit (F)</label><input type="number" id="pav" inputmode="numeric" min="0" max="${av}" value="${av}"></div>` : ""}</div>
  ${kind === "f" && av ? `<p class="note-box">Un avoir de ${fmt(av)} (produits retournés) peut être déduit de cette facture.</p>` : ""}
  <div class="row"><button class="btn pri" data-payok="${kind}|${x.id}">Enregistrer</button><button class="btn" data-close="1">Annuler</button></div></div>`, true); }
function imprimerBordereau(id) { const b = S.fin.bordereaux.find(x => x.id === id);
  API.ventesBordereau(id).then(vs => { $("#print").innerHTML = `<h3>${esc(D.ph.nom)}</h3><div>${esc(D.ph.adresse || "")} ${esc(D.ph.ville || "")} ${esc(D.ph.telephone || "")}</div><hr><div><b>Bordereau B-${b.numero} · ${esc(b.organisme)}</b></div><div>Établi le ${dfr(b.created_at)}</div><hr>
    ${vs.map(v => `<div class="l"><span>${dfr(v.created_at)} · ticket ${v.id.slice(0, 8)}</span><span>${fmt(v.part_assurance)}</span></div>`).join("")}<hr><div class="l"><b>Total à rembourser</b><b>${fmt(b.montant)}</b></div>`; window.print(); }).catch(e => toast(errMsg(e), true)); }
async function exporterFinances(btn) { await run(btn, async () => { const F = S.fin, m0 = moisDe(today()), m1 = new Date(m0.getFullYear(), m0.getMonth() - 1, 1), vs = await API.ventesDepuis(S.pid, m1.toISOString());
  const L = [["Type","Date","Pièce","Libellé","Tiers","Mode","Montant (F)","Reste dû (F)"]];
  vs.forEach(v => L.push(["Vente", dfr(v.created_at), "T-" + v.id.slice(0, 8), "Ticket de caisse" + (v.remise_pct ? ` (remise ${v.remise_pct} %)` : ""), v.organisme || "Client comptoir", v.mode, v.total, ""]));
  F.factures.forEach(x => L.push(["Achat", dfr(x.date_facture), x.numero || "", "Facture grossiste" + (x.avoir_utilise ? ` (avoir déduit ${x.avoir_utilise})` : ""), (D.fours.find(f => f.id === x.fournisseur_id) || { nom: "" }).nom, resteF(x) ? "À payer, échéance " + dfr(x.echeance) : "Payée", x.montant, resteF(x)]));
  F.depenses.forEach(x => L.push(["Dépense", dfr(x.date_depense), "", x.libelle, x.categorie, x.mode, x.montant, ""]));
  F.bordereaux.forEach(b => L.push(["Créance assurance", dfr(b.created_at), "B-" + b.numero, "Bordereau tiers payant", b.organisme, resteB(b) ? (b.envoye_le ? "Envoyé le " + dfr(b.envoye_le) : "À envoyer") : "Payé", b.montant, resteB(b)]));
  telecharger(`wergui-comptable-${iso(today()).slice(0, 7)}.csv`, csv(L), "text/csv;charset=utf-8");
  toast("Fichier pour le comptable téléchargé (ouvrable dans Excel)."); }); }

/* ================================================================ événements */
document.addEventListener("submit", e => { const f = e.target.closest("form[data-form]"); if (!f) return; e.preventDefault(); onForm(f); });
document.addEventListener("click", async e => { const t = e.target.closest("button,[data-prod],[data-close]"); if (!t) return; const d = t.dataset;
  if (d.close && e.target === t) return closeLayer();
  if (d.auth) return authScreen(d.auth);
  if (d.pid) { S.pid = d.pid; store.set("wergui.pid", d.pid); closeLayer(); return boot(); }
  if (!D) { if (d.act === "logout") { await API.signOut(); S.pid = null; return authScreen("login"); } if (d.act === "boot") return run(t, boot); return; }
  if (d.go) { if (d.tab) S.perTab = d.tab; if (d.mode) S.scanMode = d.mode; return go(d.go); }
  if (d.prod) return fiche(d.prod);
  if (d.add) return addCart(d.add);
  if (d.q) { const [pid, s] = d.q.split("|"), c = S.cart.find(x => x.pid === pid); if (+s > 0) return addCart(pid); c.q--; if (!c.q) S.cart = S.cart.filter(x => x !== c); return render(true); }
  if (d.pay) { S.pay = d.pay; return render(true); }
  if (d.rem !== undefined) { S.remise = +d.rem; return render(true); }
  if (d.per) { S.perTab = d.per; return render(true); }
  if (d.couv) { S.couv = +d.couv; S.cmdQ = {}; return render(true); }
  if (d.send) return envoyer(d.send);
  if (d.confirm) return confirmer(d.confirm, t);
  if (d.recv) return recevoir(d.recv);
  if (d.recok) return valRecep(d.recok, t);
  if (d.sortir) { const [id, type] = d.sortir.split("|"); return run(t, async () => { await API.sortirLot(id, type); await reload(true); toast(type === "retrait" ? "Lot retiré du stock et mis en destruction." : "Retour au grossiste enregistré."); }); }
  if (d.prio) { const l = D.lots.find(x => x.id === d.prio); return run(t, async () => { await API.priorite(l.id, !l.prioritaire); l.prioritaire = !l.prioritaire; render(true); toast(l.prioritaire ? "Ce lot sera proposé en premier au comptoir." : "Priorité retirée."); }); }
  if (d.smode) { S.scanMode = d.smode; document.querySelectorAll("[data-smode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.smode === S.scanMode)); return V_scanRes(); }
  if (d.stab) { S.setTab = d.stab; return render(true); }
  if (d.ftab) { S.finTab = d.ftab; return render(true); }
  if (d.mkbord) return run(t, async () => { await API.creerBordereau(S.pid, d.mkbord); S.finTab = "assur"; await finReload(); toast(`Bordereau ${d.mkbord} créé : imprimez-le et envoyez-le.`); });
  if (d.bsend) return run(t, async () => { await API.majBordereau(d.bsend, iso(today()), null); await finReload(); toast("Bordereau marqué envoyé."); });
  if (d.bpay) return payModal("b", d.bpay);
  if (d.fpay) return payModal("f", d.fpay);
  if (d.bprint) return imprimerBordereau(d.bprint);
  if (d.payok) { const [k, id] = d.payok.split("|"), m = Math.max(0, parseInt($("#pmt").value) || 0), av = $("#pav") ? Math.max(0, parseInt($("#pav").value) || 0) : 0;
    if (!m && !av) return toast("Indiquez un montant.", true);
    return run(t, async () => { if (k === "f") await API.payerFacture(id, m, av); else await API.majBordereau(id, null, m); closeLayer(); await finReload(); toast(k === "f" ? "Paiement de la facture enregistré." : "Paiement de l'assurance enregistré."); }); }
  if (d.deldep) { if (!confirmerTexte("Supprimer cette dépense ?")) return; return run(t, async () => { await API.remove("depenses", d.deldep); await finReload(); toast("Dépense supprimée."); }); }
  if (d.delfact) { if (!confirmerTexte("Supprimer cette facture ?")) return; return run(t, async () => { await API.remove("factures", d.delfact); await finReload(); toast("Facture supprimée."); }); }
  if (d.member !== undefined) return member(d.member);
  if (d.saveuser !== undefined) return saveUser(d.saveuser, t);
  if (d.editprod) return editProd(d.editprod);
  if (d.saveprod !== undefined) return saveProd(d.saveprod, t);
  if (d.delprod) return run(t, async () => { await API.remove("produits", d.delprod); closeLayer(); await reload(true); toast("Produit supprimé."); });
  if (d.delray) return run(t, async () => { await API.remove("rayons", d.delray); await reload(true); toast("Rayon supprimé."); });
  if (d.delfour) return run(t, async () => { await API.remove("fournisseurs", d.delfour); await reload(true); toast("Grossiste supprimé."); });
  if (d.admsave) { const id = d.admsave; return run(t, async () => { await API.adminDefinir(id, $("#af-" + id).value, $("#as-" + id).value, $("#ap-" + id).value); S.adminList = null; if (id === S.pid) D.ph = (await API.load(S.pid)).ph; render(true); toast("Abonnement mis à jour."); }); }
  const a = d.act; if (!a) return;
  if (a === "more") return more();
  if (a === "compte") return compte();
  if (a === "logout") { stopCam(); await API.signOut(); D = null; S.pid = null; closeLayer(); return authScreen("login", "Vous êtes déconnecté."); }
  if (a === "logoutall") { stopCam(); await API.signOutAll(); D = null; S.pid = null; closeLayer(); return authScreen("login", "Déconnecté de tous vos appareils."); }
  if (a === "delcompte") return delCompte();
  if (a === "delcompteok") { if ($("#delconf").value.trim().toUpperCase() !== "SUPPRIMER") return toast("Tapez SUPPRIMER pour confirmer.", true); const avec = !!($("#delph") && $("#delph").checked); return run(t, async () => { await API.supprimerCompte(avec); await API.signOut().catch(() => {}); D = null; S.pid = null; closeLayer(); authScreen("login", "Votre compte a été supprimé. Merci d'avoir utilisé Wergui SN."); }); }
  if (a === "mesdonnees") { const data = { compte: { id: S.user.id, email: S.user.email, cree_le: S.user.created_at, infos: S.user.user_metadata }, pharmacies: S.mems.map(m => ({ pharmacie: (S.phs.find(p => p.id === m.pharmacy_id) || {}).nom, role: m.role, nom_affiche: m.nom, droits: m.droits, depuis: m.created_at })) }; telecharger("wergui-mes-donnees.json", JSON.stringify(data, null, 2), "application/json"); return toast("Vos données personnelles sont téléchargées."); }
  if (a === "exportph") return exporterPharmacie(t);
  if (a === "transfert") { const u = $("#trto").value, m = D.membres.find(x => x.user_id === u); if (!confirmerTexte(`Transférer le rôle de titulaire à ${m.nom} ?`)) return; return run(t, async () => { await API.transferer(S.pid, u); await reload(); toast(`${m.nom} est maintenant titulaire. Vous êtes pharmacien adjoint.`); }); }
  if (a === "delpharma") { const nom = $("#delphnom").value.trim(); if (nom !== D.ph.nom) return toast("Tapez exactement le nom de la pharmacie pour confirmer.", true); return run(t, async () => { await API.supprimerPharmacie(S.pid, nom); store.set("wergui.pid", ""); S.pid = null; D = null; await boot(); toast("Pharmacie supprimée."); }); }
  if (a === "consolerefresh") { S.adminList = null; return render(true); }
  if (a === "refresh") { closeLayer(); return run(t, () => reload()); }
  if (a === "setpw") { const v = $("#npw").value; if (v.length < 8) return toast("8 caractères minimum.", true); return run(t, async () => { await API.setPassword(v); closeLayer(); toast("Mot de passe changé."); }); }
  if (a === "encaisser") return encaisser(t);
  if (a === "ouvrircaisse") { const f = Math.max(0, parseInt(($("#fond") || {}).value) || 0); return run(t, async () => { await API.ouvrirCaisse(S.pid, f); await reload(true); toast(`Caisse ouverte avec un fond de ${fmt(f)}.`); }); }
  if (a === "cloturer") return cloturer();
  if (a === "cloturerok") { const v = $("#compte").value; if (v === "" || +v < 0) return toast("Saisissez le montant compté.", true);
    return run(t, async () => { const e = await API.fermerCaisse(S.pid, parseInt(v)); closeLayer(); if (S.view === "finances") await finReload(); else await reload(true);
      toast(e == null ? "Caisse clôturée. Le titulaire verra le résultat." : e === 0 ? "Caisse clôturée : le compte est juste." : `Caisse clôturée : écart de ${e > 0 ? "+ " : "− "}${fmt(Math.abs(e))}.`, e != null && e < 0); }); }
  if (a === "adddep") { const lib = $("#dlib").value.trim(), m = parseInt($("#dmt").value) || 0; if (!lib) return toast("Indiquez le libellé.", true); if (m <= 0) return toast("Indiquez le montant.", true);
    return run(t, async () => { await API.insert("depenses", { pharmacy_id: S.pid, libelle: lib, categorie: $("#dcat").value, montant: m, mode: $("#dmode").value, date_depense: $("#ddate").value || iso(today()), user_id: S.user.id }); await finReload(); toast(`Dépense ajoutée : ${fmt(m)}.`); }); }
  if (a === "addfact") { const m = parseInt($("#fmontant").value) || 0; if (m <= 0) return toast("Indiquez le montant de la facture.", true);
    return run(t, async () => { await API.insert("factures", { pharmacy_id: S.pid, fournisseur_id: $("#ffour").value, numero: $("#fnum").value.trim() || null, montant: m, ...($("#fech").value ? { echeance: $("#fech").value } : {}) }); await finReload(); toast("Facture ajoutée."); }); }
  if (a === "exportfin") return exporterFinances(t);
  if (a === "vider") { S.cart = []; return render(true); }
  if (a === "toticket") return $("#ticket").scrollIntoView({ behavior: "smooth", block: "start" });
  if (a === "newprod") return editProd(null);
  if (a === "copybon") { try { await navigator.clipboard.writeText(S._bon); toast("Texte copié."); } catch (e) { toast("Copie impossible : sélectionnez le texte.", true); } return; }
  if (a === "toutok") { D.produits.filter(p => (p.rayon_id || "") === S.invCat).forEach(p => S.inv[p.id] = lotsOf(p).reduce((s, l) => s + l.quantite, 0)); return render(true); }
  if (a === "valinv") return valInv(t);
  if (a === "camon") return camOn();
  if (a === "camoff") { stopCam(); $("#reader").innerHTML = '<div class="ph">Caméra arrêtée.</div>'; $("#camon").hidden = false; $("#camoff").hidden = true; return; }
  if (a === "scanadd") return scanAdd(t);
  if (a === "scansell") return scanSell();
  if (a === "scannext") { S.cur = null; V_scanRes(); return resumeCam(); }
  if (a === "scanmanual") { S.cur = { raw: "", kind: "Saisie manuelle", manual: true, gtin: "", lot: "", exp: "", serie: "", pid: null }; return V_scanRes(); }
  if (a === "savepharma") { const g = k => $("#" + k).value.trim(); if (!g("cnom")) return toast("Indiquez le nom.", true); return run(t, async () => { D.ph = await API.update("pharmacies", S.pid, { nom: g("cnom"), adresse: g("cadr") || null, ville: g("cville") || null, telephone: g("ctel") || null, whatsapp: g("cwa") || null, message_ticket: g("cticket") || null }); nav(); toast("Informations enregistrées."); }); }
  if (a === "addcat") { const v = $("#newcat").value.trim(); if (!v) return toast("Indiquez le nom du rayon.", true); return run(t, async () => { await API.insert("rayons", { pharmacy_id: S.pid, nom: v }); await reload(true); toast(`Rayon « ${v} » ajouté.`); }); }
  if (a === "addfour") { const v = $("#newfour").value.trim(); if (!v) return toast("Indiquez le nom du grossiste.", true); return run(t, async () => { await API.insert("fournisseurs", { pharmacy_id: S.pid, nom: v, delai_jours: 2 }); await reload(true); toast(`${v} ajouté.`); }); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLayer(); if (e.key === "Enter" && e.target.dataset && e.target.dataset.prod) fiche(e.target.dataset.prod); });
document.addEventListener("input", e => { const t = e.target;
  if (t.id === "cq") { S.q = t.value; return fillRes(); }
  if (t.id === "sq") { S.q = t.value; return fillStock(); }
  if (t.dataset.cq) { S.cmdQ[t.dataset.cq] = Math.max(0, parseInt(t.value) || 0); return; }
  if (t.dataset.inv) { S.inv[t.dataset.inv] = t.value === "" ? null : Math.max(0, parseInt(t.value) || 0); return invTotals(); } });
document.addEventListener("change", async e => { const t = e.target; if (!D) return;
  if (t.dataset.cq) return render(true);
  if (t.id === "scat") { S.fcat = t.value; return fillStock(); }
  if (t.id === "sst") { S.fst = t.value; return fillStock(); }
  if (t.id === "icat") { S.invCat = t.value; return render(true); }
  if (t.id === "org") { S.org = t.value; return; }
  if (t.id === "scanfile" && t.files[0]) { scanPhoto(t.files[0]); t.value = ""; return; }
  if (t.id === "sp" && S.cur) { S.cur.pid = t.value || null; S.cur.lot = ($("#slot") || {}).value ?? S.cur.lot; S.cur.exp = ($("#sexp") || {}).value ?? S.cur.exp; return V_scanRes(); }
  if (t.dataset.ray) { const v = t.value.trim(); if (!v) return render(true); return run(null, async () => { await API.update("rayons", t.dataset.ray, { nom: v }); await reload(true); toast(`Rayon renommé : « ${v} ».`); }); }
  if (t.dataset.four) { const [id, k] = t.dataset.four.split("|"), v = k === "delai_jours" ? Math.max(0, Math.min(60, parseInt(t.value) || 0)) : t.value.trim() || null; return run(null, async () => { const row = await API.update("fournisseurs", id, { [k]: v }); Object.assign(D.fours.find(f => f.id === id), row); toast(`${row.nom} : enregistré.`); }); }
  if (t.dataset.fret) return run(null, async () => { const row = await API.update("fournisseurs", t.dataset.fret, { reprend_produits: t.checked }); Object.assign(D.fours.find(f => f.id === row.id), row); toast(`${row.nom} ${row.reprend_produits ? "reprend" : "ne reprend pas"} les produits.`); });
  if (t.dataset.cfg) { const v = Math.max(+t.min, Math.min(+t.max, parseInt(t.value) || 0)); t.value = v; return run(null, async () => { await saveReglages({ [t.dataset.cfg]: v }); if (t.dataset.cfg === "couverture_jours") { S.couv = v; S.cmdQ = {}; } nav(); toast("Règle enregistrée."); }); }
  if (t.id === "orgs") { const list = t.value.split(",").map(x => x.trim()).filter(Boolean); return run(null, async () => { await saveReglages({ organismes: list.length ? list : ["IPM"] }); toast("Organismes enregistrés."); }); }
  if (t.dataset.paym) { const m = t.dataset.paym, cur = R().paiements, next = t.checked ? [...new Set(cur.concat(m))] : cur.filter(x => x !== m); if (!next.length) { t.checked = true; return toast("Gardez au moins un moyen de paiement.", true); } return run(null, async () => { await saveReglages({ paiements: next }); toast(`${m} : ${t.checked ? "accepté" : "désactivé"} en caisse.`); }); } });

if (sb) sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") authScreen("nouveau"); });
boot().catch(e => { console.error(e); $("#root").innerHTML = `<div class="auth"><div class="authcard"><h1>Erreur de chargement</h1><p class="err">${esc(errMsg(e))}</p><button class="btn pri" onclick="location.reload()">Réessayer</button></div></div>`; });
