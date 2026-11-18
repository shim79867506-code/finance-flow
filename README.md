# FinanceFlow

더존 ERP 전표를 검증해 Supabase에 저장하고, 전표 조회와 재무 대시보드 및 사업부·프로젝트별 손익 분석을 제공하는 Phase 1 애플리케이션입니다.

## 실행

Node.js 24와 npm이 필요합니다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

실제 데이터는 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정하고 `supabase/migrations`의 SQL을 순서대로 적용합니다. 서비스 역할 키는 사용하지 않습니다. 브라우저 로컬 데모는 `FINANCEFLOW_DEMO=true`로 시작하며 화면에 데모 모드가 표시됩니다.

## 첫 사용

1. 이메일로 로그인합니다. 가입 메일을 사용하려면 Supabase Auth 설정에서 사이트 URL, 리디렉션 및 SMTP를 구성합니다. 초기 계정은 Supabase Dashboard의 **Authentication → Users**에서도 생성하고 확인할 수 있습니다.
2. 조직을 만들면 현재 계정이 관리자가 됩니다. 시스템 설정에서 계정코드와 프로젝트코드를 등록합니다. 초기 계정은 예제 코드를 제공하므로 ERP 매핑을 확인하세요.
3. 데이터 업로드에서 파일과 시트를 선택하고 컬럼을 매핑합니다. **데이터 검증**으로 행 오류와 차변·대변 합계를 확인한 뒤 **승인 및 저장**을 누릅니다.
4. 전표 관리에서 분개, 검토 상태, Excel 내보내기를 확인합니다. 대시보드와 손익 화면은 동일한 저장 데이터에서 집계됩니다.

조직 내 추가 사용자는 Auth에 계정을 생성한 뒤 관리자가 SQL에서 `memberships`에 사용자 UUID와 조직 UUID, 역할(`admin`, `accountant`, `auditor`)을 등록합니다. 회계 담당자는 업로드 및 검토를 할 수 있고 감사 조회자는 소속 조직 데이터를 읽을 수 있습니다. 조직을 여러 개 부여한 경우 MVP 화면은 UUID 순의 첫 조직을 선택합니다.

## ERP 입력 규칙

- XLSX(시트 선택) 또는 UTF-8/CP949 CSV를 지원합니다. 최대 4MB, 시트당 최대 5,000개 분개, 헤더는 첫 행입니다.
- 필수 열은 회계일자, 전표번호, 계정코드, 차변, 대변, 프로젝트코드입니다. 사업부, 적요, 거래처는 선택입니다. 프로젝트를 구분하지 않는 전표는 `COMMON` 등 등록된 공통 코드를 사용합니다.
- 전표의 식별자는 조직, 회계일자, 전표번호입니다. 동일 전표의 모든 분개 행은 한 파일에 포함해야 합니다. 전표별 차변과 대변 합계는 같아야 하며 각 행은 한쪽에만 양의 금액이 있어야 합니다.
- 날짜는 Excel 날짜 또는 YYYY-MM-DD/ YYYYMMDD 형태를 사용합니다. 계정코드와 프로젝트코드의 선행 0을 보존하거나 Excel의 15자리 숫자 정밀도를 넘기는 금액을 올릴 때는 해당 열을 텍스트로 저장하세요.
- 업로드 이력은 원본 및 분개와 연결됩니다. 보관된 원본은 비공개이며 인증 후에만 다운로드 URL이 발급됩니다. DB 저장 이전에 원본 저장만 성공한 경우 보존된 파일은 이력 화면과 고객 다운로드에 노출되지 않습니다.

## 집계 기준

손익은 선택 기간 전표의 매출, 매출원가, 판관비 계정의 순액입니다. 자산·부채·자본 카드는 기간 말까지 수집된 원장의 매핑 계정 잔액입니다. 이월 잔액은 기초 전표로 적재해야 합니다. 총자본 카드는 자본 분류 계정의 잔액을 보여주며 결산 전 손익의 이익잉여금 조정은 이후 재무제표 모듈 범위입니다. 전년 동기의 분모가 0일 때 증감률을 생략합니다. 금액 검증과 집계는 Decimal과 PostgreSQL NUMERIC을 사용하고, 그래프 좌표에만 JS number를 사용합니다.

