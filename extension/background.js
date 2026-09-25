import { forgetGoKwik } from './lib.js';

// The badge shows how many GoKwik tracking requests were blocked on the current page.
async function setUpBadge() {
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  await chrome.action.setBadgeBackgroundColor({ color: '#0C7F8C' });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setUpBadge();
  if (reason === 'install') {
    await chrome.storage.local.set({ forgetOnStartup: true, showWelcome: true });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await setUpBadge();
  const { forgetOnStartup = true } = await chrome.storage.local.get('forgetOnStartup');
  if (forgetOnStartup) await forgetGoKwik();
});
