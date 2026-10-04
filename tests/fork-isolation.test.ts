import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { APP_NAME, BUNDLE_ID, UPDATE_CONFIG, UPDATES_ENABLED } from "../electron/shared/app-identity.mjs"
import { createTranslator } from "../electron/shared/translations"
import { HOOK_ARGUMENT, windowsElectronPath, type HookLaunchSpec } from "../adapter/codex/hooks/HookLaunchSpec"
import { dotBridgeConfig } from "../electron/main/dot/DotBridgeServer"

const source = (name: string) => readFileSync(new URL("../" + name, import.meta.url), "utf8")

it("keeps native credential targets and Hook executable aligned with the fork identity", () => {
  // Read compile-time declarations only: never call the real OS credential store.
  const windows = source("electron/native/windows/belle-credential.c")
  expect(windows).toContain(`L"${BUNDLE_ID}.belle-connection.runtime-v1"`)
  expect(windows).toContain(`L"${BUNDLE_ID}.belle-connection.qa-v1"`)
  const mac = source("electron/native/BelleCredential.swift")
  expect(mac).toContain(`"${BUNDLE_ID}.belle-connection"`)
  expect(windows + mac).not.toContain("io.github.ddol2ya.daemonlet")
  const host = source("electron/native/windows/hook-host.c")
  expect(host).toContain(`L"${HOOK_ARGUMENT}"`)
  expect(host).toContain(`L"\\\\${APP_NAME}.exe"`)
  expect(windowsElectronPath({ executablePath: "C:\\Fork\\resources\\codex\\hook-host.exe" } as HookLaunchSpec)).toBe(`C:\\Fork\\${APP_NAME}.exe`)
})

it("does not attach to upstream Dots environment and never uses its updater identity", () => {
  expect(dotBridgeConfig({ DAEMONLET_DOT_BRIDGE: "1", DAEMONLET_DOT_PORT: "39471", DAEMONLET_DOT_TOKEN: "a".repeat(32) })).toBeNull()
  expect(UPDATES_ENABLED).toBe(false)
  expect(UPDATE_CONFIG).toMatchObject({ owner: "younghwanJoo1608", repo: "DAEMONLET_3060", updaterCacheDirName: "daemonlet-3060-updater" })
  const pkg = JSON.parse(source("package.json")), lock = JSON.parse(source("package-lock.json"))
  expect(pkg.name).toBe("daemonlet-3060"); expect(pkg.productName).toBe(APP_NAME)
  expect(lock.name).toBe(pkg.name); expect(lock.packages[""].name).toBe(pkg.name)
})

it("brands app text without rewriting interpolated user names or paths", () => {
  const t = createTranslator("ko"), userValue = "Daemonlet for Codex / Daemonlet / user's title"
  expect(t("Daemonlet 설정")).toBe("Daemonlet 3060 설정")
  expect(t("Daemonlet 3060 설정")).toBe("Daemonlet 3060 설정")
  expect(t`Daemonlet 설정: ${userValue}`).toBe(`Daemonlet 3060 설정: ${userValue}`)
  expect(createTranslator("en")("Daemonlet 설정")).toContain(APP_NAME)
})
