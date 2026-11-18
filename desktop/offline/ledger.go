package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	_ "modernc.org/sqlite"
)

const maxFileSize = 4 * 1024 * 1024
const maxRows = 5000

var headings = []string{"회계일자", "전표번호", "계정코드", "차변", "대변", "프로젝트코드", "사업부", "적요", "거래처"}
var names = [][]string{
	{"회계일자", "전표일자", "일자", "거래일자", "date"},
	{"전표번호", "전표No", "전표", "entry_no"},
	{"계정코드", "계정과목코드", "계정CD", "account_code"},
	{"차변", "차변금액", "debit"},
	{"대변", "대변금액", "credit"},
	{"프로젝트코드", "프로젝트", "PJT코드", "현장코드", "project_code"},
	{"사업부", "사업부명", "부서", "부서명", "division"},
	{"적요", "적요명", "내용", "memo"},
	{"거래처", "거래처명", "vendor"},
}
var kinds = []string{"자산", "부채", "자본", "매출", "매출원가", "판매비와관리비", "기타"}

type account struct {
	Code, Name string
	Kind       int
}
type journalLine struct {
	Date, Number, Code, Project, Division, Memo, Vendor string
	Debit, Credit                                       int64
	Row                                                 int
}
type book struct {
	file *excelize.File
	name string
	raw  []byte
}

func openWorkbook(path string) (*book, error) {
	if !strings.EqualFold(filepath.Ext(path), ".xlsx") {
		return nil, errors.New("Excel .xlsx 파일을 선택하세요.")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() == 0 || info.Size() > maxFileSize {
		return nil, errors.New("파일은 비어 있지 않은 4MB 이하의 XLSX여야 합니다.")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw) > maxFileSize {
		return nil, errors.New("파일 크기 제한을 초과했습니다.")
	}
	file, err := excelize.OpenReader(bytes.NewReader(raw), excelize.Options{UnzipSizeLimit: 48 * 1024 * 1024, UnzipXMLSizeLimit: 16 * 1024 * 1024})
	if err != nil {
		return nil, err
	}
	if len(file.GetSheetList()) == 0 {
		file.Close()
		return nil, errors.New("읽을 수 있는 시트가 없습니다.")
	}
	return &book{file: file, name: filepath.Base(path), raw: raw}, nil
}

func normalize(text string) string {
	return strings.NewReplacer(" ", "", "_", "", "-", "", "(", "", ")", "").Replace(strings.ToLower(strings.TrimSpace(text)))
}

func (b *book) read(sheet string, accounts map[string]account) ([]journalLine, []string, error) {
	props, err := b.file.GetWorkbookProps()
	if err != nil {
		return nil, nil, err
	}
	date1904 := props.Date1904 != nil && *props.Date1904
	rows, err := b.file.Rows(sheet)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil, errors.New("시트가 비어 있습니다.")
	}
	header, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	var mapping []int
	for i, aliases := range names {
		found := -1
		for j, title := range header {
			for _, alias := range aliases {
				if normalize(title) == normalize(alias) {
					if found != -1 && found != j {
						return nil, nil, fmt.Errorf("첫 행에 %s 열이 두 번 있습니다.", headings[i])
					}
					found = j
				}
			}
		}
		if found < 0 && i < 6 {
			return nil, nil, fmt.Errorf("필수 열을 찾지 못했습니다: %s", headings[i])
		}
		mapping = append(mapping, found)
	}
	var lines []journalLine
	var problems []string
	nets := map[string]*big.Int{}
	entryRows := map[string]int{}
	for row := 2; rows.Next(); row++ {
		if row > maxRows+1 {
			return nil, nil, fmt.Errorf("시트 데이터는 %d행까지 처리할 수 있습니다.", maxRows)
		}
		cells, err := rows.Columns(excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, nil, err
		}
		nonempty := false
		for _, v := range cells {
			if strings.TrimSpace(v) != "" {
				nonempty = true
				break
			}
		}
		if !nonempty {
			continue
		}
		values := make([]string, len(mapping))
		for i, j := range mapping {
			if j >= 0 && j < len(cells) {
				values[i] = strings.TrimSpace(cells[j])
			}
		}
		date, dateErr := parseDate(values[0], date1904)
		debit, debitErr := parseAmount(values[3])
		credit, creditErr := parseAmount(values[4])
		var issues []string
		if dateErr != nil {
			issues = append(issues, "회계일자 형식 오류")
		}
		if values[1] == "" {
			issues = append(issues, "전표번호 누락")
		}
		if _, ok := accounts[values[2]]; !ok {
			issues = append(issues, "미등록 계정코드 "+values[2])
		}
		if values[5] == "" {
			issues = append(issues, "프로젝트코드 누락")
		}
		if debitErr != nil || creditErr != nil {
			issues = append(issues, "금액 형식 또는 범위 오류")
		} else if (debit == 0) == (credit == 0) {
			issues = append(issues, "차변과 대변 중 한쪽에만 금액을 입력하세요.")
		}
		if len(issues) > 0 {
			problems = append(problems, fmt.Sprintf("%d행: %s", row, strings.Join(issues, ", ")))
			continue
		}
		line := journalLine{Date: date, Number: values[1], Code: values[2], Debit: debit, Credit: credit, Project: values[5], Division: values[6], Memo: values[7], Vendor: values[8], Row: row}
		key := line.Date + "\x00" + line.Number
		if nets[key] == nil {
			nets[key] = new(big.Int)
			entryRows[key] = row
		}
		nets[key].Add(nets[key], big.NewInt(debit-credit))
		lines = append(lines, line)
	}
	if err := rows.Error(); err != nil {
		return nil, nil, err
	}
	for key, net := range nets {
		if net.Sign() != 0 {
			problems = append(problems, fmt.Sprintf("%d행 전표 차대변 불일치: %s", entryRows[key], strings.ReplaceAll(key, "\x00", " ")))
		}
	}
	if len(lines) == 0 && len(problems) == 0 {
		problems = append(problems, "전표 데이터가 없습니다.")
	}
	return lines, problems, nil
}

