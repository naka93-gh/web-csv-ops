// スキーマ検証・型付け（CSV データ行 → 型付き行 ＋ 行エラー）
//
// CSV のセルは常に文字列なので、文字列入力だけを列型へ強制する。
// 受理規則: 10進数値のみ number / true・1・false・0 を boolean / ISO 8601 を date

import { parseIsoDate } from './date.js'
import type { ColumnType, RowError, Schema } from './types.js'

/**
 * スキーマを定義する（リテラル型を保持して `InferRow` の型付けを効かせる）
 *
 * @example
 * ```ts
 * const schema = defineSchema({
 *   名前: { prop: 'name', type: 'string', required: true },
 *   年齢: { prop: 'age', type: 'number' },
 * })
 * // parse(text, { schema }).data: { name: string; age: number | null }[]
 * ```
 */
export function defineSchema<const S extends Schema>(schema: S): S {
  return schema
}

/** schema 適用後の値（型付き） */
type Typed = string | number | boolean | Date | null

/**
 * 文字列の最初の重複を返す（無ければ undefined）
 */
export function firstDuplicate(values: Iterable<string>): string | undefined {
  const seen = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) return v
    seen.add(v)
  }
  return undefined
}

/**
 * スキーマ内で重複する `prop` を返す（無ければ undefined）
 *
 * 複数列が同じ prop を持つと値が黙って上書きされる。ヘッダー重複と対称に入口で弾く
 */
export function findDuplicateProp(schema: Schema): string | undefined {
  return firstDuplicate(Object.values(schema).map((col) => col.prop))
}

// 10 進数値の文字列（符号・小数・指数可）。Number() 丸投げだと "0x10" 等の
// 16 進表記や真偽値まで暗黙に通ってしまうため、受理形式を明示的に限定する
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/**
 * 文字列セルを列型に強制する
 */
function coerce(
  type: ColumnType,
  value: string,
  utc: boolean,
): { value: Typed } | { error: string } {
  switch (type) {
    case 'string':
      // 恒等変換。先頭ゼロ（郵便番号・電話番号・社員番号）を壊さない
      return { value }
    case 'number':
      if (DECIMAL_RE.test(value.trim())) return { value: Number(value) }
      return { error: '数値ではありません' }
    case 'boolean': {
      const t = value.trim().toLowerCase()
      if (t === 'true' || t === '1') return { value: true }
      if (t === 'false' || t === '0') return { value: false }
      return { error: '真偽値ではありません' }
    }
    case 'date': {
      const d = parseIsoDate(value, utc)
      return d ? { value: d } : { error: '日付ではありません' }
    }
  }
}

/** applySchema が受け取る 1 行（ヘッダー名 → セル文字列 ＋ 行番号） */
export type SchemaRow = {
  /** ヘッダー名 → セル文字列（`Object.create(null)` 推奨。__proto__ 列名対策） */
  values: Record<string, string>
  /** 1 始まりの行番号（CSV 上の実行番号） */
  row: number
}

/**
 * スキーマで各行を検証・型付けする
 *
 * 全列が通った行だけ `data` に入り、1 つでも失敗した行は除外して `errors` に記録する
 */
export function applySchema(
  rows: readonly SchemaRow[],
  schema: Schema,
  utc = false,
): { data: Record<string, Typed>[]; errors: RowError[] } {
  const columns = Object.entries(schema)
  const data: Record<string, Typed>[] = []
  const errors: RowError[] = []

  for (const { values, row } of rows) {
    // __proto__ 等の prop が prototype セッターに吸われて消えるのを防ぐ
    const out: Record<string, Typed> = Object.create(null)
    const rowErrors: RowError[] = []

    for (const [header, column] of columns) {
      const raw = values[header]

      // 空セル: defaultValue で補完、無ければ required ならエラー・任意なら null
      if (raw === undefined || raw === '') {
        if (column.defaultValue !== undefined) out[column.prop] = column.defaultValue
        else if (column.required) rowErrors.push({ row, column: header, message: '必須です' })
        else out[column.prop] = null
        continue
      }

      // ユーザー validate を先に通す（throw しても parse 全体を巻き込まず行エラーに落とす）
      if (column.validate) {
        let message: string | null
        try {
          message = column.validate(raw)
        } catch (e) {
          message = e instanceof Error ? e.message : '検証中にエラーが発生しました'
        }
        if (message) {
          rowErrors.push({ row, column: header, value: raw, message })
          continue
        }
      }

      // 列型へ強制する。失敗は値を捨てて行エラーに
      const result = coerce(column.type, raw, utc)
      if ('error' in result) {
        rowErrors.push({ row, column: header, value: raw, message: result.error })
        continue
      }
      out[column.prop] = result.value
    }

    // 1 列でも失敗した行は data から落とし、エラーだけ集める
    if (rowErrors.length > 0) errors.push(...rowErrors)
    else data.push(out)
  }

  return { data, errors }
}
