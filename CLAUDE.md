# bakery

- Commit and push to `main`. Cloudflare Workers Builds deploys `main` on every push.
- Live site: https://bakery.ruththomson.workers.dev/bakery/
- Cloudflare Worker name: `bakery` (must match `name` in `wrangler.jsonc`).
- Only `site/` is published (`assets.directory` in `wrangler.jsonc`); `site/bakery/index.html` is the game.
- Secrets (set in the Cloudflare dashboard, never in the repo): `TODOIST_CLIENT_ID`, `TODOIST_CLIENT_SECRET`.
- Windows app: bump `version` in `trackers/windows/main.go` and `site/bakery/winapp-version.txt` together when rebuilding.
- Keep internal or non-anonymized files outside `site/`.
