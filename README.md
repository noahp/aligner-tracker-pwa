# Aligner Tracker

A PWA for tracking clear aligner (Invisalign-style) treatment progress. Installable on Android via Chrome, works fully offline, no backend required.

## Features

- **Status dashboard** — current aligner number, progress bar, countdown to next rotation (shows overdue in orange)
- **Rotation tracking** — tap the big green button to log a rotation; confirm dialog prevents accidents
- **Remaining estimate** — aligners left, days to completion, estimated end date
- **Calendar reminders** — downloads a single `.ics` file with all remaining rotation dates as all-day events (with a 9 AM alarm on each day)
- **History log** — every rotation with duration worn; copy to clipboard for export
- **Offline-first** — service worker caches all assets after first load

## Usage

1. Open the app and complete the one-time setup:
   - Total aligners in your series (e.g. 19)
   - Rotation interval in days (e.g. 14)
   - Which aligner you're currently wearing
   - The date you started wearing it
2. Each time you rotate to a new aligner, tap **Rotate to Next Aligner** on the home screen.
3. Tap **Add Calendar Reminders** once to download all future rotation dates to your calendar.

## Install on Android

1. Open the app URL in Chrome
2. Tap the three-dot menu → **Add to Home screen**
3. The app will open full-screen like a native app

## Deploy to GitHub Pages

Push to `main` — the included GitHub Actions workflow (`.github/workflows/pages.yml`) deploys automatically. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Local development

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

No build step needed — plain HTML/CSS/JS.

## Data storage

All data is stored in `localStorage` on your device. Nothing is sent to any server. Use the **Copy** button in the History tab to export your rotation log as plain text.
