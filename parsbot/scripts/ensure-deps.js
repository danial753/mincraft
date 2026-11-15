// اگر پوشه‌ی ../mineflayer کنارِ این پروژه نیست، وابستگی را به نسخه‌ی npm تغییر می‌دهد تا npm install خطا ندهد.
const fs = require('fs')
const path = require('path')
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const local = path.join(__dirname, '..', '..', 'mineflayer', 'package.json')
if (pkg.dependencies.mineflayer && pkg.dependencies.mineflayer.startsWith('file:') && !fs.existsSync(local)) {
  pkg.dependencies.mineflayer = '^4.39.0'
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log('mineflayer folder not found next to parsbot -> using the npm version of mineflayer')
}
