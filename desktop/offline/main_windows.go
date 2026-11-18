package main

import (
	"database/sql"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"
)

type grid struct {
	walk.TableModelBase
	rows [][]string
}

func (g *grid) RowCount() int                     { return len(g.rows) }
func (g *grid) Value(row, column int) interface{} { return g.rows[row][column] }
func (g *grid) replace(rows [][]string)           { g.rows = rows; g.PublishRowsReset() }

type periodTotals [7]big.Int

func (totals *periodTotals) add(kind int, debit, credit int64) {
	value := debit - credit
	if kind == 1 || kind == 2 || kind == 3 {
		value = -value
	}
	totals[kind].Add(&totals[kind], big.NewInt(value))
}
func (totals *periodTotals) operatingProfit() *big.Int {
	result := new(big.Int).Sub(&totals[3], &totals[4])
	return result.Sub(result, &totals[5])
}

func main() {
	home, err := os.UserConfigDir()
	if err != nil {
		fatal(err)
		return
	}
	dir := filepath.Join(home, "FinanceFlow", "Desktop")
	if err := os.MkdirAll(dir, 0700); err != nil {
		fatal(err)
		return
	}
	db, err := database(filepath.Join(dir, "financeflow.sqlite"))
	if err != nil {
		fatal(err)
		return
	}
	defer db.Close()
	if err := run(db, dir); err != nil {
		fatal(err)
	}
}

func fatal(err error) { walk.MsgBox(nil, "FinanceFlow", err.Error(), walk.MsgBoxIconError) }

