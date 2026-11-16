#!/usr/bin/env bash
# اجرای ParsBot در لینوکس / مک
set -u
cd "$(dirname "$0")"

echo
echo " ═══════════════════════════════════════"
echo "   ParsBot — بررسی پیش‌نیازها"
echo " ═══════════════════════════════════════"

if ! command -v node >/dev/null 2>&1; then
  echo " [!] Node.js نصب نیست. از https://nodejs.org نسخه LTS را نصب کن."
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 22 ]; then
  echo " [!] نسخه Node.js تو $MAJOR است؛ نسخه ۲۲ یا بالاتر لازم است."
  echo "     از https://nodejs.org نصب‌کننده LTS را بگیر."
  exit 1
fi

echo " بررسی وابستگی‌ها..."
if ! node scripts/ensure-deps.js; then
  echo
  echo " [!] آماده‌سازی وابستگی‌ها موفق نشد."
  echo "     راه سریع: دستور «cd parsbot && npm install» را بزن، بعد start.sh را دوباره اجرا کن."
  exit 1
fi

echo
echo " در حال اجرای ParsBot... (Ctrl+C برای توقف)"
echo
exec node src/index.js "$@"
