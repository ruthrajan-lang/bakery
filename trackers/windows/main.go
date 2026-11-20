// Focus Bakery for Windows: a tray app that tells your bakery whether you're
// focused, distracted or away. Only that one word is sent; window titles stay on this PC.
//
// The pairing code comes from (in order): a "-code XXX" argument, the file name the bakery page
// gives the download (FocusBakery-<code>.exe), or the saved config.
package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"fyne.io/systray"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const site = "https://bakery.ruththomson.workers.dev"
const version = 6   // bump with each release; the app updates itself when /bakery/winapp-version.txt is higher
const idleAfter = 120 * time.Second

var defaultList = []string{"YouTube", "Reddit", "Twitter", " / X", "Instagram", "Facebook", "TikTok", "Netflix", "Twitch", "Hulu", "Disney+", "Discord", "Steam"}

//go:embed cat.ico
var icoCat []byte

//go:embed red.ico
var icoRed []byte

//go:embed grey.ico
var icoGrey []byte

var (
	user32                 = windows.NewLazySystemDLL("user32.dll")
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	pGetForegroundWindow   = user32.NewProc("GetForegroundWindow")
	pGetWindowTextW        = user32.NewProc("GetWindowTextW")
	pGetWindowThreadProcId = user32.NewProc("GetWindowThreadProcessId")
	pGetLastInputInfo      = user32.NewProc("GetLastInputInfo")
	pMessageBoxW           = user32.NewProc("MessageBoxW")
	pGetTickCount          = kernel32.NewProc("GetTickCount")
)

type config struct {
	Code string `json:"code"`
}

func cfgPath() string {
	d, _ := os.UserConfigDir()
	return filepath.Join(d, "FocusBakery", "config.json")
}

func loadCode() string {
	// the newest intent wins: a "-code" argument, then the code in this download's file name, then the saved one
	var c, saved config
	if b, err := os.ReadFile(cfgPath()); err == nil {
		json.Unmarshal(b, &saved)
	}
	for i, a := range os.Args {
		if (a == "-code" || a == "--code") && i+1 < len(os.Args) {
			c.Code = os.Args[i+1]
		}
	}
	if c.Code == "" {
		exe, _ := os.Executable()
		if m := regexp.MustCompile(`(?i)FocusBakery[-_ ]([a-z0-9_-]{8,64})`).FindStringSubmatch(filepath.Base(exe)); m != nil {
			c.Code = m[1]
		}
	}
	if c.Code == "" {
		return saved.Code
	}
	if c.Code != saved.Code {
		os.MkdirAll(filepath.Dir(cfgPath()), 0o755)
		b, _ := json.Marshal(c)
		os.WriteFile(cfgPath(), b, 0o600)
	}
	return c.Code
}

func msgBox(text string) {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("Focus Bakery")
	pMessageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}

func openURL(u string) { exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start() }

// what's in front: process name + window title (browsers put the tab title in it)
func front() string {
	h, _, _ := pGetForegroundWindow.Call()
	if h == 0 {
		return ""
	}
	buf := make([]uint16, 512)
	pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), 512)
	var pid uint32
	pGetWindowThreadProcId.Call(h, uintptr(unsafe.Pointer(&pid)))
	name := ""
	if ph, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid); err == nil {
		b := make([]uint16, 520)
		n := uint32(len(b))
		if windows.QueryFullProcessImageName(ph, 0, &b[0], &n) == nil {
			name = strings.TrimSuffix(filepath.Base(windows.UTF16ToString(b[:n])), ".exe")
		}
		windows.CloseHandle(ph)
	}
	return name + " | " + windows.UTF16ToString(buf)
}

func idle() time.Duration {
	var lii struct{ size, time uint32 }
	lii.size = 8
	pGetLastInputInfo.Call(uintptr(unsafe.Pointer(&lii)))
	now, _, _ := pGetTickCount.Call()
	return time.Duration(uint32(now)-lii.time) * time.Millisecond
}

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

func autostart() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue("FocusBakery")
	return err == nil
}

func setAutostart(on bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	if on {
		exe, _ := os.Executable()
		k.SetStringValue("FocusBakery", `"`+exe+`"`)
	} else {
		k.DeleteValue("FocusBakery")
	}
}

