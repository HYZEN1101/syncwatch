# Phase 1 Experiment — Run This Locally

This sandbox can't run the test itself: it can't download the Electron binary
(GitHub release assets are blocked here) and can't reach youtube.com or any
general internet site (only package registries are reachable). Your machine
already has none of those restrictions — you had a working `node_modules`
with a real Electron build in the project zip, so this will run fine there.

# Phase 1 Experiment — Run This Locally

This sandbox can't run the test itself: it can't download the Electron binary
(GitHub release assets are blocked here) and can't reach general internet
sites (only package registries are reachable). Your machine already proved
it can run this fine.

## Run it

```bash
cd experiments/phase1-playback-mechanism
npm install
npm start
```

A window opens with four panels:

- **A** — `<webview>` loading `https://github.com` directly (confirmed via
  `curl -I https://github.com` to send `x-frame-options: deny` and
  `frame-ancestors 'none'`).
- **B** — `WebContentsView` (a sibling native view, not DOM-nested) loading
  the same URL.
- **C** — `<webview>` loading a **local page that itself embeds a nested
  `<iframe src="github.com">`** — this is the real "aggregator site embeds a
  CDN player in an inner iframe" scenario from the original bridge problem.
- **D** — `WebContentsView` loading that same nested-iframe local page.

> **Revision history, so you know why this looks different from the first
> version:** the original test used `youtube.com/watch` as the "blocked"
> fixture, and results showed both webview and WebContentsView loaded it
> fine — that fixture's headers were never actually verified, and turned out
> not to block anything. Swapping to `github.com` (headers verified with
> `curl -I` before trusting it) showed **both approaches ALSO bypass it** —
> so the original hypothesis ("webview gets blocked, WebContentsView doesn't")
> was wrong for this Electron version. Panels C/D were added afterward to
> check the one thing that hadn't been tested yet: a *nested* iframe inside
> a loaded page, pointing at a separately-restricted domain — the scenario
> that actually matches how aggregator/streaming sites embed CDN players.

Check the terminal output and `results.json` in this folder once everything
finishes loading (a few seconds).

## What to look for

- `results.webview` / `results.webContentsView` — expect both `loaded: true,
  blocked: false` based on prior runs. If either comes back blocked this
  time, that's new information, not a bug — report it as-is.
- `results.webviewNested` / `results.webContentsViewNested` — the important
  new data point. Look at `.nestedFrameContent` — if the inner github.com
  iframe rendered real content (a title like "GitHub · ..."), the nested
  restriction was bypassed too. If `.nestedFrameContent` shows an error or
  blank content, the inner frame was blocked — and that would apply to BOTH
  webview and WebContentsView equally, since it's determined by the loaded
  page's own frame tree, not by which container loaded it.
- `results.videoControlTest` — confirms `executeJavaScript` can find and
  drive a real `<video>` element (`playResult: 'played'` is a pass). Runs
  against a local `test-video.html`, not an external site.

## Report back

Paste `results.json` (or the console output) back into the chat either way —
a "both blocked" result on the nested case is just as useful to know as a
"neither blocked" result. This is what determines whether the original
Tampermonkey relay logic can be fully retired or still needs a fallback for
some nested-frame cases.

## Fixture verification

Always check a fixture's headers before trusting it as "blocked":

```bash
curl -I https://github.com
```
Look for `x-frame-options` or `frame-ancestors`. To try a different top-level
fixture:

```bash
FIXTURE_URL="https://example.com/some-other-blocked-page" npm start
```
