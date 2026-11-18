package main

import (
	"math/big"
	"path/filepath"
	"strings"
	"testing"
)

func TestExcelImportPersistsAndRejectsDuplicate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.sqlite")
	db, err := database(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	xlsx := filepath.Join(t.TempDir(), "template.xlsx")
	if err := writeTemplate(xlsx); err != nil {
		t.Fatal(err)
	}
	workbook, err := openWorkbook(xlsx)
	if err != nil {
		t.Fatal(err)
	}
	defer workbook.file.Close()
	accounts, err := loadAccounts(db)
	if err != nil {
		t.Fatal(err)
	}
	sheet := workbook.file.GetSheetName(0)
	lines, issues, err := workbook.read(sheet, accounts)
	if err != nil || len(issues) != 0 || len(lines) != 2 {
		t.Fatalf("parse: lines=%d issues=%v error=%v", len(lines), issues, err)
	}
	if err := saveWorkbook(db, workbook, sheet, lines); err != nil {
		t.Fatal(err)
	}
	if err := saveWorkbook(db, workbook, sheet, lines); err == nil || !strings.Contains(err.Error(), "같은 파일") {
		t.Fatalf("expected blocked replay, got %v", err)
	}
	changed := &book{name: "duplicate.xlsx", raw: []byte("another workbook")}
	if err := saveWorkbook(db, changed, sheet, append([]journalLine{
		{Date: "2026-01-16", Number: "NEW", Code: "101", Debit: 100, Project: "P"},
	}, lines...)); err == nil || !strings.Contains(err.Error(), "이미 등록된 전표") {
		t.Fatalf("expected blocked voucher duplicate, got %v", err)
	}
	db.Close()
	reopened, err := database(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var linesCount, entriesCount, batchesCount int
	var net int64
	if err := reopened.QueryRow(`SELECT (SELECT count(*) FROM lines),(SELECT count(*) FROM entries),(SELECT count(*) FROM imports),(SELECT sum(debit-credit) FROM lines)`).Scan(&linesCount, &entriesCount, &batchesCount, &net); err != nil {
		t.Fatal(err)
	}
	if linesCount != 2 || entriesCount != 1 || batchesCount != 1 || net != 0 {
		t.Fatalf("persisted rows, entries, batches, net: %d %d %d %d", linesCount, entriesCount, batchesCount, net)
	}
}

func TestValidationReportsBadRowsAndUnbalancedEntry(t *testing.T) {
	xlsx := filepath.Join(t.TempDir(), "test.xlsx")
	if err := writeTemplate(xlsx); err != nil {
		t.Fatal(err)
	}
	workbook, err := openWorkbook(xlsx)
	if err != nil {
		t.Fatal(err)
	}
	defer workbook.file.Close()
	sheet := workbook.file.GetSheetName(0)
	if err := workbook.file.SetCellStr(sheet, "E3", "9000"); err != nil {
		t.Fatal(err)
	}
	accounts := map[string]account{"101": {Code: "101"}, "401": {Code: "401"}}
	_, issues, err := workbook.read(sheet, accounts)
	if err != nil || len(issues) != 1 || !strings.Contains(issues[0], "차대변 불일치") {
		t.Fatalf("%v, %v", issues, err)
	}
	if err := workbook.file.SetCellStr(sheet, "A2", "2026-02-30"); err != nil {
		t.Fatal(err)
	}
	if err := workbook.file.SetCellStr(sheet, "C3", "999"); err != nil {
		t.Fatal(err)
	}
	_, issues, err = workbook.read(sheet, accounts)
	if err != nil || len(issues) != 2 || !strings.Contains(issues[0], "회계일자") || !strings.Contains(issues[1], "미등록") {
		t.Fatalf("%v, %v", issues, err)
	}
}

func TestCurrencyAndExcelDates(t *testing.T) {
	n, err := parseAmount("12,345.67")
	if err != nil || n != 1234567 || currency(big.NewInt(-n)) != "-12,345.67" {
		t.Fatalf("%d, %v", n, err)
	}
	if _, err := parseAmount("12,34.678"); err == nil {
		t.Fatal("invalid amount accepted")
	}
	date, err := parseDate("46037", false)
	if err != nil || date != "2026-01-15" {
		t.Fatalf("%q, %v", date, err)
	}
}

func TestDistributedSample(t *testing.T) {
	db, err := database(filepath.Join(t.TempDir(), "sample.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	accounts, err := loadAccounts(db)
	if err != nil {
		t.Fatal(err)
	}
	input, err := openWorkbook(filepath.Join("downloads", "FinanceFlow-Sample.xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	defer input.file.Close()
	sheet := input.file.GetSheetName(0)
	lines, issues, err := input.read(sheet, accounts)
	if err != nil || len(issues) != 0 || len(lines) != 534 {
		t.Fatalf("sample lines=%d issues=%v error=%v", len(lines), issues, err)
	}
	if err := saveWorkbook(db, input, sheet, lines); err != nil {
		t.Fatal(err)
	}
	var revenue int64
	if err := db.QueryRow("SELECT sum(credit-debit) FROM lines WHERE account='401' AND day LIKE '2026-%'").Scan(&revenue); err != nil {
		t.Fatal(err)
	}
	if revenue != 571961600000 {
		t.Fatalf("unexpected revenue in cents: %d", revenue)
	}
}
