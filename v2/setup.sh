#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Navi HQ — Setup Wizard
#
# Generates config, builds dashboard, installs listener daemon.
#
# Usage: bash setup.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/navi-config.json"
DASHBOARD_TEMPLATE="$SCRIPT_DIR/index.html"
DASHBOARD_OUTPUT="$SCRIPT_DIR/dist/index.html"
PLIST_NAME="com.navihq.listener"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       Navi HQ — Setup Wizard          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""

# ─── Step 1: Supabase ───
echo -e "${BLUE}Step 1/5: Supabase Connection${NC}"
echo ""

read -p "Supabase project URL (e.g. https://xxx.supabase.co): " SB_URL
read -p "Supabase anon key: " SB_KEY

# Validate connection
echo -n "Testing connection... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${SB_URL}/rest/v1/" -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}")
if [ "$STATUS" = "200" ]; then
  echo -e "${GREEN}Connected!${NC}"
else
  echo -e "${YELLOW}Warning: Got HTTP $STATUS. Check your URL/key. Continuing anyway...${NC}"
fi
echo ""

# ─── Step 2: Security ───
echo -e "${BLUE}Step 2/5: Security Setup${NC}"
echo ""

# PIN
while true; do
  read -sp "Set a PIN (4-6 digits): " PIN
  echo ""
  if [[ "$PIN" =~ ^[0-9]{4,6}$ ]]; then
    break
  fi
  echo -e "${RED}PIN must be 4-6 digits${NC}"
done

PIN_HASH=$(echo -n "$PIN" | shasum -a 256 | cut -d' ' -f1)
echo -e "${GREEN}PIN hash generated${NC}"

# Shared secret
SHARED_SECRET="navi_$(date +%s)_$(openssl rand -hex 4)"
echo -e "Shared secret: ${YELLOW}$SHARED_SECRET${NC}"
echo "(This is used to validate commands. Keep it private.)"
echo ""

# ─── Step 3: Discover Projects ───
echo -e "${BLUE}Step 3/5: Project Discovery${NC}"
echo ""

SEARCH_DIR="$HOME"
read -p "Search for projects in [$SEARCH_DIR]: " CUSTOM_DIR
if [ -n "$CUSTOM_DIR" ]; then
  SEARCH_DIR="$CUSTOM_DIR"
fi

echo "Scanning for git repos..."
PROJECTS_JSON="{"
PROJECT_COUNT=0

while IFS= read -r git_dir; do
  dir=$(dirname "$git_dir")
  name=$(basename "$dir")
  slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')

  # Skip hidden dirs and node_modules
  if [[ "$name" == .* ]] || [[ "$dir" == *node_modules* ]]; then
    continue
  fi

  echo -e "  Found: ${GREEN}$name${NC} ($dir)"

  read -p "    Include? [Y/n]: " INCLUDE
  if [[ "$INCLUDE" =~ ^[Nn]$ ]]; then
    continue
  fi

  read -p "    Display name [$name]: " DISPLAY_NAME
  DISPLAY_NAME="${DISPLAY_NAME:-$name}"

  read -p "    Live URL (blank to skip): " LIVE_URL

  if [ $PROJECT_COUNT -gt 0 ]; then
    PROJECTS_JSON+=","
  fi

  # Escape the directory path for JSON
  ESCAPED_DIR=$(python3 -c "import json; print(json.dumps('$dir'))")

  PROJECTS_JSON+="
    \"$slug\": {
      \"name\": $(python3 -c "import json; print(json.dumps('$DISPLAY_NAME'))"),
      \"dir\": $ESCAPED_DIR,
      \"url\": $([ -n "$LIVE_URL" ] && python3 -c "import json; print(json.dumps('$LIVE_URL'))" || echo 'null'),
      \"tags\": [],
      \"quick_actions\": [\"git status\", \"run tests\"]
    }"

  PROJECT_COUNT=$((PROJECT_COUNT + 1))

done < <(find "$SEARCH_DIR" -maxdepth 4 -name ".git" -type d 2>/dev/null | head -20)

PROJECTS_JSON+="
}"

echo ""
echo -e "${GREEN}Found $PROJECT_COUNT projects${NC}"
echo ""

# ─── Step 4: Generate Config ───
echo -e "${BLUE}Step 4/5: Generating Config${NC}"
echo ""

