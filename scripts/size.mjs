// バンドルサイズゲート（公開エントリの gzip が上限内かを検査）
//
// gzip 4KB 超過で exit 1。依存は esbuild（既存 devDep）と node:zlib のみ。
// `pnpm size:check` で実行する。

import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

/** gzip の LIMIT（バイト）。現状 gzip 約 1.4KB に対し、回帰検知の余白として 4KB で張る */
const LIMIT = 4 * 1024

/** 計測対象エントリ（公開する import 単位） */
const ENTRIES = [{ label: 'web-csv', entry: 'src/index.ts' }]

/** 1 エントリを本番と同じ設定でバンドルし min / gzip を返す */
async function measure(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    write: false,
  })
  const code = result.outputFiles[0].contents
  return { min: code.length, gzip: gzipSync(code).length }
}

const rows = []
for (const { label, entry } of ENTRIES) rows.push({ label, ...(await measure(entry)) })

const total = rows.reduce((sum, r) => sum + r.gzip, 0)
const fmt = (n) => `${(n / 1024).toFixed(2)} KB`

for (const r of rows) {
  console.log(
    `${r.label.padEnd(10)} min ${fmt(r.min).padStart(9)}  gzip ${fmt(r.gzip).padStart(9)}`,
  )
}
console.log(`合算${' '.repeat(7)}gzip ${fmt(total).padStart(9)}  / LIMIT ${fmt(LIMIT)}`)

if (total > LIMIT) {
  console.error(`\n✗ LIMIT 超過: 合算 ${fmt(total)} > ${fmt(LIMIT)}（超過 ${total - LIMIT} B）`)
  process.exit(1)
}
console.log(`\n✓ LIMIT 内（余白 ${fmt(LIMIT - total)}）`)
