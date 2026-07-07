# HANDOFF_PHASE_1.md — Playback Architecture Decision

## Status: Complete — decision confirmed, with one clearly-scoped caveat for Phase 2 to verify against real sites

## What this phase covers
Phase 1 of the SyncWatch Electron migration: determining which Electron mechanism actually defeats `X-Frame-Options` / `frame-ancestors`, per `PHASE_1_playback_architecture_decision.md`.

## Revision history — read this before trusting the "why"
This finding went through two corrections during testing, which matters for anyone continuing this work:

1. **First run** used `youtube.com/watch` as the "known blocked" fixture (based on the original project's assumption, never independently verified). Result: both `<webview>` and `WebContentsView` loaded it fine. That fixture simply wasn't sending a blocking header (or Electron/YouTube's current behavior no longer triggers one) — the test wasn't wrong, the fixture was untrustworthy.
2. **Second run** switched to `github.com`, whose headers were directly verified beforehand (`curl -I https://github.com` → `x-frame-options: deny`, `frame-ancestors 'none'`). Result: **both `<webview>` and `WebContentsView` loaded it fine again.** This directly contradicts the original hypothesis that `<webview>` would be blocked the way a plain browser `<iframe>` is — in this Electron version (30.5.1), it isn't.
3. **Third run (pending)** adds a test for the actual scenario the original project cares about: a **nested** iframe inside a loaded page, pointing at a separately-restricted domain (an aggregator site embedding a CDN player, which is what `syncwatch-bridge.user.js`'s relay logic exists for). This is a different question from "is the outer embed blocked" and hadn't been tested until this round.

## The decision

**Still use `WebContentsView`, but for a different, more defensible reason than originally stated.**

Original reasoning (X-Frame-Options bypass) turned out not to be the actual differentiator — both approaches currently bypass it for a top-level embed. The reason that holds up:

> Electron's own documentation states, verbatim: **"We do not recommend you to use WebViews, as this tag undergoes dramatic architectural changes that may affect stability of your application... WebViews are based on Chromium's WebViews and are not explicitly supported by Electron. We do not guarantee that the WebView API will remain available in future versions of Electron."** ([electronjs.org/docs/latest/tutorial/web-embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)) The same page recommends switching to `WebContentsView`.

In other words: `<webview>`'s current frame-bypass behavior is not a documented guarantee, it's an artifact of unstable internals Electron explicitly warns could change. Building the whole playback architecture on that would be building on sand. `WebContentsView` is the currently-supported, non-deprecated API (replacing `BrowserView`, deprecated as of Electron 30 — which this project is pinned to), gives the same practical result today, and comes with the `mainFrame.framesInSubtree` capability for reaching nested frames directly from the privileged main-process side.

## What was actually tested, and the final findings

**Confirmed (2 runs):** a top-level embed of a page with `X-Frame-Options: deny` / `frame-ancestors 'none'` is NOT blocked by either `<webview>` or `WebContentsView` in Electron 30.5.1. The original core premise — "Electron gets around browser framing restrictions where a plain browser iframe can't" — is true, but true for *both* mechanisms, not a differentiator between them.

**Confirmed (nested case, 1 run):** a genuinely nested iframe inside a loaded page, pointing at a domain with `frame-ancestors 'none'`, does NOT render — in both `<webview>` and `WebContentsView` identically (`nestedFrameContent` came back an empty document, not an error — the frame never got real content). This is `frame-ancestors` correctly doing its job at the nested level, and neither container bypasses it.

**Important caveat on what that nested result actually means:** `github.com`'s `frame-ancestors 'none'` blocks *all* embedding, everywhere, always — it's the strictest possible policy. Real streaming-aggregator/CDN-player relationships aren't like this: a CDN player embedded by an aggregator site typically sends `frame-ancestors <the-specific-aggregator-domain>`, i.e. it's designed to be embedded by its known partner, which is exactly how these sites already render fine in an ordinary Chrome browser today. The synthetic test here used a maximally-strict fixture because that's what could be verified from a sandboxed environment with no access to a real aggregator URL — it proves neither container grants blanket immunity to nested-frame restrictions (useful to know), but it does NOT mean real-world nested CDN iframes will fail to load. That distinction should be verified against at least one real aggregator domain from `client/syncwatch-bridge.user.js`'s `@match` list in Phase 2, since a synthetic worst-case test isn't the same as real-world coverage.

**What actually solves the old bridge's problem:** the original `syncwatch-bridge.user.js` relay logic (`relayToChildFrames`, the `__relayed` flag dance) wasn't fighting `frame-ancestors` — it was fighting **same-origin-policy**, which stops a page's own JS from directly scripting into a cross-origin nested frame it didn't create. `webContents.mainFrame.framesInSubtree` + calling `.executeJavaScript()` on a specific inner frame is a *privileged, main-process-level* capability — not page JS — so it isn't subject to that restriction the way the old bridge's postMessage relay was. This was demonstrated working (frame discovery + per-frame `executeJavaScript` didn't throw) even in the blocked case; it should work at least as well once pointed at a nested frame that actually renders. This is the mechanism Phase 2 should build the "no more relay bridge" replacement on.

## What was built this phase
`experiments/phase1-playback-mechanism/` (updated, standalone, not wired into the main app):
- Panel A/B: `<webview>` vs `WebContentsView`, same top-level fixture (`github.com`, header-verified).
- Panel C/D: same two mechanisms, loading a local page with a genuinely nested cross-origin iframe pointing at the same restricted domain.
- Separate invisible view: video-control test against a local `test-video.html` (fixed from an earlier version that mistakenly pointed at a raw `.mp4` file instead of an HTML page — confirmed working: `playResult: "played"`).
- All results written to `results.json`.

See `experiments/phase1-playback-mechanism/README.md` for run instructions.

## Files changed/added this phase
- `experiments/phase1-playback-mechanism/main.js`, `index.html`, `README.md` — updated
- `experiments/phase1-playback-mechanism/test-video.html`, `test-nested-iframe.html` — added
- No changes to `electron/`, `client-react/`, `server/` — the winning mechanism isn't wired into the real app yet, that's Phase 2.

## Next step
Phase 1 testing is complete. Hand this file + the updated zip + `PHASE_2_electron_playback_controller.md` to the next chat. Phase 2 should build on `WebContentsView` for the outer container, use `mainFrame.framesInSubtree` + per-frame `executeJavaScript()` in place of the old relay bridge, and — importantly — verify the nested-frame-content approach against at least one real aggregator domain from `client/syncwatch-bridge.user.js`'s `@match` list early on, since this phase's nested-iframe test used a synthetic worst-case fixture (`frame-ancestors 'none'`) rather than a real CDN player's typically more permissive policy.
