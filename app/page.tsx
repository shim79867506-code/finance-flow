import { Access } from "../components/access";
import { Dashboard } from "../components/dashboard";
import { catalog, membership, readLedger } from "../lib/data";
import { session } from "../lib/auth";
import { demoAccounts, demoProjects, sampleLedger } from "../lib/demo";

export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string }>;
}) {
  const now = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  });
  const year = Number(now.slice(0, 4));
  if (process.env.FINANCEFLOW_DEMO === "true") {
    return (
      <Dashboard
        demo
        year={year}
        initial={{
          org: "demo",
          name: "샘플 워크스페이스",
          role: "admin",
          email: "데모 사용자",
          ledger: sampleLedger(year),
          accounts: demoAccounts,
          projects: demoProjects,
          batches: [],
        }}
      />
    );
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    return <Access missing />;
  const current = await session();
  if (!current)
    return <Access authError={Boolean((await searchParams).authError)} />;
  const member = await membership(current.db, current.user.id);
  if (!member) return <Access setup />;
  const org = member.org_id;
  const [meta, info, ledger, batches] = await Promise.all([
    current.db.from("organizations").select("name").eq("id", org).single(),
    catalog(current.db, org),
    readLedger(current.db, org),
    current.db
      .from("upload_batches")
      .select("id,original_name,row_count,created_at")
      .eq("org_id", org)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (meta.error || batches.error)
    throw new Error("워크스페이스 조회에 실패했습니다.");
  return (
    <Dashboard
      year={year}
      initial={{
        org,
        name: meta.data.name,
        role: member.role,
        email: current.user.email ?? "",
        ledger,
        batches: batches.data,
        ...info,
      }}
    />
  );
}
