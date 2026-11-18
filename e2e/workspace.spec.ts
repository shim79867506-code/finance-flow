import { test, expect } from "@playwright/test";

const csv =
  "회계일자,전표번호,계정코드,차변,대변,프로젝트코드,사업부,적요\n2026-01-15,E2E-01,101,12345,0,COMMON,E2E,검증 수납\n2026-01-15,E2E-01,401,0,12345,COMMON,E2E,검증 매출\n";
test("업로드 → 전표 조회 → 집계 → 다운로드", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "재무 대시보드" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ERP 업로드" }).click();
  const input = page.getByLabel("전표 파일");
  await input.setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv.replace("0,12345", "0,12000")),
  });
  await page.getByRole("button", { name: "데이터 검증" }).click();
  await expect(page.getByText(/차대변 불일치/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "승인 및 저장" }),
  ).toBeDisabled();
  await input.setInputFiles({
    name: "e2e.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "데이터 검증" }).click();
  await page.getByRole("button", { name: "승인 및 저장" }).click();
  await expect(page.getByText(/샘플 워크스페이스에 반영/)).toBeVisible();
  await page.getByRole("link", { name: "전표 관리" }).click();
  await page.getByLabel("회계연도").selectOption("2026");
  await page.getByLabel("전표 검색").fill("E2E-01");
  await expect(page.getByText(/2개 분개/)).toBeVisible();
  await page.getByRole("button", { name: "차변 정렬" }).click();
  await page
    .getByRole("button", { name: "E2E-01", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog").getByText("검증 매출")).toBeVisible();
  await page.getByRole("button", { name: "검토 완료로 표시" }).click();
  await page.getByRole("button", { name: "전표 상세 닫기" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  expect((await download).suggestedFilename()).toContain(".xlsx");
  await page.getByRole("link", { name: "사업별 손익" }).click();
  await page.getByRole("button", { name: "사업부별", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E" })).toContainText(
    "12,345",
  );
  await page.getByRole("link", { name: "대시보드" }).click();
  await page.getByLabel("사업부", { exact: true }).selectOption("E2E");
  await expect(
    page.getByText("₩12,345", { exact: true }).first(),
  ).toBeVisible();
});

test("모바일 메뉴와 전표 페이지네이션", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("link", { name: "전표 관리" }).click();
  await expect(page.getByRole("heading", { name: "전표 목록" })).toBeVisible();
  const before = await page
    .locator("main .panel > .table-scroll tbody")
    .innerText();
  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(
    page.locator("main .panel > .table-scroll tbody"),
  ).not.toHaveText(before);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
