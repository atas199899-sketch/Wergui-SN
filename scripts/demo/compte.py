import json, subprocess, re, secrets, sys
REF = "bjkyezwiddvotikldbag"; SB = f"https://{REF}.supabase.co"
PUB = re.search(r'supabaseAnonKey:\s*"([^"]+)"', open('/home/user/wergui-sn/app/config.js').read()).group(1)
def curl(method, url, body=None, headers={}):
    cmd = ["curl", "-sS", "-X", method, url, "-H", "Content-Type: application/json"]
    for k, v in headers.items(): cmd += ["-H", f"{k}: {v}"]
    if body is not None: cmd += ["--data", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try: return json.loads(out)
    except Exception: return out
keys = curl("GET", f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true")
SR = next(k["api_key"] for k in keys if k.get("name") == "service_role"); A = {"apikey": SR, "Authorization": "Bearer " + SR}
email = "contact.werguisn+demo@gmail.com"
pw = "Demo-Wergui-" + str(secrets.randbelow(9000) + 1000)   # mot de passe tiré au hasard, gardé seulement dans compte.json (non publié)
u = curl("POST", f"{SB}/auth/v1/admin/users", {"email": email, "password": pw, "email_confirm": True, "user_metadata": {"nom": "Dr Aminata Diallo", "demo": True}}, A)
if "id" not in u: sys.exit("création du titulaire : " + str(u))
tok = curl("POST", f"{SB}/auth/v1/token?grant_type=password", {"email": email, "password": pw}, {"apikey": PUB})["access_token"]
T = {"apikey": PUB, "Authorization": "Bearer " + tok}
ph = curl("POST", f"{SB}/rest/v1/rpc/creer_pharmacie", {"p_nom": "Pharmacie Démo Wergui SN", "p_ville": "Dakar", "p_telephone": "33 800 00 00", "p_nom_titulaire": "Dr Aminata Diallo"}, T)
print("pharmacie", ph)
r = curl("POST", f"{SB}/rest/v1/rpc/definir_pin", {"p_pin": "2580"}, T); print("PIN titulaire", r)
equipe = [("Moussa Diop", "vendeur", "2468"), ("Fatou Sarr", "vendeur", "1357"), ("Dr Awa Ndiaye", "adjoint", "8642")]
membres = {}
for nom, role, pin in equipe:
    r = curl("POST", f"{SB}/functions/v1/pin", {"action": "creer_membre", "pharmacy_id": ph, "nom": nom, "role": role, "pin": pin}, T)
    print(nom, r); membres[nom] = r.get("user_id")
json.dump({"pharmacy_id": ph, "titulaire": u["id"], "email": email, "mot_de_passe": pw, "membres": membres}, open("compte.json", "w"), ensure_ascii=False)
print("ok")
