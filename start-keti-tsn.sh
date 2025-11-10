#!/bin/bash

# KETI TSN Management System Launcher
# 더블클릭 실행 가능

cd "$(dirname "$0")"

# 기존 로그 파일 제거
rm -f last_log.mvdct.json

echo "╔══════════════════════════════════════════════════════╗"
echo "║     KETI TSN Management System Starting...          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check if device is connected
if [ ! -e "/dev/ttyACM1" ] && [ ! -e "/dev/ttyACM0" ]; then
    echo "⚠️  경고: LAN9662 디바이스가 연결되지 않았습니다!"
    echo "   /dev/ttyACM* 을 찾을 수 없습니다."
    echo ""
    echo "계속하시겠습니까? (y/n)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "종료합니다."
        exit 1
    fi
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되지 않았습니다!"
    echo "   sudo apt install nodejs npm"
    exit 1
fi

# Check npm packages
if [ ! -d "node_modules" ]; then
    echo "📦 의존성 패키지를 설치합니다..."
    npm install
fi

# Start server
echo "🚀 서버를 시작합니다..."
echo ""

# Open browser after 2 seconds
(sleep 2 && xdg-open http://localhost:8080 2>/dev/null) &

# Start Node.js server (Official mup1cc)
node web-server-mup1cc.js