# Bingsu's Bakery

A cozy focus game: Bingsu the cat bakes while you focus, customers visit, and things go gently wrong when you get distracted.
Live at https://bakery.ruththomson.workers.dev/bakery/

- `site/` is published by the Cloudflare Worker (`site/bakery/` is the game; `site/bakery/critters/` holds the customers, traced from `art-src/critter-lineup.webp` and drawn in code).
- `src/worker.js` is the Worker: static files, the focus relay between your devices, accounts and Todoist sign-in.
- Everything else (`trackers/`, `art-src/`, `pipeline/`) is source material and is not published.

- `trackers/windows/`: the Windows tray app (Go). Build with
  `GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o ../../site/bakery/FocusBakery.exe .`
  then bump `version` in `main.go` and the number in `site/bakery/winapp-version.txt` so installed apps update themselves.
- `art-src/`: original artwork. The site uses resized copies in `site/bakery/art/` and `site/bakery/items/`.
- The Mac tracker is `site/bakery/mac-tracker.sh` (downloaded from the bakery's Connect dialog).

Trackers send only "focused", "distracted" or "idle" (plus a reason when the oven pauses), never window titles.
