"""Vidéo de présentation Wergui SN (voix IA Piper, diapositives, sous-titres) — 1920x1080."""
import json, os, re, subprocess, wave, sys

D = os.path.dirname(os.path.abspath(__file__)); CAP = D + '/cap/'; OUT = D + '/build/'; os.makedirs(OUT, exist_ok=True)
VOIX = sys.argv[1] if len(sys.argv) > 1 else 'fr_FR-siwis-medium'
GRA = '/tmp/claude-0/-home-user/8a45cc43-8049-5e9a-b61e-235f58f717b7/images/13.png'

S = [
 dict(id='intro', layout='intro', s=["Ouergui ès ène, en partenariat avec Groupe Référence Afrique, présente le logiciel de gestion de stock pensé pour les pharmacies du Sénégal."],
      sub=["Wergui SN, en partenariat avec Groupe Référence Afrique, présente le logiciel de gestion de stock pensé pour les pharmacies du Sénégal."]),
 dict(id='probleme', k='Le constat', t='Fini le cahier', b=['Boîtes qui périment en rayon', 'Ruptures sans prévenir', 'Bénéfice difficile à connaître'], img=['01_accueil_site'],
      s=["Aujourd'hui, beaucoup de pharmacies gèrent encore leur stock sur un cahier.", "Des boîtes périment en rayon, des ruptures arrivent sans prévenir, et il est difficile de savoir ce que la pharmacie gagne vraiment.", "Ouergui ès ène règle tout cela."],
      sub=["Aujourd'hui, beaucoup de pharmacies gèrent encore leur stock sur un cahier.", "Des boîtes périment en rayon, des ruptures arrivent sans prévenir, et il est difficile de savoir ce que la pharmacie gagne vraiment.", "Wergui SN règle tout cela."]),
 dict(id='dashboard', k='01 · Tableau de bord', t='Votre journée en un coup d’œil', b=['Ventes du jour, valeur du stock', 'Lots à surveiller, ruptures', '« À faire aujourd’hui »'], img=['02_tableau_de_bord'],
      s=["Dès l'ouverture, le tableau de bord résume la journée : les ventes du jour, la valeur du stock, les lots à surveiller et les ruptures.", "La liste « À faire aujourd'hui » indique exactement quoi faire : retirer les lots périmés, commander, réceptionner une livraison."]),
 dict(id='scanner', k='02 · Scanner', t='Une boîte scannée, tout est rempli', b=['Médicament reconnu', 'N° de lot et péremption lus', 'Plus de 20 000 médicaments connus'], img=['03_scanner'],
      s=["Le scanner lit le petit code carré imprimé sur les boîtes.", "En une seconde, il reconnaît le médicament, le numéro de lot et la date de péremption.", "Plus de vingt mille médicaments sont déjà connus : il suffit de saisir le nombre de boîtes."],
      sub=["Le scanner lit le petit code carré imprimé sur les boîtes.", "En une seconde, il reconnaît le médicament, le numéro de lot et la date de péremption.", "Plus de 20 000 médicaments sont déjà connus : il suffit de saisir le nombre de boîtes."]),
 dict(id='caisse', k='03 · Caisse', t='Vendre vite, sans erreur', b=['Les lots qui périment en premier sortent en premier', 'Lots périmés bloqués', 'Espèces, Wave, Orange Money, tiers payant'], img=['04_caisse'],
      s=["À la caisse, on cherche ou on scanne les produits.", "Ouergui ès ène fait sortir en premier les lots qui périment le plus tôt, et bloque automatiquement les lots périmés.", "Le paiement se fait en espèces, par Wave, Orange Money, ou au tiers payant pour les I P M, les mutuelles et la C M U."],
      sub=["À la caisse, on cherche ou on scanne les produits.", "Wergui SN fait sortir en premier les lots qui périment le plus tôt, et bloque automatiquement les lots périmés.", "Le paiement se fait en espèces, par Wave, Orange Money, ou au tiers payant pour les IPM, les mutuelles et la CMU."]),
 dict(id='ticket', k='04 · Ticket', t='Imprimé ou envoyé sur WhatsApp', b=['Imprimante thermique 58 ou 80 mm', 'Ticket PDF par WhatsApp', 'Réimpression à tout moment'], img=['05_ticket'],
      s=["Après la vente, le ticket s'imprime sur une petite imprimante thermique, ou s'envoie au client sur WhatsApp, en PDF."]),
 dict(id='peremptions', k='05 · Péremptions', t='Plus aucune boîte oubliée', b=['Périmés, moins de 30 jours, moins de 3 mois', 'Vendre en priorité', 'Rendre au grossiste à temps'], img=['06_peremptions'],
      s=["L'écran Péremptions classe tous les lots : déjà périmés, moins de trente jours, moins de trois mois.", "Pour chaque lot, Ouergui ès ène propose de le vendre en priorité, ou de le rendre au grossiste à temps, avant qu'il ne soit perdu."],
      sub=["L'écran Péremptions classe tous les lots : déjà périmés, moins de 30 jours, moins de 3 mois.", "Pour chaque lot, Wergui SN propose de le vendre en priorité, ou de le rendre au grossiste à temps, avant qu'il ne soit perdu."]),
 dict(id='commandes', k='06 · Commandes', t='Les commandes se calculent seules', b=['À partir des ventes réelles', 'Bon de commande par WhatsApp', 'Réception avec lots et dates'], img=['07_commandes'],
      s=["Les commandes sont calculées à partir des ventes réelles et du délai de chaque grossiste.", "Le bon de commande part en un clic par WhatsApp à Laborex, Cophase, Sodipharm ou Duopharm.", "À la livraison, on réceptionne avec les lots et les dates."]),
 dict(id='inventaire', k='07 · Inventaire', t='Inventaire sans fermer', b=['Rayon par rayon', 'Écarts corrigés et enregistrés'], img=['08_inventaire'],
      s=["L'inventaire se fait rayon par rayon, sans fermer la pharmacie. Les écarts sont corrigés et enregistrés."]),
 dict(id='finances', k='08 · Finances', t='La caisse sous contrôle', b=['Ouverture avec le fond de caisse', 'Clôture « à l’aveugle »', 'Écart visible par le titulaire'], img=['09_finances_caisse'],
      s=["Avec la formule Officine, le module Finances suit l'argent.", "La caisse s'ouvre le matin avec son fond, et se clôture le soir à l'aveugle : le vendeur compte sans voir le montant attendu, et le titulaire voit l'écart.", "Aucune vente n'est possible tant que la caisse n'est pas ouverte."]),
 dict(id='finances2', k='08 · Finances', t='Assurances, grossistes, résultat', b=['Bordereaux IPM, mutuelles, CMU', 'Factures et avoirs des grossistes', 'Résultat du mois, export comptable'], img=['10_finances_assurances', '11_finances_resultat'],
      s=["Les bordereaux d'assurance se préparent tout seuls, avec le suivi des paiements.", "Les factures des grossistes, les dépenses et le résultat du mois sont calculés automatiquement, avec un fichier Excel prêt pour le comptable."]),
 dict(id='equipe', k='09 · Équipe', t='Chacun ses droits', b=['Adjoint, vendeur, stagiaire', 'Prix d’achat, remises, commandes : au choix', 'Chaque vente au nom du vendeur'], img=['12_equipe'],
      s=["Chaque membre de l'équipe a son compte et ses droits : pharmacien adjoint, vendeur, stagiaire.", "Le titulaire décide qui voit les prix d'achat, qui accorde les remises, ou qui passe les commandes.", "Chaque vente est enregistrée au nom de la personne connectée."]),
 dict(id='poste', k='10 · Poste de la pharmacie', t='Son nom, son code, c’est parti', b=['Liste de l’équipe au comptoir', 'Code personnel à 4 chiffres', 'Pas besoin d’e-mail pour les vendeurs'], img=['16_poste_liste_c', '17_poste_pin_c'], layout='cartes',
      s=["Au comptoir, chacun se connecte en touchant son nom, puis en tapant son code personnel.", "Pas besoin d'e-mail pour les vendeurs."]),
 dict(id='horsligne', k='11 · Sans internet', t='La caisse ne s’arrête jamais', b=['Ventes gardées sur l’appareil', 'Envoi automatique au retour du réseau'], img=['15_hors_ligne'],
      s=["Coupure d'internet ? La caisse continue de vendre.", "Les ventes sont gardées sur l'appareil, puis envoyées automatiquement au retour du réseau."]),
 dict(id='import', k='12 · Démarrage rapide', t='Votre stock importé depuis Excel', b=['Produits, prix, codes', 'Lots et dates de péremption', 'En quelques minutes'], img=['14_import'],
      s=["Pour démarrer vite, le stock s'importe depuis un fichier Excel : produits, prix, lots et dates de péremption, en quelques minutes."]),
 dict(id='mobile', k='Partout', t='Téléphone, tablette, ordinateur', b=['En français', 'Rien à installer', 'Données sécurisées'], img=['18_mobile_accueil', '19_mobile_caisse'], layout='mobile',
      s=["Ouergui ès ène fonctionne sur téléphone, tablette et ordinateur, en français, sans rien installer."],
      sub=["Wergui SN fonctionne sur téléphone, tablette et ordinateur, en français, sans rien installer."]),
 dict(id='tarifs', k='Tarifs', t='Deux formules, un mois offert', b=['Petite officine : 15 000 F / mois', 'Officine : 25 000 F / mois', 'Paiement Wave ou Orange Money'], img=['13_abonnement'],
      s=["Deux formules : Petite officine, à quinze mille francs par mois, et Officine, à vingt-cinq mille francs par mois, avec un mois d'essai gratuit.", "Le paiement se fait par Wave ou Orange Money."],
      sub=["Deux formules : Petite officine, à 15 000 F par mois, et Officine, à 25 000 F par mois, avec un mois d'essai gratuit.", "Le paiement se fait par Wave ou Orange Money."]),
 dict(id='outro', layout='outro', s=["Ouergui ès ène, en partenariat avec Groupe Référence Afrique.", "Essayez gratuitement sur ouergui ès ène, point pages, point dev."],
      sub=["Wergui SN, en partenariat avec Groupe Référence Afrique.", "Essayez gratuitement sur werguisn.pages.dev"]),
]


