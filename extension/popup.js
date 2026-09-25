import {
  CATEGORIES,
  RULESET_ID,
  categoryOfRule,
  forgetGoKwik,
  forgetGoKwikOnPage,
  isPaused,
  pauseSite,
  resumeSite,
  siteOf,
} from './lib.js';

const $ = (id) => document.getElementById(id);

// Headline and supporting line for each state of the current page.
const STATES = {
  loading: ['Checking this page…', ''],
  unsupported: ['Open a store to check it.', 'This kind of page can’t be checked.'],
  none: ['No GoKwik on this page.', 'Nothing to stop here.'],
  quiet: ['GoKwik’s tracking is blocked here.', ''],
  protected: ['GoKwik’s tracking is blocked here.', ''],
  paused: ['GoKwik’s tracking is allowed here.', 'Paused so you can log in with your phone number. Resume when you’re done.'],
};

function setState(state, text) {
  const [title, defaultText] = STATES[state];
  $('status').dataset.state = state;
  $('status-title').textContent = title;
  $('status-text').textContent = text ?? defaultText;
  if (state !== 'loading' && !('ready' in document.body.dataset)) {
    requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = ''; }));
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Reads when the page loaded and whether it includes GoKwik. Works through the activeTab grant.
async function pageFacts(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        loadedAt: performance.timeOrigin,
        hasGoKwik:
          Boolean(document.querySelector('script[src*="gokwik.co"], iframe[src*="gokwik.co"], link[href*="gokwik.co"]')) ||
          [...document.scripts].some((script) => script.textContent.includes('gokwik')),
      }),
    });
    return result;
  } catch {
    return null;
  }
}

async function blockedOnPage(tabId, loadedAt) {
  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((key) => [key, 0]));
  let seen = false;
  try {
    const filter = { tabId };
    if (loadedAt) filter.minTimeStamp = Math.floor(loadedAt);
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules(filter);
    for (const { rule } of rulesMatchedInfo) {
      if (rule.rulesetId !== RULESET_ID) continue;
      seen = true;
      const key = categoryOfRule(rule.ruleId);
      if (key) counts[key] += 1;
    }
  } catch {
    // Not available for this tab.
  }
  return { counts, seen };
}

function renderReport(counts) {
  $('blocked').replaceChildren(
    ...Object.entries(CATEGORIES).map(([key, category]) => {
      const item = document.createElement('li');
      item.title = category.detail;
      if (counts[key]) item.className = 'hit';
      const label = Object.assign(document.createElement('span'), { className: 'label', textContent: category.label });
      const leader = Object.assign(document.createElement('span'), { className: 'leader' });
      leader.setAttribute('aria-hidden', 'true');
      const count = Object.assign(document.createElement('span'), { className: 'count', textContent: String(counts[key]) });
      item.append(label, leader, count);
      return item;
    }),
  );
  $('report').hidden = false;
}

// Pause lives in the report; resume and reload sit under the status when they apply.
function showSiteActions({ resume = false, reload = false }) {
  $('site-actions').hidden = !(resume || reload);
  $('resume').hidden = !resume;
  $('reload').hidden = !reload;
}

function wireSiteActions(tab, site) {
  $('pause').addEventListener('click', async () => {
    await pauseSite(site);
    setState('paused', 'Reload the page to let GoKwik load here.');
    $('report').hidden = true;
    showSiteActions({ resume: true, reload: true });
  });
  $('resume').addEventListener('click', async () => {
    await resumeSite(site);
    setState('protected', 'Protection is back on. Reload the page to apply it.');
    $('report').hidden = true;
    showSiteActions({ reload: true });
  });
  $('reload').addEventListener('click', async () => {
    await chrome.tabs.reload(tab.id);
    window.close();
  });
}

// Clears GoKwik's own data, and on a store also the GoKwik items that store saved.
async function forget(button, storeTab) {
  button.disabled = true;
  try {
    await forgetGoKwik();
    const fromStore = storeTab ? await forgetGoKwikOnPage(storeTab.id).catch(() => 0) : 0;
    $('forget-result').textContent = fromStore > 0
      ? `Cleared, including ${fromStore} GoKwik ${fromStore === 1 ? 'item' : 'items'} this store had saved. Reload the page.`
      : 'Cleared. You’ll type your number again at your next GoKwik checkout.';
  } catch (error) {
    $('forget-result').textContent = `Couldn’t clear GoKwik data: ${error.message}`;
  }
  $('forget-result').hidden = false;
  button.disabled = false;
}

async function wireDataControls(storeTab) {
  const { forgetOnStartup = true, showWelcome = false } = await chrome.storage.local.get(['forgetOnStartup', 'showWelcome']);

  const toggle = $('forget-on-startup');
  toggle.checked = forgetOnStartup;
  toggle.addEventListener('change', () => chrome.storage.local.set({ forgetOnStartup: toggle.checked }));

  $('forget').addEventListener('click', (event) => forget(event.currentTarget, storeTab));

  // The first-run note has its own forget button, so the regular one waits until it's dismissed.
  if (showWelcome) {
    $('welcome').hidden = false;
    $('forget').hidden = true;
    const dismiss = () => {
      $('welcome').hidden = true;
      $('forget').hidden = false;
      chrome.storage.local.set({ showWelcome: false });
    };
    $('welcome-forget').addEventListener('click', async (event) => {
      await forget(event.currentTarget, storeTab);
      dismiss();
    });
    $('welcome-dismiss').addEventListener('click', dismiss);
  }

  $('cookie-settings').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/cookies' }));
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
}

async function main() {
  const tab = await activeTab();
  let url = null;
  try {
    url = tab?.url ? new URL(tab.url) : null;
  } catch {
    url = null;
  }
  const onWebPage = Boolean(url && /^https?:$/.test(url.protocol));
  await wireDataControls(onWebPage ? tab : null);

  if (!onWebPage) {
    setState('unsupported');
    return;
  }

  const site = siteOf(url.hostname);
  $('site').textContent = site;
  wireSiteActions(tab, site);

  if (await isPaused(site)) {
    setState('paused');
    showSiteActions({ resume: true });
    return;
  }

  const facts = await pageFacts(tab.id);
  const { counts, seen } = await blockedOnPage(tab.id, facts?.loadedAt);
  const blocked = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (blocked > 0) {
    setState('protected');
  } else if (seen || facts?.hasGoKwik) {
    setState('quiet');
  } else {
    setState('none');
    return;
  }
  renderReport(counts);
}

main();
