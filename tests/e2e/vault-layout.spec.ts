import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("vault table aligns empty and filled rows without column shifts or page overflow", async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "studio-vault-layout-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("本地工作区已连接")).toBeVisible();
    await page.evaluate(async () => {
      for (const name of ["空账号", "完整账号", "长备注账号"]) {
        const s = await window.studio.command({
          type: "account.add",
          platform: "bilibili",
          name,
        });
        const id = s.accounts[s.accounts.length - 1].id;
        if (name !== "空账号")
          await window.studio.vault({
            type: "save",
            record: {
              accountId: id,
              username: "fixture@example.com",
              password: "fixture-long-secret-123456789",
              loginMethod: "密码",
              contact: "fixture@example.com",
              notes:
                name === "长备注账号" ? "多行备注\n".repeat(30) : "一行备注",
            },
          });
      }
    });
    await page.getByRole("button", { name: "账号资料表", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    const geometry = await page.locator(".vault-table").evaluate((table) => {
      const headers = [...table.querySelectorAll("th")].map((e) =>
        e.getBoundingClientRect(),
      );
      return [...table.querySelectorAll("tbody tr")].map((row) => {
        const r = row.getBoundingClientRect();
        const cells = [...row.querySelectorAll("td")];
        const centers = cells.map((cell) => {
          const content = cell.firstElementChild;
          if (content) {
            const b = content.getBoundingClientRect();
            return b.y + b.height / 2;
          }
          const range = document.createRange();
          range.selectNodeContents(cell);
          const b = range.getBoundingClientRect();
          return b.y + b.height / 2;
        });
        return {
          height: r.height,
          centerSpread: Math.max(...centers) - Math.min(...centers),
          columnErrors: cells.map((c, i) =>
            Math.abs(c.getBoundingClientRect().x - headers[i].x),
          ),
          buttons: [...row.querySelectorAll(".button-row button")].map(
            (b) => b.getBoundingClientRect().height,
          ),
        };
      });
    });
    for (const row of geometry) {
      expect(row.height).toBe(64);
      expect(row.centerSpread).toBeLessThanOrEqual(2);
      expect(Math.max(...row.columnErrors)).toBeLessThan(1);
      expect(row.buttons).toEqual([32, 32]);
    }
    const before = await page
      .locator("th")
      .evaluateAll((cells) =>
        cells.map((c) => c.getBoundingClientRect().width),
      );
    await page
      .getByRole("button", { name: "显示完整账号密码", exact: true })
      .click();
    expect(
      await page
        .locator("th")
        .evaluateAll((cells) =>
          cells.map((c) => c.getBoundingClientRect().width),
        ),
    ).toEqual(before);
    for (const width of [1080, 1480]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setSize(width, 960),
        width,
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
    await page.screenshot({
      path: path.join("test-results", "vault-table-layout.png"),
      fullPage: true,
    });
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
