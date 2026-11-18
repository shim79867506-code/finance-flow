"use client";
import { useActionState } from "react";
import { ArrowRight, BarChart3, ShieldCheck } from "lucide-react";
import { authenticate, createOrganization } from "../app/actions";
import { Button } from "./ui";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <BarChart3 size={20} />
      </span>
      <span>
        Finance<span>Flow</span>
        <small>FINANCE WORKSPACE</small>
      </span>
    </div>
  );
}

export function Access({
  setup = false,
  missing = false,
  authError = false,
}: {
  setup?: boolean;
  missing?: boolean;
  authError?: boolean;
}) {
  const [message, action, pending] = useActionState(
    setup ? createOrganization : authenticate,
    "",
  );
  return (
    <div className="access">
      <div className="access-brand">
        <Brand />
        <div>
          <ShieldCheck size={32} />
          <h1>기업 재무를 한곳에서</h1>
          <p>ERP 전표 검증부터 사업별 수익성 분석까지</p>
        </div>
      </div>
      <main className="access-card">
        <h2>
          {missing
            ? "Supabase 연결 설정"
            : setup
              ? "새 조직 만들기"
              : "FinanceFlow 로그인"}
        </h2>
        {missing ? (
          <p>
            서버에 Supabase URL과 공개 키를 설정하세요. 샘플 데이터로 실행하려면
            FINANCEFLOW_DEMO를 true로 설정하세요.
          </p>
        ) : (
          <form action={action}>
            {setup ? (
              <>
                <p>조직을 만들면 현재 계정이 관리자가 됩니다.</p>
                <label>
                  조직 이름
                  <input
                    name="name"
                    required
                    maxLength={100}
                    autoComplete="organization"
                  />
                </label>
              </>
            ) : (
              <>
                <p>이메일로 재무 워크스페이스에 접속하세요.</p>
                <label>
                  이메일
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@company.com"
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    minLength={8}
                    required
                  />
                </label>
              </>
            )}
            {(message || authError) && (
              <div className="notice" role="status">
                {message || "가입 확인 링크가 만료되었거나 올바르지 않습니다."}
              </div>
            )}
            <Button
              variant="primary"
              disabled={pending}
              name="intent"
              value="login"
            >
              {pending ? "처리 중…" : setup ? "조직 생성" : "로그인"}
              <ArrowRight size={16} />
            </Button>
            {!setup && (
              <Button disabled={pending} name="intent" value="register">
                계정 만들기
              </Button>
            )}
          </form>
        )}
      </main>
    </div>
  );
}