var amountPattern = regexp.MustCompile(`^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$`)

func parseAmount(input string) (int64, error) {
	if input == "" {
		return 0, nil
	}
	if !amountPattern.MatchString(input) {
		return 0, errors.New("invalid amount")
	}
	parts := strings.SplitN(strings.ReplaceAll(input, ",", ""), ".", 2)
	cents := "00"
	if len(parts) == 2 {
		cents = (parts[1] + "0")[:2]
	}
	n, err := strconv.ParseInt(parts[0]+cents, 10, 64)
	if err != nil || n > 999_999_999_999_999 {
		return 0, errors.New("amount exceeds limit")
	}
	return n, nil
}

func parseDate(input string, date1904 bool) (string, error) {
	for _, layout := range []string{"2006-01-02", "20060102", "2006/1/2", "2006.1.2", "2006-1-2"} {
		if date, err := time.Parse(layout, input); err == nil && date.Year() >= 1900 {
			return date.Format("2006-01-02"), nil
		}
	}
	if serial, err := strconv.ParseUint(input, 10, 32); err == nil && serial > 0 && serial <= 2957003 && !(serial == 60 && !date1904) {
		date, err := excelize.ExcelDateToTime(float64(serial), date1904)
		if err == nil && date.Year() >= 1900 && date.Year() <= 9999 {
			return date.Format("2006-01-02"), nil
		}
	}
	return "", errors.New("invalid date")
}

func currency(cents *big.Int) string {
	s := new(big.Int).Abs(cents).String()
	s = strings.Repeat("0", max(0, 3-len(s))) + s
	whole, decimal := s[:len(s)-2], s[len(s)-2:]
	var result strings.Builder
	if cents.Sign() < 0 {
		result.WriteByte('-')
	}
	for i, c := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			result.WriteByte(',')
		}
		result.WriteRune(c)
	}
	if decimal != "00" {
		result.WriteByte('.')
		result.WriteString(decimal)
	}
	return result.String()
}

