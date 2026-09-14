# LACK Studio visual refresh

## Scope

The embedded `INDEX_HTML` in `lack.py` now uses a workspace design inspired by
the cream, yellow, pink and outlined visual language of https://www.raft.build/zh-cn/.
No Raft logos, proprietary artwork, testimonials or product claims are reused.
The geometric decorations are CSS and HTML, with no new font, image, framework
or package downloads. Existing Font Awesome usage elsewhere is unchanged.

The implementation retains the existing chat, thread, attachment, provider,
Agent editor, graph, repository tree, Moderator and CRON element IDs and handlers.
Server code, model routing, permissions, persistence and production configuration
are unchanged. The Studio label is a presentation name, not a backend upgrade.

## Interaction changes

- A cream workspace sits beneath a yellow header, with pink collaboration CTA.
- The sidebar has a visible Add Agent action using the existing spawn workflow.
- Empty message views show onboarding and three editable prompt starters.
- Starters only fill the composer; they do not send requests or execute tools.
- Replacing a nonempty draft requires confirmation.
- Tool-free prompt wording is guidance, not a new security enforcement mechanism.
- Graph, repository, Moderator and destructive CRON controls are grouped in an
  explicit workspace menu. The existing CRON confirmation remains unchanged.
- Mobile navigation can be toggled; Escape closes navigation and the menu.
- Dark mode, visible focus states and reduced-motion preferences are retained.
- Connection text starts as CONNECTING and is updated by existing WebSocket code.
- Empty-view wording deliberately does not assert that no historical data exists.

## Delivery status

The initial visual-edit request delivered source only. After the user's explicit
approval, release `6c37342` was tested and deployed on 2026-09-14. See
[the release acceptance record](UI_STUDIO_RELEASE_2026-09-14.md) for measured
results, test limitations, backup and rollback information. Existing history
restoration and admission-control limitations are not fixed by this change.

## Next approval-gated acceptance and release

1. Materialize into a new disposable directory, preserving live configuration.
2. Run existing regression/smoke tests and frontend syntax checks.
3. Check desktop/mobile layouts, light/dark modes, keyboard focus, navigation,
   draft preservation, model selection, sending, attachments, threads and dialogs.
4. Confirm the CRON warning without accepting it; do not reset production data.
5. Back up the current VPS release/data, deploy a separate reviewed release and
   retain rollback. Verify LACK and the unchanged Tailscale relay afterward.

Do not run the legacy installer or overwrite the live VPS configuration to
publish this UI. Future releases must repeat the backup and acceptance process.
