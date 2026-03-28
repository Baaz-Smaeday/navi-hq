#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Navi HQ Listener v2 — Direct CLI execution, no AppleScript for AI
#
# Architecture:
#   Polls Supabase for pending commands
#   Routes to correct project directory
#   Executes AI tools as direct child processes (stdin/stdout)
#   Streams results back to Supabase
#   Keeps AppleScript only for Mac app launchers
#
# Usage: bash navi-listener.sh [config-path]
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# --- Config ---
CONFIG_FILE="${1:-$(dirname "$0")/navi-config.json}"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config not found at $CONFIG_FILE"
  echo "Run setup.sh first or pass config path: bash navi-listener.sh /path/to/navi-config.json"
  exit 1
fi

# Load config values
SB_URL=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c['supabase_url'])")
SB_KEY=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c['supabase_anon_key'])")
SHARED_SECRET=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c['shared_secret'])")
LISTENER_ID=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('listener_id',''))")
DEFAULT_TOOL=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('default_tool','claude-code'))")

if [ -z "$SB_URL" ] || [ -z "$SB_KEY" ]; then
  echo "Error: supabase_url and supabase_anon_key must be set in config"
  exit 1
fi

# Generate listener ID if not set
if [ -z "$LISTENER_ID" ]; then
  LISTENER_ID="laptop-$(hostname -s)-$$"
  python3 -c "
import json
c=json.load(open('$CONFIG_FILE'))
c['listener_id']='$LISTENER_ID'
json.dump(c,open('$CONFIG_FILE','w'),indent=2)
"
fi

POLL_SEC=3
HEARTBEAT_SEC=30
SESSION_DIR="/tmp/navi-sessions"
LOG_FILE="/tmp/navi-listener.log"
LAST_HEARTBEAT=0

mkdir -p "$SESSION_DIR"

# --- Helpers ---