var client = &http.Client{Timeout: 6 * time.Second}

type remoteCfg struct {
	Distracting []string `json:"distracting"`
	Kind        *string  `json:"kind"`
}

func fetchCfg(code string) *remoteCfg {
	r, err := client.Get(site + "/api/config/" + code)
	if err != nil {
		return nil
	}
	defer r.Body.Close()
	var c remoteCfg
	if json.NewDecoder(r.Body).Decode(&c) != nil {
		return nil
	}
	return &c
}

// Kinds of work picked next to your task on the bakery page. Apps whose name or window
// title contains one of these words count as focus; anything else (Claude included,
// unless "claude" is picked) gets a 5-minute check-in, then the oven pauses.
var workWords = map[string][]string{
	"writing":  {"winword", "microsoft word", "google docs", "google sheets", "notion", "obsidian", "scrivener", "notepad", "typora", "onenote"},
	"research": {"chrome", "msedge", "firefox", "brave", "opera", "arc", "acrobat", "acrord32", "sumatrapdf", "zotero", ".pdf"},
	"coding":   {"code |", "cursor |", "- visual studio code", "- cursor", "devenv", "windowsterminal", "pwsh", "powershell", "idea64", "github"},
}

const checkIn = 5 * time.Minute

var claudeTitle = regexp.MustCompile(`(?i)(^|\s[-\x{2013}|]\s)claude(\s[-\x{2013}|]\s|$)`)

func isClaude(win string) bool {
	parts := strings.SplitN(win, " | ", 2)
	if strings.HasPrefix(strings.ToLower(parts[0]), "claude") {
		return true
	}
	return len(parts) > 1 && claudeTitle.MatchString(parts[1])
}

func onTask(win, kind string) bool {
	if kind == "" {
		return !isClaude(win)
	}
	kinds := strings.Split(kind, ",")
	if isClaude(win) {
		for _, k := range kinds {
			if k == "claude" {
				return true
			}
		}
		return false
	}
	lw := strings.ToLower(win)
	for _, k := range kinds {
		for _, w := range workWords[k] {
			if strings.Contains(lw, w) {
				return true
			}
		}
	}
	return false
}

func send(code, state, why, dev string) error {
	b, _ := json.Marshal(map[string]string{"state": state, "why": why, "dev": dev})
	r, err := client.Post(site+"/api/state/"+code, "application/json", bytes.NewReader(b))
	if err != nil {
		return err
	}
	r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("status %d", r.StatusCode)
	}
	return nil
}

