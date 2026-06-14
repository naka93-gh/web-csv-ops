# Changelog

## 0.1.0

初回リリース。CSV を parse / stringify する、依存ゼロ・極小ライブラリ。

- `parse` / `parseFile` で CSV をオブジェクト配列に読む。値は常に文字列（数値・日付への自動変換はしない）
- 引用符・エスケープ（`""`）・LF / CRLF / CR 改行・BOM 除去に対応。失敗は例外でなく Result 型（`line` 付き）で返す
- `header` / `headers`（ヘッダー無しモード）/ `skipEmptyLines` オプション
- `stringify` でオブジェクト配列を CSV 文字列に書き出す。既定で BOM 付き UTF-8・CRLF 改行・CSV インジェクション対策（Excel 互換）
- `headers` / `headerLabels` / `bom` / `newline` / `sanitizeFormula` オプション。`Date` は ISO 8601、ネスト値は JSON 文字列化
- `downloadCSV` でブラウザのダウンロードを起動（Object URL は確実に解放）
