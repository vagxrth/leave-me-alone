// What the extension knows about GoKwik, and the actions shared by the popup and background.

export const RULESET_ID = 'gokwik';

// Each static rule in rules/gokwik.json belongs to one of these. Keep the two in sync.
export const CATEGORIES = {
  identity: {
    label: 'Recognising you from other stores',
    detail: 'KwikPass and KwikCart frames that pass your number between stores',
    rules: [1, 2],
  },
  fingerprint: {
    label: 'Fingerprinting your device',
    detail: 'Recognises your device even after you clear cookies',
    rules: [3, 4],
  },
  analytics: {
    label: 'Reporting what you view',
    detail: 'Sends the products you look at to GoKwik for follow-up messages',
    rules: [5, 6],
  },
};

// Low-priority allow rule that only records that GoKwik is on the page.
export const PRESENCE_RULE_ID = 100;

export function categoryOfRule(ruleId) {
  for (const [key, category] of Object.entries(CATEGORIES)) {
    if (category.rules.includes(ruleId)) return key;
  }
  return null;
}

// Cookies are cleared for the whole gokwik.co domain; storage is cleared per origin.
const GOKWIK_ORIGINS = [
  'https://gokwik.co',
  'https://www.gokwik.co',
  'https://pdp.gokwik.co',
  'https://gkx.gokwik.co',
  'https://api.gokwik.co',
  'https://sdk.gokwik.co',
  'https://cdn.gokwik.co',
  'https://hits.gokwik.co',
  'https://kwikcart.gokwik.co',
  'https://prd-gfp.gokwik.co',
];

export async function forgetGoKwik() {
  await chrome.browsingData.remove(
    { origins: GOKWIK_ORIGINS },
    { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true },
  );
}

// GoKwik also saves copies on each store's own site: a visitor ID, phone numbers it picked up,
// and login tokens that its cart and checkout read. This runs in the store's tab and removes only
// those items, matched by the names GoKwik's code uses, so the cart and the store's own login stay.
function removeGoKwikItemsFromPage() {
  const GOKWIK_KEY = new RegExp([
    'kwik',
    '^(kp|gk)[_-]',
    '^ELRTOKEN$',
    '^snowplowOutQueue_',
    '^_sp_(id|ses)\\.',
    '^_ka_c',
    'go_sid$',
    '^(notifyph|notify_phone_number|KC_PHONE|rp-phone-number|unverified_phone_number|non_authed_info' +
      '|idb_ph_no|expired_ph_no|app_unauth_user|no_otp_flow_phone_number|unkwn|kpToken' +
      '|kpExistingPhoneNumber|kpUnauthPhoneNumber|IS_SSO_LOGIN|dpdp_ssoed|acs_tkn|sc_tkn|cap_tkn' +
      '|whatsapp_token|SP_DUID|usr_trck|FP_CONTROLS_DATA|USER_VISITED_PAGES|LOGIN_MODAL_ASSETS' +
      '|shopify_api_tags|shopify_api_tags_login_modal)$',
  ].join('|'), 'i');
  let removed = 0;

  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (GOKWIK_KEY.test(key)) {
        storage.removeItem(key);
        removed += 1;
      }
    }
  }

  const cookieNames = () => document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean);
  const labels = location.hostname.split('.');
  const domains = ['', location.hostname];
  for (let i = 0; i < labels.length - 1; i += 1) domains.push(`.${labels.slice(i).join('.')}`);
  const matching = cookieNames().filter((name) => GOKWIK_KEY.test(name));
  for (const name of matching) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; Secure${domain ? `; domain=${domain}` : ''}`;
    }
  }
  const left = new Set(cookieNames());
  removed += matching.filter((name) => !left.has(name)).length;

  // KwikPass keeps a backup of its login token in this database.
  const listDatabases = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
  return listDatabases.then((databases) => {
    if (!databases.some((db) => db.name === 'KP_DB')) return removed;
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('KP_DB');
      const deleted = () => resolve(removed + 1);
      request.onsuccess = deleted;
      request.onblocked = deleted; // Finishes once the page closes its connection.
      request.onerror = () => resolve(removed);
      setTimeout(deleted, 1500);
    });
  });
}

export async function forgetGoKwikOnPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: removeGoKwikItemsFromPage });
  return result ?? 0;
}

// Pausing a site adds a dynamic rule that allows everything inside pages from that site.
const PAUSE_PRIORITY = 100;
const FIRST_PAUSE_RULE_ID = 1000;

export function siteOf(hostname) {
  return hostname.replace(/^www\./, '');
}

async function pauseRuleFor(site) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.find((rule) => rule.condition.requestDomains?.includes(site)) || null;
}

export async function isPaused(site) {
  return (await pauseRuleFor(site)) !== null;
}

export async function pauseSite(site) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  if (rules.some((rule) => rule.condition.requestDomains?.includes(site))) return;
  const id = Math.max(FIRST_PAUSE_RULE_ID - 1, ...rules.map((rule) => rule.id)) + 1;
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id,
      priority: PAUSE_PRIORITY,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: [site], resourceTypes: ['main_frame'] },
    }],
  });
}

export async function resumeSite(site) {
  const rule = await pauseRuleFor(site);
  if (rule) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [rule.id] });
}