log() {
  local msg="[$(date '+%H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

sb_headers() {
  echo -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" -H "Content-Type: application/json"
}

# Get project directory from config
get_project_dir() {
  local project="$1"
  python3 -c "
import json
c=json.load(open('$CONFIG_FILE'))
p=c.get('projects',{}).get('$project',{})
print(p.get('dir',''))
" 2>/dev/null
}

# Get mac action command from config
get_mac_action() {
  local action_key="$1"
  python3 -c "
import json,sys
c=json.load(open('$CONFIG_FILE'))
actions=c.get('mac_actions',{})
# Try exact match first, then lowercase match
for k,v in actions.items():
    if k.lower()==sys.argv[1].lower():
        print(v)
        break
" "$action_key" 2>/dev/null
}

# Update command status in Supabase
update_status() {
  local id="$1" status="$2" result="$3"
  local escaped
  escaped=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${id}" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${status}\",\"result\":${escaped},\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"laptop_id\":\"${LISTENER_ID}\"}" > /dev/null 2>&1
}

# Stream partial result to Supabase (for live updates)
stream_result() {
  local id="$1" partial="$2"
  local escaped
  escaped=$(echo "$partial" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${id}" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"result\":${escaped}}" > /dev/null 2>&1
}

# Send heartbeat
heartbeat() {
  local now
  now=$(date +%s)
  if (( now - LAST_HEARTBEAT < HEARTBEAT_SEC )); then
    return
  fi
  LAST_HEARTBEAT=$now

  # Upsert into laptops table
  curl -s -X POST "${SB_URL}/rest/v1/laptops" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d "{\"id\":\"${LISTENER_ID}\",\"hostname\":\"$(hostname -s)\",\"last_heartbeat\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"online\"}" > /dev/null 2>&1
}

# --- AI Tool Execution ---

# Run Claude Code in a project directory — direct CLI, no GUI
run_claude_code() {
  local id="$1" cmd="$2" project_dir="$3"
  local result="" chunk="" line_count=0

  log "Running Claude Code in: $project_dir"

  # Execute claude -p directly, stream output
  local tmpfile="$SESSION_DIR/output-${id}"

  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    (cd "$project_dir" && claude -p "$cmd" --max-turns 10 2>&1) > "$tmpfile" &
  else
    claude -p "$cmd" --max-turns 10 2>&1 > "$tmpfile" &
  fi
  local pid=$!

  # Stream results back while process runs
  local last_size=0
  local timeout=300  # 5 minute timeout
  local elapsed=0

  while kill -0 "$pid" 2>/dev/null; do
    sleep 2
    elapsed=$((elapsed + 2))

    if [ -f "$tmpfile" ]; then
      local current_size
      current_size=$(wc -c < "$tmpfile" 2>/dev/null || echo 0)

      # Stream update if content grew
      if [ "$current_size" -gt "$last_size" ]; then
        chunk=$(tail -c 4000 "$tmpfile" 2>/dev/null || true)
        stream_result "$id" "$chunk"
        last_size=$current_size
      fi
    fi

    # Timeout check
    if [ "$elapsed" -ge "$timeout" ]; then
      kill "$pid" 2>/dev/null || true
      log "Command timed out after ${timeout}s"
      update_status "$id" "error" "Command timed out after ${timeout} seconds. Partial output:\n$(tail -c 3000 "$tmpfile" 2>/dev/null)"
      rm -f "$tmpfile"
      return
    fi
  done

  # Process finished — send final result
  wait "$pid" 2>/dev/null
  local exit_code=$?

  if [ -f "$tmpfile" ]; then
    result=$(tail -c 4000 "$tmpfile")
    rm -f "$tmpfile"
  fi

  if [ $exit_code -eq 0 ]; then
    update_status "$id" "done" "$result"
    log "Done (exit 0)"
  else
    update_status "$id" "error" "$result"
    log "Error (exit $exit_code)"
  fi
}

# Run a raw shell command
run_shell() {
  local id="$1" cmd="$2" project_dir="$3"
  log "Running shell command in: ${project_dir:-$HOME}"

  local result
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    result=$(cd "$project_dir" && bash -c "$cmd" 2>&1 | tail -c 4000)
  else
    result=$(bash -c "$cmd" 2>&1 | tail -c 4000)
  fi

  if [ $? -eq 0 ]; then
    update_status "$id" "done" "$result"
  else
    update_status "$id" "error" "$result"
  fi
}

# Run a Mac app action (AppleScript — kept for convenience only)
run_mac_action() {
  local id="$1" action="$2"
  local mac_cmd
  mac_cmd=$(get_mac_action "$action")

  if [ -n "$mac_cmd" ]; then
    log "Running Mac action: $action → $mac_cmd"
    eval "$mac_cmd" 2>&1
    update_status "$id" "done" "Executed: $action"
  else
    log "Unknown Mac action: $action"
    update_status "$id" "error" "Unknown action: $action. Available: $(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(', '.join(c.get('mac_actions',{}).keys()))")"
  fi
}

# --- Command Router ---

route_command() {
  local id="$1" cmd="$2" project="$3" tool="$4"
  local cmd_lower
  cmd_lower=$(echo "$cmd" | tr '[:upper:]' '[:lower:]')

  # 1. Check if it's a Mac action (open app, lock, screenshot)
  local mac_cmd
  mac_cmd=$(get_mac_action "$cmd_lower")
  if [ -n "$mac_cmd" ]; then
    run_mac_action "$id" "$cmd_lower"
    return
  fi

  # Also check partial matches for "open X" commands
  if echo "$cmd_lower" | grep -qE "^open "; then
    local app_name
    app_name=$(echo "$cmd_lower" | sed 's/^open //')
    mac_cmd=$(get_mac_action "open $app_name")
    if [ -n "$mac_cmd" ]; then
      run_mac_action "$id" "open $app_name"
      return
    fi
    # Open URL
    if echo "$cmd_lower" | grep -qE "^open https?://"; then
      local url
      url=$(echo "$cmd" | sed 's/^[Oo]pen //')
      open "$url" 2>/dev/null
      update_status "$id" "done" "Opened $url"
      return
    fi
  fi

  # 2. Resolve project directory
  local project_dir=""
  if [ "$project" != "general" ] && [ -n "$project" ]; then
    project_dir=$(get_project_dir "$project")
    if [ -z "$project_dir" ] || [ ! -d "$project_dir" ]; then
      log "Warning: project '$project' dir not found, using HOME"
      project_dir="$HOME"
    fi
  else
    project_dir="$HOME"
  fi

  # 3. Route by tool
  case "${tool:-$DEFAULT_TOOL}" in
    claude-code)
      run_claude_code "$id" "$cmd" "$project_dir"
      ;;
    shell)
      run_shell "$id" "$cmd" "$project_dir"
      ;;
    cursor)
      # Activate Cursor, open AI chat, paste command
      log "Routing to Cursor"
      echo -n "$cmd" | pbcopy
      osascript -e '
        tell application "Cursor" to activate
        delay 0.5
        tell application "System Events"
          tell process "Cursor"
            keystroke "l" using command down
            delay 0.5
            keystroke "v" using command down
            delay 0.2
            key code 36
          end tell
        end tell
      ' 2>&1
      update_status "$id" "done" "Sent to Cursor AI chat: $cmd"
      ;;
    copilot)
      log "Routing to VS Code Copilot"
      echo -n "$cmd" | pbcopy
      osascript -e '
        tell application "Visual Studio Code" to activate
        delay 0.5
        tell application "System Events"
          tell process "Code"
            keystroke "i" using {command down, control down}
            delay 0.5
            keystroke "v" using command down
            delay 0.2
            key code 36
          end tell
        end tell
      ' 2>&1
      update_status "$id" "done" "Sent to Copilot chat: $cmd"
      ;;
    *)
      log "Unknown tool: $tool, falling back to claude-code"
      run_claude_code "$id" "$cmd" "$project_dir"
      ;;
  esac
}

