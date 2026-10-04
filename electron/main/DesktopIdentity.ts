import type { App } from "electron"
import { join, resolve } from "node:path"
import { APP_NAME, BUNDLE_ID, PROTOCOL_PORT, HOOK_PORT } from "../shared/app-identity.mjs"

/** Run before the single-instance lock and before Chromium starts.
 * Never migrate the regular app's settings, imported packs or browser storage. */
export function configureDesktopIdentity(app: Pick<App, "isPackaged" | "setName" | "getPath" | "setPath" | "setAppUserModelId">,
  environment: NodeJS.ProcessEnv = process.env, platform = process.platform): void {
  const name = app.isPackaged ? APP_NAME : `${APP_NAME} Dev`
  app.setName(name)
  const qaProfile = (typeof __APP_QA__ === "undefined" || __APP_QA__) ? environment.ELECTRON_SMOKE_USER_DATA : undefined
  const profile = environment.DAEMONLET_3060_DATA_HOME ?? qaProfile
  const userData = profile
    ? resolve(profile)
    : join(app.getPath("appData"), name)
  app.setPath("userData", userData)
  app.setPath("sessionData", userData)
  app.setPath("logs", join(userData, "logs"))
  app.setPath("crashDumps", join(userData, "crash-dumps"))
  if (platform === "win32") app.setAppUserModelId(app.isPackaged ? BUNDLE_ID : `${BUNDLE_ID}.dev`)
  // Do not inherit the original app's generic adapter/profile overrides.
  // Child adapter/forwarder contracts retain CODEX_PET_* after this boundary.
  environment.CODEX_PET_DATA_DIR = environment.DAEMONLET_3060_ADAPTER_DATA_DIR ?? join(userData, "adapter")
  for (const [key, forkKey, fallback] of [
    ["CODEX_PET_PROTOCOL_PORT", "DAEMONLET_3060_PROTOCOL_PORT", PROTOCOL_PORT],
    ["CODEX_PET_HOOK_PORT", "DAEMONLET_3060_HOOK_PORT", HOOK_PORT],
  ] as const) {
    const override = environment[forkKey]
    if (override !== undefined) environment[key] = override
    else if (platform === "win32") delete environment[key] // OS-selected free ports.
    else environment[key] = String(fallback + (app.isPackaged ? 0 : 100))
  }
}
