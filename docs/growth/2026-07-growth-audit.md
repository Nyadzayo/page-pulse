# PagePulse Growth & Instrumentation Audit — July 2026

Scope: full repository inspection (v1.0.1, main @ 08cb9cd), analytics audit against the
reported GA numbers for ~Jun 12 – Jul 9 2026, funnel definition, churn diagnosis,
hypotheses, and the Tier 0/1 implementation shipped alongside this document.

---

## 1. Executive diagnosis

**The reported numbers are a measurement artifact, not a product verdict.**
The shipped extension contains **zero analytics code** — no GA, no telemetry, no
event of any kind (confirmed by repo-wide search; the privacy policy explicitly
promised "no analytics"). Therefore the GA property that produced "60 active
users, 0% Day-1/Day-7 retention, 6.45 s engagement" cannot be measuring the
extension. It is measuring **web pages** — the store listing and/or the GitHub
Pages privacy-policy/landing page. Those numbers are exactly what a listing
page looks like: ~6 seconds of reading, one visit, no return. **Day-1/Day-7
retention of the product is currently unknown, not zero.**

What we *can* say from the repo:

- The core loop (select element → scheduled check → notification → diff view)
  is implemented and plausibly works; reliability engineering is unusually good
  for a v1 (selector recovery, broken-monitor alerts, health states, 245 tests).
- The most likely real losses are at the *front* of the funnel: after install
  **nothing happens** (no welcome page, onboarding card lives on a page users
  may never open), the popup's Add Monitor button **silently no-ops** on
  new-tab/chrome pages and at the monitor limit, and the success toast lied
  about the check interval.
- This product should not be judged on DAU. A correctly configured monitor
  delivers value silently for weeks. Retention must be defined as
  **"still has a healthy active monitor"**, measured via a daily heartbeat.

## 2. Product value loop

```
User action        →  System action              →  User value            →  Reason to return
─────────────────────────────────────────────────────────────────────────────────────────────
Click element on   →  Baseline captured;         →  "It's being watched   →  (none needed yet)
a page they care      alarm checks every            for me"
about                 5 min–24 h
                   →  Fetch/offscreen render,    →  —                     →  —
                      diff vs baseline
Page changes       →  Notification + badge +     →  Learns of the change  →  Click notification →
                      history entry (+webhook)      without checking         dashboard diff view
Views diff         →  Old/new comparison,        →  Understands what      →  Keeps monitor alive;
                      smart summary                 changed                  adds more monitors
```

**Verdict: the loop is complete in code but unverified in the field, and the
first three loop segments had UX leaks** (silent failures, invisible first-run
guide, wrong expectations copy). The loop's weakest link is *perceived* liveness
between creation and the first real change — a gap of days or weeks in which
the user has no evidence the product works (partially mitigated by the
health/last-checked UI, now also by the test notification).

## 3. Current user flow and friction points

| Step | What happens | Friction / leak |
|---|---|---|
| Store visit | Listing (87 views, ~56 installs → **~64% listing conversion — good; acquisition volume, not conversion, is the store-side constraint**) | Description is strong; screenshots not audited here |
| Install | Nothing opens. Icon likely unpinned. | **Dead end #1.** User must discover the toolbar icon. (Fixed: welcome dashboard tab on install) |
| First open (popup) | Empty state: "Click Add Monitor" | If on a chrome:// or Web-Store page, Add Monitor silently did nothing. **Dead end #2.** (Fixed: inline reason) |
| Add Monitor | Permission prompt **closes the popup** (Chrome behavior); after grant, selection overlay auto-starts via `permissions.onAdded` | Clever recovery, but the popup vanishing feels broken; nothing explains the per-site permission. |
| Select content | Crosshair overlay, click element | No preview of what was captured; selecting an empty element created a junk monitor. (Fixed: empty-selection rejected; toast echoes captured text) |
| Configure | Defaults: 5-min interval, auto render-mode | Toast said "checking every hour" while default is 5 min. (Fixed) |
| First check | Runs within ~1 min (lastChecked=null → due) | Invisible unless the user reopens the popup/dashboard. |
| First change | Days–weeks later, notification + badge | OS-level notification muting fails silently. **Dead end #3.** (Mitigated: test notification button) |
| Return | Notification click → dashboard diff | Works; unread badge semantics are solid. |

