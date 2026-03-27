# NAVI HQ

**Control your AI, your code, and your laptop — from your phone. No API costs.**

A mobile-first project command centre that monitors your projects, sends commands to your laptop's AI coding assistant, and remote-controls your Mac — all from your phone.

## Live

https://baaz-smaeday.github.io/navi-hq/

## Features

- PIN-protected dashboard
- Live health monitoring for 14 projects (auto-ping every 60s)
- Remote control: open apps, start Claude Code, take screenshots, lock Mac
- Voice commands (speech-to-text)
- Supabase relay: send commands from phone to laptop
- Saved commands for quick reuse
- Offline alerts with vibration
- Laptop connection status indicator
- Result panel showing Claude Code output
- PWA support (add to home screen)
- Dark theme, mobile-optimised
- Single HTML file, zero dependencies

## Architecture

```
Phone (Navi HQ) → Supabase (relay) → Laptop (listener) → Claude Code
      ↑                                                        │
      └──────────────── Result sent back ──────────────────────┘
```

## Setup

1. Open `https://baaz-smaeday.github.io/navi-hq/` on your phone
2. Enter PIN to unlock
3. On your laptop, start the listener:

```bash
bash navi-listener.sh
```

4. Send commands from your phone — they execute on your laptop

## Files

```
navi-hq/
├── index.html          # Full dashboard (single self-contained file)
├── navi-listener.sh    # Laptop listener script (polls Supabase, runs commands)
├── PITCH.md            # Product pitch and business plan
├── README.md           # This file
└── .github/
    └── workflows/
        └── claude-command.yml  # GitHub Actions fallback
```

## Cost

Zero extra. Uses your existing Claude Max plan + Supabase free tier + GitHub Pages.

## Stack

- Frontend: Vanilla HTML/CSS/JS (no framework)
- Relay: Supabase (Postgres + REST API)
- Listener: Bash + osascript (macOS)
- AI: Claude Code (user's own plan)
- Hosting: GitHub Pages (free)