# --- Main Loop ---

echo "╔═══════════════════════════════════════════╗"
echo "║         NAVI HQ v2 — Listener             ║"
echo "║  ID: $LISTENER_ID"
echo "║  Config: $CONFIG_FILE"
echo "║  Polling: every ${POLL_SEC}s"
echo "║  Waiting for commands...                   ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# Cleanup on exit
cleanup() {
  log "Shutting down listener..."
  # Kill any running command subprocesses
  pkill -P $$ 2>/dev/null || true
  # Mark laptop as offline
  curl -s -X PATCH "${SB_URL}/rest/v1/laptops?id=eq.${LISTENER_ID}" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status":"offline"}' > /dev/null 2>&1
  rm -rf "$SESSION_DIR"/output-* 2>/dev/null
  log "Listener stopped."
}
trap cleanup EXIT

while true; do
  # Send heartbeat
  heartbeat

  # Poll for pending commands
  ROW=$(curl -s "${SB_URL}/rest/v1/commands?status=eq.pending&order=created_at.asc&limit=1" \
    -H "apikey: ${SB_KEY}" \
    -H "Authorization: Bearer ${SB_KEY}" 2>/dev/null || echo "[]")

  # Parse command
  ID=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || true)

  if [ -n "$ID" ]; then
    CMD=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['command'])" 2>/dev/null)
    PROJ=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('project','general'))" 2>/dev/null)
    TOOL=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('tool','claude-code'))" 2>/dev/null)
    SECRET=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('secret',''))" 2>/dev/null)

    # Validate secret
    if [ -n "$SHARED_SECRET" ] && [ "$SECRET" != "$SHARED_SECRET" ]; then
      log "Rejected (invalid secret): $CMD"
      update_status "$ID" "error" "Rejected: invalid secret"
      sleep "$POLL_SEC"
      continue
    fi

    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "Command: $CMD"
    log "Project: $PROJ | Tool: $TOOL"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Mark as running
    curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${ID}" \
      -H "apikey: ${SB_KEY}" \
      -H "Authorization: Bearer ${SB_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"running\",\"laptop_id\":\"${LISTENER_ID}\"}" > /dev/null 2>&1

    # Route and execute
    route_command "$ID" "$CMD" "$PROJ" "$TOOL"

    log "Done."
    echo ""
  fi

  sleep "$POLL_SEC"
done
