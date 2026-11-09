"""Remplit la pharmacie de démonstration : produits, lots, 30 jours de ventes, alertes, commandes, caisse, finances.
Produit des fichiers SQL (un par étape) exécutés ensuite par l'API de gestion Supabase."""
import json, random, uuid, datetime as dt
random.seed(221)
C = json.load(open('compte.json')); PH = C['pharmacy_id']; TIT = C['titulaire']; M = C['membres']
VEND = [M['Moussa Diop'], M['Fatou Sarr']]; ADJ = M['Dr Awa Ndiaye']
CODES = json.load(open('codes.json'))
RAY = {'A': 'Antipaludiques', 'B': 'Antibiotiques', 'C': 'Antalgiques', 'M': 'Maladies chroniques', 'D': 'Digestif', 'P': 'Pédiatrie', 'R': 'Respiratoire', 'V': 'Vitamines', 'X': 'Parapharmacie'}
FOURS = ['Laborex', 'Cophase', 'Sodipharm', 'Duopharm']; FW = [45, 30, 15, 10]
today = dt.date.today(); now = dt.datetime.now(dt.timezone.utc)
q = lambda s: "'" + str(s).replace("'", "''") + "'"
def ts(d): return q(d.isoformat())
ID = lambda: str(uuid.uuid4())

rows = [l.rstrip('\n').split('|') for l in open('catalogue.txt') if l.strip() and not l.startswith('#')]
P = []
for r in rows:
    pv = int(r[3]); marge = random.uniform(0.70, 0.80)
    P.append(dict(id=ID(), ray=RAY[r[0]], nom=r[1], pres=r[2], pv=pv, pa=max(25, int(round(pv * marge / 25.0)) * 25), vj=float(r[4]),
                  four=random.choices(FOURS, FW)[0], codes=['0' + CODES[r[1]]] if r[1] in CODES else []))

# ---------------------------------------------------------------- ventes sur 30 jours (+ aujourd'hui jusqu'à maintenant)
heures = list(range(8, 22)); hw = [3, 5, 6, 6, 5, 4, 4, 5, 6, 7, 7, 6, 4, 2]
weights = [p['vj'] for p in P]; total_vj = sum(weights)
ventes, lignes, sold = [], [], {p['id']: 0 for p in P}
orgs = ['IPM', 'IPM', 'Mutuelle', 'CMU']
for jour in range(30, -1, -1):
    d = today - dt.timedelta(days=jour)
    facteur = 0.75 if d.weekday() == 6 else (1.1 if d.weekday() == 4 else 1.0)
    units = int(random.gauss(total_vj * facteur, total_vj * 0.08))
    if jour == 0: units = int(units * min(1, max(0.15, (now.hour + 1 - 8) / 14)))
    while units > 0:
        n = random.choices([1, 1, 1, 2, 2, 3, 4], k=1)[0]
        prods = random.choices(P, weights=weights, k=n); items = {}
        for p in prods: items[p['id']] = items.get(p['id'], 0) + (1 if random.random() < 0.85 else 2)
        units -= sum(items.values())
        h = random.choices(heures, hw)[0]
        if jour == 0 and h > max(8, now.hour - 1): h = max(8, now.hour - 1)
        t = dt.datetime(d.year, d.month, d.day, h, random.randint(0, 59), random.randint(0, 59), tzinfo=dt.timezone.utc)
        mode = random.choices(['Espèces', 'Wave', 'Orange Money', 'Assurance'], [55, 25, 12, 8])[0]
        remise = random.choices([0, 5, 10], [94, 4, 2])[0]
        vid = ID(); brut = 0
        for pid, qte in items.items():
            p = next(x for x in P if x['id'] == pid)
            lignes.append(dict(id=ID(), v=vid, p=pid, q=qte, pu=p['pv'], pa=p['pa'], t=t)); brut += qte * p['pv']; sold[pid] += qte
        total = round(brut * (100 - remise) / 100)
        user = random.choices(VEND + [ADJ, TIT], [42, 38, 12, 8])[0]
        ventes.append(dict(id=vid, user=user, total=total, remise=remise, mode=mode, org=random.choice(orgs) if mode == 'Assurance' else None,
                           part=round(total * 0.8) if mode == 'Assurance' else 0, t=t))

