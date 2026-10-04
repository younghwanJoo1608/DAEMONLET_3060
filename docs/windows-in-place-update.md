# Daemonlet 3060: 0.8.4 to 0.8.5 Windows update

This is an in-place update of the existing Daemonlet 3060 fork. It includes full-answer local reading from commit 3e0cdc1. It does not migrate the original Daemonlet for Codex application.

## Stable identity and stored data

| Boundary | Both versions |
| --- | --- |
| Package/product/executable | daemonlet-3060 / Daemonlet 3060 / Daemonlet 3060.exe |
| App ID | io.github.younghwanjoo1608.daemonlet3060 |
| NSIS upgrade/uninstall GUID | 6cd36946-74d2-50c7-ab39-99db71ee5c6e |
| Normal profile | %APPDATA%/Daemonlet 3060 |
| Credential Manager target | io.github.younghwanjoo1608.daemonlet3060.belle-connection.runtime-v1 |
| Hook launch ownership | Daemonlet 3060.exe; --daemonlet-3060-codex-pet-adapter=1 |
| Endpoint policy | Windows chooses free ports; explicit fork overrides remain supported; protocol/Hook fallback constants 4674/4675 |
| Legacy manual Dots bridge | DAEMONLET_3060_DOT_*; default loopback port 39531 |
| Update cache | daemonlet-3060-updater |

The NSIS GUID is derived from the unchanged app ID by the pinned electron-builder 26.15.3 UUID-v5 algorithm. The new installer uses the same current-user scope, product name, shortcuts and executable. The previous installed EXE, ASAR and credential helper were compared read-only with the archived 0.8.4 package and matched exactly. No credential operation was performed.

Persistent connection metadata, saved autoConnect consent, voice enabled/autoRead/volume choices, ICL transcript, reference bindings, models, runtime receipts and runtime-term acceptance retain their existing schemas and storage paths. No new profile migration or credential copy is needed. The runtime catalog and terms pins are unchanged, allowing existing managed assets and valid terms receipts to be reused. An explicitly configured DAEMONLET_3060_DATA_HOME remains authoritative and must be supplied as before.

Dots mute is session-only in both versions: each newly started bridge begins muted. This is distinct from saved voice enabled/volume choices. Updating does not introduce a new mute reset rule or automatically unmute the application. Closing the app preserves saved autoConnect; explicitly selecting Disconnect intentionally disables autoConnect under the existing behavior.

## Installer behavior

The assisted, current-user NSIS installer keeps allowElevation:false, runAfterFinish:false and deleteAppDataOnUninstall:false. The unchanged previous-version removal path passes --updated and only replaces the installation directory. The custom uninstall macro removes the installation marker, not the profile or Windows credential. A running or locked application causes the installer to wait and then stop with an error; it does not kill the app or unrelated processes. The owner should retain the existing destination when later installing the update.

This is a full offline installer, not a delta package. Build inputs reuse existing verified runtime archives, the cached Electron distribution and cached NSIS tools. Existing managed model/runtime data lives outside the application installation and is not a payload to be reset. Files manually placed inside the program installation directory are outside this preservation guarantee. An explicit external --delete-app-data uninstall request is also outside the ordinary update flow.

## Same tunnel and plugin

Key re-entry, new tunnel creation and plugin recreation are not part of this update. On a later user-authorized application start, saved autoConnect uses the same connection and credential target. If autoConnect was off, use the existing Connect action; this starts the saved connection without entering a key again. Remote key expiry/revocation, OS credential-access failures or workspace-policy changes remain independent of installer identity and cannot be ruled out without a live connection test.

The MCP adapter advertises version 1.1.0 with present, cancel and status. Its present tool adds speechText and speechMode. After installing and starting the updated app through the existing connection:

1. Open the existing connection at [ChatGPT Plugins](https://chatgpt.com/plugins).
2. Select Refresh and review the updated tool metadata; keep the same tunnel and connection.
3. Confirm present exposes speechText and speechMode and that status is listed.
4. Start a new conversation and test the updated tools. Locally unmute if voice is wanted.

This is the official [developer-mode metadata refresh workflow](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata), checked 2026-10-04. Published plugins instead use continuous review. Any UI approval associated with newly discovered tools is separate from Daemonlet's runtime key and was not changed during this build. The app's own Refresh button only rechecks connection health; it does not refresh the ChatGPT tool schema. [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) explains the existing tunnel/client association.

## Verification boundaries

Regression fixtures use synthetic profiles, reference placeholders and mocked credentials. They verify that enabled and disabled voice choices, autoConnect on/off, consent, ICL wording, bindings, volume, seed settings, model/runtime placeholders and a valid terms receipt survive initialization without rewriting or reacceptance. Static checks cover identity/GUID stability, user-data preservation and the no-force-close guard. Actual account credentials and personal profiles are neither copied into fixtures nor exercised.

Native installation and a live post-update connection remain untested: this task creates and audits the installer only. An unsigned package remains unsigned unless an owner-provided signing workflow is separately configured. It is not claimed that static checks replace an installation test.