// self-update: download the newer exe next to this one, swap it in, restart
func checkUpdate() {
	r, err := client.Get(site + "/bakery/winapp-version.txt")
	if err != nil {
		return
	}
	b := make([]byte, 16)
	n, _ := r.Body.Read(b)
	r.Body.Close()
	var v int
	if _, err := fmt.Sscan(strings.TrimSpace(string(b[:n])), &v); err != nil || v <= version {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	dl := &http.Client{Timeout: 2 * time.Minute}
	resp, err := dl.Get(site + "/bakery/FocusBakery.exe")
	if err != nil || resp.StatusCode != 200 {
		return
	}
	defer resp.Body.Close()
	tmp := exe + ".new"
	f, err := os.Create(tmp)
	if err != nil {
		return
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return
	}
	f.Close()
	os.Remove(exe + ".old")
	if os.Rename(exe, exe+".old") != nil {   // Windows lets a running exe be renamed, not overwritten
		os.Remove(tmp)
		return
	}
	if os.Rename(tmp, exe) != nil {
		os.Rename(exe+".old", exe)
		return
	}
	exec.Command(exe).Start()
	os.Exit(0)
}

func main() {
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe + ".old")
	}
	code := loadCode()
	if code == "" {
		msgBox("Focus Bakery needs your pairing code.\n\nOn the bakery page, open ⚙ → Connect phone & computer and use “Download for Windows”. That download already knows your code.")
		openURL(site + "/bakery/")
		return
	}
	if !autostart() && !fileExists(filepath.Join(filepath.Dir(cfgPath()), "no-autostart")) {
		setAutostart(true) // start with Windows by default; untick in the menu to stop
	}
	go func() {
		for {
			checkUpdate()
			time.Sleep(6 * time.Hour)
		}
	}()
	systray.Run(func() { onReady(code) }, func() {})
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func onReady(code string) {
	host, _ := os.Hostname()
	dev := "pc-" + regexp.MustCompile(`[^\w-]`).ReplaceAllString(host, "")
	systray.SetIcon(icoCat)
	systray.SetTitle("Focus Bakery")
	systray.SetTooltip("Focus Bakery: starting…")
	mStatus := systray.AddMenuItem("Starting…", "")
	mStatus.Disable()
	mSees := systray.AddMenuItem("", "")
	mSees.Disable()
	systray.AddSeparator()
	mOpen := systray.AddMenuItem("Open the bakery", "")
	mSites := systray.AddMenuItem("Choose distracting sites…", "")
	mPause := systray.AddMenuItem("Pause for 30 minutes", "Counts as away, so nothing is lost")
	mAuto := systray.AddMenuItemCheckbox("Start with Windows", "", autostart())
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Quit", "")

	var pausedUntil time.Time
	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openURL(site + "/bakery/?code=" + code)
			case <-mSites.ClickedCh:
				openURL(site + "/bakery/?code=" + code + "&open=dist")
			case <-mPause.ClickedCh:
				if time.Now().Before(pausedUntil) {
					pausedUntil = time.Time{}
					mPause.SetTitle("Pause for 30 minutes")
				} else {
					pausedUntil = time.Now().Add(30 * time.Minute)
					mPause.SetTitle("Resume now")
				}
			case <-mAuto.ClickedCh:
				on := !autostart()
				setAutostart(on)
				marker := filepath.Join(filepath.Dir(cfgPath()), "no-autostart")
				if on {
					mAuto.Check()
					os.Remove(marker)
				} else {
					mAuto.Uncheck()
					os.WriteFile(marker, nil, 0o600)
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()

	go func() {
		list := defaultList
		kind := ""
		var lastCfg, lastSent, offSince time.Time
		last := ""
		for {
			if time.Since(lastCfg) > 30*time.Second {
				if c := fetchCfg(code); c != nil {
					if c.Distracting != nil {
						list = c.Distracting
					}
					if c.Kind != nil && *c.Kind != kind {
						kind = *c.Kind
						offSince = time.Time{}
					}
				}
				lastCfg = time.Now()
			}
			win := front()
			state, why := "focused", ""
			if idle() >= idleAfter || time.Now().Before(pausedUntil) {
				state = "idle"
			} else {
				lw := strings.ToLower(win)
				for _, k := range list {
					if k != "" && strings.Contains(lw, strings.ToLower(k)) {
						state = "distracted"
						break
					}
				}
			}
			if state == "focused" {
				if onTask(win, kind) {
					offSince = time.Time{}
				} else {
					if offSince.IsZero() {
						offSince = time.Now()
					}
					if time.Since(offSince) >= checkIn {
						state, why = "idle", "other"
						if isClaude(win) {
							why = "claude"
						}
					}
				}
			} else {
				offSince = time.Time{}
			}
			key := state + why
			if key != last || time.Since(lastSent) > 30*time.Second {
				if err := send(code, state, why, dev); err == nil {
					lastSent = time.Now()
					if key != last {
						last = key
						label := map[string]string{"focused": "Focused 🍪", "distracted": "Distracted — the cat noticed!", "idle": "Away (cat is napping)"}[state]
						if why != "" {
							label = "Paused · off your kind of work"
						}
						if time.Now().Before(pausedUntil) {
							label = "Paused until " + pausedUntil.Format("15:04")
						}
						mStatus.SetTitle(label)
						systray.SetTooltip("Focus Bakery: " + label)
						switch state {
						case "distracted":
							systray.SetIcon(icoRed)
						case "idle":
							systray.SetIcon(icoGrey)
						default:
							systray.SetIcon(icoCat)
						}
					}
				} else {
					mStatus.SetTitle("Can't reach the bakery, retrying…")
				}
			}
			t := win
			if len([]rune(t)) > 60 {
				t = string([]rune(t)[:60]) + "…"
			}
			mSees.SetTitle("Sees: " + t)
			time.Sleep(3 * time.Second)
		}
	}()
}
