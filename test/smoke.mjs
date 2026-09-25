// Loads the extension into a throwaway Chrome profile and checks it against a live GoKwik store.
// Nothing is typed into any form and no order is placed.
//
//   npm run smoke                      # uses XtremeX
//   npm run smoke -- <product-url>     # any GoKwik store product page
//   CHROME_PATH=/path/to/chrome npm run smoke
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(here, '../extension');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PRODUCT_URL = process.argv[2] || 'https://xtremexmartialarts.com/products/metalx-unisex-joggers';
const SITE = new URL(PRODUCT_URL).hostname.replace(/^www\./, '');
const GOKWIK = /gokwik\.(co|io)\//;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In real use the popup reads the current tab because you clicked the toolbar icon.
// A test can't click the toolbar, so it runs a copy with those permissions granted up front.
function testCopyOfExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lma-ext-'));
  fs.cpSync(EXTENSION_DIR, dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.permissions.push('tabs', 'declarativeNetRequestFeedback');
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function watchGoKwik(page) {
  const log = { blocked: [], loaded: [] };
  page.on('requestfailed', (request) => {
    if (GOKWIK.test(request.url()) && request.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') log.blocked.push(request.url());
  });
  page.on('requestfinished', (request) => {
    if (GOKWIK.test(request.url())) log.loaded.push(request.url());
  });
  log.reset = () => { log.blocked.length = 0; log.loaded.length = 0; };
  return log;
}

async function gokwikCookies(page) {
  const session = await page.createCDPSession();
  const { cookies } = await session.send('Storage.getCookies');
  await session.detach();
  return cookies.filter((cookie) => /gokwik/.test(cookie.domain));
}

async function openStore(page, log) {
  log.reset();
  await page.goto(PRODUCT_URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await sleep(8000);
}

async function popupView(popup, tab) {
  await tab.bringToFront();
  await popup.reload({ waitUntil: 'load' });
  await sleep(2500);
  return popup.evaluate(() => ({
    state: document.getElementById('status').dataset.state,
    site: document.getElementById('site').textContent,
    blocked: Object.fromEntries([...document.querySelectorAll('#blocked li')].map((li) => [
      li.querySelector('.label').textContent,
      Number(li.querySelector('.count').textContent),
    ])),
  }));
}

// Runs one of lib.js's exported actions inside an extension page, the same code the popup uses.
async function runAction(extensionPage, name, ...args) {
  return extensionPage.evaluate(async (exportName, exportArgs) => {
    const lib = await import('./lib.js');
    return lib[exportName](...exportArgs);
  }, name, args);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lma-profile-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: profile,
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const extensionId = await browser.installExtension(testCopyOfExtension());
  console.log(`Extension ${extensionId} installed. Store: ${PRODUCT_URL}\n`);

  const store = await browser.newPage();
  await store.setViewport({ width: 1366, height: 900 });
  const log = watchGoKwik(store);

  // 1. Protection on a GoKwik store
  await openStore(store, log);
  check('GoKwik checkout code still loads', log.loaded.some((u) => /merchant\.integration|build\/gokwik\.js|kwik-cart/.test(u)));
  check('Cross-store identity frame is blocked',
    log.blocked.some((u) => u.includes('/kwikpass/')) && !log.loaded.some((u) => u.includes('/kwikpass/kwikpass.html')),
    `${log.blocked.filter((u) => u.includes('/kwikpass/')).length} KwikPass requests blocked`);
  check('Browsing analytics never reach GoKwik', !log.loaded.some((u) => /gkx\.gokwik\.co\/gke\/|sdk\.gokwik\.co|prd-gfp\.gokwik\.co|\/kp\/api\/v1\/fp\//.test(u)));
  const cookies = await gokwikCookies(store);
  check('No GoKwik visitor ID cookie is created', !cookies.some((c) => c.name === 'kp_user_id'),
    cookies.length ? cookies.map((c) => c.name).join(', ') : 'no GoKwik cookies at all');

  // 2. The popup flags the store
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
  const view = await popupView(popup, store);
  check('Popup flags the store as GoKwik and protected', view.state === 'protected' && view.site === SITE, JSON.stringify(view));

  // 3. Checkout still works: GoKwik's checkout window opens and asks for a phone number
  await store.bringToFront();
  await store.evaluate(async () => {
    const product = await (await fetch(`${location.pathname}.js`)).json();
    const variant = product.variants.find((v) => v.available) || product.variants[0];
    await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: variant.id, quantity: 1 }) });
  });
  const trigger = await store.evaluate(() => {
    if (typeof window.triggerGokwikCustomCheckout !== 'function') return 'no checkout trigger on this store';
    window.triggerGokwikCustomCheckout();
    return 'opened';
  });
  let checkoutFrame = null;
  for (let i = 0; i < 30 && !checkoutFrame; i += 1) {
    await sleep(1000);
    checkoutFrame = store.frames().find((frame) => frame.url().startsWith('https://pdp.gokwik.co/index.html'));
  }
  let phoneField = false;
  for (let i = 0; checkoutFrame && i < 20 && !phoneField; i += 1) {
    await sleep(1000);
    phoneField = await checkoutFrame.evaluate(() => Boolean(document.querySelector('input[type=tel], input[inputmode=numeric]'))).catch(() => false);
  }
  check('GoKwik checkout opens and asks for a phone number', Boolean(checkoutFrame) && phoneField, trigger);

  // 4. Pause and resume on this site
  await runAction(popup, 'pauseSite', SITE);
  await store.bringToFront();
  await openStore(store, log);
  const pausedCookies = await gokwikCookies(store);
  check('Pausing lets GoKwik identity load on this site', log.loaded.some((u) => u.includes('/kwikpass/kwikpass.html')),
    pausedCookies.map((c) => c.name).join(', '));
  await runAction(popup, 'resumeSite', SITE);
  await openStore(store, log);
  check('Resuming blocks it again', log.blocked.some((u) => u.includes('/kwikpass/')) && !log.loaded.some((u) => u.includes('/kwikpass/kwikpass.html')));

  // 5. Forget clears what GoKwik stored while paused
  const before = (await gokwikCookies(store)).length;
  await runAction(popup, 'forgetGoKwik');
  const after = (await gokwikCookies(store)).length;
  check('"Forget my GoKwik data" clears GoKwik cookies', before > 0 && after === 0, `${before} → ${after} cookies`);

  // 6. Forget also removes GoKwik's copies saved on the store's own site, and keeps everything else.
  //    Plants fake GoKwik items (the phone number is a made-up 0000000000) next to one that must survive.
  await store.bringToFront();
  await store.evaluate(async () => {
    localStorage.setItem('kp_user_id', 'test-visitor');
    localStorage.setItem('notifyph', btoa('+91|0000000000'));
    localStorage.setItem('ELRTOKEN', 'test-token');
    localStorage.setItem('lma-test-keep', 'keep me');
    document.cookie = 'KC_PHONE=0000000000; path=/; Secure';
    await new Promise((resolve) => {
      const open = indexedDB.open('KP_DB', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kp_storage');
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => resolve();
    });
  });
  const storeTabId = await popup.evaluate(async (site) => (await chrome.tabs.query({})).find((t) => t.url?.includes(site))?.id, SITE);
  const removedFromStore = await runAction(popup, 'forgetGoKwikOnPage', storeTabId);
  const leftover = await store.evaluate(async () => ({
    gokwikKeys: Object.keys(localStorage).filter((key) => /^(kp_user_id|notifyph|ELRTOKEN)$/.test(key)),
    phoneCookie: document.cookie.includes('KC_PHONE='),
    backupDatabase: (await indexedDB.databases()).some((db) => db.name === 'KP_DB'),
    keptItem: localStorage.getItem('lma-test-keep'),
    cartCookie: document.cookie.split(';').some((c) => c.trim().startsWith('cart=')),
  }));
  check('Forget removes GoKwik items saved on the store',
    removedFromStore >= 5 && leftover.gokwikKeys.length === 0 && !leftover.phoneCookie && !leftover.backupDatabase,
    `${removedFromStore} removed`);
  check('Forget keeps the cart and the store’s other data', leftover.keptItem === 'keep me' && leftover.cartCookie);

  // 7. A site without GoKwik is left alone
  const other = await browser.newPage();
  await other.goto('https://example.com/', { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  const otherView = await popupView(popup, other);
  check('Popup shows nothing to block on a site without GoKwik', otherView.state === 'none', JSON.stringify(otherView));
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
