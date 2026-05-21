import type { StringifyOptions } from './types.js'

/** UTF-8 BOM */
const BOM = '﻿'
/** CSV インジェクション対策の対象文字 */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@'])

/**
 * オブジェクト配列をCSV文字列にシリアライズする
 * デフォルトで BOM 付き UTF-8、CRLF 改行、数式インジェクション対策を有効化（Excel 互換）
 *
 * @example
 * ```ts
 * const csv = stringify([{ id: 1, name: 'Alice' }], {
 *   headers: ['id', 'name'],
 *   headerLabels: { id: 'ID', name: '名前' },
 * })
 * ```
 */
export function stringify<T>(rows: readonly T[], options: StringifyOptions<T> = {}): string {
  const {
    headers: explicitHeaders,
    headerLabels,
    bom = true,
    newline = '\r\n',
    sanitizeFormula = true,
  } = options

  // BOM付きの場合はプレフィックスで付与するのでここで準備
  // 書き出しデータがなければBOMのみで返す
  const prefix = bom ? BOM : ''
  if (rows.length === 0) return prefix

  // 出力対象のキーを抽出
  // 指定キーのヘッダー・ボディで書き出す
  // keyof T & string で絞っているため、k は常に string 型として扱える
  const keys: readonly (keyof T & string)[] =
    explicitHeaders ?? (Object.keys(rows[0] as object) as (keyof T & string)[])

  // ヘッダー行の生成
  // 第2引数 false: ヘッダー名は開発者が指定するラベル（業務用語）なので、
  // '@user' のような名前を "'@user" にされたくないためサニタイズしない
  const headerLabelsRow = keys.map((k) => headerLabels?.[k] ?? k)
  const headerLine = headerLabelsRow.map((v) => escapeField(v, false)).join(',')

  // ボディ行の生成
  const bodyLines = rows.map((row) =>
    keys
      .map((k) => {
        const raw = (row as Record<string, unknown>)[k]
        return escapeField(stringifyValue(raw), sanitizeFormula && typeof raw === 'string')
      })
      .join(','),
  )

  // 連結してCSV文字列として構築
  return prefix + [headerLine, ...bodyLines].join(newline)
}

/**
 * オブジェクト配列を CSV 化してブラウザのダウンロードを起動する
 * 内部で Blob と一時 `<a>` を生成し、`URL.createObjectURL` でリンクを発行する
 *
 * @example
 * ```ts
 * downloadCSV(users, 'users.csv', {
 *   headers: ['id', 'name', 'email'],
 *   headerLabels: { id: 'ID', name: '名前', email: 'メールアドレス' },
 * })
 * ```
 */
export function downloadCSV<T>(
  rows: readonly T[],
  filename: string,
  options?: StringifyOptions<T>,
): void {
  // データをシリアライズ
  const csv = stringify(rows, options)

  // Blob作成
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })

  // ダウンロード用のリンクを内部的に構築
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)

  // クリック起動
  // この動作でCSVファイルとしてダウンロードされる
  a.click()

  // リンク破棄
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 値の正規化を行う
 *
 * @param value 値
 * @returns
 */
function stringifyValue(value: unknown): string {
  // null/undefined は空文字で返す
  if (value === null || value === undefined) return ''
  // 値が文字列ならそのまま返す
  if (typeof value === 'string') return value
  // 文字列以外(数値など)は文字列化して返す
  // TODO: オブジェクトが直接渡されるとCSVが壊れる可能性があるので、防御策を入れてもいいかもしれない
  return String(value)
}

/**
 * サニタイズを行う
 *
 * @param value 値
 * @param sanitizeFormula CSVインジェクション対策フラグ
 * @returns
 */
function escapeField(value: string, sanitizeFormula: boolean): string {
  // 数式として解釈される値がプレフィックスになっているものをサニタイズ
  // Excelで開かれた時を考慮
  // value.charAt(0) は空文字でも '' を返すため、length チェック不要で安全
  const sanitized = sanitizeFormula && FORMULA_PREFIXES.has(value.charAt(0)) ? `'${value}` : value

  // カンマやダブルクォート、改行コードなどが含まれてない場合は問題なしとして返す
  const needsQuote =
    sanitized.includes(',') ||
    sanitized.includes('"') ||
    sanitized.includes('\n') ||
    sanitized.includes('\r')
  if (!needsQuote) return sanitized

  // テキスト中にあるダブルクォートはエスケープし、ダブルクォートでフィールドを包む
  // そのままにするとCSVが壊れてしまうため
  return `"${sanitized.replace(/"/g, '""')}"`
}
