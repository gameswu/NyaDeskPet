#!/bin/bash
echo "编译 TypeScript 项目..."

echo ""
echo "[1/2] 编译主进程和预加载脚本..."
tsc -p .

echo ""
echo "[2/2] 编译渲染进程..."
tsc -p renderer

echo ""
echo "编译完成！"
