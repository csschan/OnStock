#!/bin/bash
# OnStock 一键启动脚本
# 用法：bash start.sh

cd "$(dirname "$0")"

echo "=== 停止旧进程 ==="
pkill -f "ts-node|nodemon|next dev" 2>/dev/null
sleep 2

echo "=== 启动 Server (port 4000) ==="
(cd server && npm run dev) > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

echo "=== 等待 Server 就绪 ==="
for i in $(seq 1 20); do
  sleep 1
  if curl -s http://localhost:4000/api/health > /dev/null 2>&1; then
    echo "Server OK"
    break
  fi
done

echo "=== 启动 Web (port 3000) ==="
(cd web && npm run dev) > /tmp/web.log 2>&1 &
WEB_PID=$!
echo "Web PID: $WEB_PID"

echo ""
echo "=============================="
echo "OnStock 已启动："
echo "  Web:    http://localhost:3000"
echo "  Server: http://localhost:4000"
echo "  日志:   tail -f /tmp/server.log"
echo "          tail -f /tmp/web.log"
echo "=============================="
