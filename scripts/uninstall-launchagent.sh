#!/bin/bash
# Pixel Agents — macOS 자동 시작 제거

PLIST_PATH="$HOME/Library/LaunchAgents/com.pixel-agents.server.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "✅ Pixel Agents 자동 시작 제거 완료"
else
  echo "ℹ️  설치된 LaunchAgent가 없습니다"
fi

# 실행 중인 서버도 종료
pkill -f "pixel-agents/dist/server.js" 2>/dev/null && echo "   서버 프로세스 종료" || true
