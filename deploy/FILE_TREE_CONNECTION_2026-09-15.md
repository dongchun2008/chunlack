# File-tree connection recovery, 2026-09-15

The user reported `Failed to load tree.` in the Repository Tree dialog.

## Observations

- The VPS-local request to `/api/tree?root=thread_repos` returned HTTP 200,
  `application/json`, and `[]`.
- LACK remained active with PID 234963 and automatic restart count 0.
- Tailscale remained active with PID 859 and restart count 0.
- Recent inspected LACK journal entries showed routine indexing activity.
- A request from Windows to the configured local entry point on port 13721
  failed with a connection-refused error. The SSH forwarding endpoint was absent.

## Recovery and result

Re-established SSH local forwarding from port 13721 to the VPS loopback port
3721. Opened the application and selected Workspace > Project Files.
The actual dialog rendered an empty list (`<ul></ul>`) without the error text,
and the connection indicator read CONNECTED.

This identifies and resolves the currently observed access failure. No network
trace from the original screenshot was available; the generic error message
can also represent other request, JSON parsing or rendering failures.

No application code, directory permissions, provider settings or persistent
data were changed. Neither LACK nor Tailscale was restarted. No regression or
load test was needed or performed for this connection-only recovery.

## Prevention and limitations

Keep an SSH tunnel running in the user's own terminal for daily access.
The user guide now includes keepalive options and explains that cached UI can
remain visible after the tunnel disconnects. Keepalive is not automatic process
restart and cannot maintain access when the computer sleeps or the terminal exits.

The empty-directory presentation and generic error wording are unchanged.
An empty tree concerns LACK's thread repositories, not the contents of the
project's GitHub repository. Do not reset data to populate an empty tree.
