#!/bin/bash
# Pixel Agents — macOS 로그인 시 자동 시작 설정

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
NODE_BIN="$(which node)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.pixel-agents.server.plist"
ENV_FILE="$REPO_DIR/.env"

if [ -z "$NODE_BIN" ]; then
  echo "❌ node를 찾을 수 없습니다. Node.js를 먼저 설치해주세요."
  exit 1
fi

# API 키 읽기
ANTHROPIC_API_KEY=""
if [ -f "$ENV_FILE" ]; then
  ANTHROPIC_API_KEY=$(grep -E "^ANTHROPIC_API_KEY=" "$ENV_FILE" | cut -d= -f2- | tr -d ' ')
fi

# 빌드 파일 확인
if [ ! -f "$REPO_DIR/dist/server.js" ]; then
  echo "⚙️  빌드 파일이 없습니다. 빌드를 실행합니다..."
  cd "$REPO_DIR"
  npm run build
fi

# 기존 LaunchAgent 제거
if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# plist 생성
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pixel-agents.server</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$REPO_DIR/dist/server.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ANTHROPIC_API_KEY</key>
        <string>$ANTHROPIC_API_KEY</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/pixel-agents.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/pixel-agents.log</string>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"
echo "✅ Pixel Agents 자동 시작 등록 완료"
echo "   로그: tail -f /tmp/pixel-agents.log"
echo "   접속: http://localhost:3456"
