# Daemonlet 3060: fork identity and packaging

This is an unofficial RTX 3060 Ti / SM86 fork of
[ddol2ya/DAEMONLET](https://github.com/ddol2ya/DAEMONLET).
Upstream copyright, MIT license, third-party notices and selected character artwork remain intact.
The upstream version remains `0.8.4`; product and release identity distinguish this fork.

| Surface | Fork identity |
| --- | --- |
| Product, EXE, shortcut, uninstall display name | `Daemonlet 3060` |
| Package | `daemonlet-3060` |
| Windows AppUserModelID / installer appId | `io.github.younghwanjoo1608.daemonlet3060` |
| Installer artifact | `Daemonlet-3060-<version>-windows-x64-Setup.exe` |
| Default Windows profile | `%APPDATA%/Daemonlet 3060` |
| Development profile / app ID | `Daemonlet 3060 Dev` / app ID + `.dev` |
| Adapter, settings, model cache, browser data | Under the fork's profile |
| Logs / crash dumps | Profile + `logs` / `crash-dumps` |
| Windows credential targets | App ID + `.belle-connection.runtime-v1` / `.qa-v1` |
| macOS credential service | App ID + `.belle-connection` |
| Hook ownership marker | `daemonlet-3060-codex-pet-adapter` |
| Standalone CLI profile | `~/.daemonlet-3060` |
| CLI Hook receipt/backup directory | Codex home + `.daemonlet-3060-hook-installer` |
| Stable protocol / Hook ports | `4674` / `4675`; macOS development `4774` / `4775` |
| Renderer development / preview port | `4673` |
| Windows desktop ports | OS-selected free loopback ports |
| External Dots bridge default | `39531`; app-owned connections use random ports |
| Updater cache | `daemonlet-3060-updater` |
| Release metadata repository | `younghwanJoo1608/DAEMONLET_3060` |

`electron/shared/app-identity.mjs` is the central identity source. Native credential
and Hook hosts have fixed compile-time counterparts covered by regression tests.
Electron selects the profile before acquiring its single-instance lock. No original
profile, model cache, API key or tunnel connection is copied or automatically migrated.
The installer retains current-user scope and does not delete app data on uninstall.
Its appId gives electron-builder a separate derived installation/uninstall identity.

Profile overrides now use `DAEMONLET_3060_DATA_HOME` and
`DAEMONLET_3060_ADAPTER_DATA_DIR`. Endpoint overrides are
`DAEMONLET_3060_PROTOCOL_PORT` and `DAEMONLET_3060_HOOK_PORT`.
Desktop startup ignores inherited original `DAEMONLET_DATA_HOME` and
`CODEX_PET_DATA_DIR`/port values. Child adapter and forwarder protocols still use
`CODEX_PET_*`, populated from the fork's resolved configuration.
External Dots opt-in variables are `DAEMONLET_3060_DOT_BRIDGE`,
`DAEMONLET_3060_DOT_PORT` and `DAEMONLET_3060_DOT_TOKEN`.

Codex home remains the user's selected Codex home. Installing a fork Hook is still
an explicit action. Original Hook entries are foreign and are preserved when the
fork plans install/uninstall changes. The short-lived `.daemonlet-hooks.lock`
transaction lock stays shared intentionally: both apps can edit the same Codex
configuration, so different transaction locks would permit conflicting writes.
This is separate from Electron's single-instance lock. The `pet://` scheme and
renderer IPC channels are internal to an app process and do not register an OS handler.

## Updates and attribution

In-app updates are disabled at the service boundary, including automatic/manual
checks, downloads, installer handoff and unsigned-update policy changes. The UI
allows opening the fork's release page. Upstream releases cannot replace the fork.
Packaging metadata points only at the fork repository; release tooling retains
`publish: never` and all artifact identity, hash, signature and runtime checks.
Re-enabling updates requires a separate reviewed change and a verified fork release.
Dormant updater unit tests explicitly enable injected test engines.

Window/tray text and settings branding display `Daemonlet 3060`. The settings header
adds a CSS/text `SM86 · unofficial` badge. Translation keys stay stable and branding
runs before interpolation, preserving user-authored names, paths and dialogue.
Original character and application icon artwork is preserved. A derived icon badge
can be produced from existing vector/code assets without ImageGen; ICO/ICNS/tray
artwork has not been replaced in this change, so tiny tray icons still look alike.

## Local packaging evidence and remaining acceptance

The unsigned Windows x64 NSIS installer was built locally from the fork, with
all six catalog-pinned voice archives, the pinned character-chat runtime and
rebuilt native helpers. Static extraction matched every one of the 254 payload
files by hash. Renderer/production Electron builds and the strict packaging
checks passed. No model weights, private profiles or credentials are committed.

The installer was not launched by the agent. The owner installed it and reported
successful voice output. This is user-reported functional acceptance, not an
automated test of every install, upgrade, uninstall or desktop interaction.
There is no published release, signing claim or automatic installed-app update.

A real Electron probe with a private `appData` root confirmed that a synthetic
upstream identity and the fork can hold separate instance locks simultaneously,
while a second fork instance is rejected. The actual original profile was not
used, no BrowserWindow was created and AppController was not started. The fork's
resolved userData, sessionData, log and crash-dump paths were checked.

Runtime archives and build receipts remain external. Reproduction requires the
exact catalog files and hashes, including the two Vulkan archives and the
character-chat runtime at `391fac16460f15233a7740550d858ac96df3419d`.
Do not weaken the six-archive, runtime-lock, license or terms checks. A future
installer must be rebuilt from its final source commit and verified separately;
source commits do not update an existing installation.

The Qwen SM86 source/catalog pins and measured isolated ICL playback evidence are
described in [the Qwen notes](voice-qwen-sm86-windows.md). This evidence does not
establish VoxCPM2 CUDA compatibility on SM86, clean-host compatibility or full
uninstall isolation. Preserve upstream attribution and private data in further QA.
