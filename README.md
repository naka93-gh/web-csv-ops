# web-csv-ops

[![npm version](https://img.shields.io/npm/v/web-csv-ops.svg)](https://www.npmjs.com/package/web-csv-ops)
[![bundle size](https://deno.bundlejs.com/badge?q=web-csv-ops)](https://bundlejs.com/?q=web-csv-ops)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://www.npmjs.com/package/web-csv-ops?activeTab=dependencies)
[![types](https://img.shields.io/npm/types/web-csv-ops.svg)](https://www.npmjs.com/package/web-csv-ops)
[![license](https://img.shields.io/npm/l/web-csv-ops.svg)](./LICENSE)

ブラウザ・Node に対応した TypeScript 製の CSV parse/stringify ライブラリ。

## 特徴

- 外部依存なしの小バンドル
- Excel 互換（BOM 付き UTF-8・CRLF）と CSV インジェクション対策を既定で有効
- `parse` / `stringify` は Node でも動作（`downloadCSV` はブラウザ専用）
- Result 型による戻り値統一

## インストール

```bash
npm install web-csv-ops
pnpm add web-csv-ops
bun add web-csv-ops
```

- ESM 専用
- Node.js 22 以上
- ブラウザは現行版（`downloadCSV` は DOM 必須）

## Quick Start

### parse

CSV 文字列をオブジェクト配列にパースする。値は常に文字列で、数値・日付への自動変換はしない。

```ts
import { parse } from "web-csv-ops";

const result = parse("name,age\nAlice,30\nBob,25");
if (result.ok) {
  console.log(result.data);
  // [{ name: "Alice", age: "30" }, { name: "Bob", age: "25" }]
} else {
  console.error(`${result.error.message} (line: ${result.error.line})`);
}
```

ヘッダーが無い CSV は `options.headers` でキーを指定。

```ts
const result = parse("1,2\n3,4", { options: { headers: ["x", "y"] } });
// [{ x: "1", y: "2" }, { x: "3", y: "4" }]
```

### schema で型付き

`schema` を渡すと列ごとに型・必須・既定値・検証を適用し、型付き行（`data`）と行番号付きの検証エラー（`errors`）に分けて返す。失敗を例外でなく `errors` で扱うため「有効行だけ insert、エラー行は提示」がそのまま書ける。

```ts
import { parse, type Schema } from "web-csv-ops";

const schema = {
  名前: { prop: "name", type: "string", required: true },
  年齢: { prop: "age", type: "number" },
  入社日: { prop: "hireDate", type: "date" },
} satisfies Schema;

const result = parse(
  "名前,年齢,入社日\nAlice,30,2020-01-15\nBob,xx,2021-02-01",
  { schema },
);
if (result.ok) {
  console.log(result.data); // [{ name: "Alice", age: 30, hireDate: Date }]（Bob は年齢NGで除外）
  console.log(result.errors); // [{ row: 3, column: "年齢", value: "xx", message: "数値ではありません" }]
}
```

- 値の型は `type`（`string` / `number` / `boolean` / `date`）で決まる。`type: "string"` は恒等変換で先頭ゼロ（郵便番号など）を保つ
- `required` 未入力・型変換失敗・`validate` の NG は **その行だけ** `errors` に落ち、`data` には残らない

### parseFile

`<input type="file">` で取得した `File` をそのまま渡せる。読み込み失敗も Result 型で返る。ブラウザ専用 API なので `web-csv-ops/browser` から import する。

```ts
import { parseFile } from "web-csv-ops/browser";

const handleChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const result = await parseFile(file); // 第2引数に { schema } / { options } を渡せる
  if (result.ok) console.log(result.data);
};
```

### stringify

オブジェクト配列を CSV 文字列にする。既定で BOM 付き UTF-8・CRLF 改行（Excel 互換）。

```ts
import { stringify } from "web-csv-ops";

const csv = stringify([{ id: 1, name: "Alice" }], {
  headers: ["id", "name"],
  headerLabels: { id: "ID", name: "名前" },
});
// "﻿ID,名前\r\n1,Alice"
```

### downloadCSV

シリアライズしてブラウザのダウンロードを起動する。`web-csv-ops/browser` から import する。

```ts
import { downloadCSV } from "web-csv-ops/browser";

downloadCSV(users, "users.csv", { headers: ["id", "name", "email"] });
```

## API

| 関数                                                     | 戻り値                                |
| -------------------------------------------------------- | ------------------------------------- |
| `parse(text, args?)`                                     | `ParseResult<Record<string, string>>` |
| `parse<S>(text, { schema })`                             | `ParseResult<InferRow<S>>`            |
| `parseFile(file, args?)`（`/browser`）                   | `Promise<ParseResult<…>>`             |
| `stringify<T>(rows, options?)`                           | `string`                              |
| `downloadCSV<T>(rows, filename, options?)`（`/browser`） | `void`                                |

第2引数 `args` は `{ schema?, options? }`。`schema` 省略時は全セル文字列、指定時は型付き行。

### ParseResult

| 形                                            | 説明                                                              |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `{ ok: false; error: FileError }`             | ファイルが扱えない。`FileError` = `{ code, message, line? }`      |
| `{ ok: true; data: T[]; errors: RowError[] }` | `data`=有効行、`errors`=検証 NG 行。schema 無しなら `errors` は空 |

`FileError.code`: `malformed` / `duplicate-header` / `missing-column` / `invalid-option` / `read-failed`。
`RowError`: `{ row, column?, value?, message }`（`row` は CSV の物理行番号）。

### ParseOptions（`args.options` に入れる）

| オプション       | デフォルト | 説明                                                                          |
| ---------------- | ---------- | ----------------------------------------------------------------------------- |
| `header`         | `true`     | 1 行目をヘッダーとして使う。`headers` 指定かつ `header` 省略時は `false` 扱い |
| `headers`        | —          | ヘッダーを明示指定。渡すと 1 行目もデータ行として扱う                         |
| `skipEmptyLines` | `true`     | 空行をスキップする                                                            |

### StringifyOptions

| オプション        | デフォルト     | 説明                                                                |
| ----------------- | -------------- | ------------------------------------------------------------------- |
| `headers`         | 1 件目の全キー | 出力する列とその順序                                                |
| `headerLabels`    | —              | 表示用ヘッダー名のマッピング                                        |
| `bom`             | `true`         | UTF-8 BOM を付与する（Excel 互換）                                  |
| `newline`         | `"\r\n"`       | 改行コード（`"\r\n"` または `"\n"`）                                |
| `sanitizeFormula` | `true`         | CSV インジェクション対策（数式と解釈されうる値の先頭に `'` を付与） |

## 制限事項

- parse: schema 無しの値は常に文字列。型付けは `schema` 経由で行う
- parse: schema 無しでヘッダーに同名の列があると後勝ちで上書きされる（schema 経路は `duplicate-header` で拒否）
- parse: `InferRow` の型付けは現状 tsc 6.0.3 の制約で静的に全列 union に潰れる（runtime は正しい）
- stringify: ネストした値（オブジェクト・配列）は JSON 文字列化する
- stringify: `Date` は ISO 8601（ロケール非依存）で出力する

## 未対応

- ストリーミング・巨大ファイルの分割処理
- 文字コード変換

## ライセンス

MIT
