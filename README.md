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

For iPhone testing on the same Wi-Fi, use the computer's local network IP instead of `127.0.0.1`.

Example from the current Wi-Fi network:

```text
http://192.168.4.38:5190
```

## Current Features

- Ward19 league settings baked in
- FantasyPros 2026 draft rankings loaded from CSV
- Beat ADP merged for consensus, Sleeper, ESPN, Yahoo, Underdog, and FantasyPros ADP fields where player/team match
- 12-team, 15-round snake draft
- Flexible draft slot selector
- Player search and tap-to-draft
- Best available and position filters
- Personalized recommendations
- My roster view
- Team roster view
- Undo and reset
- Local browser save
- PWA manifest and service worker

## Next Data Step

Refresh the FantasyPros and Beat ADP CSVs closer to draft day, then run:

```powershell
node scripts\merge-rankings.mjs
```
