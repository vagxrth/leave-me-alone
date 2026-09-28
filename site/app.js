// Leave Me Alone site: device tabs, the browser check, copy and share.
// Everything here runs in the visitor's browser. Nothing is sent anywhere.

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const phoneTab = isIOS ? 'iphone' : 'android';
const deviceTab = isIOS ? 'iphone' : /Android/.test(ua) ? 'android' : 'computer';
const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href.split('#')[0];

/* Device tabs */

const tablist = document.querySelector('[role="tablist"]');
const tabs = tablist ? [...tablist.querySelectorAll('[role="tab"]')] : [];
const panelOf = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

function selectTab(id, focus = false) {
  const chosen = tabs.find((tab) => tab.getAttribute('aria-controls') === id);
  if (!chosen) return false;
  for (const tab of tabs) {
    const on = tab === chosen;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    panelOf(tab).hidden = !on;
  }
  if (focus) chosen.focus();
  return true;
}

function showFix(id) {
  if (!selectTab(id)) return false;
  document.getElementById('fix').scrollIntoView();
  return true;
}

if (tabs.length) {
  tablist.hidden = false;
  document.querySelector('.panels')?.classList.remove('no-js-panels');
  if (!showFix(location.hash.slice(1))) selectTab(deviceTab);

  for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab.getAttribute('aria-controls')));

  tablist.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (index < 0 || next === undefined) return;
    event.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length].getAttribute('aria-controls'), true);
  });

  // Links to #android, #iphone or #computer open that tab. "Fix it on your phone" opens the visitor's phone tab.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.hasAttribute('data-phone-tab') ? phoneTab : link.getAttribute('href').slice(1);
    if (!tabs.some((tab) => tab.getAttribute('aria-controls') === id)) return;
    event.preventDefault();
    history.pushState(null, '', `#${id}`);
    showFix(id);
  });

  addEventListener('hashchange', () => showFix(location.hash.slice(1)));
}

/* The browser check
   A page on a different site, loaded in a hidden frame, asks the browser whether it can use cookies it
   shares with other sites. That's what GoKwik's frame relies on. The frame never contacts GoKwik or
   any store, and the answer stays on this page. */

// What to do about shared cookies, in the words of each device's steps.
const FIX_FOR = {
  android: 'Do step 1, then check again.',
  iphone: 'Turn on Prevent Cross-Site Tracking in Settings › Apps › Safari, then check again.',
  computer: 'Do step 2, then check again.',
};

const RESULTS = {
  checking: () => ['Checking…'],
  exposed: (panel) => ['Your browser shares cookies between sites.', `GoKwik’s ID can follow you from store to store. ${FIX_FOR[panel] || 'Block third-party cookies, then check again.'}`],
  protected: () => ['Your browser keeps each site’s cookies separate.', 'GoKwik’s cookie ID can’t follow you between stores.'],
  unknown: () => ['We couldn’t check this browser.', 'Follow the steps above anyway.'],
};

// Close enough to a registrable domain for the hosts this site uses.
function siteOf(host) {
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  const shared = /\.(github\.io|pages\.dev|netlify\.app|vercel\.app|co\.in|org\.in|net\.in|co\.uk)$/.test(host);
  return labels.slice(shared ? -3 : -2).join('.');
}

function checkFrameUrl() {
  // Local preview: this page on localhost:8080, the frame on 127.0.0.1:8081, a different site.
  const raw = location.hostname === 'localhost'
    ? 'http://127.0.0.1:8081/frame.html'
    : document.querySelector('meta[name="lma-check-frame"]')?.content;
  if (!raw) return null;
  try {
    const url = new URL(raw, location.href);
    return siteOf(url.hostname) === siteOf(location.hostname) ? null : url;
  } catch {
    return null;
  }
}

function showResult(state) {
  for (const box of document.querySelectorAll('.check-result')) {
    const [title, detail] = RESULTS[state](box.closest('.panel')?.id);
    const heading = document.createElement('strong');
    heading.textContent = title;
    box.replaceChildren(heading);
    if (detail) {
      const text = document.createElement('span');
      text.textContent = detail;
      box.append(text);
    }
    box.dataset.state = state;
    box.hidden = false;
  }
  for (const button of document.querySelectorAll('.check-button')) {
    button.disabled = state === 'checking';
    button.textContent = state === 'checking' ? 'Checking…' : 'Check again';
  }
}

const frameUrl = checkFrameUrl();
let checking = false;

function runCheck() {
  if (checking) return;
  checking = true;
  showResult('checking');
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Browser check';
  frame.src = frameUrl.href;
  let timer = 0;
  const finish = (state) => {
    clearTimeout(timer);
    removeEventListener('message', onMessage);
    frame.remove();
    checking = false;
    showResult(state);
  };
  function onMessage(event) {
    if (event.origin !== frameUrl.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type !== 'lma-check') return;
    const access = event.data.access;
    finish(access === 'shared' ? 'exposed' : access === 'separate' ? 'protected' : 'unknown');
  }
  addEventListener('message', onMessage);
  timer = setTimeout(() => finish('unknown'), 5000);
  document.body.append(frame);
}

if (frameUrl) {
  for (const step of document.querySelectorAll('.check-step')) step.hidden = false;
  for (const button of document.querySelectorAll('.check-button')) button.addEventListener('click', runCheck);
}

/* Copy and share */

function say(button, message) {
  const status = button.parentElement.querySelector('.copied');
  if (!status) return;
  status.textContent = message;
  clearTimeout(status.timer);
  status.timer = setTimeout(() => { status.textContent = ''; }, 3000);
}

async function copy(text, fallbackNode) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallbackNode) return false;
    // Older browsers: select the text so the visitor can copy it themselves.
    const range = document.createRange();
    range.selectNodeContents(fallbackNode);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return false;
  }
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copy);
    const copied = await copy(source.textContent, source);
    say(button, copied ? 'Copied' : 'Selected. Use your browser’s Copy.');
  });
}

for (const button of document.querySelectorAll('[data-copy-link]')) {
  button.addEventListener('click', async () => {
    say(button, (await copy(canonical)) ? 'Link copied' : canonical);
  });
}

const shareButton = document.querySelector('.share-button');
if (shareButton && navigator.share) {
  shareButton.hidden = false;
  shareButton.addEventListener('click', () => {
    navigator.share({
      title: 'Leave Me Alone',
      text: 'Getting WhatsApp messages from stores you only browsed? Here’s how they get your number, and how to stop it.',
      url: canonical,
    }).catch(() => {});
  });
}