# ---------------------------------------------------------------- lots (stock final + ventes du mois sur le premier lot valide)
lots = []; L = []
alerte_court = set(random.sample(range(len(P)), 9)); alerte_moyen = set(random.sample(range(len(P)), 16)); perimes = set(random.sample(range(len(P)), 5))
rupture = set(random.sample([i for i, p in enumerate(P) if p['vj'] >= 0.3], 4)); sous_seuil = set(random.sample([i for i, p in enumerate(P) if p['vj'] >= 0.5], 12))
lettres = 'ABCDEFGHJKLMNPRSTUVWXYZ'
num = lambda: random.choice(lettres) + random.choice(lettres) + str(random.randint(100, 9999))
for i, p in enumerate(P):
    jours_stock = 0 if i in rupture else (random.uniform(1.5, 4) if i in sous_seuil else random.uniform(12, 60))
    final = int(round(p['vj'] * jours_stock)) if i not in rupture else 0
    if i not in rupture and final == 0: final = random.randint(2, 6)
    exps = sorted(today + dt.timedelta(days=random.randint(150, 720)) for _ in range(random.choice([1, 1, 2, 2, 3])))
    if i in alerte_court: exps[0] = today + dt.timedelta(days=random.randint(6, 28))
    elif i in alerte_moyen: exps[0] = today + dt.timedelta(days=random.randint(35, 85))
    parts = [final] if len(exps) == 1 else [max(1, final // len(exps))] * (len(exps) - 1) + [final - max(1, final // len(exps)) * (len(exps) - 1)]
    if (i in alerte_court or i in alerte_moyen) and final: parts[0] = max(parts[0], random.randint(3, 15))
    for k, (e, f) in enumerate(zip(exps, parts)):
        ini = f + (sold[p['id']] if k == 0 else 0)
        if ini <= 0: continue
        lid = ID(); lots.append(dict(id=lid, p=p['id'], num=num(), exp=e, ini=ini, fin=max(0, f), prio=(i in alerte_court and random.random() < 0.4)))
        if k == 0: p['lot0'] = lid
    if i in perimes: lots.append(dict(id=ID(), p=p['id'], num=num(), exp=today - dt.timedelta(days=random.randint(3, 40)), ini=random.randint(2, 8), fin=None, prio=False))
for l in lots:
    if l['fin'] is None: l['fin'] = l['ini']
for x in lignes:
    x['lot'] = next(p for p in P if p['id'] == x['p']).get('lot0')

# ---------------------------------------------------------------- écriture SQL
out = {}
s = [f"update public.pharmacies set adresse = 'Avenue Blaise Diagne, Médina', ville = 'Dakar', telephone = '33 800 00 00', whatsapp = '221770000000', message_ticket = 'Merci de votre visite. Bonne santé !', essai_fin = current_date + 3650, reglages = coalesce(reglages, '{{}}'::jsonb) || '{{\"organismes\":[\"IPM\",\"Mutuelle\",\"CMU\"],\"tiers_payant\":80}}'::jsonb where id = {q(PH)};"]
s.append("insert into public.produits (id, pharmacy_id, nom, presentation, rayon_id, fournisseur_id, prix_vente, prix_achat, codes, created_at) values\n" + ",\n".join(
    f"({q(p['id'])}, {q(PH)}, {q(p['nom'])}, {q(p['pres'])}, (select id from public.rayons where pharmacy_id = {q(PH)} and nom = {q(p['ray'])}), (select id from public.fournisseurs where pharmacy_id = {q(PH)} and nom = {q(p['four'])}), {p['pv']}, {p['pa']}, array[{','.join(q(c) for c in p['codes'])}]::text[], now() - interval '45 days')" for p in P) + ";")
s.append("insert into public.lots (id, pharmacy_id, produit_id, numero, peremption, quantite, prioritaire, created_at) values\n" + ",\n".join(
    f"({q(l['id'])}, {q(PH)}, {q(l['p'])}, {q(l['num'])}, {q(l['exp'].isoformat())}, {l['fin']}, {str(l['prio']).lower()}, now() - interval '40 days')" for l in lots) + ";")
out['1_produits_lots'] = "\n".join(s)

chunks = [ventes[i:i + 700] for i in range(0, len(ventes), 700)]
for n, ch in enumerate(chunks):
    ids = {v['id'] for v in ch}; ls = [x for x in lignes if x['v'] in ids]
    s = ["insert into public.ventes (id, pharmacy_id, user_id, total, remise_pct, mode, organisme, part_assurance, created_at) values\n" + ",\n".join(
        f"({q(v['id'])}, {q(PH)}, {q(v['user'])}, {v['total']}, {v['remise']}, {q(v['mode'])}, {q(v['org']) if v['org'] else 'null'}, {v['part']}, {ts(v['t'])})" for v in ch) + ";",
         "insert into public.vente_lignes (id, vente_id, pharmacy_id, produit_id, lot_id, quantite, prix_unitaire, prix_achat, created_at) values\n" + ",\n".join(
        f"({q(x['id'])}, {q(x['v'])}, {q(PH)}, {q(x['p'])}, {q(x['lot']) if x['lot'] else 'null'}, {x['q']}, {x['pu']}, {x['pa']}, {ts(x['t'])})" for x in ls) + ";"]
    out[f'2_ventes_{n}'] = "\n".join(s)

# mouvements : retraits de périmés et un retour grossiste dans le mois
s = []
mv = random.sample(P, 4)
for k, p in enumerate(mv):
    qte = random.randint(2, 6); t = now - dt.timedelta(days=random.randint(3, 25))
    s.append(f"insert into public.mouvements (pharmacy_id, type, produit_id, quantite, valeur, user_id, created_at) values ({q(PH)}, {q('retour' if k == 0 else 'retrait')}, {q(p['id'])}, {-qte}, {qte * p['pa']}, {q(ADJ)}, {ts(t)});")
# commandes : une en attente de livraison, deux reçues (avec facture)
sugg = [p for i, p in enumerate(P) if i in sous_seuil and p['four'] == 'Laborex'][:5] or [p for i, p in enumerate(P) if i in sous_seuil][:5]
cid = ID(); s.append(f"insert into public.commandes (id, pharmacy_id, fournisseur_id, user_id, statut, created_at) values ({q(cid)}, {q(PH)}, (select id from public.fournisseurs where pharmacy_id = {q(PH)} and nom = 'Laborex'), {q(TIT)}, 'envoyee', now() - interval '5 hours');")
s += [f"insert into public.commande_lignes (commande_id, pharmacy_id, produit_id, quantite) values ({q(cid)}, {q(PH)}, {q(p['id'])}, {max(5, int(p['vj'] * 15))});" for p in sugg]
for k, (four, jours, montant, paye) in enumerate([('Laborex', 26, 1284500, 1284500), ('Cophase', 12, 615800, 300000), ('Laborex', 4, 942300, 0), ('Sodipharm', 38, 388900, 0)]):
    rid = ID(); s.append(f"insert into public.commandes (id, pharmacy_id, fournisseur_id, user_id, statut, created_at, recue_at) values ({q(rid)}, {q(PH)}, (select id from public.fournisseurs where pharmacy_id = {q(PH)} and nom = {q(four)}), {q(TIT)}, 'recue', now() - interval '{jours + 1} days', now() - interval '{jours} days');")
    s.append(f"insert into public.factures (pharmacy_id, fournisseur_id, numero, date_facture, echeance, montant, paye, commande_id) values ({q(PH)}, (select id from public.fournisseurs where pharmacy_id = {q(PH)} and nom = {q(four)}), (select 'BC-' || numero from public.commandes where id = {q(rid)}), current_date - {jours}, current_date - {jours} + 30, {montant}, {paye}, {q(rid)});")
# caisse : 14 clôtures, caisse du jour ouverte par Moussa à 8 h
for j in range(14, 0, -1):
    d = today - dt.timedelta(days=j); att = random.randint(180, 330) * 1000 + random.choice([0, 250, 500, 750]); ecart = random.choices([0, 0, 0, -500, -1000, 250, -2500], k=1)[0]
    qui = random.choice(VEND)
    s.append(f"insert into public.caisses (pharmacy_id, fond, ouverte_par, ouverte_le, fermee_par, fermee_le, attendu, compte, ecart, statut) values ({q(PH)}, 25000, {q(qui)}, {ts(dt.datetime(d.year, d.month, d.day, 8, 2, tzinfo=dt.timezone.utc))}, {q(qui)}, {ts(dt.datetime(d.year, d.month, d.day, 21, 55, tzinfo=dt.timezone.utc))}, {att}, {att + ecart}, {ecart}, 'fermee');")
s.append(f"insert into public.caisses (pharmacy_id, fond, ouverte_par, ouverte_le, statut) values ({q(PH)}, 25000, {q(VEND[0])}, {ts(dt.datetime(today.year, today.month, today.day, 8, 0, tzinfo=dt.timezone.utc))}, 'ouverte');")
# dépenses
m0 = today.replace(day=1); m1 = (m0 - dt.timedelta(days=1)).replace(day=1)
dep = [(m1 + dt.timedelta(days=4), 'Loyer', 'Loyer', 350000, 'Banque'), (m1 + dt.timedelta(days=27), 'Salaires (3 personnes)', 'Salaires', 620000, 'Banque'), (m1 + dt.timedelta(days=24), 'Facture Senelec', 'Électricité et eau', 84300, 'Wave'),
       (m1 + dt.timedelta(days=25), 'Facture SDE', 'Électricité et eau', 18600, 'Wave'), (m1 + dt.timedelta(days=28), 'Gardiennage', 'Gardiennage', 60000, 'Orange Money'),
       (m0 + dt.timedelta(days=min(3, (today - m0).days)), 'Loyer', 'Loyer', 350000, 'Banque'), (today - dt.timedelta(days=2), 'Rouleaux de caisse et sachets', 'Fournitures', 6500, 'Espèces caisse'),
       (today - dt.timedelta(days=1), 'Transport livraison grossiste', 'Transport', 3000, 'Espèces caisse')]
for d, lib, cat, mt, mode in dep:
    if d > today: d = today
    s.append(f"insert into public.depenses (pharmacy_id, date_depense, libelle, categorie, montant, mode, user_id, created_at) values ({q(PH)}, {q(d.isoformat())}, {q(lib)}, {q(cat)}, {mt}, {q(mode)}, {q(TIT)}, {ts(dt.datetime(d.year, d.month, d.day, 12, 0, tzinfo=dt.timezone.utc))});")
# bordereau IPM : ventes assurance de plus de 15 jours, envoyé, payé en partie
s.append(f"""with b as (insert into public.bordereaux (pharmacy_id, organisme, montant, paye, envoye_le, created_at)
  select {q(PH)}, 'IPM', coalesce(sum(part_assurance), 0), round(coalesce(sum(part_assurance), 0) * 0.4), current_date - 12, now() - interval '13 days'
  from public.ventes where pharmacy_id = {q(PH)} and organisme = 'IPM' and created_at < now() - interval '15 days' returning id)
update public.ventes set bordereau_id = (select id from b) where pharmacy_id = {q(PH)} and organisme = 'IPM' and created_at < now() - interval '15 days';""")
out['3_activite'] = "\n".join(s)
for k, v in out.items(): open(f'sql_{k}.sql', 'w').write(v)
print(len(P), 'produits ·', len(lots), 'lots ·', len(ventes), 'ventes ·', len(lignes), 'lignes ·', sum(v['total'] for v in ventes if v['t'].date() == today), 'F aujourd\'hui ·', sorted(out))
