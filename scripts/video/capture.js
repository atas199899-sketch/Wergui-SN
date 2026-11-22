const { chromium } = require('playwright'); const fs = require('fs');
const C = JSON.parse(fs.readFileSync('../demo/compte.json')), OUT = '../video/cap/', SITE = 'https://werguisn.pages.dev';
(async () => { const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('wergui.imprimante', JSON.stringify({ quand: 'demander', largeur: 58, methode: 'navigateur' })); } catch (e) {} });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  const shot = async (n, w = 1500) => { await p.waitForTimeout(w); await p.screenshot({ path: OUT + n + '.png' }); console.log('📸', n); };
  await p.goto(SITE + '/'); await shot('01_accueil_site', 2500);
  await p.goto(SITE + '/app/'); await p.waitForSelector('[data-form=login]', { timeout: 30000 });
  await p.fill('#ae', C.email); await p.fill('#ap', C.mot_de_passe); await p.click('[data-form=login] button'); await p.waitForSelector('#nav', { timeout: 30000 });
  await shot('02_tableau_de_bord', 3000);
  await p.evaluate(() => window.scrollTo(0, 650)); await shot('02b_tableau_ventes', 800); await p.evaluate(() => window.scrollTo(0, 0));
  // scanner : lecture simulée d'un DataMatrix de boîte (code, lot, péremption)
  await p.evaluate(() => { go('scanner'); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { stopCam(); const r = document.getElementById('reader'); if (r) r.innerHTML = '<div class="ph">Caméra : visez le code de la boîte</div>'; onCode('010340093595583817280331104LW8A', 'data_matrix'); stopCam(); });
  await shot('03_scanner', 1500);
  // caisse : ticket en cours
  await p.evaluate(() => go('caisse')); await p.waitForTimeout(800);
  for (const q of ['doli', 'smecta', 'coartem']) { await p.fill('#cq', q); await p.waitForTimeout(400); await p.click('#res [data-add]'); }
  await p.click('[data-pay="Wave"]'); await shot('04_caisse', 1000);
  await p.click('[data-act=encaisser]'); await p.waitForSelector('.ticketvue', { timeout: 20000 }); await shot('05_ticket', 1200);
  await p.keyboard.press('Escape');
  await p.evaluate(() => { S.perTab = '30'; go('peremption'); }); await shot('06_peremptions', 1200);
  await p.evaluate(() => go('commandes')); await shot('07_commandes', 1500);
  await p.evaluate(() => go('inventaire')); await shot('08_inventaire', 1200);
  await p.evaluate(() => { S.finTab = 'caisse'; go('finances'); }); await shot('09_finances_caisse', 4500);
  await p.evaluate(() => { S.finTab = 'assur'; render(true); }); await shot('10_finances_assurances', 1200);
  await p.evaluate(() => { S.finTab = 'res'; render(true); }); await shot('11_finances_resultat', 1200);
  await p.evaluate(() => { S.setTab = 'equipe'; go('parametres'); }); await shot('12_equipe', 2500);
  await p.evaluate(() => go('abonnement')); await shot('13_abonnement', 3000);
  // import Excel
  await p.evaluate(() => go('stock')); await p.waitForTimeout(800); await p.click('[data-act=import]'); await p.setInputFiles('#impfile', '../imp/stock.xlsx'); await p.waitForSelector('[data-impmap]'); await shot('14_import', 800);
  await p.keyboard.press('Escape');
  // hors ligne (bandeau)
  await p.evaluate(() => { S.offline = true; S.snapAt = Date.now() - 3600e3; S.pending = 3; go('caisse'); }); await shot('15_hors_ligne', 800);
  await p.evaluate(() => { S.offline = false; S.pending = 0; });
  // poste de la pharmacie : choix du nom puis code PIN (affichage)
  await p.evaluate(() => { localStorage.setItem('wergui.poste', JSON.stringify({ jeton: 'x', pid: S.pid, nom: 'Comptoir' })); S.posteInfo = { ok: true, pharmacie: D.ph.nom, poste: 'Comptoir', membres: D.membres.map(m => ({ user_id: m.user_id, nom: m.nom, role: m.role, pin: true })) }; D = null; ecranVerrou(); });
  await shot('16_poste_liste', 1000);
  await p.evaluate(() => { S.pinFor = S.posteInfo.membres.find(m => m.role === 'vendeur').user_id; S.pin = '24'; ecranVerrou(); }); await shot('17_poste_pin', 800);
  await p.evaluate(() => localStorage.removeItem('wergui.poste'));
  // téléphone
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); await m.addInitScript(() => { try { localStorage.setItem('wergui.imprimante', JSON.stringify({ quand: 'jamais' })); } catch (e) {} });
  const t = await m.newPage(); await t.goto(SITE + '/app/'); await t.waitForSelector('[data-form=login]'); await t.fill('#ae', C.email); await t.fill('#ap', C.mot_de_passe); await t.click('[data-form=login] button'); await t.waitForSelector('#nav', { state: 'attached', timeout: 30000 });
  await t.waitForTimeout(2500); await t.screenshot({ path: OUT + '18_mobile_accueil.png' }); await t.evaluate(() => go('caisse')); await t.waitForTimeout(1200); await t.screenshot({ path: OUT + '19_mobile_caisse.png' }); console.log('📸 mobile');
  console.log('ERREURS :', errs); await b.close(); })().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
