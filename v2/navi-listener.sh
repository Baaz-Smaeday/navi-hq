#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Navi HQ Listener v2.1
#
# Features:
#   - Direct CLI execution for Claude Code (no GUI dependency)
#   - Project-aware Warp tab routing (open/switch to project tab)
#   - Multi-AI tool support (Claude, Cursor, ChatGPT, Gemini, Aider)
#   - Mac app launchers via AppleScript
#   - Heartbeat system for laptop status
#   - Streaming results back to phone
#   - New Warp + Claude with auto-permissions (like v1)
#
# Usage: bash navi-listener.sh [config-path]
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# --- Config ---
CONFIG_FILE="${1:-$(dirname "$0")/navi-config.json}"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config not found at $CONFIG_FILE"
  echo "Run setup.sh first or pass config path"
  exit 1
fi

SB_URL=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c['supabase_url'])")
SB_KEY=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c['supabase_anon_key'])")
SHARED_SECRET=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c['shared_secret'])")
LISTENER_ID=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('listener_id',''))")
DEFAULT_TOOL=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('default_tool','claude-code'))")

if [ -z "$SB_URL" ] || [ -z "$SB_KEY" ]; then
  echo "Error: supabase_url and supabase_anon_key must be set in config"
  exit 1
fi

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

get_project_dir() {
  python3 -c "
import json
c=json.load(open('$CONFIG_FILE'))
p=c.get('projects',{}).get('$1',{})
print(p.get('dir',''))
" 2>/dev/null
}

get_mac_action() {
  python3 -c "
import json,sys
c=json.load(open('$CONFIG_FILE'))
actions=c.get('mac_actions',{})
for k,v in actions.items():
    if k.lower()==sys.argv[1].lower():
        print(v)
        break
" "$1" 2>/dev/null
}