**Permissions & trust:** install-time permissions are minimal (no host access at
install — excellent for conversion). Per-site optional host permission at first
monitor is the right model but is never explained to the user before the prompt
appears. Two credibility wrinkles: popup/dashboard load Google Fonts remotely
(an external request on every open, sitting under a "Local only" badge), and
the AI/webhook/sync features mean "local only" needed more precise wording
(footer copy now says "Local first — page content never leaves your device").

## 4. Analytics audit (Phase 2 answers)

1. **Existing events:** none. Nothing in the extension emits telemetry.
2. **Untracked actions:** everything — install, open, creation, checks, changes, notifications, retention.
3. **Identity:** no identity existed. Now: random UUID in `chrome.storage.local`, stable across popup sessions, SW restarts, browser restarts, and upgrades. Lost only on uninstall/reinstall (acceptable; that *is* a new install).
4. **Can activation/retention be computed?** Before: no. Now: yes — funnel events + daily heartbeat (see spec).
5. **Does MV3 lose events?** Risks: SW may be killed mid-tick (event never sent — accepted, best-effort); GA4 ignores events without `session_id`/engagement (handled); events from three isolated contexts (popup/dashboard/SW) need shared storage-based identity (handled).
6. **Extension vs listing traffic separated?** No — this is the root cause of the bogus numbers. The fix is a **dedicated GA4 property for extension telemetry**; never mix it with the web property.
7. **Duplicated/blocked/delayed/mislabeled?** first_* events dedupe via persisted flags; MP events are not blocked by page-level ad-blockers (sent from extension context), though privacy-DNS can block them (undercount, acceptable); no delay handling (no offline queue — deliberate simplicity).
8. **Does config explain 0% retention?** Yes: a web property measuring one-shot listing/policy pageviews mathematically yields ~0% retention and seconds of engagement.
9. **Privacy/CWS issues:** the listing and policy said "No analytics." **Shipping telemetry without updating them is a policy violation.** Both documents are updated in this repo; they must be published in the same release. Data minimisation is enforced in code: per-event param allowlist + forbidden-key blocklist (no URLs, hostnames, selectors, labels, content, keys).

### Event specification (implemented in `src/lib/telemetry.js`)

Transport: GA4 Measurement Protocol (`/mp/collect`), fired from whichever context
owns the action. Global rules: random `client_id`; 30-min `session_id` in
`chrome.storage.session`; `engagement_time_msec:100`; strings truncated to 90
chars; unknown events and non-allowlisted params dropped; no-op when
`telemetryConfig.js` is empty or the user disables the dashboard-footer toggle.

| Event | Trigger (emitted from) | Required props | Optional props | Dedupe | Metric it feeds |
|---|---|---|---|---|---|
| `extension_installed` | `onInstalled` reason=install (SW) | version | — | Chrome fires once | Install count ground truth |
| `extension_updated` | `onInstalled` reason=update (SW) | version | — | per update | Version adoption |
| `extension_opened` | popup/dashboard DOMContentLoaded | surface | monitor_count | n/a (each open real) | Install→open rate |
| `onboarding_started` | welcome card rendered (dashboard) | surface | — | trackOnce | Onboarding funnel top |
| `onboarding_completed` | "Got it" (dashboard) | surface | — | trackOnce | Onboarding completion |
| `monitor_creation_started` | Add Monitor click / auto-flow (popup) | surface | — | n/a | Creation funnel top |
| `monitor_created` | `handleCreateMonitor` success (SW) | render_mode, interval_minutes | monitor_count, via | n/a | Creation success rate |
| `monitor_creation_failed` | limit / unsupported page / invalid input | reason, surface | — | n/a | Creation failure diagnosis |
| `first_monitor_created` | first success (SW) | hours_since_install | render_mode | trackOnce | **Activation**, time-to-activate |
| `monitor_check_completed` | end of tick with ≥1 check (SW) | checks, failures, changes | — | per tick (aggregate, never per monitor) | Check success rate |
| `monitor_check_failed` | OK→BROKEN transition (SW) | reason | — | transition-gated | Reliability |
| `change_detected` | tick with ≥1 change (SW) | count | — | per tick | Value delivery |
| `first_change_detected` | first ever (SW) | hours_since_install | — | trackOnce | Time-to-first-value |
| `notification_sent` | instant/digest/broken/test fired | kind | count | n/a | Delivery rate denominator |
| `notification_clicked` | `notifications.onClicked` (SW) | kind | — | n/a | Notification CTR |
| `change_viewed` | dashboard opens monitor with unread>0 | unread_count | — | unread-gated | Notification→return |
| `monitor_edited` | interval/notify/render/keywords change | field | — | n/a | Config depth (leading retention indicator) |
| `monitor_paused` | popup toggle / dashboard button | surface, paused | — | n/a | Disengagement signal |
| `monitor_deleted` | dashboard delete | age_days, change_count | — | n/a | Monitor survival; `change_count=0` deletions = wasted setups |
| `share_clicked` | share open / copy link / copy text | action | — | n/a | Referral intent |
| `heartbeat` | daily alarm, only if ≥1 monitor exists (SW) | monitors_total/active/paused/healthy/broken, days_since_install | version | daily | **North star + retention** |
| `extension_error` | caught failures (tick, digest, migration, sync, create) | context, message (≤90ch, no page data) | — | n/a | Reliability triage |