MVP는 전체 원장을 페이지 단위로 읽고 앱에서 필터와 집계를 수행합니다. 대규모 조직의 성능 최적화에는 서버 집계 및 테이블 전용 페이지 API가 필요합니다.

## Vercel 배포

1. 저장소를 Vercel의 새 Next.js 프로젝트로 가져오고 Node.js 24를 선택하거나 소스 파일로 배포합니다.
2. Supabase URL과 공개 키를 배포 환경변수에 등록합니다. `FINANCEFLOW_SITE_URL`은 사용자에게 제공할 정식 HTTPS 도메인입니다. 생략하면 Vercel의 프로덕션 URL을 사용합니다.
3. Supabase Authentication의 Site URL을 프로덕션 URL로 설정하고 **Redirect URLs**에 `https://도메인/auth/confirm`을 추가합니다. 가입 메일을 운영하려면 SMTP를 설정합니다. 서버 측 OTP 확인을 사용하려면 가입 템플릿 링크를 `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`로 지정합니다.
4. 배포 후 로그아웃 상태의 접근 차단을 확인하고 테스트 조직에서 전표 업로드, 검토 및 Excel 내보내기를 확인합니다.

## 테스트

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

단위 테스트는 CSV 및 XLSX 입력, 형식 오류, 중복, 제한, 균형과 금액 정밀도를 검사합니다. 브라우저 테스트는 전표 화면, 필터, 정렬, 페이지네이션, Excel 내보내기 및 모바일 화면을 검사합니다. `tests/security.sql`은 격리 및 역할 권한, 비공개 원본 조회, 중복·잠금·실패 롤백을 검증하고 테스트 트랜잭션을 되돌립니다. Supabase SQL Editor에서 마이그레이션 소유자 권한으로 실행할 수 있습니다.

## 후속 범위

- Phase 2: 정식 재무제표·시산표·원장 보고서, 결산 및 조정분개, 상세 원가와 공통비 배부
- Phase 3: 기간비용, 감사 대응, 증빙 첨부, 정산서 비교, 결산 승인 및 이력 조회
- Phase 4: AI 분석

MVP 업로드 유형은 전표 내역입니다. 계정별 원장, 시산표, 프로젝트 원가보고서 및 재무제표 기초자료의 별도 가져오기 유형은 후속 범위입니다.

실제 Supabase를 사용한 브라우저 테스트를 실행하려면 별도 테스트 조직 관리자 계정을 준비한 뒤 `TEST_BASE_URL`, `TEST_LIVE_EMAIL`, `TEST_LIVE_PASSWORD`를 로컬 환경에서 설정하고 `npm run test:e2e -- e2e/live.spec.ts`를 실행합니다. 이 테스트는 검증용 전표와 원본 파일을 실제 프로젝트에 보관합니다.

## Windows 데스크톱 프로그램

[다운로드 및 Excel 등록 방법](desktop/offline/README.md)을 참고하세요. [Windows 실행 파일과 샘플 Excel](desktop/offline/downloads)을 제공합니다.

## 웹 실행 도구 (이전 버전)

일반 Intel/AMD PC는 [Windows x64](https://raw.githubusercontent.com/shim79867506-code/finance-flow/main/desktop/windows/downloads/FinanceFlow-Windows-x64.exe), Windows on ARM PC는 [Windows ARM64](https://raw.githubusercontent.com/shim79867506-code/finance-flow/main/desktop/windows/downloads/FinanceFlow-Windows-ARM64.exe)를 받습니다. [SHA-256 체크섬](desktop/windows/downloads/SHA256SUMS.txt)을 함께 제공합니다. 실행 파일은 코드 서명되지 않았습니다.

실행 파일은 Microsoft Edge 앱 창에서 배포된 FinanceFlow를 엽니다. Edge 앱 창을 열 수 없으면 Windows 기본 브라우저를 사용합니다. 로그인, Excel 업로드와 Supabase 동기화에는 인터넷이 필요합니다. 앱에서 **데이터 업로드 → Excel 또는 CSV 파일 선택**으로 파일을 선택하고, Excel 시트와 컬럼 매핑을 확인한 뒤 검증 및 저장합니다.

Go를 설치한 환경에서 실행 파일을 빌드하려면 프로젝트 루트에서 `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -H=windowsgui" -o FinanceFlow-Windows-x64.exe desktop/windows/main.go`를 실행합니다. ARM64용은 `GOARCH=arm64`를 사용합니다.