if os.environ.get('COURT'):   # version courte (~1 min) : l'essentiel
    P = {x['id']: x for x in S}
    def sl(id, s, sub=None, **kw): d = dict(P[id]); d.update(kw); d['s'] = s; d['sub'] = sub or s; return d
    S = [
     sl('intro', ["Ouergui ès ène, avec Groupe Référence Afrique : la gestion de stock pensée pour les pharmacies du Sénégal."], ["Wergui SN, avec Groupe Référence Afrique : la gestion de stock pensée pour les pharmacies du Sénégal."]),
     sl('dashboard', ["Fini le cahier : chaque matin, le tableau de bord vous dit quoi faire."], k='Tableau de bord'),
     sl('scanner', ["Scannez une boîte : le médicament, le lot et la date de péremption se remplissent tout seuls."], k='Scanner'),
     sl('caisse', ["À la caisse, les lots qui périment en premier sortent en premier. Vous encaissez en espèces, par Wave ou Orange Money."], k='Caisse'),
     sl('peremptions', ["Ouergui ès ène vous alerte trois mois avant la péremption, pour les vendre à temps, ou les retourner au grossiste."], ["Wergui SN vous alerte 3 mois avant la péremption, pour les vendre à temps, ou les retourner au grossiste."], k='Péremptions'),
     sl('commandes', ["Les commandes se calculent toutes seules, et partent par WhatsApp."], k='Commandes'),
     sl('finances2', ["La caisse, les assurances et le bénéfice du mois sont suivis automatiquement."], k='Finances', t='Votre argent sous contrôle', b=['Caisse ouverte et clôturée', 'Assurances et grossistes', 'Bénéfice du mois']),
     sl('mobile', ["Sur téléphone, tablette ou ordinateur, même sans internet."], b=['Téléphone, tablette, ordinateur', 'Même sans internet', 'En français']),
     sl('tarifs', ["À partir de quinze mille francs par mois, avec un mois d'essai gratuit."], ["À partir de 15 000 F par mois, avec un mois d'essai gratuit."]),
     sl('outro', ["Essayez gratuitement sur ouergui ès ène, point pages, point dev."], ["Essayez gratuitement sur werguisn.pages.dev"]),
    ]
    OUT = D + '/build_court/'; os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ voix (edge-tts, fr-CH-FabriceNeural, vitesse normale)
