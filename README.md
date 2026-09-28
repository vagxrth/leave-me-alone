# Leave Me Alone

A browser extension that stops GoKwik's shopper network from recognising you on stores you only browse. That recognition is why a brand can WhatsApp you after you looked at a product and left. Checkout keeps working.

## Why

Many Indian D2C stores (Mokobara, Stoa Paris, Salt Oral Care, XtremeX and others) embed GoKwik KwikPass. On every page it loads hidden frames from `pdp.gokwik.co` that read a 365-day GoKwik cookie set on *other* stores. It hands your phone number to the store you're on, and reports the products you view. GoKwik sells this as "identify up to 30% of visitors, even those who don't sign up", followed by WhatsApp messages.

## What it does

It blocks only the parts of GoKwik that identify you:


| What                  | Blocked address                                                  | What it did                                                                                        |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cross-store identity  | `pdp.gokwik.co/kwikpass/…`, `pdp.gokwik.co/cart-get-tokens.html` | Hidden frames that read GoKwik's cookie and pass your number or login token to the store you're on |
| Device fingerprinting | `prd-gfp.gokwik.co`, `gkx.gokwik.co/kp/api/v1/fp/…`              | Fingerprint (FingerprintJS) service that recognises a device without cookies                       |
| Browsing analytics    | `gkx.gokwik.co/gke/…`, `sdk.gokwik.co`                           | Sends each product you view to GoKwik for "you were looking at…" follow-ups                        |


GoKwik's cart and checkout are left alone. When you decide to buy, you type your number at checkout as usual.

- **Flags GoKwik stores.** The toolbar badge shows how many tracking requests were blocked on the page. The popup says which kinds.
- **Pause on this site.** Use this when you want to log in with a store's GoKwik OTP login, then resume.
- **Forget my GoKwik data.** Clears GoKwik's cookies and storage from Chrome: the data stores already use to recognise you. Clicked while you're on a store, it also removes the GoKwik copies that store saved on its own site (your visitor ID, saved phone numbers, login tokens), keeping your cart and the store's own login. Do this once on each store that already messages you. GoKwik's own data is also cleared every time Chrome starts, unless you turn that off; the per-store copies are only cleared when you click the button.

## Install (Chrome, Edge or Brave on a computer)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the extension, open it, and click **Forget it now** to clear GoKwik data from earlier shopping.

Also recommended: Settings → Privacy and security → Third-party cookies → **Block third-party cookies**. Tested: with this on, GoKwik can't carry one ID between stores.

## What it doesn't do

- Stores that already have your number keep it. In WhatsApp, use Stop, Block and Report, and ask the brand and GoKwik ([grievance-officer@gokwik.co](mailto:grievance-officer@gokwik.co)) to delete it.
- Typing your number into a GoKwik checkout gives it to that store, which may message you if you leave without buying.
- Other checkout networks (Shopflo, Razorpay Magic Checkout, Shiprocket) aren't covered yet.
- GoKwik can change its addresses at any time. Run the test below to confirm the rules still match.

## Test

```sh
cd test
npm install
npm run smoke                      # checks xtremexmartialarts.com
npm run smoke -- <product-url>     # checks any GoKwik store's product page
```

The test installs the extension into a throwaway Chrome profile. It checks that the identity, fingerprinting and analytics requests are blocked, that no GoKwik ID cookie is created, and that GoKwik's checkout still opens and asks for a phone number. It also checks pause, resume and forget, including that forgetting on a store removes GoKwik's saved copies while keeping the cart. It never types into a form or places an order. On 25 Sep 2026 it passed 12/12 on xtremexmartialarts.com, stoaparis.com and saltoralcare.com.

Set `CHROME_PATH` if Chrome isn't at the default macOS location.

## How it works

- `extension/rules/gokwik.json`: the blocking rules (`declarativeNetRequest`). Rule 100 is a low-priority allow rule that only records that GoKwik is on the page; it isn't counted on the badge.
- `extension/lib.js`: which rule belongs to which category, pause and resume (a dynamic `allowAllRequests` rule for the site), and data clearing.
- `extension/background.js`: sets up the badge and clears GoKwik data at startup when that setting is on.
- `extension/popup.*`: the toolbar popup.


| Permission               | Why                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `declarativeNetRequest`  | Block GoKwik's tracking addresses                                                                                   |
| `activeTab`, `scripting` | When you open the popup, read which site you're on and whether it includes GoKwik. Nothing runs on pages otherwise. |
| `storage`                | Your settings                                                                                                       |
| `browsingData`           | Clear GoKwik's cookies and storage when you ask, or at startup                                                      |


The extension makes no network requests of its own and sends nothing anywhere.