update_status() {
  local id="$1" status="$2" result="$3"
  local escaped
  escaped=$(echo "$result" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${id}" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"${status}\",\"result\":${escaped},\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"laptop_id\":\"${LISTENER_ID}\"}" > /dev/null 2>&1
}

stream_result() {
  local id="$1" partial="$2"
  local escaped
  escaped=$(echo "$partial" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${id}" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"result\":${escaped}}" > /dev/null 2>&1
}

heartbeat() {
  local now; now=$(date +%s)
  if (( now - LAST_HEARTBEAT < HEARTBEAT_SEC )); then return; fi
  LAST_HEARTBEAT=$now
  curl -s -X POST "${SB_URL}/rest/v1/laptops" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
    -d "{\"id\":\"${LISTENER_ID}\",\"hostname\":\"$(hostname -s)\",\"last_heartbeat\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"online\"}" > /dev/null 2>&1
}

# ═══════════════════════════════════════════
# WARP TAB MANAGEMENT
# ═══════════════════════════════════════════

# Open a new Warp tab, cd to project, start Claude with auto-permissions
open_warp_claude() {
  local project_dir="$1"
  local project_name="${2:-general}"

  log "Opening new Warp tab with Claude for: $project_name ($project_dir)"

  # Build the command to run in the new tab
  local warp_cmd
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    warp_cmd="cd '$project_dir' && claude --dangerously-skip-permissions"
  else
    warp_cmd="claude --dangerously-skip-permissions"
  fi

  echo -n "$warp_cmd" | pbcopy

  osascript <<'APPLESCRIPT'
    tell application "Warp" to activate
    delay 0.5
    tell application "System Events"
      tell process "Warp"
        keystroke "t" using command down
        delay 0.5
        keystroke "v" using command down
        delay 0.2
        key code 36
        -- Wait for Claude to start, accept trust prompt
        delay 5
        key code 36
        -- Accept permissions prompt (press Down then Enter)
        delay 2
        key code 125
        delay 0.3
        key code 36
      end tell
    end tell
APPLESCRIPT
}

# Type into an existing Warp Claude session (switch to last tab + paste)
type_into_warp() {
  local msg="$1"
  echo -n "$msg" | pbcopy

  osascript -e '
    tell application "Warp" to activate
    delay 0.3
    tell application "System Events"
      tell process "Warp"
        keystroke "9" using command down
        delay 0.5
        keystroke "v" using command down
        delay 0.2
        key code 36
      end tell
    end tell
  '
}

# ═══════════════════════════════════════════
# AI TOOL EXECUTION
# ═══════════════════════════════════════════

run_claude_code() {
  local id="$1" cmd="$2" project_dir="$3"
  log "Running Claude Code in: $project_dir"

  local tmpfile="$SESSION_DIR/output-${id}"
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    (cd "$project_dir" && claude -p "$cmd" --max-turns 10 2>&1) > "$tmpfile" &
  else
    claude -p "$cmd" --max-turns 10 2>&1 > "$tmpfile" &
  fi
  local pid=$!
  local last_size=0 elapsed=0 timeout=300

  while kill -0 "$pid" 2>/dev/null; do
    sleep 2; elapsed=$((elapsed + 2))
    if [ -f "$tmpfile" ]; then
      local current_size; current_size=$(wc -c < "$tmpfile" 2>/dev/null || echo 0)
      if [ "$current_size" -gt "$last_size" ]; then
        stream_result "$id" "$(tail -c 4000 "$tmpfile" 2>/dev/null)"
        last_size=$current_size
      fi
    fi
    if [ "$elapsed" -ge "$timeout" ]; then
      kill "$pid" 2>/dev/null || true
      update_status "$id" "error" "Timed out after ${timeout}s. Partial:\n$(tail -c 3000 "$tmpfile" 2>/dev/null)"
      rm -f "$tmpfile"; return
    fi
  done

  wait "$pid" 2>/dev/null; local exit_code=$?
  local result=""; [ -f "$tmpfile" ] && result=$(tail -c 4000 "$tmpfile") && rm -f "$tmpfile"
  if [ $exit_code -eq 0 ]; then update_status "$id" "done" "$result"; log "Done (exit 0)"
  else update_status "$id" "error" "$result"; log "Error (exit $exit_code)"; fi
}

run_shell() {
  local id="$1" cmd="$2" project_dir="$3"
  log "Running shell in: ${project_dir:-$HOME}"
  local result
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    result=$(cd "$project_dir" && bash -c "$cmd" 2>&1 | tail -c 4000)
  else
    result=$(bash -c "$cmd" 2>&1 | tail -c 4000)
  fi
  [ $? -eq 0 ] && update_status "$id" "done" "$result" || update_status "$id" "error" "$result"
}

run_cursor() {
  local id="$1" cmd="$2" project_dir="$3"
  log "Routing to Cursor"
  # Open project in Cursor if specified
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    open -a "Cursor" "$project_dir" 2>/dev/null
    sleep 1
  fi
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
  update_status "$id" "done" "Sent to Cursor AI: $cmd"
}

run_copilot() {
  local id="$1" cmd="$2" project_dir="$3"
  log "Routing to VS Code Copilot"
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    open -a "Visual Studio Code" "$project_dir" 2>/dev/null
    sleep 1
  fi
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
  update_status "$id" "done" "Sent to Copilot: $cmd"
}

run_chatgpt() {
  local id="$1" cmd="$2"
  log "Opening ChatGPT"
  echo -n "$cmd" | pbcopy
  open "https://chatgpt.com/" 2>/dev/null
  sleep 2
  osascript -e '
    tell application "System Events"
      tell process "Google Chrome"
        keystroke "v" using command down
        delay 0.3
        key code 36
      end tell
    end tell
  ' 2>&1
  update_status "$id" "done" "Sent to ChatGPT: $cmd — check browser"
}

run_gemini() {
  local id="$1" cmd="$2"
  log "Opening Gemini"
  echo -n "$cmd" | pbcopy
  open "https://gemini.google.com/" 2>/dev/null
  sleep 2
  osascript -e '
    tell application "System Events"
      tell process "Google Chrome"
        keystroke "v" using command down
        delay 0.3
        key code 36
      end tell
    end tell
  ' 2>&1
  update_status "$id" "done" "Sent to Gemini: $cmd — check browser"
}

run_claude_web() {
  local id="$1" cmd="$2"
  log "Opening Claude Web"
  echo -n "$cmd" | pbcopy
  open "https://claude.ai/new" 2>/dev/null
  sleep 2
  osascript -e '
    tell application "System Events"
      tell process "Google Chrome"
        keystroke "v" using command down
        delay 0.3
        key code 36
      end tell
    end tell
  ' 2>&1
  update_status "$id" "done" "Sent to Claude Web: $cmd — check browser"
}

run_aider() {
  local id="$1" cmd="$2" project_dir="$3"
  log "Running Aider in: $project_dir"
  local tmpfile="$SESSION_DIR/output-${id}"
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    (cd "$project_dir" && aider --message "$cmd" --yes 2>&1) > "$tmpfile" &
  else
    (aider --message "$cmd" --yes 2>&1) > "$tmpfile" &
  fi
  local pid=$!
  local last_size=0 elapsed=0 timeout=300
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2; elapsed=$((elapsed + 2))
    if [ -f "$tmpfile" ]; then
      local current_size; current_size=$(wc -c < "$tmpfile" 2>/dev/null || echo 0)
      if [ "$current_size" -gt "$last_size" ]; then
        stream_result "$id" "$(tail -c 4000 "$tmpfile" 2>/dev/null)"
        last_size=$current_size
      fi
    fi
    if [ "$elapsed" -ge "$timeout" ]; then
      kill "$pid" 2>/dev/null || true
      update_status "$id" "error" "Timed out. Partial:\n$(tail -c 3000 "$tmpfile" 2>/dev/null)"
      rm -f "$tmpfile"; return
    fi
  done
  wait "$pid" 2>/dev/null; local exit_code=$?
  local result=""; [ -f "$tmpfile" ] && result=$(tail -c 4000 "$tmpfile") && rm -f "$tmpfile"
  [ $exit_code -eq 0 ] && update_status "$id" "done" "$result" || update_status "$id" "error" "$result"
}

# ═══════════════════════════════════════════
# MAC ACTIONS
# ═══════════════════════════════════════════

run_mac_action() {
  local id="$1" action="$2"
  local mac_cmd; mac_cmd=$(get_mac_action "$action")
  if [ -n "$mac_cmd" ]; then
    log "Mac action: $action → $mac_cmd"
    eval "$mac_cmd" 2>&1
    update_status "$id" "done" "Executed: $action"
  else
    update_status "$id" "error" "Unknown action: $action"
  fi
}

# ═══════════════════════════════════════════
# COMMAND ROUTER
# ═══════════════════════════════════════════

route_command() {
  local id="$1" cmd="$2" project="$3" tool="$4"
  local cmd_lower; cmd_lower=$(echo "$cmd" | tr '[:upper:]' '[:lower:]')

  # --- Safety check: block dangerous commands ---
  if echo "$cmd_lower" | grep -qE "(rm -rf|rm -r /|drop table|drop database|format |mkfs|dd if=|shutdown|reboot|git push.*--force|git reset --hard|:(){ :|:& };:)"; then
    log "BLOCKED dangerous command: $cmd"
    update_status "$id" "error" "BLOCKED: This command is potentially destructive and was not executed.\n\nCommand: $cmd\n\nIf you really need to run this, use the shell tool with the exact command."
    return
  fi

  # --- Special commands (before tool routing) ---

  # NEW WARP + CLAUDE (like v1: opens new tab with Claude in project dir)
  if echo "$cmd_lower" | grep -qE "(new claude|start claude|open claude|claude chat|new chat|new warp|open warp)"; then
    local project_dir="$HOME"
    if [ "$project" != "general" ] && [ -n "$project" ]; then
      project_dir=$(get_project_dir "$project")
      [ -z "$project_dir" ] || [ ! -d "$project_dir" ] && project_dir="$HOME"
    fi
    open_warp_claude "$project_dir" "$project"
    update_status "$id" "done" "Opened new Warp tab with Claude in: $project ($project_dir)"
    return
  fi

  # TYPE INTO EXISTING WARP SESSION
  if echo "$cmd_lower" | grep -qE "^(>|type:|type |send:|send )"; then
    local msg; msg=$(echo "$cmd" | sed -E 's/^(>|type:|type |send:|send )[[:space:]]*//')
    type_into_warp "$msg"
    update_status "$id" "done" "Typed into Warp: $msg"
    return
  fi

  # MAC ACTIONS (open app, lock, screenshot)
  local mac_cmd; mac_cmd=$(get_mac_action "$cmd_lower")
  if [ -n "$mac_cmd" ]; then
    run_mac_action "$id" "$cmd_lower"
    return
  fi
  # Partial match: "open X"
  if echo "$cmd_lower" | grep -qE "^open "; then
    local app_name; app_name=$(echo "$cmd_lower" | sed 's/^open //')
    mac_cmd=$(get_mac_action "open $app_name")
    if [ -n "$mac_cmd" ]; then
      run_mac_action "$id" "open $app_name"
      return
    fi
    # Open URL
    if echo "$cmd_lower" | grep -qE "^open https?://"; then
      local url; url=$(echo "$cmd" | sed 's/^[Oo]pen //')
      open "$url" 2>/dev/null
      update_status "$id" "done" "Opened $url"
      return
    fi
  fi

  # GIT SHORTCUTS
  if echo "$cmd_lower" | grep -qE "^(git pull|git push|git status|git log|git diff|git commit|git branch|git checkout|git stash)"; then
    local project_dir="$HOME"
    if [ "$project" != "general" ] && [ -n "$project" ]; then
      project_dir=$(get_project_dir "$project")
      [ -z "$project_dir" ] || [ ! -d "$project_dir" ] && project_dir="$HOME"
    fi
    run_shell "$id" "$cmd" "$project_dir"
    return
  fi

  # NPM/YARN SHORTCUTS
  if echo "$cmd_lower" | grep -qE "^(npm |yarn |pnpm |npx )"; then
    local project_dir="$HOME"
    if [ "$project" != "general" ] && [ -n "$project" ]; then
      project_dir=$(get_project_dir "$project")
      [ -z "$project_dir" ] || [ ! -d "$project_dir" ] && project_dir="$HOME"
    fi
    run_shell "$id" "$cmd" "$project_dir"
    return
  fi

  # --- Tool-based routing ---

  local project_dir=""
  if [ "$project" != "general" ] && [ -n "$project" ]; then
    project_dir=$(get_project_dir "$project")
    [ -z "$project_dir" ] || [ ! -d "$project_dir" ] && project_dir="$HOME"
  else
    project_dir="$HOME"
  fi

  case "${tool:-$DEFAULT_TOOL}" in
    claude-code)
      # SMART ROUTING:
      # - Project selected → type into existing Warp session (saves tokens, keeps conversation)
      #   If no Warp session exists, open one first then type
      # - No project ("general") → silent claude -p, result to phone (quick one-shot)
      if [ "$project" != "general" ] && [ -n "$project" ]; then
        log "Smart route: project '$project' → typing into Warp session"
        # Type the command into the last Warp Claude tab
        # (user should have a session open for this project)
        type_into_warp "$cmd"
        update_status "$id" "done" "Typed into Warp Claude session: $cmd — check laptop screen"
      else
        run_claude_code "$id" "$cmd" "$project_dir"
      fi
      ;;
    warp)
      # Always open a NEW Warp tab with Claude in the project dir
      open_warp_claude "$project_dir" "$project"
      update_status "$id" "done" "Opened new Warp+Claude tab for: $project ($project_dir)"
      ;;
    shell)         run_shell "$id" "$cmd" "$project_dir" ;;
    cursor)        run_cursor "$id" "$cmd" "$project_dir" ;;
    copilot)       run_copilot "$id" "$cmd" "$project_dir" ;;
    chatgpt)       run_chatgpt "$id" "$cmd" ;;
    gemini)        run_gemini "$id" "$cmd" ;;
    claude-web)    run_claude_web "$id" "$cmd" ;;
    aider)         run_aider "$id" "$cmd" "$project_dir" ;;
    *)             log "Unknown tool: $tool, using claude-code"
                   run_claude_code "$id" "$cmd" "$project_dir" ;;
  esac
}