import asyncio, edge_tts
RATE = 24000; GAP, SLIDE_GAP = float(os.environ.get('PAUSE', 0.8)), float(os.environ.get('PAUSE_DIAPO', 1.1)); TAUX = os.environ.get('TAUX', '+0%')   # vitesse de la voix
def oral(t):  # texte lu par Fabrice (voix suisse) : noms propres écrits comme ils se prononcent
    return (t.replace('Ouergui ès ène', 'Ouergui S N').replace('ouergui ès ène', 'ouergui S N'))
VITE_MARQUE = 1.2   # « Wergui » prononcé 20 % plus vite (validé à l'écoute)
async def tts(texte, f):
    c = edge_tts.Communicate(texte, 'fr-CH-FabriceNeural', rate=TAUX, proxy=os.environ.get('HTTPS_PROXY'), boundary='WordBoundary'); mots = []
    with open(f, 'wb') as out:
        async for ch in c.stream():
            if ch['type'] == 'audio': out.write(ch['data'])
            elif ch['type'] == 'WordBoundary': mots.append((ch['offset'] / 1e7, ch['duration'] / 1e7, ch['text']))
    return mots
def phrase_pcm(texte):
    mp3, wav = OUT + 'tmp.mp3', OUT + 'tmp.wav'
    for essai in range(4):
        try: mots = asyncio.run(tts(oral(texte), mp3)); break
        except Exception as e: print('nouvel essai', e); import time; time.sleep(2 * (essai + 1))
    marque = [(a, d) for a, d, w in mots if w.lower().startswith('ouergui')]
    if marque:   # accélère seulement le mot « Wergui »
        parts, t, k = [], 0.0, 0
        for a, d in marque:
            parts.append(f"[0:a]atrim={t:.3f}:{a:.3f},asetpts=PTS-STARTPTS[p{k}]"); parts.append(f"[0:a]atrim={a:.3f}:{a + d:.3f},asetpts=PTS-STARTPTS,atempo={VITE_MARQUE}[p{k + 1}]"); k += 2; t = a + d
        parts.append(f"[0:a]atrim={t:.3f},asetpts=PTS-STARTPTS[p{k}]"); k += 1
        fc = ";".join(parts) + ";" + "".join(f"[p{i}]" for i in range(k)) + f"concat=n={k}:v=0:a=1,"
    else: fc = "[0:a]"
    fc += "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse[o]"
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', mp3, '-filter_complex', fc, '-map', '[o]', '-ac', '1', '-ar', str(RATE), wav], check=True)
    with wave.open(wav, 'rb') as wr: return wr.readframes(wr.getnframes())
