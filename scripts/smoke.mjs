// dist スモークテスト — バンドラを介さない Node ネイティブ ESM で公開物が動くか
//
// vitest は src を Vite 経由で解決するため、「dist の相対 import が Node で
// 解決できるか」（拡張子の有無）はここでしか検知できない。`pnpm build` 後に実行する。

import { parse, stringify } from '../dist/index.js'

const rows = [{ name: 'Alice', age: '30' }]
const csv = stringify(rows, { headers: ['name', 'age'] })
const result = parse(csv)

if (!result.ok) throw new Error(`parse 失敗: ${result.error.type} ${result.error.message}`)
const r0 = result.data[0]
if (r0?.name !== 'Alice' || r0?.age !== '30') {
  throw new Error(`往復結果が不一致: ${JSON.stringify(result.data)}`)
}
console.log('✓ dist smoke OK（Node ネイティブ ESM で stringify → parse 往復一致）')