Reserved, not implemented (no product surface exists yet): `upgrade_completed`
(payments disabled), `feedback_opened`/`feedback_submitted` (no feedback UI —
Tier 2 candidate). `monitor_check_started` deliberately omitted: a
started/completed pair doubles volume and answers nothing `checks`+`failures`
don't.

## 5. Likely tracking defects (ranked)

1. **Wrong instrument entirely** — web GA property interpreted as product analytics (certain).
2. "Active users" ≈ listing/policy page visitors; "56 new users" may loosely track installs but proves nothing about opens.
3. 0% retention = nobody revisits a listing page (expected, meaningless).
4. 6.45 s engagement = time reading a web page.
5. "Unassigned: 13" = typical GA4 attribution noise on low volume.
6. Even after this fix: MP events can be dropped by privacy DNS/firewalls; heartbeats stop when Chrome is closed for days (undercounts retention slightly — bias is *conservative*, acceptable).

## 6. The real funnel & metric definitions (Phase 3)

```
Store visitor → install → first open → first monitor created → first successful check
→ first change detected → notification sent → notification clicked → change viewed → still monitoring
```

| Metric | Source |
|---|---|
| Listing conversion | CWS dashboard impressions/installs (not GA) |
| Install → first open | `extension_installed` → first `extension_opened` |
| First open → first monitor | `extension_opened` → `first_monitor_created` |
| Creation success rate | `monitor_created` / (`monitor_created`+`monitor_creation_failed`) |
| Time to first monitor | `first_monitor_created.hours_since_install` (median) |
| Time to first check | ≈ +1 min from creation (by design); failures visible in check aggregates |
| Time to first change | `first_change_detected.hours_since_install` |
| Notification delivery | `notification_sent` counts (true OS-level delivery is unobservable; test-notification mitigates) |
| Notification CTR | `notification_clicked` / `notification_sent` (kind=change,digest) |
| D1/D7 activated retention | GA4 cohort on users with `first_monitor_created`, returning = any heartbeat/opened event |
| Weekly active monitors | `heartbeat.monitors_active` weekly avg |
| Monitors per activated user | `heartbeat.monitors_total` distribution |
| Checks per active monitor | `monitor_check_completed.checks` / active monitors |
| % installed users receiving value | users with ≥1 `change_detected` ÷ users with `extension_installed` |

**Activation metric decision: `first_monitor_created` (a valid monitor).**
- *vs first successful check:* the check runs automatically ≤1 min later; it measures our reliability, not user behaviour — track it as a **reliability** metric, not activation.
- *vs first change detected:* strongest link to realised value, but the timing is owned by the monitored website (days–weeks); useless as an activation target and would punish us for users monitoring slow-moving pages. Track as **time-to-first-value**.
- Creating a valid monitor is the last step the *user* controls, happens in-session, and is the correct optimisation target for onboarding. Guardrail: pair with creation success rate and `monitor_deleted{change_count:0}` so we don't optimise junk-monitor creation.

