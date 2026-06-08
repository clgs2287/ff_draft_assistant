# Ward19 Draft Assistant

Mobile-first fantasy football draft assistant for the Ward19 Yahoo league.

## Run Locally

```powershell
cd "C:\Users\coryl\OneDrive\Documents\New project\fantasy-draft-assistant"
node server.mjs 5182
```

Open:

```text
http://127.0.0.1:5182
```

## Phone / Hosted App

GitHub Pages URL:

```text
https://clgs2287.github.io/ff_draft_assistant/
```

Open that URL on your iPhone and use Share > Add to Home Screen.

Draft picks, team names, and settings are saved locally on the device you use.

For iPhone testing on the same Wi-Fi, use the computer's local network IP instead of `127.0.0.1`.

Example from the current Wi-Fi network:

```text
http://192.168.4.38:5190
```

## Current Features

- Ward19 league settings baked in
- FantasyPros 2026 draft rankings loaded from CSV
- Draft Sharks PPR rankings blended into quality rank with slightly higher weight than FantasyPros
- Beat ADP merged for consensus, Sleeper, ESPN, Yahoo, Underdog, and FantasyPros ADP fields where player/team match
- 12-team, 15-round snake draft
- Flexible draft slot selector
- Player search and tap-to-draft
- Best available and position filters
- Personalized recommendations
- My roster view
- Team roster view
- In-app CSV imports for updated FantasyPros rankings and Beat ADP
- Undo and reset
- Local browser save
- PWA manifest and service worker

## Next Data Step

From the app, open Teams > Rankings Data:

- Import Rankings CSV for a fresh FantasyPros draft rankings export.
- Import Draft Sharks CSV for a fresh Draft Sharks PPR rankings export.
- Import ADP CSV for a fresh Beat ADP export.
- Use Bundled Data to reset back to the checked-in data.

The imported player pool is saved locally on that device and is included in current draft backups.

For a checked-in data refresh from the computer, refresh the FantasyPros, Beat ADP, and Draft Sharks CSVs closer to draft day, then run:

```powershell
node scripts\merge-rankings.mjs
```
