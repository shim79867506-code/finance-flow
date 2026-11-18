//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

const productionURL = "https://financeflow-five-zeta.vercel.app/"

func main() {
	for _, variable := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		base := os.Getenv(variable)
		if !filepath.IsAbs(base) {
			continue
		}
		edge := filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe")
		info, err := os.Stat(edge)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		cmd := exec.Command(edge, "--app="+productionURL)
		if err := cmd.Start(); err == nil {
			_ = cmd.Process.Release()
			return
		}
	}
	if !openInDefaultBrowser() {
		showOpenError()
	}
}

func openInDefaultBrowser() bool {
	shellExecute := syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")
	action, _ := syscall.UTF16PtrFromString("open")
	target, _ := syscall.UTF16PtrFromString(productionURL)
	result, _, _ := shellExecute.Call(0, uintptr(unsafe.Pointer(action)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
	return result > 32
}

func showOpenError() {
	messageBox := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	message, _ := syscall.UTF16PtrFromString("FinanceFlow를 열 수 없습니다. Edge 또는 기본 웹 브라우저 설정을 확인하세요.\n\n" + productionURL)
	title, _ := syscall.UTF16PtrFromString("FinanceFlow")
	messageBox.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
}
