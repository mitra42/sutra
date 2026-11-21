#!/bin/zsh
# Makes Sutra's servers start when you log in to the Mac, and start again if they ever stop.
#   zsh scripts/start-at-login.sh            set it up (or update it), and start them now
#   zsh scripts/start-at-login.sh status     are they running?
#   zsh scripts/start-at-login.sh remove     stop them and no longer start at login
# Two servers: the hub (while it lives on the laptop) and the laptop's own server. Each is a
# macOS "launch agent", a small file in ~/Library/LaunchAgents. Their output goes to
# app/data/server.log and app/data-hub/server.log.

set -e
APP="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
NODE="$(command -v node || true)"

names=(biz.mitra.sutra.hub biz.mitra.sutra.server)

plist() { # label role data-folder
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SUTRA_ROLE</key><string>$2</string>
    <key>SUTRA_DATA</key><string>$APP/$3</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$APP/$3/server.log</string>
  <key>StandardErrorPath</key><string>$APP/$3/server.log</string>
</dict>
</plist>
PLIST
}

case "${1:-install}" in
  install)
    if [[ -z "$NODE" ]]; then echo "Cannot find node. Run this from a terminal where 'node --version' works."; exit 1; fi
    if lsof -nP -iTCP:8470 -iTCP:8471 -sTCP:LISTEN 2>/dev/null | grep -q node; then
      echo "Sutra is already running in a terminal (port 8470 or 8471). Stop it there with Ctrl-C first, then run this again."
      exit 1
    fi
    mkdir -p "$AGENTS" "$APP/data" "$APP/data-hub"
    plist biz.mitra.sutra.hub hub data-hub > "$AGENTS/biz.mitra.sutra.hub.plist"
    plist biz.mitra.sutra.server node data > "$AGENTS/biz.mitra.sutra.server.plist"
    for n in $names; do
      launchctl bootout "$DOMAIN/$n" 2>/dev/null || true
      launchctl bootstrap "$DOMAIN" "$AGENTS/$n.plist"
    done
    sleep 3
    zsh "$0" status
    ;;
  status)
    for n in $names; do
      if launchctl print "$DOMAIN/$n" 2>/dev/null | grep -q "state = running"; then echo "$n: running"; else echo "$n: NOT running"; fi
    done
    curl -s -o /dev/null -w "laptop server answers: %{http_code}\n" http://localhost:8470/ || echo "laptop server does not answer"
    curl -s -o /dev/null -w "hub answers: %{http_code}\n" http://localhost:8471/ || echo "hub does not answer"
    echo "Logs: $APP/data/server.log and $APP/data-hub/server.log"
    ;;
  remove)
    for n in $names; do
      launchctl bootout "$DOMAIN/$n" 2>/dev/null || true
      rm -f "$AGENTS/$n.plist"
    done
    echo "Removed. Sutra no longer starts at login; start it by hand with npm start (and npm run hub)."
    ;;
  *)
    echo "Usage: zsh scripts/start-at-login.sh [install|status|remove]"; exit 1 ;;
esac
