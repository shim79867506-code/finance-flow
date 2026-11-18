# FinanceFlow 데스크톱

Windows 10/11용 프로그램입니다. 다운로드한 PC 유형에 맞는 실행 파일을 엽니다. 로컬로 등록한 원장과 원본 Excel은 Windows 사용자별 SQLite 파일에 저장됩니다. 인터넷 연결과 웹 로그인 없이 사용할 수 있습니다.

## 사용 방법

1. **Excel 업로드 → Excel 양식 저장**으로 양식을 저장하거나 제공된 `FinanceFlow-Sample.xlsx`를 엽니다.
2. **Excel 파일 선택**으로 파일을 열고 시트를 선택합니다. **데이터 검증**으로 첫 10행과 차변·대변 합계를 확인합니다.
3. **승인 및 저장**을 누르면 분개와 원본 파일이 등록됩니다. **재무 대시보드**에서 연도·월별 집계를 확인하고 합계를 월별, 프로젝트별 또는 사업부별로 볼 수 있습니다.
4. **전표 관리**에서 검색, Excel 내보내기 및 검토 완료를 사용할 수 있습니다. **등록 이력**에서 원본 XLSX를 다시 저장할 수 있습니다.

데이터는 `%APPDATA%\FinanceFlow\Desktop\financeflow.sqlite`에 저장합니다. 데이터베이스를 복사해 보관하려면 다른 FinanceFlow 창까지 닫은 뒤 진행하세요. 기존 웹·Supabase에서 보관한 파일은 원본을 내려받아 여기서 가져올 수 있습니다. 웹 데이터의 자동 동기화는 제공하지 않습니다.

## Excel 규칙

- XLSX 형식으로 첫 행에 제목을 둡니다. 파일 크기는 최대 4MB, 시트당 데이터는 최대 5,000행입니다.
- 필수 열은 회계일자, 전표번호, 계정코드, 차변, 대변, 프로젝트코드입니다. 사업부, 적요, 거래처는 선택입니다. 프로젝트가 없다면 `COMMON`과 같이 공통 코드를 입력합니다.
- 회계일자는 Excel 날짜 또는 YYYY-MM-DD를 사용합니다. 계정코드와 프로젝트코드에 선행 0이 있으면 Excel에서 텍스트로 저장합니다.
- 전표별 차변·대변이 일치해야 하고, 각 행에는 한쪽 금액만 입력합니다. 일자와 전표번호가 같은 분개는 같은 시트에 포함합니다. 알 수 없는 계정은 **계정과목 설정**에서 등록한 뒤 검증합니다.
- 매출·비용은 선택 기간 순액이며 자산·부채·자본 카드는 해당 기간 말까지 적재한 계정 잔액입니다. 전기 이월은 기초 전표를 함께 가져와야 합니다.

## 빌드

Go 1.27.4와 `github.com/akavel/rsrc`가 필요합니다. 아래 명령은 빌드 호스트의 POSIX 셸에서 실행합니다.

```sh
go test ./...
rsrc -arch amd64 -manifest FinanceFlow.manifest -o rsrc_windows_amd64.syso
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -H=windowsgui' -o FinanceFlow-Desktop-Windows-x64.exe .
```

ARM64용은 `amd64`를 `arm64`로 바꾸고 출력 파일명을 변경합니다. 내려받은 파일의 SHA-256 해시는 `downloads/SHA256SUMS.txt`에서 확인할 수 있습니다.
