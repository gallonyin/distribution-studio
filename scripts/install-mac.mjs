import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");
const dryRun = args.has("--dry-run");
const skipBuild = args.has("--skip-build");
const allowDirty = args.has("--allow-dirty");
const launch = !args.has("--no-launch");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const appName = "分发工作台.app";
const targetDirectory = path.resolve(
  targetArg?.slice("--target=".length) ||
    process.env.STUDIO_APP_DIR ||
    path.join(os.homedir(), "Applications"),
);
const target = path.join(targetDirectory, appName);

if (help) {
  console.log(`用法：npm run install:mac -- [选项]

构建分发工作台，安全替换当前用户的 macOS 应用并重新启动。

选项：
  --skip-build       使用 release/ 中已有的打包结果
  --allow-dirty      允许安装包含未提交代码的构建
  --no-launch        安装后不启动应用
  --target=<目录>    安装目录，默认 ~/Applications
  --dry-run          只显示将执行的操作
  -h, --help         显示帮助

也可用 STUDIO_APP_DIR 设置安装目录。系统级安装示例：
  npm run install:mac -- --target=/Applications`);
  process.exit(0);
}

if (process.platform !== "darwin") {
  console.error("install:mac 只能在 macOS 上运行。");
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} 执行失败（退出码 ${result.status}）。`);
}

function packagedApp() {
  const preferred = [
    path.resolve("release/mac-arm64", appName),
    path.resolve("release/mac", appName),
    path.resolve("release/mac-x64", appName),
  ];
  return preferred.find((candidate) => fs.existsSync(candidate));
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

if (dryRun) {
  console.log(`${skipBuild ? "跳过构建" : "执行 npm run pack"}`);
  console.log(`安装到 ${target}`);
  console.log(launch ? "安装后重新启动" : "安装后不启动");
  process.exit(0);
}

try {
  if (!allowDirty) {
    const status = spawnSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    });
    if (status.status === 0 && status.stdout.trim())
      throw new Error(
        "工作区有未提交代码。请先测试并提交，或明确使用 --allow-dirty。",
      );
  }
  if (!skipBuild) run("npm", ["run", "pack"]);
  const source = packagedApp();
  if (!source)
    throw new Error("没有找到 macOS 打包结果，请先运行 npm run pack。");

  fs.mkdirSync(targetDirectory, { recursive: true });
  const staging = path.join(targetDirectory, `.${appName}.installing`);
  const backup = path.join(targetDirectory, `.${appName}.previous`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  run("/usr/bin/ditto", [source, staging]);

  // Quit only after a complete replacement bundle exists.
  spawnSync("/usr/bin/osascript", [
    "-e",
    'tell application id "local.distribution.studio" to quit',
  ]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const running = spawnSync("/usr/bin/pgrep", [
      "-f",
      `${appName}/Contents/MacOS/`,
    ]);
    if (running.status !== 0) break;
    wait(250);
  }

  if (fs.existsSync(target)) fs.renameSync(target, backup);
  try {
    fs.renameSync(staging, target);
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(target))
      fs.renameSync(backup, target);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });

  console.log(`已安装：${target}`);
  if (launch) run("/usr/bin/open", [target]);
} catch (error) {
  console.error(`安装失败：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
