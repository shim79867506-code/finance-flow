import { test, expect } from "@playwright/test";

const email = process.env.TEST_LIVE_EMAIL;
const password = process.env.TEST_LIVE_PASSWORD;
const year = new Date().getUTCFullYear();
const ref = "LIVE-" + Date.now();
const text = `회계일자,전표번호,계정코드,차변,대변,프로젝트코드,사업부,적요\n${year}-01-15,${ref},101,12345.67,0,COMMON,${ref},Live debit\n${year}-01-15,${ref},401,0,12345.67,COMMON,${ref},Live credit\n`;

test.skip(
  !email || !password,
  "Requires a dedicated, confirmed Supabase test user.",
);
test("실제 Supabase 로그인, 원장 저장, 원본 다운로드 및 로그아웃", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "FinanceFlow 로그인" }),
  ).toBeVisible();
  expect((await request.post("/api/import")).status()).toBe(401);
  await page.getByLabel("이메일").fill(email!);
  await page.getByLabel("비밀번호").fill(password!);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const org = page.getByRole("heading", { name: "새 조직 만들기" });
  await expect(
    org.or(page.getByRole("heading", { name: "재무 대시보드" })),
  ).toBeVisible({ timeout: 10000 });
  if (await org.isVisible()) {
    await page.getByLabel("조직 이름").fill("FinanceFlow 검증용 조직");
    await page.getByRole("button", { name: "조직 생성" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "재무 대시보드" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ERP 업로드" }).click();
  await page
    .getByLabel("전표 파일")
    .setInputFiles({
      name: ref + ".csv",
      mimeType: "text/csv",
      buffer: Buffer.from(text),
    });
  await page.getByRole("button", { name: "데이터 검증" }).click();
  await page.getByRole("button", { name: "승인 및 저장" }).click();
  await expect(page.getByText(/원본과 전표를 저장했습니다/)).toBeVisible({
    timeout: 12000,
  });
  const original = page.getByRole("link", { name: ref + ".csv" });
  const href = await original.getAttribute("href");
  expect(href).toBeTruthy();
  const redirect = await page.request.get(href!, { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  const originalUrl = redirect.headers().location;
  expect(new URL(originalUrl).protocol).toBe("https:");
  const downloaded = await fetch(originalUrl);
  expect(downloaded.ok).toBeTruthy();
  expect(await downloaded.text()).toBe(text);
  await page.getByRole("link", { name: "전표 관리" }).click();
  await page.getByLabel("전표 검색").fill(ref);
  await expect(page.getByText(/2개 분개/)).toBeVisible();
  await page.getByRole("link", { name: "대시보드" }).click();
  await page.getByLabel("사업부", { exact: true }).selectOption(ref);
  await expect(page.getByText(/₩12,345\.67/).first()).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("heading", { name: "FinanceFlow 로그인" }),
  ).toBeVisible();
  expect((await page.request.get(href!)).status()).toBe(401);
});
