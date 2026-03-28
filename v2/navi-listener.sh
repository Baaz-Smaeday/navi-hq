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

set -uo pipefail
# Note: NOT using set -e because we don't want the listener to crash on transient errors

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

# --- GUI Helper ---
# Wraps osascript with launchctl asuser so GUI control works from background LaunchAgent
USER_ID=$(id -u)
gui_osascript() {
  launchctl asuser "$USER_ID" osascript "$@" 2>&1
}

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

# Decrypt ENC:: prefixed commands
decrypt_cmd() {
  local cmd="$1"
  if echo "$cmd" | grep -q "^ENC::"; then
    local encrypted; encrypted=$(echo "$cmd" | sed 's/^ENC:://')
    # Decrypt using Python + config encryption key
    local decrypted; decrypted=$(python3 -c "
import base64,json,hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
try:
    c=json.load(open('$CONFIG_FILE'))
    key_pass=c.get('encryption_key','navi-default-key')
    # PBKDF2 derive key (must match browser)
    import hashlib
    dk=hashlib.pbkdf2_hmac('sha256',key_pass.encode(),'navi-hq-salt'.encode(),100000,dklen=32)
    data=base64.b64decode('$encrypted')
    iv=data[:12]
    ct=data[12:]
    aesgcm=AESGCM(dk)
    print(aesgcm.decrypt(iv,ct,None).decode())
except Exception as e:
    print('DECRYPT_FAIL:'+str(e))
" 2>/dev/null)
    if echo "$decrypted" | grep -q "^DECRYPT_FAIL:"; then
      # Decryption failed, use original (might not be encrypted)
      echo "$cmd"
    else
      echo "$decrypted"
    fi
  else
    echo "$cmd"
  fi
}

get_project_field() {
  local project="$1" field="$2"
  python3 -c "
import json
c=json.load(open('$CONFIG_FILE'))
p=c.get('projects',{}).get('$project',{})
print(p.get('$field',''))
" 2>/dev/null
}

# ═══════════════════════════════════════════
# PREVIEW MANAGEMENT
# ═══════════════════════════════════════════

PREVIEW_REGISTRY="/tmp/navi-previews.json"

init_preview_registry() {
  if [ ! -f "$PREVIEW_REGISTRY" ]; then
    echo '{}' > "$PREVIEW_REGISTRY"
  fi
}

get_preview_info() {
  local project="$1"
  python3 -c "
import json
try:
    r=json.load(open('$PREVIEW_REGISTRY'))
    p=r.get('$project',{})
    if p: print(json.dumps(p))
    else: print('')
except: print('')
" 2>/dev/null
}

save_preview() {
  local project="$1" dev_pid="$2" tunnel_pid="$3" tunnel_url="$4" port="$5"
  python3 -c "
import json
r=json.load(open('$PREVIEW_REGISTRY'))
r['$project']={'dev_pid':$dev_pid,'tunnel_pid':$tunnel_pid,'tunnel_url':'$tunnel_url','port':$port,'started':'$(date -u +%Y-%m-%dT%H:%M:%SZ)'}
json.dump(r,open('$PREVIEW_REGISTRY','w'),indent=2)
" 2>/dev/null
}

remove_preview() {
  local project="$1"
  python3 -c "
import json
r=json.load(open('$PREVIEW_REGISTRY'))
r.pop('$project',None)
json.dump(r,open('$PREVIEW_REGISTRY','w'),indent=2)
" 2>/dev/null
}

start_preview() {
  local id="$1" project="$2"
  local project_dir; project_dir=$(get_project_dir "$project")
  local dev_cmd; dev_cmd=$(get_project_field "$project" "dev_cmd")
  local dev_port; dev_port=$(get_project_field "$project" "dev_port")

  if [ -z "$project_dir" ] || [ ! -d "$project_dir" ]; then
    update_status "$id" "error" "Project directory not found: $project"
    return
  fi
  if [ -z "$dev_cmd" ]; then
    update_status "$id" "error" "No dev_cmd configured for: $project"
    return
  fi
  if [ -z "$dev_port" ]; then
    dev_port=3000
  fi

  # Check if already running
  local existing; existing=$(get_preview_info "$project")
  if [ -n "$existing" ]; then
    local old_pid; old_pid=$(echo "$existing" | python3 -c "import sys,json; print(json.load(sys.stdin).get('dev_pid',''))" 2>/dev/null)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      local old_url; old_url=$(echo "$existing" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tunnel_url',''))" 2>/dev/null)
      update_status "$id" "done" "Preview already running for $project\n\nURL: $old_url\nPort: $dev_port"
      return
    fi
    # Old preview is dead, clean up
    remove_preview "$project"
  fi

  log "Starting preview for $project: $dev_cmd (port $dev_port)"
  stream_result "$id" "Starting dev server for $project..."

  # Kill anything on the port first
  lsof -ti:$dev_port | xargs kill -9 2>/dev/null || true
  sleep 1

  # Start dev server
  local dev_log="$SESSION_DIR/preview-dev-${project}.log"
  (cd "$project_dir" && PORT=$dev_port $dev_cmd > "$dev_log" 2>&1) &
  local dev_pid=$!
  log "Dev server PID: $dev_pid"

  # Wait for dev server to be ready (max 30s)
  local elapsed=0
  while ! curl -s -o /dev/null "http://localhost:$dev_port" 2>/dev/null; do
    sleep 2; elapsed=$((elapsed + 2))
    if ! kill -0 "$dev_pid" 2>/dev/null; then
      local err_log=""; [ -f "$dev_log" ] && err_log=$(tail -c 2000 "$dev_log")
      update_status "$id" "error" "Dev server crashed.\n\n$err_log"
      remove_preview "$project"
      return
    fi
    if [ "$elapsed" -ge 30 ]; then
      stream_result "$id" "Dev server taking long, starting tunnel anyway..."
      break
    fi
    stream_result "$id" "Waiting for dev server... (${elapsed}s)"
  done

  stream_result "$id" "Dev server running on port $dev_port. Starting tunnel..."

  # Start tunnel (prefer cloudflared, fallback to localtunnel)
  local tunnel_log="$SESSION_DIR/preview-tunnel-${project}.log"
  if command -v cloudflared &>/dev/null; then
    cloudflared tunnel --url "http://localhost:$dev_port" > "$tunnel_log" 2>&1 &
  else
    npx localtunnel --port "$dev_port" > "$tunnel_log" 2>&1 &
  fi
  local tunnel_pid=$!
  log "Tunnel PID: $tunnel_pid"

  # Wait for tunnel URL (max 20s)
  local tunnel_url="" t_elapsed=0
  while [ -z "$tunnel_url" ]; do
    sleep 2; t_elapsed=$((t_elapsed + 2))
    if [ -f "$tunnel_log" ]; then
      tunnel_url=$(grep -oE 'https://[a-zA-Z0-9._-]+\.(trycloudflare\.com|loca\.lt)' "$tunnel_log" 2>/dev/null | head -1)
    fi
    if ! kill -0 "$tunnel_pid" 2>/dev/null; then
      local t_err=""; [ -f "$tunnel_log" ] && t_err=$(cat "$tunnel_log")
      update_status "$id" "error" "Tunnel failed to start.\n\n$t_err"
      kill "$dev_pid" 2>/dev/null || true
      remove_preview "$project"
      return
    fi
    if [ "$t_elapsed" -ge 20 ]; then
      update_status "$id" "error" "Tunnel timed out. Check network connection."
      kill "$dev_pid" 2>/dev/null || true
      kill "$tunnel_pid" 2>/dev/null || true
      remove_preview "$project"
      return
    fi
  done

  # Save to registry
  init_preview_registry
  save_preview "$project" "$dev_pid" "$tunnel_pid" "$tunnel_url" "$dev_port"
  log "Preview live: $tunnel_url"

  update_status "$id" "done" "Preview live for $(get_project_field "$project" "name")\n\nURL: $tunnel_url\nLocal: http://localhost:$dev_port\n\nOpen this URL on your phone to see the preview.\nThe tunnel will stay active until you stop it."
}

stop_preview() {
  local id="$1" project="$2"
  local existing; existing=$(get_preview_info "$project")
  if [ -z "$existing" ]; then
    update_status "$id" "done" "No preview running for $project"
    return
  fi

  local dev_pid; dev_pid=$(echo "$existing" | python3 -c "import sys,json; print(json.load(sys.stdin).get('dev_pid',''))" 2>/dev/null)
  local tunnel_pid; tunnel_pid=$(echo "$existing" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tunnel_pid',''))" 2>/dev/null)

  kill "$dev_pid" 2>/dev/null || true
  kill "$tunnel_pid" 2>/dev/null || true
  # Also kill child processes
  pkill -P "$dev_pid" 2>/dev/null || true
  pkill -P "$tunnel_pid" 2>/dev/null || true

  remove_preview "$project"
  log "Preview stopped for $project"
  update_status "$id" "done" "Preview stopped for $project"
}

list_previews() {
  local id="$1"
  init_preview_registry
  local result; result=$(python3 -c "
import json
r=json.load(open('$PREVIEW_REGISTRY'))
if not r:
    print('No active previews.')
else:
    lines=[]
    for proj,info in r.items():
        lines.append(f\"{proj}: {info.get('tunnel_url','?')} (port {info.get('port','?')})\")
    print('Active previews:\n' + '\n'.join(lines))
" 2>/dev/null)
  update_status "$id" "done" "$result"
}

# ═══════════════════════════════════════════
# WARP TAB MANAGEMENT
# ═══════════════════════════════════════════

TAB_REGISTRY="/tmp/navi-warp-tabs.json"

# Initialize tab registry if it doesn't exist
init_tab_registry() {
  if [ ! -f "$TAB_REGISTRY" ]; then
    echo '{"tabs":{},"next_index":1}' > "$TAB_REGISTRY"
  fi
}

# Get the tab index for a project (returns empty if not registered)
get_tab_index() {
  local project="$1"
  python3 -c "
import json
try:
    r=json.load(open('$TAB_REGISTRY'))
    idx=r.get('tabs',{}).get('$project',{}).get('index','')
    print(idx)
except: print('')
" 2>/dev/null
}

# Register a new tab for a project
register_tab() {
  local project="$1"
  python3 -c "
import json
r=json.load(open('$TAB_REGISTRY'))
idx=r.get('next_index',1)
r['tabs']['$project']={'index':idx}
r['next_index']=idx+1
json.dump(r,open('$TAB_REGISTRY','w'),indent=2)
print(idx)
" 2>/dev/null
}

# Reset tab registry (when Warp restarts or tabs get out of sync)
reset_tab_registry() {
  echo '{"tabs":{},"next_index":1}' > "$TAB_REGISTRY"
  log "Tab registry reset"
}

# Count Warp tabs via AppleScript
count_warp_tabs() {
  gui_osascript -e '
    tell application "System Events"
      tell process "Warp"
        count of windows
      end tell
    end tell
  ' 2>/dev/null || echo "0"
}

# Open a new Warp tab, cd to project, start Claude with auto-permissions
# Returns and registers the new tab index
open_warp_claude() {
  local project_dir="$1"
  local project_name="${2:-general}"

  init_tab_registry

  log "Opening new Warp tab with Claude for: $project_name ($project_dir)"

  # Register this tab
  local tab_idx
  tab_idx=$(register_tab "$project_name")
  log "Registered as tab $tab_idx"

  # Build the command to run in the new tab
  local warp_cmd
  if [ -n "$project_dir" ] && [ -d "$project_dir" ]; then
    warp_cmd="cd '$project_dir' && claude --dangerously-skip-permissions"
  else
    warp_cmd="claude --dangerously-skip-permissions"
  fi

  echo -n "$warp_cmd" | pbcopy

  gui_osascript <<'APPLESCRIPT'
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

# Open a new Warp tab AND type a message into it after Claude starts
open_warp_claude_with_msg() {
  local project_dir="$1"
  local project_name="${2:-general}"
  local msg="$3"

  # Open the tab first
  open_warp_claude "$project_dir" "$project_name"

  # Wait for Claude to be fully ready then type the message
  sleep 3
  echo -n "$msg" | pbcopy
  gui_osascript -e '
    tell application "System Events"
      tell process "Warp"
        keystroke "v" using command down
        delay 0.2
        key code 36
      end tell
    end tell
  '
}

# Switch to a specific Warp tab by index and type a message
type_into_warp_tab() {
  local tab_idx="$1"
  local msg="$2"

  echo -n "$msg" | pbcopy

  # Cmd+1 through Cmd+9 to switch tabs
  gui_osascript -e "
    tell application \"Warp\" to activate
    delay 0.3
    tell application \"System Events\"
      tell process \"Warp\"
        keystroke \"$tab_idx\" using command down
        delay 0.5
        keystroke \"v\" using command down
        delay 0.2
        key code 36
      end tell
    end tell
  "
}

# Smart: type into the right project tab, or open a new one
smart_warp_route() {
  local project="$1"
  local project_dir="$2"
  local msg="$3"

  init_tab_registry

  local tab_idx
  tab_idx=$(get_tab_index "$project")

  if [ -n "$tab_idx" ]; then
    # Project already has a tab — activate Warp and paste into it
    log "Project '$project' → existing tab $tab_idx, typing message"
    echo -n "$msg" | pbcopy
    gui_osascript -e "
      tell application \"Warp\" to activate
      delay 0.5
      tell application \"System Events\"
        tell process \"Warp\"
          keystroke \"$tab_idx\" using command down
          delay 0.5
          keystroke \"v\" using command down
          delay 0.2
          key code 36
        end tell
      end tell
    "
  else
    # Check if Warp is running with any tabs — if so, just type into active tab
    local warp_running
    warp_running=$(pgrep -x "Warp" 2>/dev/null || true)
    if [ -n "$warp_running" ]; then
      # Warp is open — type into the last/active tab
      log "Project '$project' → Warp active, typing into current tab"
      echo -n "$msg" | pbcopy
      gui_osascript -e '
        tell application "Warp" to activate
        delay 0.5
        tell application "System Events"
          tell process "Warp"
            keystroke "v" using command down
            delay 0.2
            key code 36
          end tell
        end tell
      '
      register_tab "$project"
    else
      # Warp not running — open new tab with Claude
      log "Project '$project' → opening new Warp tab"
      open_warp_claude_with_msg "$project_dir" "$project" "$msg"
    fi
  fi
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
  gui_osascript -e '
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
  '
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
  gui_osascript -e '
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
  '
  update_status "$id" "done" "Sent to Copilot: $cmd"
}

run_chatgpt() {
  local id="$1" cmd="$2"
  log "Opening ChatGPT"
  echo -n "$cmd" | pbcopy
  open "https://chatgpt.com/" 2>/dev/null
  sleep 2
  gui_osascript -e '
    tell application "System Events"
      tell process "Google Chrome"
        keystroke "v" using command down
        delay 0.3
        key code 36
      end tell
    end tell
  '
  update_status "$id" "done" "Sent to ChatGPT: $cmd — check browser"
}

run_gemini() {
  local id="$1" cmd="$2"
  log "Opening Gemini"
  echo -n "$cmd" | pbcopy
  open "https://gemini.google.com/" 2>/dev/null
  sleep 2
  gui_osascript -e '
    tell application "System Events"
      tell process "Google Chrome"
        keystroke "v" using command down
        delay 0.3
        key code 36
      end tell
    end tell
  '
  update_status "$id" "done" "Sent to Gemini: $cmd — check browser"
}

run_claude_web() {
  local id="$1" cmd="$2"
  log "Opening Claude Web"
  echo -n "$cmd" | pbcopy
  open "https://claude.ai/new" 2>/dev/null
  sleep 2
  gui_osascript -e '
    tell application "System Events"
      tell process "Google Chrome"
        keystroke "v" using command down
        delay 0.3
        key code 36
      end tell
    end tell
  '
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
    # Route osascript commands through launchctl asuser for background compatibility
    if echo "$mac_cmd" | grep -q "^osascript"; then
      # Replace 'osascript' with 'launchctl asuser <uid> osascript' for GUI access
      local gui_cmd; gui_cmd=$(echo "$mac_cmd" | sed "s|^osascript|launchctl asuser $USER_ID osascript|")
      eval "$gui_cmd" 2>&1
    else
      eval "$mac_cmd" 2>&1
    fi
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

  # PREVIEW COMMANDS
  if echo "$cmd" | grep -q "^__navi_preview::"; then
    local preview_action; preview_action=$(echo "$cmd" | sed 's/__navi_preview:://' | cut -d: -f1)
    local preview_project; preview_project=$(echo "$cmd" | sed 's/__navi_preview:://' | sed 's/^[^:]*:://')
    case "$preview_action" in
      start) start_preview "$id" "$preview_project" ;;
      stop)  stop_preview "$id" "$preview_project" ;;
      list)  list_previews "$id" ;;
      *)     update_status "$id" "error" "Unknown preview action: $preview_action" ;;
    esac
    return
  fi

  # TEST & GIT COMMANDS
  if echo "$cmd" | grep -q "^__navi_"; then
    local navi_cmd; navi_cmd=$(echo "$cmd" | sed 's/^__navi_//' | cut -d: -f1)
    local navi_arg; navi_arg=$(echo "$cmd" | sed 's/^[^:]*:://' | sed 's/^[^:]*:://')
    local proj_dir="$HOME"
    if [ "$project" != "general" ] && [ -n "$project" ]; then
      proj_dir=$(get_project_dir "$project")
      [ -z "$proj_dir" ] || [ ! -d "$proj_dir" ] && proj_dir="$HOME"
    fi

    case "$navi_cmd" in
      test)
        log "Running tests in: $proj_dir"
        local test_cmd; test_cmd=$(get_project_field "$project" "test_cmd")
        [ -z "$test_cmd" ] && test_cmd="npm test"
        stream_result "$id" "Running: $test_cmd"
        local tmpfile="$SESSION_DIR/test-${id}"
        (cd "$proj_dir" && bash -c "$test_cmd" > "$tmpfile" 2>&1) &
        local tpid=$!
        local telapsed=0
        while kill -0 "$tpid" 2>/dev/null; do
          sleep 2; telapsed=$((telapsed + 2))
          [ -f "$tmpfile" ] && stream_result "$id" "$(tail -c 4000 "$tmpfile" 2>/dev/null)"
          if [ "$telapsed" -ge 120 ]; then
            kill "$tpid" 2>/dev/null || true
            update_status "$id" "error" "Test timed out after 120s\n$(tail -c 3000 "$tmpfile" 2>/dev/null)"
            rm -f "$tmpfile"; return
          fi
        done
        wait "$tpid" 2>/dev/null; local texit=$?
        local tresult=""; [ -f "$tmpfile" ] && tresult=$(tail -c 4000 "$tmpfile") && rm -f "$tmpfile"
        if [ $texit -eq 0 ]; then
          update_status "$id" "done" "Tests PASSED\n\n$tresult"
        else
          update_status "$id" "error" "Tests FAILED (exit $texit)\n\n$tresult"
        fi
        ;;

      build)
        log "Running build in: $proj_dir"
        local build_cmd; build_cmd=$(get_project_field "$project" "build_cmd")
        [ -z "$build_cmd" ] && build_cmd="npm run build"
        local bresult; bresult=$(cd "$proj_dir" && bash -c "$build_cmd" 2>&1 | tail -c 4000)
        [ $? -eq 0 ] && update_status "$id" "done" "Build PASSED\n\n$bresult" || update_status "$id" "error" "Build FAILED\n\n$bresult"
        ;;

      diff)
        log "Git diff in: $proj_dir"
        local diff_result; diff_result=$(cd "$proj_dir" && git diff --stat 2>&1 && echo "---DIFF---" && git diff 2>&1 | head -c 8000)
        update_status "$id" "done" "$diff_result"
        ;;

      diff_staged)
        log "Git diff staged in: $proj_dir"
        local sdiff; sdiff=$(cd "$proj_dir" && git diff --cached --stat 2>&1 && echo "---DIFF---" && git diff --cached 2>&1 | head -c 8000)
        update_status "$id" "done" "$sdiff"
        ;;

      status)
        log "Git status in: $proj_dir"
        local gstatus; gstatus=$(cd "$proj_dir" && git status 2>&1 && echo "" && echo "Branch: $(git branch --show-current 2>/dev/null)" && echo "Last commit: $(git log --oneline -1 2>/dev/null)")
        update_status "$id" "done" "$gstatus"
        ;;

      commit)
        log "Git commit in: $proj_dir"
        local cmsg="$navi_arg"
        [ -z "$cmsg" ] && cmsg="Update from Navi HQ"
        local cresult; cresult=$(cd "$proj_dir" && git add -A && git commit -m "$cmsg" 2>&1)
        [ $? -eq 0 ] && update_status "$id" "done" "Committed!\n\n$cresult" || update_status "$id" "error" "Commit failed\n\n$cresult"
        ;;

      push)
        log "Git push in: $proj_dir"
        local presult; presult=$(cd "$proj_dir" && git push 2>&1)
        [ $? -eq 0 ] && update_status "$id" "done" "Pushed!\n\n$presult" || update_status "$id" "error" "Push failed\n\n$presult"
        ;;

      pr)
        log "Creating PR in: $proj_dir"
        local pr_title="$navi_arg"
        [ -z "$pr_title" ] && pr_title="Update from Navi HQ"
        local prresult; prresult=$(cd "$proj_dir" && gh pr create --title "$pr_title" --body "Created from Navi HQ mobile dashboard" --fill 2>&1)
        [ $? -eq 0 ] && update_status "$id" "done" "PR Created!\n\n$prresult" || update_status "$id" "error" "PR failed\n\n$prresult"
        ;;

      branches)
        log "Listing branches in: $proj_dir"
        local blist; blist=$(cd "$proj_dir" && echo "Current: $(git branch --show-current 2>/dev/null)" && echo "" && git branch -a --format='%(refname:short) %(upstream:short) %(committerdate:relative)' 2>&1 | head -30)
        update_status "$id" "done" "$blist"
        ;;

      checkout)
        log "Checkout branch in: $proj_dir"
        local branch="$navi_arg"
        if [ -z "$branch" ]; then
          update_status "$id" "error" "No branch specified"
        else
          local coresult; coresult=$(cd "$proj_dir" && git checkout "$branch" 2>&1)
          [ $? -eq 0 ] && update_status "$id" "done" "Switched to: $branch\n\n$coresult" || update_status "$id" "error" "Checkout failed\n\n$coresult"
        fi
        ;;

      revert)
        log "Reverting last commit in: $proj_dir"
        local revresult; revresult=$(cd "$proj_dir" && git revert HEAD --no-edit 2>&1)
        [ $? -eq 0 ] && update_status "$id" "done" "Reverted last commit!\n\n$revresult" || update_status "$id" "error" "Revert failed\n\n$revresult"
        ;;

      log)
        log "Git log in: $proj_dir"
        local glog; glog=$(cd "$proj_dir" && git log --oneline --graph -20 2>&1)
        update_status "$id" "done" "$glog"
        ;;

      # ── FILE BROWSER ──
      ls)
        local target_path="$navi_arg"
        [ -z "$target_path" ] && target_path="$proj_dir"
        # Block dangerous paths
        if echo "$target_path" | grep -qE "(node_modules|\.git/|\.env)"; then
          update_status "$id" "error" "Blocked: cannot browse $target_path"
        else
          local listing; listing=$(ls -la "$target_path" 2>&1 | head -50)
          update_status "$id" "done" "Directory: $target_path\n\n$listing"
        fi
        ;;

      tree)
        local target_path="$navi_arg"
        [ -z "$target_path" ] && target_path="$proj_dir"
        local treeout; treeout=$(find "$target_path" -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' 2>/dev/null | head -80 | sed "s|$target_path/||" | sort)
        update_status "$id" "done" "Tree: $target_path\n\n$treeout"
        ;;

      cat)
        local filepath="$navi_arg"
        if [ -z "$filepath" ]; then
          update_status "$id" "error" "No file path specified"
        elif echo "$filepath" | grep -qE "(\.env|credentials|secret|\.key$)"; then
          update_status "$id" "error" "Blocked: cannot read sensitive file"
        elif [ ! -f "$filepath" ]; then
          update_status "$id" "error" "File not found: $filepath"
        else
          local fsize; fsize=$(wc -c < "$filepath" 2>/dev/null || echo 0)
          if [ "$fsize" -gt 50000 ]; then
            update_status "$id" "error" "File too large (${fsize} bytes). Max 50KB."
          else
            local content; content=$(cat "$filepath" 2>&1)
            local ext; ext=$(echo "$filepath" | sed 's/.*\.//')
            update_status "$id" "done" "File: $filepath ($ext, ${fsize}b)\n\n$content"
          fi
        fi
        ;;

      search)
        log "Searching in: $proj_dir"
        local pattern="$navi_arg"
        if [ -z "$pattern" ]; then
          update_status "$id" "error" "No search pattern"
        else
          local sresult; sresult=$(cd "$proj_dir" && grep -rn --include='*.{js,ts,tsx,jsx,py,json,css,html}' "$pattern" . 2>/dev/null | head -30 | sed "s|^\./||")
          [ -z "$sresult" ] && sresult="No matches found"
          update_status "$id" "done" "Search: $pattern\n\n$sresult"
        fi
        ;;

      # ── DEPLOY ──
      deploy)
        log "Deploying: $project"
        local deploy_cmd; deploy_cmd=$(get_project_field "$project" "deploy_cmd")
        [ -z "$deploy_cmd" ] && deploy_cmd="vercel --prod"
        stream_result "$id" "Deploying $project...\nRunning: $deploy_cmd"
        local tmpfile="$SESSION_DIR/deploy-${id}"
        (cd "$proj_dir" && bash -c "$deploy_cmd" > "$tmpfile" 2>&1) &
        local dpid=$!
        local delapsed=0
        while kill -0 "$dpid" 2>/dev/null; do
          sleep 3; delapsed=$((delapsed + 3))
          [ -f "$tmpfile" ] && stream_result "$id" "$(tail -c 4000 "$tmpfile" 2>/dev/null)"
          if [ "$delapsed" -ge 180 ]; then
            kill "$dpid" 2>/dev/null || true
            update_status "$id" "error" "Deploy timed out\n$(tail -c 3000 "$tmpfile" 2>/dev/null)"
            rm -f "$tmpfile"; return
          fi
        done
        wait "$dpid" 2>/dev/null; local dexit=$?
        local dresult=""; [ -f "$tmpfile" ] && dresult=$(tail -c 4000 "$tmpfile") && rm -f "$tmpfile"
        [ $dexit -eq 0 ] && update_status "$id" "done" "Deploy SUCCESS\n\n$dresult" || update_status "$id" "error" "Deploy FAILED\n\n$dresult"
        ;;

      # ── SCREENSHOT ──
      screenshot)
        log "Taking screenshot"
        local ssfile="/tmp/navi-screenshot-$(date +%s).png"
        screencapture -x "$ssfile" 2>/dev/null
        if [ -f "$ssfile" ]; then
          local ssb64; ssb64=$(base64 < "$ssfile" | tr -d '\n' | head -c 100000)
          local sssize; sssize=$(wc -c < "$ssfile")
          rm -f "$ssfile"
          update_status "$id" "done" "SCREENSHOT_B64::$ssb64"
        else
          update_status "$id" "error" "Screenshot failed"
        fi
        ;;

      # ── CLIPBOARD ──
      clipboard_get)
        log "Getting clipboard"
        local clip; clip=$(pbpaste 2>/dev/null | head -c 4000)
        update_status "$id" "done" "Clipboard:\n\n$clip"
        ;;

      clipboard_set)
        log "Setting clipboard"
        echo -n "$navi_arg" | pbcopy 2>/dev/null
        update_status "$id" "done" "Clipboard set to: ${navi_arg:0:100}"
        ;;

      # ── PIPELINE ──
      pipeline)
        log "Running pipeline in: $proj_dir"
        local steps; IFS='&&' read -ra steps <<< "$navi_arg"
        local step_num=0 total=${#steps[@]}
        local all_output=""
        for step in "${steps[@]}"; do
          step=$(echo "$step" | xargs) # trim
          step_num=$((step_num + 1))
          stream_result "$id" "Step $step_num/$total: $step\n$all_output"
          local sout; sout=$(cd "$proj_dir" && bash -c "$step" 2>&1 | tail -c 2000)
          local sexit=$?
          all_output="${all_output}\n--- Step $step_num: $step ---\n$sout\n"
          if [ $sexit -ne 0 ]; then
            update_status "$id" "error" "Pipeline FAILED at step $step_num/$total: $step\n$all_output"
            return
          fi
        done
        update_status "$id" "done" "Pipeline COMPLETE ($total steps)\n$all_output"
        ;;

      # ── SYSTEM INFO ──
      sysinfo)
        log "System info"
        local info="Hostname: $(hostname)\nUptime: $(uptime)\nDisk: $(df -h / | tail -1)\nMemory: $(vm_stat | head -5)\nBattery: $(pmset -g batt | tail -1)"
        update_status "$id" "done" "$info"
        ;;

      logs)
        log "Fetching logs for: $project"
        local log_cmd; log_cmd=$(get_project_field "$project" "log_cmd")
        [ -z "$log_cmd" ] && log_cmd="echo 'No log command configured'"
        local tmpfile="$SESSION_DIR/logs-${id}"
        (cd "$proj_dir" && bash -c "$log_cmd" > "$tmpfile" 2>&1) &
        local lpid=$!
        local lelapsed=0
        while kill -0 "$lpid" 2>/dev/null; do
          sleep 2; lelapsed=$((lelapsed + 2))
          [ -f "$tmpfile" ] && stream_result "$id" "$(tail -c 4000 "$tmpfile" 2>/dev/null)"
          if [ "$lelapsed" -ge 30 ]; then
            kill "$lpid" 2>/dev/null || true
            local lresult=""; [ -f "$tmpfile" ] && lresult=$(tail -c 4000 "$tmpfile") && rm -f "$tmpfile"
            update_status "$id" "done" "$lresult"
            return
          fi
        done
        wait "$lpid" 2>/dev/null
        local lresult=""; [ -f "$tmpfile" ] && lresult=$(tail -c 4000 "$tmpfile") && rm -f "$tmpfile"
        update_status "$id" "done" "$lresult"
        ;;

      *)
        update_status "$id" "error" "Unknown navi command: $navi_cmd"
        ;;
    esac
    return
  fi

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

  # TYPE / SEND PREFIX — run as claude -p, result to phone
  if echo "$cmd_lower" | grep -qE "^(>|type:|type |send:|send )"; then
    local msg; msg=$(echo "$cmd" | sed -E 's/^(>|type:|type |send:|send )[[:space:]]*//')
    local proj_dir="$HOME"
    if [ "$project" != "general" ] && [ -n "$project" ]; then
      proj_dir=$(get_project_dir "$project")
      [ -z "$proj_dir" ] || [ ! -d "$proj_dir" ] && proj_dir="$HOME"
    fi
    run_claude_code "$id" "$msg" "$proj_dir"
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
      # Always run claude -p silently — result streams back to phone
      # This works reliably from background LaunchAgent
      run_claude_code "$id" "$cmd" "$project_dir"
      ;;
    warp)
      # Open a NEW Warp tab with Claude in the project dir
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

# Keep existing tab registry (don't reset — tabs may still be open from before)
init_tab_registry

echo "╔═══════════════════════════════════════════╗"
echo "║         NAVI HQ v2.2 — Listener           ║"
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
    # Decrypt if encrypted
    CMD=$(decrypt_cmd "$CMD")
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