# Generate listener ID
LISTENER_ID="laptop-$(hostname -s)-$(openssl rand -hex 3)"

cat > "$CONFIG_FILE" << JSONEOF
{
  "supabase_url": "$SB_URL",
  "supabase_anon_key": "$SB_KEY",
  "shared_secret": "$SHARED_SECRET",
  "listener_id": "$LISTENER_ID",
  "default_tool": "claude-code",
  "projects": $PROJECTS_JSON,
  "tools": {
    "claude-code": { "type": "cli", "command": "claude", "flags": "--max-turns 10" },
    "cursor": { "type": "applescript", "app": "Cursor", "shortcut": "Cmd+L" },
    "shell": { "type": "direct" },
    "copilot": { "type": "applescript", "app": "Visual Studio Code", "shortcut": "Cmd+Shift+P" }
  },
  "mac_actions": {
    "open chrome": "open -a 'Google Chrome'",
    "open safari": "open -a 'Safari'",
    "open warp": "open -a 'Warp'",
    "open finder": "open -a 'Finder'",
    "open vscode": "open -a 'Visual Studio Code'",
    "lock": "pmset displaysleepnow",
    "screenshot": "screencapture -x ~/Desktop/navi-screenshot-\$(date +%s).png"
  }
}
JSONEOF

echo -e "${GREEN}Config saved to: $CONFIG_FILE${NC}"

# ─── Step 5: Build Dashboard ───
echo -e "${BLUE}Step 5/5: Building Dashboard${NC}"
echo ""

mkdir -p "$SCRIPT_DIR/dist"

# Extract JSON blocks for template replacement
PROJECTS_FOR_HTML=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(json.dumps(c['projects'],indent=2))")
MAC_ACTIONS_FOR_HTML=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(json.dumps(c['mac_actions'],indent=2))")
TOOLS_FOR_HTML=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(json.dumps(c['tools'],indent=2))")

# Template replace
python3 << PYEOF
import re

with open('$DASHBOARD_TEMPLATE', 'r') as f:
    html = f.read()

replacements = {
    "'__SUPABASE_URL__'": "'$SB_URL'",
    "'__SUPABASE_ANON_KEY__'": "'$SB_KEY'",
    "'__SHARED_SECRET__'": "'$SHARED_SECRET'",
    "'__PIN_HASH__'": "'$PIN_HASH'",
    "__PROJECTS_JSON__": """$PROJECTS_FOR_HTML""",
    "__MAC_ACTIONS_JSON__": """$MAC_ACTIONS_FOR_HTML""",
    "__TOOLS_JSON__": """$TOOLS_FOR_HTML"""
}

for placeholder, value in replacements.items():
    html = html.replace(placeholder, value)

with open('$DASHBOARD_OUTPUT', 'w') as f:
    f.write(html)

print("Dashboard built successfully")
PYEOF

echo -e "${GREEN}Dashboard saved to: $DASHBOARD_OUTPUT${NC}"
echo ""

# ─── Optional: Install Listener Daemon ───
echo -e "${YELLOW}Optional: Install listener as background service?${NC}"
read -p "This starts the listener automatically on login. [y/N]: " INSTALL_DAEMON

if [[ "$INSTALL_DAEMON" =~ ^[Yy]$ ]]; then
  cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT_DIR/navi-listener.sh</string>
    <string>$CONFIG_FILE</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/navi-listener.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/navi-listener-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
PLISTEOF

  launchctl load "$PLIST_PATH" 2>/dev/null || true
  echo -e "${GREEN}Listener daemon installed and started!${NC}"
  echo "  Logs: /tmp/navi-listener.log"
  echo "  Stop: launchctl unload $PLIST_PATH"
else
  echo ""
  echo "To run the listener manually:"
  echo -e "  ${YELLOW}bash $SCRIPT_DIR/navi-listener.sh${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo "  1. Run the Supabase migration:"
echo -e "     ${YELLOW}Copy migrations/001_setup.sql into your Supabase SQL editor${NC}"
echo ""
echo "  2. Open the dashboard on your phone:"
echo -e "     ${YELLOW}$DASHBOARD_OUTPUT${NC}"
echo "     (or deploy dist/index.html to GitHub Pages)"
echo ""
echo "  3. Start the listener (if not installed as daemon):"
echo -e "     ${YELLOW}bash $SCRIPT_DIR/navi-listener.sh${NC}"
echo ""
