# Agent Gateway browser acceptance

Date: 2026-10-08. Tested with the Codex in-app browser against a disposable loopback HTTP server and an in-memory SQLite store. All nodes, results and credentials were synthetic. No VPS or model endpoint was accessed.

## Observed functional results

- Incorrect admin credential: login rejected with `unauthorized`; management panel remained hidden.
- Correct preview credential: management panel and initial simulated nodes displayed.
- Pause and resume: node status changed to paused and then recently online.
- View result: stored structured result and explicit missing-evidence fixture warning displayed.
- Create node: new simulated node appeared in the list, with a one-time pairing code displayed.
- Logout: management lists, result and pairing text hidden/cleared; login form returned.

Pairing redemption and five-minute expiry were not exercised in this browser run. Browser logout visibility does not independently prove every asynchronous request race or JavaScript memory property.

## Visual results

- 1280 x 900 desktop: main controls and node table readable. Full-page screenshot: `2026-10-08-gateway-desktop.png`.
- 390 x 844 narrow viewport: action column compresses Chinese button labels into vertical character stacks. The table can scroll horizontally, but narrow-screen usability is not accepted. Full-page screenshot: `2026-10-08-gateway-mobile.png`.
- Additional minor observation: the cleared pairing area remains as an empty colored strip after logging in again.

Screenshots were captured after clearing pairing text; they contain no production credentials or user data. A viewport override tests responsive layout only, not a physical mobile browser.

## Status and proposed correction

Functional paths above passed; visual acceptance remains PARTIAL. No runtime code was modified in this step. Suggested next change: prevent action-label wrapping, give the table a practical minimum width within its existing scroll container, and hide cleared pairing/result areas on logout. Run narrow-screen acceptance again after approval.

The temporary browser tab was closed and viewport override reset. Real third-party adapters, actual nodes and VPS deployment remain pending. No additional regression suite or benchmark was run in this browser-only step.