# ═══════════════════════════════════════════
# MAIN LOOP
# ═══════════════════════════════════════════

echo "╔═══════════════════════════════════════════╗"
echo "║         NAVI HQ v2.1 — Listener           ║"
echo "║  ID: $LISTENER_ID"
echo "║  Config: $CONFIG_FILE"
echo "║  Tools: claude-code, warp, cursor, copilot,"
echo "║         chatgpt, gemini, claude-web, aider,"
echo "║         shell"
echo "║  Polling: every ${POLL_SEC}s                      ║"
echo "║  Waiting for commands...                   ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

cleanup() {
  log "Shutting down..."
  pkill -P $$ 2>/dev/null || true
  curl -s -X PATCH "${SB_URL}/rest/v1/laptops?id=eq.${LISTENER_ID}" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status":"offline"}' > /dev/null 2>&1
  rm -rf "$SESSION_DIR"/output-* 2>/dev/null
  log "Stopped."
}
trap cleanup EXIT

while true; do
  heartbeat

  ROW=$(curl -s "${SB_URL}/rest/v1/commands?status=eq.pending&order=created_at.asc&limit=1" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" 2>/dev/null || echo "[]")

  ID=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || true)

  if [ -n "$ID" ]; then
    CMD=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['command'])" 2>/dev/null)
    PROJ=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('project','general'))" 2>/dev/null)
    TOOL=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('tool','claude-code'))" 2>/dev/null)
    SECRET=$(echo "$ROW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('secret',''))" 2>/dev/null)

    # Accept new secret OR old secret (for cached phone pages)
    OLD_SECRET="navi_2024_xk9m"
    if [ -n "$SHARED_SECRET" ] && [ "$SECRET" != "$SHARED_SECRET" ] && [ "$SECRET" != "$OLD_SECRET" ]; then
      log "Rejected (bad secret): $CMD"
      update_status "$ID" "error" "Rejected: invalid secret"
      sleep "$POLL_SEC"; continue
    fi

    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "Command: $CMD"
    log "Project: $PROJ | Tool: $TOOL"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    curl -s -X PATCH "${SB_URL}/rest/v1/commands?id=eq.${ID}" \
      -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"running\",\"laptop_id\":\"${LISTENER_ID}\"}" > /dev/null 2>&1

    route_command "$ID" "$CMD" "$PROJ" "$TOOL"
    log "Done."
    echo ""
  fi

  sleep "$POLL_SEC"
done