def silence(sec): return b'\x00\x00' * int(RATE * sec)
timeline = []; t0 = 0.0
for i, sl in enumerate(S):
    subs = sl.get('sub', sl['s']); lead = 0.6 if i == 0 else SLIDE_GAP / 2; pcm = silence(lead); cur = lead; cues = []
    for j, phrase in enumerate(sl['s']):
        data = phrase_pcm(phrase); dur = len(data) / 2 / RATE
        cues.append((t0 + cur, t0 + cur + dur, subs[j])); pcm += data; cur += dur
        pause = GAP if j < len(sl['s']) - 1 else (SLIDE_GAP / 2 if i < len(S) - 1 else 1.2); pcm += silence(pause); cur += pause
    with wave.open(f'{OUT}a{i:02d}.wav', 'wb') as wf: wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE); wf.writeframes(pcm)
    timeline.append(dict(i=i, debut=t0, duree=cur, cues=cues)); t0 += cur
    print(f'{sl["id"]:12} {cur:5.1f} s', flush=True)
print(f'TOTAL {t0:.1f} s')

# ------------------------------------------------------------------ sous-titres (ASS)
def ts(x): h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60; return f'{h}:{m:02d}:{s:05.2f}'
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "",
       "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Sous,Inter,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H9A1D2B24,1,0,0,0,100,100,0,0,3,18,0,2,220,220,48,1", "",
       "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
