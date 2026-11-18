"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { serverClient } from "../lib/supabase";
import { session } from "../lib/auth";

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
});
export async function authenticate(_previous: string, form: FormData) {
  const values = credentials.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!values.success) return "이메일 주소와 8자 이상의 비밀번호를 입력하세요.";
  const db = await serverClient();
  if (!db) return "Supabase 연결을 설정하세요.";
  if (form.get("intent") === "register") {
    const origin =
      process.env.FINANCEFLOW_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
        : await headers().then(
            (h) => h.get("origin") ?? "http://localhost:3000",
          ));
    const { data, error } = await db.auth.signUp({
      ...values.data,
      options: { emailRedirectTo: new URL("/auth/confirm", origin).href },
    });
    if (error)
      return "가입 요청에 실패했습니다. 이메일 주소, 비밀번호 또는 메일 전송 제한을 확인하세요.";
    if (!data.session)
      return "확인 메일을 보냈습니다. 링크를 열어 가입을 완료하세요.";
  } else {
    const { error } = await db.auth.signInWithPassword(values.data);
    if (error)
      return "로그인에 실패했습니다. 인증된 이메일과 비밀번호를 확인하세요.";
  }
  redirect("/");
}

export async function logout() {
  const db = await serverClient();
  await db?.auth.signOut();
  redirect("/");
}

export async function createOrganization(_previous: string, form: FormData) {
  const current = await session();
  if (!current) return "로그인이 필요합니다.";
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 100) return "조직 이름을 입력하세요.";
  const { error } = await current.db.rpc("bootstrap_org", { p_name: name });
  if (error) return error.message;
  redirect("/");
}