**Product-appropriate retention definitions** (do not copy SaaS DAU):
- % of monitors still active+healthy at 7/30/60 days (heartbeat)
- % of activated users with ≥1 healthy monitor each week ← **north star**
- % of users receiving ≥1 successful check per week
- Notification→return rate (`change_viewed` within 48 h of `notification_sent`)
- Monitor survival curve (`monitor_deleted.age_days`)

## 7. Churn & friction diagnosis table (Phase 4)

| # | Problem | Evidence | Conf. | Likely cause | Metric affected | Experiment | Effort | Expected impact |
|---|---|---|---|---|---|---|---|---|
| 1 | Analytics measures the wrong thing | No telemetry code in repo; numbers shaped like listing traffic | **Certain** | Web GA property ≠ product | All | Ship Tier 0 (done) | S | Unblocks everything |
| 2 | Nothing happens after install | No `onInstalled` UI; onboarding card only in dashboard | **High** | Missing welcome surface | Install→open, activation | Welcome tab on install (done) | S | High |
| 3 | Add Monitor silently no-ops | `popup.js` early `return`s with no UI | **High** (code-proven) | Unhandled edge UI | First-open→first-monitor | Inline reasons (done) | S | Medium-high |
| 4 | Wrong expectation copy | Toast said "every hour", default is 5 min | **Certain** | Copy drift | Trust, creation confidence | Fixed | S | Low-medium |
| 5 | No proof of life before first change | No test notification; value gap of days | High | Product physics | Perceived value, D7 | Test notification (done); "next check" countdown (Tier 2) | S–M | Medium |
| 6 | Notifications muted at OS level fail silently | No delivery verification possible | Medium | macOS/Win Chrome notif settings | % receiving value | Test notification surfaces it; add delivery-check hint | S | Medium |
| 7 | Empty/invalid monitors | `content.js` accepted empty textContent | **Certain** (code) | No validation | Creation success, junk churn | Rejection + preview (done) | S | Medium |
| 8 | Popup closes during permission grant feels broken | Chrome closes popup on permission dialog | High | Chrome MV3 behavior | Creation completion | Pre-permission explainer line in popup (Tier 2) | S | Medium |
| 9 | Fetch-vs-DOM baseline mismatch → spurious first change | Baseline from DOM textContent; checks parse raw HTML | Medium | Whitespace/render diffs partially normalised | False notifications, trust | Measure via `change_detected` within 10 min of creation; if high, re-baseline on first check without notifying | M | Medium |
| 10 | AI dialog crash after save | `aiOnIcon` undefined (ReferenceError) | **Certain** (code) | Dead identifier | Feature adoption | Fixed | S | Low |
| 11 | Wrong-audience installs | Cannot know without funnel data | Low | Listing keywords | Activation rate | Read `monitor_creation_failed` + activation by cohort after 30 days | — | — |
| 12 | Low usage is partly *natural cadence* | Product checks pages so users don't have to | High | Product design (good!) | Misread DAU | Use heartbeat-based retention, not DAU | — | Reframes everything |

## 8. Prioritized hypotheses (Phase 6) — Impact × Confidence ÷ Effort

All evidence below is **directional** (n≈56 installs; nothing here is statistically powered).

