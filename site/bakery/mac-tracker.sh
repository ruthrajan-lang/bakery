#!/bin/bash
# Focus Bakery — Mac tracker.
# Watches which app / browser tab is in front and whether you're idle, and sends
# ONLY "focused", "distracted" or "idle" to your bakery (window titles never leave your Mac).
#
#   Usage:  bash focus-bakery.sh YOUR_CODE
#   Choose what counts as distracting on the bakery page (⚙︎ → Distracting sites).

CODE="${1:-$FOCUS_BAKERY_CODE}"
[ -z "$CODE" ] && { echo "Usage: bash $0 YOUR_CODE   (get the code from the bakery page → Connect phone & Mac)"; exit 1; }
URL="https://bakery.ruththomson.workers.dev/api/state/$CODE"
CFG_URL="https://bakery.ruththomson.workers.dev/api/config/$CODE"
REMOTE="$HOME/.focus-bakery-remote.txt"   # list picked on the bakery page (overrides the file below)
LIST="$HOME/.focus-bakery-distracting.txt"
DEV="mac-$(hostname -s | tr -cd '[:alnum:]-')"
IDLE_AFTER=120      # seconds without keyboard/mouse before you count as away
GRACE_NOTE="(the bakery itself gives you 30s grace before it counts)"

if [ ! -f "$LIST" ]; then
  cat > "$LIST" <<'LIST'
# Apps or words in the window/tab title that count as distracting (case-insensitive).
YouTube
Reddit
Twitter
 / X
Instagram
Facebook
TikTok
Netflix
Twitch
Hulu
Disney+
Discord
Steam
LIST
  echo "Created $LIST — edit it to change what counts as distracting."
fi

front() {
  # frontmost app; for browsers also ask for the active tab's title + address (needs only an "allow Terminal to control <browser>" OK)
  local app tab=""
  app="$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)"
  case "$app" in
    "Google Chrome"|"Google Chrome Canary"|"Brave Browser"|"Microsoft Edge"|"Arc"|"Vivaldi"|"Chromium"|"Opera")
      tab="$(osascript -e "tell application \"$app\" to get (title of active tab of front window) & \" \" & (URL of active tab of front window)" 2>/dev/null)";;
    "Safari"|"Safari Technology Preview")
      tab="$(osascript -e "tell application \"$app\" to get (name of current tab of front window) & \" \" & (URL of current tab of front window)" 2>/dev/null)";;
    *)
      tab="$(osascript -e 'tell application "System Events" to tell (first application process whose frontmost is true) to get name of front window' 2>/dev/null)";;
  esac
  echo "$app | $tab"
}
idle_secs() { ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'; }

shopt -s nocasematch
echo "Focus Bakery tracker running (code $CODE). Ctrl+C to stop. $GRACE_NOTE"
echo "When macOS asks to let Terminal control your browser, click OK (that's how it sees the tab you're on)."

fetch_cfg() {
  local j; j="$(curl -fsS -m 5 "$CFG_URL" 2>/dev/null)" || return
  osascript -l JavaScript -e 'function run(a){var d=JSON.parse(a[0]).distracting;return d?d.join("\n"):"__none__"}' "$j" > "$REMOTE.tmp" 2>/dev/null && mv "$REMOTE.tmp" "$REMOTE"
  local k; k="$(osascript -l JavaScript -e 'function run(a){var k=JSON.parse(a[0]).kind;return typeof k==="string"?k:"__keep__"}' "$j" 2>/dev/null)"
  if [ "$k" != "__keep__" ] && [ "$k" != "$KIND" ]; then KIND="$k"; off_since=0; echo "Work: ${KIND:-anything}"; fi
}
# Kinds of work picked next to your task on the bakery page: matching apps count as focus;
# anything else (Claude included, unless picked) gets a 5-minute check-in, then the oven pauses.
WORK_writing="Microsoft Word|Pages|Google Docs|Google Sheets|Notion|Obsidian|Scrivener|TextEdit|Bear|Ulysses|iA Writer|Typora|OneNote"
WORK_research="Safari|Google Chrome|Firefox|Arc|Brave|Microsoft Edge|Preview|Acrobat|Zotero|.pdf"
WORK_coding="Code|Cursor|Xcode|Terminal|iTerm|Warp|IntelliJ|PyCharm|WebStorm|GitHub|Nova|Sublime"
is_claude() { [[ "$1" == Claude* ]] || [[ "$1" =~ (^|[[:space:]][-|][[:space:]])Claude([[:space:]][-|][[:space:]]|$) ]] || [[ "$1" == *"claude.ai"* ]]; }
on_task() {   # $1 = "App | tab title + url"
  if is_claude "$1"; then [[ ",$KIND," == *",claude,"* ]]; return; fi
  [ -z "$KIND" ] && return 0
  local k w IFS_old="$IFS"
  for k in ${KIND//,/ }; do
    local var="WORK_$k"; IFS='|'
    for w in ${!var}; do IFS="$IFS_old"; [[ -n "$w" && "$1" == *"$w"* ]] && return 0; IFS='|'; done
    IFS="$IFS_old"
  done
  return 1
}
KIND=""; off_since=0
last=""; last_sent=0; last_cfg=0
while true; do
  [ $(( $(date +%s) - last_cfg )) -ge 30 ] && { fetch_cfg; last_cfg=$(date +%s); }
  SRC="$LIST"; [ -s "$REMOTE" ] && [ "$(head -1 "$REMOTE")" != "__none__" ] && SRC="$REMOTE"
  win="$(front)"; idle="$(idle_secs)"; state="focused"
  if [ "${idle:-0}" -ge "$IDLE_AFTER" ]; then state="idle"
  else
    while IFS= read -r kw; do
      [[ -z "$kw" || "$kw" == \#* ]] && continue
      if [[ "$win" == *"$kw"* ]]; then state="distracted"; break; fi
    done < "$SRC"
  fi
  why=""
  if [ "$state" = "focused" ]; then
    if on_task "$win"; then off_since=0
    else
      [ "$off_since" -eq 0 ] && off_since=$(date +%s)
      if [ $(( $(date +%s) - off_since )) -ge 300 ]; then state="idle"; why="other"; is_claude "$win" && why="claude"; fi
    fi
  else off_since=0; fi
  now=$(date +%s)
  # send on change, and every 30s as a heartbeat
  if [ "$state$why" != "$last" ] || [ $((now - last_sent)) -ge 30 ]; then
    if curl -fsS -m 5 -X POST -H 'content-type: application/json' -d "{\"state\":\"$state\",\"why\":\"$why\",\"dev\":\"$DEV\"}" "$URL" >/dev/null; then
      [ "$state$why" != "$last" ] && echo "$(date +%H:%M:%S)  $state${why:+ (paused: off your kind of work)}   ($win)"
      last="$state$why"; last_sent=$now
    else
      echo "$(date +%H:%M:%S)  couldn't reach the bakery, retrying…"
    fi
  fi
  sleep 3
done
