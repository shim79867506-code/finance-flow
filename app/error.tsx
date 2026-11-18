"use client";
import { Button } from "../components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>워크스페이스를 불러오지 못했습니다.</h1>
      <p>연결 상태를 확인하고 다시 시도하세요.</p>
      <Button onClick={reset}>다시 시도</Button>
    </main>
  );
}
