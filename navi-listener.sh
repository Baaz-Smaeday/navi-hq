#!/bin/bash
# Navi HQ Listener — polls Supabase for commands, executes VISIBLY on laptop
# Usage: bash ~/Projects/navi-hq/navi-listener.sh

SB_URL="https://nibemnomfzflvpnlfgbh.supabase.co"
SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pYmVtbm9tZnpmbHZwbmxmZ2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTMzNzYsImV4cCI6MjA4OTg2OTM3Nn0.0gQPv67Bh5Fh1PocqENfPCm-dWQDe41886VfLUgQhuM"
POLL_SEC=8

update_status() {
  local id="$1" status="$2" result="$3"
  local escaped=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${id}" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${status}\",\"result\":${escaped},\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
}

echo "╔══════════════════════════════════════╗"
echo "║     NAVI HQ — Laptop Listener        ║"
echo "║  Waiting for commands from phone...   ║"
echo "║                                       ║"
echo "║  Commands you can send from phone:    ║"
echo "║  • 'open chrome'                      ║"
echo "║  • 'open warp'                        ║"
echo "║  • 'new claude chat'                  ║"
echo "║  • 'open finder'                      ║"
echo "║  • Any Claude Code instruction        ║"
echo "╚══════════════════════════════════════╝"
echo ""

while true; do
  ROW=$(curl -s "${SB_URL}/rest/v1/commands?status=eq.pending&order=created_at.asc&limit=1" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}")

  ID=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

  if [ -n "$ID" ]; then
    CMD=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['command'])" 2>/dev/null)
    PROJ=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('project','general'))" 2>/dev/null)
    CMD_LOWER=$(echo "$CMD" | tr '[:upper:]' '[:lower:]')

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📥 Command: $CMD"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Mark as running
    curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${ID}" \
      -H "apikey: ${SB_KEY}" \
      -H "Authorization: Bearer ${SB_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"status":"running"}' > /dev/null

    # === SMART COMMAND ROUTING ===

    # Open apps
    if echo "$CMD_LOWER" | grep -qE "^open (chrome|google chrome|browser)"; then
      open -a "Google Chrome"
      update_status "$ID" "done" "Opened Google Chrome"
      echo "✅ Opened Chrome"

    elif echo "$CMD_LOWER" | grep -qE "^open (safari)"; then
      open -a "Safari"
      update_status "$ID" "done" "Opened Safari"
      echo "✅ Opened Safari"

    elif echo "$CMD_LOWER" | grep -qE "^open (warp|terminal)"; then
      open -a "Warp"
      update_status "$ID" "done" "Opened Warp terminal"
      echo "✅ Opened Warp"

    elif echo "$CMD_LOWER" | grep -qE "^open (finder|files)"; then
      open -a "Finder"
      update_status "$ID" "done" "Opened Finder"
      echo "✅ Opened Finder"

    elif echo "$CMD_LOWER" | grep -qE "^open (vscode|vs code|code)"; then
      open -a "Visual Studio Code"
      update_status "$ID" "done" "Opened VS Code"
      echo "✅ Opened VS Code"

    elif echo "$CMD_LOWER" | grep -qE "^open https?://"; then
      URL=$(echo "$CMD" | sed 's/^[Oo]pen //')
      open "$URL"
      update_status "$ID" "done" "Opened $URL in browser"
      echo "✅ Opened $URL"

    # New Claude Code chat in Warp — opens with --dangerously-skip-permissions so no approval needed from phone
    elif echo "$CMD_LOWER" | grep -qE "(new claude|start claude|open claude|claude chat|new chat)"; then
      # Extract any message after "new claude chat: <message>"
      MSG=$(echo "$CMD" | sed -E 's/.*(new claude|start claude|open claude|claude chat|new chat)[[:space:]]*//' | sed 's/^[[:space:]]*//')
      if [ -n "$MSG" ] && [ "$MSG" != "$CMD" ]; then
        # Has a follow-up message — run it headless and show in Warp
        osascript -e "
          tell application \"Warp\" to activate
          delay 0.3
          tell application \"System Events\"
            tell process \"Warp\"
              keystroke \"t\" using command down
              delay 0.3
              keystroke \"claude -p \\\"${MSG}\\\"\"
              delay 0.2
              key code 36
            end tell
          end tell
        "
        update_status "$ID" "done" "Running Claude in Warp: $MSG"
        echo "✅ Running Claude command in Warp"
      else
        # Just open interactive Claude — auto-accept trust
        # Open Warp, start Claude, auto-accept both prompts
        osascript <<'APPLESCRIPT'
          tell application "Warp" to activate
          delay 0.5
          tell application "System Events"
            tell process "Warp"
              keystroke "t" using command down
              delay 0.5
              keystroke "claude --dangerously-skip-permissions"
              delay 0.2
              key code 36
              -- Prompt 1: "Yes, I trust this folder" (already selected) → Enter
              delay 5
              key code 36
              -- Prompt 2: "1. No, exit" is default → press Down to select "2. Yes, I accept" → Enter
              delay 2
              key code 125
              delay 0.3
              key code 36
            end tell
          end tell
APPLESCRIPT
        update_status "$ID" "done" "Opened Claude in Warp (fully auto-accepted)"
        echo "✅ Claude opened in Warp (fully auto-accepted)"
      fi

    # Lock/sleep Mac
    elif echo "$CMD_LOWER" | grep -qE "^(lock|sleep|lock screen)"; then
      pmset displaysleepnow
      update_status "$ID" "done" "Locked screen"
      echo "✅ Locked screen"

    # Screenshot
    elif echo "$CMD_LOWER" | grep -qE "(screenshot|screen grab|capture screen)"; then
      screencapture -x ~/Desktop/navi-screenshot-$(date +%s).png
      update_status "$ID" "done" "Screenshot saved to Desktop"
      echo "✅ Screenshot saved"

    # Run Claude Code (visible in this terminal)
    else
      echo "🤖 Running Claude Code..."
      RESULT=$(claude -p "$CMD" --max-turns 5 2>&1 | tail -c 5000)
      if [ $? -eq 0 ]; then
        update_status "$ID" "done" "$RESULT"
        echo "✅ Done"
      else
        update_status "$ID" "error" "$RESULT"
        echo "❌ Error"
      fi
    fi

    echo "📤 Sent back to phone"
    echo ""
  fi

  sleep $POLL_SEC
done
