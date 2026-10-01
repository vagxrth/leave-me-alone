// Leave Me Alone site: the hero chat story, device tabs, and the browser check.
// Everything here runs in the visitor's browser. Nothing is sent anywhere.

/* The hero chat plays its story once, when it comes into view. styles.css holds the timing. */

const chat = document.querySelector('.chat');
if (chat && document.documentElement.classList.contains('story')) {
  const watcher = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    chat.classList.add('play');
    watcher.disconnect();
  }, { threshold: 0.4 });
  watcher.observe(chat);
}

/* Device tabs: open the visitor's own device, or the one named in the link (#android, #iphone, #computer). */

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const deviceTab = isIOS ? 'iphone' : /Android/.test(ua) ? 'android' : 'computer';

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

  addEventListener('hashchange', () => showFix(location.hash.slice(1)));
}

/* The browser check
   A page on a different site, loaded in a hidden frame, asks the browser whether it can use cookies it
   shares with other sites. That's what GoKwik's frame relies on. The frame never contacts GoKwik or
   any store, and the answer stays on this page. */

// What to do about shared cookies on the device being tested, whichever tab is open.
const FIX_FOR = {
  android: 'Turn on “Block third-party cookies” in Chrome’s settings, then check again.',
  iphone: 'Turn on Prevent Cross-Site Tracking in Settings › Apps › Safari, then check again.',
  computer: 'Turn on “Block third-party cookies” in your browser’s settings, then check again.',
};

const RESULTS = {
  checking: () => ['Checking…'],
  exposed: () => ['Your browser shares cookies between sites.', `GoKwik’s ID can follow you from store to store. ${FIX_FOR[deviceTab]}`],
  protected: () => ['Your browser keeps each site’s cookies separate.', 'GoKwik’s ID can’t follow you between stores.'],
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

const check = document.querySelector('.check');
const checkButton = check?.querySelector('.check-button');
const checkResult = check?.querySelector('.check-result');
const frameUrl = checkFrameUrl();
let checking = false;

function showResult(state) {
  const [title, detail] = RESULTS[state]();
  const heading = document.createElement('strong');
  heading.textContent = title;
  checkResult.replaceChildren(heading);
  if (detail) {
    const text = document.createElement('span');
    text.textContent = detail;
    checkResult.append(text);
  }
  checkResult.dataset.state = state;
  checkResult.hidden = false;
  checkButton.disabled = state === 'checking';
  checkButton.textContent = state === 'checking' ? 'Checking…' : 'Check again';
}

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

if (check && frameUrl) {
  check.hidden = false;
  checkButton.addEventListener('click', runCheck);
}