func database(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS accounts (code TEXT PRIMARY KEY, name TEXT NOT NULL, kind INTEGER NOT NULL CHECK(kind BETWEEN 0 AND 6));
INSERT OR IGNORE INTO accounts VALUES ('101','현금 및 현금성자산',0),('201','미지급금',1),('301','자본금',2),('401','매출액',3),('501','매출원가',4),('601','판매비와관리비',5);
CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, sha TEXT NOT NULL, sheet TEXT NOT NULL, name TEXT NOT NULL, original BLOB NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(sha,sheet));
CREATE TABLE IF NOT EXISTS entries (day TEXT NOT NULL, number TEXT NOT NULL, batch INTEGER NOT NULL REFERENCES imports, reviewed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,number));
CREATE TABLE IF NOT EXISTS lines (id INTEGER PRIMARY KEY, day TEXT NOT NULL, number TEXT NOT NULL, account TEXT NOT NULL REFERENCES accounts, debit INTEGER NOT NULL, credit INTEGER NOT NULL, project TEXT NOT NULL, division TEXT NOT NULL, memo TEXT NOT NULL, vendor TEXT NOT NULL, FOREIGN KEY(day,number) REFERENCES entries(day,number));
CREATE INDEX IF NOT EXISTS lines_entry ON lines(day,number);
`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func loadAccounts(db *sql.DB) (map[string]account, error) {
	rows, err := db.Query("SELECT code,name,kind FROM accounts")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := map[string]account{}
	for rows.Next() {
		var a account
		if err := rows.Scan(&a.Code, &a.Name, &a.Kind); err != nil {
			return nil, err
		}
		accounts[a.Code] = a
	}
	return accounts, rows.Err()
}

func saveWorkbook(db *sql.DB, b *book, sheet string, lines []journalLine) error {
	if len(lines) == 0 {
		return errors.New("저장할 전표가 없습니다.")
	}
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec("INSERT INTO imports(sha,sheet,name,original) VALUES(?,?,?,?) ON CONFLICT(sha,sheet) DO NOTHING", fmt.Sprintf("%x", sha256.Sum256(b.raw)), sheet, b.name, b.raw)
	if err != nil {
		return err
	}
	added, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if added == 0 {
		return errors.New("같은 파일과 시트가 등록되어 있습니다.")
	}
	batch, err := res.LastInsertId()
	if err != nil {
		return err
	}
	seen := map[[2]string]bool{}
	for _, line := range lines {
		key := [2]string{line.Date, line.Number}
		if !seen[key] {
			res, err := tx.Exec("INSERT INTO entries(day,number,batch) VALUES(?,?,?) ON CONFLICT(day,number) DO NOTHING", line.Date, line.Number, batch)
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if n == 0 {
				return fmt.Errorf("이미 등록된 전표: %s %s", line.Date, line.Number)
			}
			seen[key] = true
		}
		_, err := tx.Exec("INSERT INTO lines(day,number,account,debit,credit,project,division,memo,vendor) VALUES(?,?,?,?,?,?,?,?,?)", line.Date, line.Number, line.Code, line.Debit, line.Credit, line.Project, line.Division, line.Memo, line.Vendor)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func writeTemplate(path string) error {
	b := excelize.NewFile()
	defer b.Close()
	sheet := b.GetSheetName(0)
	rows := [][]string{
		headings,
		{"2026-01-15", "EXAMPLE-01", "101", "10000", "0", "COMMON", "시설운영", "샘플 입금", "샘플 거래처"},
		{"2026-01-15", "EXAMPLE-01", "401", "0", "10000", "COMMON", "시설운영", "샘플 매출", "샘플 거래처"},
	}
	for i, row := range rows {
		if err := b.SetSheetRow(sheet, fmt.Sprintf("A%d", i+1), &row); err != nil {
			return err
		}
	}
	return b.SaveAs(path)
}

func exportRows(path string, header []string, rows [][]string) error {
	b := excelize.NewFile()
	defer b.Close()
	sheet := b.GetSheetName(0)
	if err := b.SetSheetRow(sheet, "A1", &header); err != nil {
		return err
	}
	for i, row := range rows {
		if err := b.SetSheetRow(sheet, fmt.Sprintf("A%d", i+2), &row); err != nil {
			return err
		}
	}
	return b.SaveAs(path)
}
