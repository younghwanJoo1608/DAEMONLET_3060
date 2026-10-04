// Fork identity: installation, runtime storage and release metadata must agree.
export const APP_NAME = "Daemonlet 3060"
export const BUNDLE_ID = "io.github.younghwanjoo1608.daemonlet3060"
export const PROTOCOL_PORT = 4674
export const HOOK_PORT = 4675
export const UPDATES_ENABLED = false
/** @type {{ provider: "github", owner: string, repo: string, private: boolean }} */
export const UPDATE_REPOSITORY = { provider: "github", owner: "younghwanJoo1608", repo: "DAEMONLET_3060", private: false }
export const UPDATE_CACHE_NAME = "daemonlet-3060-updater"
export const UPDATE_CONFIG = { ...UPDATE_REPOSITORY, updaterCacheDirName: UPDATE_CACHE_NAME }
export const RELEASE_ROOT = `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases`

// Applied to application messages before interpolation, never to user content.
/** @param {string} text */
export function brandText(text) {
  return text.replaceAll("Daemonlet for Codex", APP_NAME).replace(/\bDaemonlet\b(?! 3060)/g, APP_NAME)
}
