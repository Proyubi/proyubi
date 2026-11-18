#!/usr/bin/env bash
#
# Proyubi server 本地启动脚本
#
# 用法: ./run.sh [run|jar]
#   run = mvn spring-boot:run（默认；改代码需重启）
#   jar = 先 package 再 java -jar
#
# 环境变量从 server/.env.dev（或 .env.local / .env）自动加载，见 DotEnvEnvironmentPostProcessor。
# 可选: SKIP_DEPS=1 跳过兄弟模块 install；DEBUG_PORT=5005 开启远程调试。
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-run}"
JAR="proyubi-server/target/proyubi-server-0.1.0-SNAPSHOT.jar"

[[ -f .env.dev ]] || echo "⚠️  未找到 .env.dev（复制 .env.dev.example 后填写）"

RUN_DEBUG_ARG=()
JAR_DEBUG_OPTS=""
if [[ -n "${DEBUG_PORT:-}" ]]; then
  JDWP="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${DEBUG_PORT}"
  RUN_DEBUG_ARG=("-Dspring-boot.run.jvmArguments=${JDWP}")
  JAR_DEBUG_OPTS="$JDWP"
fi

case "$MODE" in
  jar)
    mvn -q -pl proyubi-server -am package -DskipTests -Pdev
    exec java ${JAR_DEBUG_OPTS:+$JAR_DEBUG_OPTS} -jar "$JAR" --spring.profiles.active=dev ;;
  run)
    # spring-boot:run 只在 proyubi-server 上执行，先把兄弟模块装进本地 .m2
    [[ "${SKIP_DEPS:-0}" == "1" ]] || mvn -q -pl proyubi-server -am install -DskipTests -Pdev
    exec mvn -pl proyubi-server spring-boot:run -Pdev ${RUN_DEBUG_ARG[@]+"${RUN_DEBUG_ARG[@]}"} ;;
  *)
    echo "未知 mode: $MODE（可选 run | jar）"; exit 1 ;;
esac