| Rank | Hypothesis (Because / we believe / if / then / because) | Conf. | Primary metric | Guardrail | Effort | False interpretation risk |
|---|---|---|---|---|---|---|
| H1 | Because GA shows listing-page-shaped numbers, we believe retention is unmeasured, not zero. If we ship dedicated extension telemetry, reported retention should move from 0% to a real number, because the instrument will finally observe the product. | 95% | All | User trust (disclosure shipped) | S (done) | Telemetry bugs mistaken for behaviour; validate with own usage first |
| H2 | Because nothing opens post-install and the onboarding card lives on an unvisited page, we believe many installers never form a first-use intent. If we open the dashboard welcome on install, install→first-open should rise materially, because the first step becomes zero-discovery. | 80% | Install→open rate | Uninstall rate (annoyance), onboarding_completed | S (done) | Opens rise without activation → welcome content is the problem, not discovery |
| H3 | Because Add Monitor silently no-ops on chrome://newtab (a very common first-click context), we believe some users conclude the extension is broken. If we show the reason inline, first-open→creation-started completion should rise. | 70% | monitor_creation_failed{unsupported_page} followed by later monitor_created | — | S (done) | Failure events rising just means visibility, not regression |
| H4 | Because the wait for a first real change is days, we believe users lose faith before first value. If we offer a labelled test notification, D7 activated retention should rise, because users get proof the alert channel works. | 55% | notification_sent{test} → D7 retention | No fake-alert confusion (labelled) | S (done) | Test-clickers may be self-selected engaged users (correlation ≠ causation) |
| H5 | Because empty-element selections created junk monitors, we believe some "activated" users actually got zero value. If we validate selection and echo captured text, monitor_deleted{change_count:0} should fall. | 65% | Junk-deletion rate | Creation success rate | S (done) | Low volume may hide effect for weeks |
| H6 | Because the permission dialog kills the popup mid-flow, we believe creation abandonment happens at the grant step. If we add one explainer line before requesting ("Chrome will ask for access to this site — that's normal"), creation_started→created should rise. | 55% | Creation completion rate | Permission grant rate | S | Users may abandon for privacy reasons regardless of copy |
| H7 | Because baseline is DOM text but checks parse fetched HTML, we believe some monitors fire a spurious change within minutes of creation. If we silently re-baseline the first check, false first notifications should drop. | 50% | change_detected within 10 min of monitor_created | Real fast changes not swallowed | M | Fast-moving pages legitimately change in 10 min |
| H8 | Because the listing already converts (~64%) on tiny traffic, we believe acquisition volume, not conversion, is the store constraint. If we publish 3–5 use-case landing pages (price-drop, job-posting, restock) targeting search intent, installs should rise via referral traffic. | 50% | CWS installs by referrer | Activation rate of new cohort | M | Seasonality/listing-rank changes confound |
| H9 | Because review count drives store rank and we only ask nobody, we believe a review prompt shown *only after* first_change_detected + change_viewed would convert well. If we add it, reviews/WAU should rise without rating damage, because we ask exactly when value was just received. | 60% | Reviews; listing rank | Rating average; prompt-dismiss rate | S–M | Reviews rise but rank effect lags months |
| H10 | Because share exists but is buried post-setup, we believe referral moments are being missed. If we surface "Share this monitor" in the change-view (the value moment), share_clicked should rise. | 45% | share_clicked → referral installs | Notification-view UX clutter | S | Share clicks without installs = wrong artifact (need public change-report page) |
| H11 | Because a monitor going BROKEN ends value delivery silently-ish, we believe broken-monitor recovery is a retention lever. If we measure broken→re-selected rates and streamline re-selection (deep-link opens the source page with overlay pre-armed), monitor survival should rise. | 55% | monitor_check_failed → subsequent monitor_created same-user | — | M | Users may abandon the *page*, not the tool |
| H12 | Because DAU is the wrong frame, we believe some "churned" users are silently satisfied. If we compare heartbeat-healthy users vs popup-openers after 30 days of data, we expect healthy ≫ openers, confirming cadence-appropriate retention. | 70% | Heartbeat cohort analysis | — | — (analysis only) | Heartbeats stop when Chrome closed long-term — undercount |

## 9. Implementation tiers (Phase 7) — status

**Tier 0 — measurement (SHIPPED in this change set)**
- `src/lib/telemetry.js` (new), `src/lib/telemetryConfig.js` (new, credentials empty → no-op until owner fills them)
- Instrumented: `background.js`, `popup.js`, `dashboard.js` (events per spec §4)
- Daily heartbeat alarm (`constants.js`, `background.js`)
- Opt-out toggle (dashboard footer), `telemetryEnabled` default setting
- Disclosure updates: `privacy-policy.html` §2.1, `store-listing.md`, `README.md`
- Tests: `tests/lib/telemetry.test.js` (13 tests)
- **Owner actions required before events flow:** create a separate GA4 property; fill `telemetryConfig.js`; publish the updated privacy policy to GitHub Pages and the updated listing text to CWS in the same release.

**Tier 1 — activation (SHIPPED)**
- Welcome dashboard tab on fresh install (`background.js` onInstalled)
- Accurate creation toast + captured-content preview + first-check expectation; empty-selection rejection (`content.js`)
- Popup inline failure reasons for unsupported page / limit (`popup.js`, `popup.html`, `popup.css`)
- "Send test notification" in onboarding card, with delivery-failure hint (`dashboard.html`, `dashboard.js`)
- Bug fix: `aiOnIcon` ReferenceError that broke the AI-config save flow (`dashboard.js`)

