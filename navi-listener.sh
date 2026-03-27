#!/bin/bash
# Navi HQ Listener — polls Supabase for commands, runs Claude Code on laptop
# Usage: bash ~/Projects/navi-hq/navi-listener.sh

SB_URL="https://nibemnomfzflvpnlfgbh.supabase.co"
SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pYmVtbm9tZnpmbHZwbmxmZ2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTMzNzYsImV4cCI6MjA4OTg2OTM3Nn0.0gQPv67Bh5Fh1PocqENfPCm-dWQDe41886VfLUgQhuM"
POLL_SEC=10

echo "╔══════════════════════════════════════╗"
echo "║     NAVI HQ — Laptop Listener        ║"
echo "║  Waiting for commands from phone...   ║"
echo "╚══════════════════════════════════════╝"
echo ""

while true; do
  # Fetch oldest pending command
  ROW=$(curl -s "${SB_URL}/rest/v1/commands?status=eq.pending&order=created_at.asc&limit=1" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}")

  ID=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

  if [ -n "$ID" ]; then
    CMD=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['command'])" 2>/dev/null)
    PROJ=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('project','general'))" 2>/dev/null)

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📥 Command: $CMD"
    echo "📁 Project: $PROJ"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Mark as running
    curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${ID}" \
      -H "apikey: ${SB_KEY}" \
      -H "Authorization: Bearer ${SB_KEY}" \
      -H "Content-Type: application/json" \
      -d '{"status":"running"}' > /dev/null

    # Run Claude Code
    echo "🤖 Running Claude Code..."
    RESULT=$(claude -p "$CMD" --max-turns 5 2>&1 | tail -c 5000)

    if [ $? -eq 0 ]; then
      STATUS="done"
      echo "✅ Done"
    else
      STATUS="error"
      echo "❌ Error"
    fi

    # Save result back to Supabase
    ESCAPED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
    curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${ID}" \
      -H "apikey: ${SB_KEY}" \
      -H "Authorization: Bearer ${SB_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"${STATUS}\",\"result\":${ESCAPED},\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

    echo ""
    echo "📤 Result sent back to Navi HQ"
    echo ""
  fi

  sleep $POLL_SEC
done