func run(db *sql.DB, dir string) error {
	var win *walk.MainWindow
	var year, search, code, accountName *walk.LineEdit
	var period, dimension, kind, sheetBox *walk.ComboBox
	var screen, status, importedFile *walk.Label
	var validation *walk.TextEdit
	var save *walk.PushButton
	var journalTable, historyTable *walk.TableView
	var current *book
	defer func() {
		if current != nil {
			current.file.Close()
		}
	}()
	var validated []journalLine
	var keys [][2]string
	report, journal, catalog, history := new(grid), new(grid), new(grid), new(grid)
	var imports []int64
	fail := func(err error) { walk.MsgBox(win, "FinanceFlow", err.Error(), walk.MsgBoxIconError) }
	months := []string{"연간", "1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"}
	dimensionModel := []string{"월별", "프로젝트별", "사업부별"}
	viewError := func(err error) {
		if err != nil {
			fail(err)
		}
	}

	refreshCatalog := func() error {
		accounts, err := loadAccounts(db)
		if err != nil {
			return err
		}
		rows := make([][]string, 0, len(accounts))
		for _, a := range accounts {
			rows = append(rows, []string{a.Code, a.Name, kinds[a.Kind]})
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i][0] < rows[j][0] })
		catalog.replace(rows)
		return nil
	}

	refreshHistory := func() error {
		rows, err := db.Query("SELECT id,name,sheet,created FROM imports ORDER BY id DESC")
		if err != nil {
			return err
		}
		defer rows.Close()
		var ids []int64
		var displayed [][]string
		for rows.Next() {
			var id int64
			var name, sheet, created string
			if err := rows.Scan(&id, &name, &sheet, &created); err != nil {
				return err
			}
			ids = append(ids, id)
			displayed = append(displayed, []string{name, sheet, created})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		imports = ids
		history.replace(displayed)
		return nil
	}
	saveExcelFile := func(name, title string, write func(string) error) {
		dialog := walk.FileDialog{Title: title, FilePath: name, Filter: "Excel 통합 문서 (*.xlsx)|*.xlsx"}
		ok, err := dialog.ShowSave(win)
		if err != nil {
			fail(err)
			return
		}
		if !ok {
			return
		}
		target := dialog.FilePath
		if !strings.EqualFold(filepath.Ext(target), ".xlsx") {
			target += ".xlsx"
		}
		viewError(write(target))
	}
	exportOriginal := func() {
		index := historyTable.CurrentIndex()
		if index < 0 || index >= len(imports) {
			fail(fmt.Errorf("내려받을 원본을 선택하세요."))
			return
		}
		var name string
		var original []byte
		if err := db.QueryRow("SELECT name,original FROM imports WHERE id=?", imports[index]).Scan(&name, &original); err != nil {
			fail(err)
			return
		}
		saveExcelFile(filepath.Base(name), "원본 Excel 저장", func(path string) error { return os.WriteFile(path, original, 0600) })
	}
	ledgerHeaders := []string{"회계일자", "전표번호", "계정코드", "계정과목", "차변", "대변", "프로젝트코드", "사업부", "적요", "거래처", "검토 상태"}
	exportJournal := func() {
		if len(journal.rows) == 0 {
			fail(fmt.Errorf("내보낼 전표가 없습니다."))
			return
		}
		saveExcelFile("FinanceFlow-전표.xlsx", "전표 목록 내보내기", func(path string) error { return exportRows(path, ledgerHeaders, journal.rows) })
	}

	refresh := func() error {
		selectedYear, err := strconv.Atoi(strings.TrimSpace(year.Text()))
		if err != nil || selectedYear < 1901 || selectedYear > 9999 {
			return fmt.Errorf("조회 연도는 1901~9999 사이로 입력하세요.")
		}
		month := max(0, period.CurrentIndex())
		endMonth := month
		if month == 0 {
			endMonth = 12
		}
		prevEnd := fmt.Sprintf("%04d-%02d-31", selectedYear-1, endMonth)
		end := fmt.Sprintf("%04d-%02d-31", selectedYear, endMonth)

		rows, err := db.Query(`SELECT l.day,l.number,l.account,a.name,a.kind,l.debit,l.credit,l.project,l.division,l.memo,l.vendor,e.reviewed
			FROM lines l JOIN accounts a ON l.account=a.code JOIN entries e ON (l.day,l.number)=(e.day,e.number)
			WHERE l.day<=? ORDER BY l.day DESC,l.number,l.id`, end)
		if err != nil {
			return err
		}
		defer rows.Close()
		var now, previous, balance periodTotals
		grouped := map[string]*periodTotals{}
		var ledgerRows [][]string
		var rowKeys [][2]string
		term := strings.ToLower(strings.TrimSpace(search.Text()))
		for rows.Next() {
			var l journalLine
			var name string
			var k, reviewed int
			if err := rows.Scan(&l.Date, &l.Number, &l.Code, &name, &k, &l.Debit, &l.Credit, &l.Project, &l.Division, &l.Memo, &l.Vendor, &reviewed); err != nil {
				return err
			}
			balance.add(k, l.Debit, l.Credit)
			isCurrent := l.Date[:4] == strconv.Itoa(selectedYear)
			rowMonth, _ := strconv.Atoi(l.Date[5:7])
			if month != 0 && rowMonth != month {
				continue
			}
			if !isCurrent {
				if l.Date[:4] == strconv.Itoa(selectedYear-1) && l.Date <= prevEnd {
					previous.add(k, l.Debit, l.Credit)
				}
				continue
			}
			now.add(k, l.Debit, l.Credit)
			group := l.Date[:7]
			switch dimension.CurrentIndex() {
			case 1:
				group = l.Project
			case 2:
				group = l.Division
			}
			if group == "" {
				group = "미지정"
			}
			if grouped[group] == nil {
				grouped[group] = new(periodTotals)
			}
			grouped[group].add(k, l.Debit, l.Credit)
			if !strings.Contains(strings.ToLower(strings.Join([]string{l.Number, l.Code, name, l.Project, l.Division, l.Memo, l.Vendor}, " ")), term) {
				continue
			}
			review := "미검토"
			if reviewed == 1 {
				review = "완료"
			}
			ledgerRows = append(ledgerRows, []string{l.Date, l.Number, l.Code, name, currency(big.NewInt(l.Debit)), currency(big.NewInt(l.Credit)), l.Project, l.Division, l.Memo, l.Vendor, review})
			rowKeys = append(rowKeys, [2]string{l.Date, l.Number})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		var groups []string
		for g := range grouped {
			groups = append(groups, g)
		}
		sort.Strings(groups)
		var summaries [][]string
		for _, g := range groups {
			t := grouped[g]
			summaries = append(summaries, []string{g, currency(&t[3]), currency(&t[4]), currency(&t[5]), currency(t.operatingProfit())})
		}
		keys = rowKeys
		journal.replace(ledgerRows)
		report.replace(summaries)
		_ = status.SetText(fmt.Sprintf("조회 분개 %d행", len(ledgerRows)))
		margin := "—"
		if now[3].Sign() != 0 {
			ratio := new(big.Rat).SetFrac(now.operatingProfit(), &now[3])
			margin = ratio.Mul(ratio, big.NewRat(100, 1)).FloatString(1) + "%"
		}
		_ = screen.SetText(fmt.Sprintf("매출액 %s원  |  매출원가 %s원  |  판매비와관리비 %s원\r\n영업이익 %s원  |  영업이익률 %s  |  전년 동기 매출 %s원  |  전년 동기 영업이익 %s원\r\n자산 %s원  |  부채 %s원  |  자본 계정 잔액 %s원",
			currency(&now[3]), currency(&now[4]), currency(&now[5]), currency(now.operatingProfit()), margin, currency(&previous[3]), currency(previous.operatingProfit()), currency(&balance[0]), currency(&balance[1]), currency(&balance[2])))
		return nil
	}
	clearPreview := func() {
		validated = nil
		save.SetEnabled(false)
		_ = validation.SetText("시트를 선택한 뒤 데이터 검증을 누르세요.")
	}
	openExcel := func() {
		dialog := walk.FileDialog{Title: "FinanceFlow 전표 파일 열기", Filter: "Excel 통합 문서 (*.xlsx)|*.xlsx"}
		ok, err := dialog.ShowOpen(win)
		if err != nil {
			fail(err)
			return
		}
		if !ok {
			return
		}
		next, err := openWorkbook(dialog.FilePath)
		if err != nil {
			fail(err)
			return
		}
		if current != nil {
			current.file.Close()
		}
		current = next
		_ = importedFile.SetText(current.name)
		_ = sheetBox.SetModel(current.file.GetSheetList())
		_ = sheetBox.SetCurrentIndex(0)
		clearPreview()
	}
	validate := func() {
		if current == nil || sheetBox.CurrentIndex() < 0 {
			fail(fmt.Errorf("파일과 시트를 선택하세요."))
			return
		}
		clearPreview()
		accounts, err := loadAccounts(db)
		if err != nil {
			fail(err)
			return
		}
		lines, issues, err := current.read(sheetBox.Text(), accounts)
		if err != nil {
			_ = validation.SetText(err.Error())
			return
		}
		if len(issues) > 0 {
			sort.Strings(issues)
			_ = validation.SetText(fmt.Sprintf("오류 %d건\r\n\r\n", len(issues)) + strings.Join(issues, "\r\n"))
			return
		}
		var debit, credit big.Int
		for _, l := range lines {
			debit.Add(&debit, big.NewInt(l.Debit))
			credit.Add(&credit, big.NewInt(l.Credit))
		}
		preview := []string{fmt.Sprintf("검증 완료 · %d개 분개 · 차변 %s원 · 대변 %s원", len(lines), currency(&debit), currency(&credit)), "", "미리보기 (첫 10행)"}
		for _, l := range lines[:min(10, len(lines))] {
			preview = append(preview, fmt.Sprintf("%d행  %s  %s  %s  %s  차변 %s  대변 %s", l.Row, l.Date, l.Number, l.Code, l.Project, currency(big.NewInt(l.Debit)), currency(big.NewInt(l.Credit))))
		}
		_ = validation.SetText(strings.Join(preview, "\r\n"))
		validated = lines
		save.SetEnabled(true)
	}
	onSave := func() {
		if len(validated) == 0 || current == nil {
			return
		}
		if err := saveWorkbook(db, current, sheetBox.Text(), validated); err != nil {
			fail(err)
			return
		}
		count := len(validated)
		save.SetEnabled(false)
		latest := validated[0].Date
		for _, line := range validated {
			if line.Date > latest {
				latest = line.Date
			}
		}
		validated = nil
		_ = year.SetText(latest[:4])
		_ = period.SetCurrentIndex(0)
		viewError(refresh())
		viewError(refreshHistory())
		_ = validation.SetText(fmt.Sprintf("로컬 데이터베이스에 %d개 분개와 원본 Excel을 저장했습니다.", count))
	}
	saveTemplate := func() { saveExcelFile("FinanceFlow-전표양식.xlsx", "Excel 전표 양식 저장", writeTemplate) }
	review := func() {
		index := journalTable.CurrentIndex()
		if index < 0 || index >= len(keys) {
			fail(fmt.Errorf("검토한 전표 행을 선택하세요."))
			return
		}
		key := keys[index]
		if _, err := db.Exec("UPDATE entries SET reviewed=1 WHERE day=? AND number=?", key[0], key[1]); err != nil {
			fail(err)
			return
		}
		viewError(refresh())
	}
	saveAccount := func() {
		key, name, k := strings.TrimSpace(code.Text()), strings.TrimSpace(accountName.Text()), kind.CurrentIndex()
		if key == "" || name == "" || k < 0 {
			fail(fmt.Errorf("코드와 이름, 분류를 입력하세요."))
			return
		}
		result, err := db.Exec(`INSERT INTO accounts(code,name,kind) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,kind=excluded.kind
			WHERE accounts.kind=excluded.kind OR NOT EXISTS(SELECT 1 FROM lines WHERE account=accounts.code)`, key, name, k)
		if err != nil {
			fail(err)
			return
		}
		n, err := result.RowsAffected()
		if err != nil {
			fail(err)
			return
		}
		if n == 0 {
			fail(fmt.Errorf("기존 전표에 사용된 계정 분류는 변경할 수 없습니다."))
			return
		}
		clearPreview()
		viewError(refreshCatalog())
		viewError(refresh())
	}
	columns := func(names []string, widths []int) []TableViewColumn {
		result := make([]TableViewColumn, len(names))
		for i, name := range names {
			result[i] = TableViewColumn{Title: name, Width: widths[i]}
		}
		return result
	}
	window := MainWindow{AssignTo: &win, Title: "FinanceFlow 데스크톱", Size: Size{Width: 1160, Height: 750}, MinSize: Size{Width: 850, Height: 580}, Layout: VBox{Spacing: 10}, Children: []Widget{
		Label{Text: "FinanceFlow", Font: Font{Family: "Segoe UI", PointSize: 20, Bold: true}},
		Label{Text: "로컬 재무 대시보드 · Excel 전표 등록"},
		Composite{Layout: HBox{}, Children: []Widget{
			Label{Text: "회계연도"}, LineEdit{AssignTo: &year, Text: strconv.Itoa(time.Now().Year()), MaxLength: 4, MinSize: Size{Width: 70}},
			Label{Text: "기간"}, ComboBox{AssignTo: &period, Model: months, CurrentIndex: 0},
			PushButton{Text: "조회", OnClicked: func() { viewError(refresh()) }}, HSpacer{},
		}},
		TabWidget{Pages: []TabPage{
			{Title: "재무 대시보드", Layout: VBox{}, Children: []Widget{
				Label{AssignTo: &screen, MinSize: Size{Height: 82}},
				Composite{Layout: HBox{}, Children: []Widget{
					Label{Text: "손익 집계"}, ComboBox{AssignTo: &dimension, Model: dimensionModel, CurrentIndex: 0, OnCurrentIndexChanged: func() {
						if journalTable != nil {
							viewError(refresh())
						}
					}}, HSpacer{},
				}},
				TableView{Model: report, Columns: columns([]string{"기간 / 구분", "매출액", "매출원가", "판매비와관리비", "영업이익"}, []int{250, 155, 155, 160, 155})},
			}},
			{Title: "전표 관리", Layout: VBox{}, Children: []Widget{
				Composite{Layout: HBox{}, Children: []Widget{
					Label{Text: "전표 검색"}, LineEdit{AssignTo: &search, CueBanner: "전표번호, 계정, 프로젝트, 적요"},
					PushButton{Text: "검색", OnClicked: func() { viewError(refresh()) }},
					PushButton{Text: "선택 전표 검토 완료", OnClicked: review},
					PushButton{Text: "Excel 내보내기", OnClicked: exportJournal},
				}},
				Label{AssignTo: &status},
				TableView{AssignTo: &journalTable, Model: journal, Columns: columns(ledgerHeaders, []int{100, 135, 60, 130, 95, 95, 110, 100, 155, 100, 65})},
			}},
			{Title: "Excel 업로드", Layout: VBox{}, Children: []Widget{
				Label{Text: "Excel (.xlsx) · 첫 행에 열 제목 · 최대 4MB, 5,000행"},
				Composite{Layout: HBox{}, Children: []Widget{
					PushButton{Text: "Excel 파일 선택", OnClicked: openExcel}, PushButton{Text: "Excel 양식 저장", OnClicked: saveTemplate}, Label{AssignTo: &importedFile, Text: "선택한 파일 없음"}, HSpacer{},
				}},
				Composite{Layout: HBox{}, Children: []Widget{
					Label{Text: "시트"}, ComboBox{AssignTo: &sheetBox, OnCurrentIndexChanged: func() {
						if save != nil {
							clearPreview()
						}
					}},
					PushButton{Text: "데이터 검증", OnClicked: validate},
					PushButton{AssignTo: &save, Text: "승인 및 저장", Enabled: false, OnClicked: onSave}, HSpacer{},
				}},
				TextEdit{AssignTo: &validation, ReadOnly: true, VScroll: true, Text: "Excel 파일을 선택하세요."},
			}},
			{Title: "등록 이력", Layout: VBox{}, Children: []Widget{
				Composite{Layout: HBox{}, Children: []Widget{PushButton{Text: "선택 원본 Excel 저장", OnClicked: exportOriginal}, HSpacer{}}},
				TableView{AssignTo: &historyTable, Model: history, Columns: columns([]string{"원본 파일", "시트", "등록 시각 (UTC)"}, []int{410, 190, 190})},
			}},
			{Title: "계정과목 설정", Layout: VBox{}, Children: []Widget{
				Label{Text: "ERP 파일의 계정코드를 해당 재무 분류에 연결하세요."},
				Composite{Layout: HBox{}, Children: []Widget{
					Label{Text: "코드"}, LineEdit{AssignTo: &code, MaxLength: 100},
					Label{Text: "계정명"}, LineEdit{AssignTo: &accountName, MaxLength: 150},
					ComboBox{AssignTo: &kind, Model: kinds, CurrentIndex: 0}, PushButton{Text: "계정 저장", OnClicked: saveAccount},
				}},
				TableView{Model: catalog, Columns: columns([]string{"코드", "계정명", "분류"}, []int{110, 280, 220})},
			}},
		}},
		Label{Text: "데이터 저장 위치  " + dir},
	}}
	if err := window.Create(); err != nil {
		return err
	}
	defer win.Dispose()
	if err := refreshCatalog(); err != nil {
		return err
	}
	if err := refresh(); err != nil {
		return err
	}
	if err := refreshHistory(); err != nil {
		return err
	}
	win.Run()
	return nil
}