**Tier 2 — retention & growth (NOT implemented; ordered by leverage, gated on 30 days of Tier 0 data)**
1. Pre-permission explainer line in popup (H6) — S
2. Silent re-baseline on first check if only whitespace/parse deltas (H7) — M; requires evidence first
3. Review prompt after `change_viewed` following a real change (H9) — S/M; CWS-compliant, value-gated
4. "Share this change" (sanitised report) from the diff view (H10) — M
5. Broken-monitor one-click re-selection flow (H11) — M
6. Next-check countdown in monitor detail — S
7. Use-case landing pages + self-host fonts (remove Google Fonts remote loads) — M
8. Feedback link + `feedback_opened`/`feedback_submitted` events — S

## 10. Growth dashboard specification (Phase 9)

**North star: weekly users with ≥1 healthy active monitor** (from `heartbeat`).
This is the right choice because it captures delivered value regardless of
popup opens, punishes silent breakage, and is insensitive to the product's
naturally low interaction cadence. Explicitly do **not** optimise DAU.

| Section | Metric | Source |
|---|---|---|
| Acquisition | CWS impressions, listing visitors, installs, listing conversion | CWS developer dashboard (keep out of GA) |
| Activation | first opens; `first_monitor_created` count; creation success rate; median `hours_since_install` at first monitor | GA4 |
| Value | `change_detected` events; `notification_sent` (change/digest); `notification_clicked`; `change_viewed` | GA4 |
| Retention | monitor survival (heartbeat + `monitor_deleted.age_days`); weekly healthy-monitor users; D7/D30 activated-user retention (cohort: `first_monitor_created`) | GA4 cohorts |
| Reliability | check success rate (`checks`−`failures`)/`checks`; `monitor_check_failed`; `extension_error` by context; broken-monitor rate (heartbeat) | GA4 |
| Growth | `share_clicked` by action; review prompt impressions/clicks (when built); referral installs (CWS referrer report) | GA4 + CWS |

## 11. 30-day experiment plan

- **Week 1:** Owner fills `telemetryConfig.js`, publishes policy + listing, ships v1.1.0. Validate events end-to-end with own installs (GA4 DebugView). Baseline CWS stats snapshot.
- **Week 2:** First real funnel read (even n=20 installs shows *where* the cliff is: open? create? notify?). Decide H6 vs H7 as next build based on `monitor_creation_failed` reasons and early spurious-change counts.
- **Week 3:** Ship the winning Tier 2 item + review prompt (H9) if ≥5 users have reached `first_change_detected`. Draft 3 use-case landing pages (H8).
- **Week 4:** First cohort review: install→open, open→create, creation success, time-to-first-change distribution, heartbeat-healthy %. Re-rank hypothesis backlog with actual numbers. Explicitly test H12 (healthy-but-silent users) before declaring any "churn" problem.
- Throughout: no statistical claims below ~100 activated users; treat everything as directional and prefer fixing code-proven defects over A/B testing at this volume.

## 12. Remaining unknowns

1. Where the current GA numbers actually come from (which property/page has the tag) — owner should check the GA admin.
2. True install→open rate (measurable only after Tier 0 ships in a release).
3. Whether the fetch-vs-DOM baseline mismatch fires spurious first changes in the wild (H7) — instrumented, watch `change_detected` timing.
4. OS-level notification delivery rate — fundamentally unobservable; test-notification click-throughs are the proxy.
5. Whether uninstalls cluster immediately post-install (CWS dashboard shows uninstalls; consider `chrome.runtime.setUninstallURL` later — deliberately deferred, it was explicitly scoped out of the onboarding PR).
6. Store search terms driving impressions (CWS stats → keywords report).

## 13. Data to export next (owner)

1. CWS developer dashboard: impressions, installs, uninstalls, weekly users — CSV, since launch.
2. GA admin: identify the property currently reporting; confirm it's web-only; create the new "PagePulse Extension" property.
3. After v1.1.0: GA4 exports of `first_monitor_created` (with `hours_since_install`), heartbeat aggregates, `monitor_creation_failed` reasons, notification CTR.
4. Any user feedback already received (store reviews, emails) — currently the only qualitative signal available.