for tl in timeline:
    for a, b, txt in tl['cues']: ass.append(f"Dialogue: 0,{ts(a)},{ts(b + 0.15)},Sous,,0,0,0,,{txt}")
open(OUT + 'sous-titres.ass', 'w').write("\n".join(ass) + "\n")
srt = []
for n, (a, b, txt) in enumerate([c for tl in timeline for c in tl['cues']], 1):
    f = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(round((x % 1) * 1000)) % 1000:03d}"
    srt.append(f"{n}\n{f(a)} --> {f(b + 0.15)}\n{txt}\n")
open(OUT + 'sous-titres.srt', 'w').write("\n".join(srt))

# ------------------------------------------------------------------ diapositives (HTML)
def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;')
LOGO = '<svg width="56" height="56" viewBox="0 0 30 30"><rect width="30" height="30" rx="8" fill="#0A6B4B"/><path d="M12 6h6v6h6v6h-6v6h-6v-6H6v-6h6z" fill="#fff"/></svg>'
CSS = """@font-face{font-family:I;src:local('Inter')}*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;font-family:Inter,'DejaVu Sans',sans-serif;overflow:hidden;position:relative;
background:radial-gradient(circle at 85% 10%,#E3F1EA 0,#F6F9F7 38%,#FFFFFF 70%)}
.top{position:absolute;top:40px;left:72px;right:72px;display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;gap:16px;align-items:center;font-weight:800;font-size:36px;color:#0A6B4B;letter-spacing:-.01em}
.partner{display:flex;align-items:center;gap:14px;font-size:17px;color:#5b6b64;font-weight:600}.partner .card{background:#fff;border-radius:14px;padding:6px 12px;box-shadow:0 6px 18px rgba(0,0,0,.08)}.partner img{height:58px;display:block}
.left{position:absolute;left:72px;top:200px;width:560px}.kicker{font-weight:800;font-size:22px;color:#C98A00;letter-spacing:.14em;text-transform:uppercase}
h1{font-weight:800;font-size:62px;line-height:1.06;color:#0d2b20;margin:16px 0 34px;letter-spacing:-.02em}
ul{list-style:none;padding:0;margin:0}li{font-size:29px;line-height:1.3;color:#24423a;margin:0 0 20px;padding-left:46px;position:relative;font-weight:500}
li:before{content:'';position:absolute;left:0;top:6px;width:28px;height:28px;border-radius:50%;background:#0A6B4B url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12l4 4 8-8' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") center/18px no-repeat}
.shot{position:absolute;right:72px;top:170px;width:1140px;border-radius:18px;box-shadow:0 30px 80px rgba(10,60,40,.20);overflow:hidden;border:1px solid #d3e0d9;background:#fff}
.shot .bar{height:34px;background:#EEF3F0;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #dbe5e0}.d{width:12px;height:12px;border-radius:50%;background:#e2a1a1}.d:nth-child(2){background:#e7cf8f}.d:nth-child(3){background:#9ed2b2}
.url{margin-left:14px;font-size:15px;color:#6a7a73;background:#fff;border-radius:8px;padding:3px 12px}.shot img{display:block;width:100%}
.duo .a{position:absolute;right:420px;top:175px;width:600px}.duo .b{position:absolute;right:72px;top:255px;width:560px}
.phone{position:absolute;top:150px;width:330px;border-radius:44px;background:#111;padding:12px;box-shadow:0 30px 70px rgba(0,0,0,.25)}.phone img{width:100%;display:block;border-radius:34px}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.big{display:flex;gap:26px;align-items:center;font-size:110px;font-weight:800;color:#0A6B4B;letter-spacing:-.03em}.big svg{width:130px;height:130px}
.tag{font-size:40px;color:#24423a;margin:22px 0 60px;font-weight:600}.avec{font-size:24px;color:#5b6b64;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:18px}
.gra{background:#fff;border-radius:22px;padding:18px 34px;box-shadow:0 14px 40px rgba(0,0,0,.10)}.gra img{height:190px;display:block}
.cta{margin-top:40px;font-size:44px;font-weight:800;color:#fff;background:#0A6B4B;border-radius:18px;padding:20px 44px}.contact{margin-top:22px;font-size:30px;color:#24423a;font-weight:600}
.carte{position:absolute;width:420px;border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(10,60,40,.22);border:1px solid #d3e0d9;background:#fff}.carte img{width:100%;display:block}
.band{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#0A6B4B,#C98A00)}"""
def page(body): return f"<!doctype html><html lang='fr'><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}<div class='band'></div></body></html>"
haut = f"<div class='top'><div class='brand'>{LOGO}Wergui SN</div><div class='partner'>En partenariat avec<div class='card'><img src='file://{GRA}'></div></div></div>"
for i, sl in enumerate(S):
    L = sl.get('layout', 'std')
    if L == 'intro':
        body = f"<div class='center'><div class='big'>{LOGO}Wergui SN</div><div class='tag'>La gestion de stock pensée pour les pharmacies du Sénégal</div><div class='avec'>En partenariat avec</div><div class='gra'><img src='file://{GRA}'></div></div>"
    elif L == 'outro':
        body = f"<div class='center'><div class='big'>{LOGO}Wergui SN</div><div class='avec' style='margin-top:30px'>En partenariat avec</div><div class='gra'><img src='file://{GRA}' style='height:150px'></div><div class='cta'>Essai gratuit : werguisn.pages.dev</div><div class='contact'>contact.werguisn@gmail.com</div></div>"
    else:
        gauche = f"<div class='left'><div class='kicker'>{esc(sl['k'])}</div><h1>{esc(sl['t'])}</h1><ul>{''.join(f'<li>{esc(x)}</li>' for x in sl['b'])}</ul></div>"
        cadre = lambda img, cls='': f"<div class='shot {cls}'><div class='bar'><span class='d'></span><span class='d'></span><span class='d'></span><span class='url'>werguisn.pages.dev/app</span></div><img src='file://{CAP}{img}.png'></div>"
        if L == 'duo': droite = f"<div class='duo'>{cadre(sl['img'][0], 'a')}{cadre(sl['img'][1], 'b')}</div>"
        elif L == 'cartes': droite = f"<div class='carte' style='right:560px;top:160px'><img src='file://{CAP}{sl['img'][0]}.png'></div><div class='carte' style='right:110px;top:200px'><img src='file://{CAP}{sl['img'][1]}.png'></div>"
        elif L == 'mobile': droite = f"<div class='phone' style='right:480px'><img src='file://{CAP}{sl['img'][0]}.png'></div><div class='phone' style='right:110px;top:190px'><img src='file://{CAP}{sl['img'][1]}.png'></div>"
        elif len(sl['img']) == 2: droite = f"<div class='duo'>{cadre(sl['img'][0], '').replace(chr(39) + 'shot ' + chr(39), chr(39) + 'shot' + chr(39))}</div>" if False else f"{cadre(sl['img'][0])}<div class='shot' style='right:40px;top:470px;width:700px;box-shadow:0 30px 80px rgba(10,60,40,.30)'><div class='bar'><span class='d'></span><span class='d'></span><span class='d'></span></div><img src='file://{CAP}{sl['img'][1]}.png'></div>"
        else: droite = cadre(sl['img'][0])
        body = haut + gauche + droite
    open(f'{OUT}s{i:02d}.html', 'w').write(page(body))
json.dump(timeline, open(OUT + 'timeline.json', 'w'))
print('ok')
