import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import electron from "electron";
const requestId = randomUUID();
const root = resolve(import.meta.dirname, "..");
const base =
  process.platform === "darwin"
    ? join(homedir(), "Library/Application Support")
    : process.platform === "win32"
      ? process.env.APPDATA
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const dirs = process.env.STUDIO_DATA_DIR
  ? [resolve(process.env.STUDIO_DATA_DIR)]
  : ["分发工作台", "distribution-studio"].map((n) => join(base, n));
const child = spawn(electron, [root, `--check-accounts=${requestId}`], {
  cwd: root,
  stdio: "ignore",
  env: process.env,
});
let failure;
child.on("error", () => {
  failure = "无法启动 Electron，请先 npm run build";
});
// The second instance delegates to the running app. No separate process opens its workspace or cookie store.
const started = Date.now();
while (Date.now() - started < 70000) {
  if (failure) throw Error(failure);
  for (const dir of dirs) {
    try {
      const report = JSON.parse(
        readFileSync(join(dir, "account-health-report.json"), "utf8"),
      );
      if (report.requestId !== requestId) continue;
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    } catch (error) {
      if (error?.code && !["ENOENT"].includes(error.code)) throw error;
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.error(
  "账号检测未在 70 秒内完成。请确认主客户端使用最新版；结果未知，不代表账号失效。",
);
process.exit(1);
