# Leave Me Alone

A blocklist for the cross-merchant identity network that runs on Indian D2C storefronts.

It stops a shop you have never logged into from learning your phone number on your first visit. It does not block checkout, so you can still buy things.

### 👉 [leave-me-alone-1.vercel.app](https://leave-me-alone-1.vercel.app/)

Check what a shop already knows about you, then block it in one click. No install, no account, nothing leaves your browser.

---

## The problem

GoKwik's **KwikPass** module is installed on a large share of Indian D2C storefronts. Alongside its checkout product, it performs visitor identification, which the vendor markets publicly as recognising *"up to 25% of anonymous visitors"* from a network it describes as 165 million shoppers across 12,000+ merchants.

The mechanism is observable in the page source of any store that runs it:

1. Every participating storefront embeds a hidden iframe from a single shared origin, `pdp.gokwik.co/kwikpass/kwikpass.html`.
2. That frame holds a persistent network user id and a stored phone number in its own origin's storage, and passes them to each merchant page over `postMessage`.
3. The merchant page writes them into **its own first-party storage** — a `kp_user_id` cookie, and a `notifyph` key containing the phone number as base64. A copy also goes into an IndexedDB database named `KP_DB`, so clearing cookies alone does not remove it.
4. Where no stored identifier exists, the script loads **FingerprintJS Pro** from `prd-gfp.gokwik.co` — a vendor endpoint self-hosted on a first-party-looking subdomain — and resolves the device against the network via `/kp/api/v1/fp/g-v-id`.

The result is that the same user id and the same phone number appear in the first-party storage of unrelated stores, and a store can identify a visitor who has given it nothing.

## What this list blocks

| Rule | What it stops |
|---|---|
| `pdp.gokwik.co/kwikpass/` | the identity sync frame and the KwikPass bundle |
| `gkx.gokwik.co` | the visitor-identification API |
| `prd-gfp.gokwik.co` | device fingerprinting |
| `sdk.gokwik.co` | analytics SDK loader |
| `hits.gokwik.co` | behavioural event collector |

## What it deliberately does not block

`api.gokwik.co`, `kwikcart.gokwik.co`, `pdp.gokwik.co/merchant-integration/`, and `pdp.gokwik.co/build/gokwik.js`.

These carry cart, checkout and payment. Blocking them would stop people completing purchases on hundreds of stores, which would make this list something people uninstall rather than something they keep. **Pull requests adding them will be declined.**

That the remaining rules leave checkout intact was checked rather than assumed. Reading `merchant.integration.js`, the script this list deliberately allows:

- it contains **no reference to the KwikPass bundle**, and fires the `gokwikLoaded` event that enables Buy Now and checkout buttons by itself;
- it loads the checkout from `pdp.gokwik.co/build/gokwik.js` — a different path from the `/kwikpass/` one blocked here, which is why that rule is path-scoped rather than a whole-host block;
- its references to `sdk.gokwik.co` and `gkx.gokwik.co` resolve to an object named `gokwik-analytics-sdk`, used only to send event hits.

That check is also what surfaced `hits.gokwik.co`, which is in the blocklist above.

## Install

### uBlock Origin, AdGuard, Brave

Dashboard → **Filter lists** → **Import** → paste:

```
https://vagxrth.github.io/leave-me-alone/gokwik.txt
```

### Pi-hole, AdGuard Home, NextDNS, hosts files

```
https://vagxrth.github.io/leave-me-alone/gokwik-domains.txt
```

DNS blockers match hostnames, not paths, so the DNS list is slightly more conservative by default. See the notes inside that file.

### Mirrors

The list is also served from [leave-me-alone-1.vercel.app](https://leave-me-alone-1.vercel.app/gokwik.txt) and from jsDelivr:

```
https://cdn.jsdelivr.net/gh/vagxrth/leave-me-alone@main/docs/gokwik.txt
```

**Subscribe using the `vagxrth.github.io` URLs above, not a mirror.** Those are canonical and will not move; they are what upstream filter lists reference. Mirrors exist for reach and may change.

---

## What this does not do

Read this part before relying on it.

- **It does not delete what is already held.** If your number is already in the network, blocking stops further linkage; the server-side record remains, and brands can still message you. Removing it takes a data-erasure request — see [`erasure-letter.md`](erasure-letter.md).
- **It does not stop brands you have actually shopped with.** That is an ordinary customer relationship, and out of scope.
- **It is not the whole ecosystem.** Other identity-resolution vendors operate on the same storefronts. This list covers one network, the largest.
- **A blocked page is not a private page.** Analytics, session recording and ad pixels are unaffected. Use this alongside a general privacy list, not instead of one.

The most robust single measure is not this list at all: **Firefox, Brave and Safari partition third-party frame storage by default**, which breaks the cross-site mechanism structurally. Chrome does not.

## Reporting a broken checkout

If a store's Buy Now or checkout button stops working with this list enabled, that is a bug in the list and takes priority over blocking. Open an issue with the storefront URL and which rule fixes it when disabled.

## Verifying it yourself

On any Indian D2C storefront, open the browser console and run:

```js
localStorage.getItem('kp_user_id')                 // network-wide id, identical across merchants
atob(localStorage.getItem('notifyph') || '')       // the phone number that store holds for you
localStorage.getItem('usr_trck')                   // kp_count: stores in the network that have seen you
```

Compare the id across two unrelated stores. It is the same value.

## Contributing

Useful contributions, in rough order of value:

- storefronts where checkout breaks (highest priority)
- new hostnames if the vendor rotates them
- the same mechanism from other identity-resolution vendors, with page-source evidence

Claims in this repository are limited to **what code is present on a page and what it stores**, all of it verifiable by anyone with a browser. Please keep contributions to that standard.

## Licence

CC BY-SA 3.0 — deliberately matching EasyList, so these rules can be merged upstream without a licensing obstacle.
