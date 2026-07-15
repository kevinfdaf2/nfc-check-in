# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Flask app (`app.py`, ~870 lines) that simulates NFC check-in: a phone tapping an NFC tag opens a URL that fingerprints the device (canvas fingerprint + localStorage keys, see `static/js/app.js`) and records a check-in/check-out. There is no actual NFC hardware/driver code in this repo — "NFC" only refers to what triggers the URL open on the phone.

Storage is Google Sheets only. The README describes a "LOCAL_MODE" dual-storage mode (local JSON vs. Sheets) — this is stale/aspirational; `app.py` has no `LOCAL_MODE` logic at all. Don't rely on that part of the README.

## Running locally

```bash
lsof -ti:5001 | xargs kill -9 2>/dev/null; sleep 1; .venv/bin/python app.py
```

Kill-then-run is necessary because a previous instance is often still bound to port 5001. Serves on `$PORT` if set, otherwise 5001.

No test suite, no linter/formatter, no CI configured in this repo.

## Deployment

Deploys to Railway. `app.py` constructs the OAuth redirect URI off `RAILWAY_PUBLIC_DOMAIN` (falls back to `RENDER_EXTERNAL_HOSTNAME`) when present — treat Railway as the source of truth over the README's Heroku/GCP App Engine instructions or `app.yaml`, which are not the current deploy path.

## Auth / secrets gotchas

- `ADMIN_PASSPHRASE` (app.py:24) defaults to the hardcoded string `'imsb'` if the env var isn't set. Treat this as a real secret in any prod-facing change — don't leave the default in place for a deploy.
- `SPREADSHEET_ID` (app.py:25) defaults to a hardcoded real Sheet ID if unset.
- `OAUTHLIB_INSECURE_TRANSPORT=1` is set unconditionally, including on production code paths (app.py:16). This is intentional per the current design, not a bug to silently fix — flag it if you touch the OAuth flow rather than removing it.
- Google OAuth needs `credentials.json` locally (gitignored, not in repo) to bootstrap, or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_TOKEN_JSON` / `GOOGLE_PROJECT_ID` env vars in production. `token.json` is generated at runtime and is gitignored.

## Git workflow

Commit straight to `main` — this is a solo project with no branches or PRs in its history. Keep that pattern unless told otherwise.
