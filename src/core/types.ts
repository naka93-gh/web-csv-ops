// web-csv-ops 公開型

// ───────────────────────────────────────────
// エラー（file 単位 / 行単位）
// ───────────────────────────────────────────
/**
 * file 単位で読み取りに失敗した理由
 */
export type FileErrorCode =
  | 'malformed' // CSV として壊れている（引用符不整合 等）
  | 'duplicate-header' // ヘッダー列名が重複し列の対応が一意に決まらない（schema 経路）
  | 'missing-column' // schema の必須列（required・defaultValue 無し）がヘッダーに無い
  | 'invalid-option' // オプション/スキーマの指定値が不正（schema の prop 重複 等）
  | 'read-failed' // File/Blob の読み込みに失敗（parseFile のみ）

/**
 * file 単位のエラー
 *
 * ファイルがそもそも扱えない（壊れている・列対応が決まらない・必須列が無い 等）場合に返る
 */
export type FileError = {
  /** 失敗の種別 */
  code: FileErrorCode
  /** 人が読めるメッセージ */
  message: string
  /** パース失敗で該当行が特定できる場合の行番号（1始まり） */
  line?: number
}

/**
 * 行単位の検証エラー
 *
 * ファイルは読めたが、特定の行・列が schema 検証に通らなかった場合に
 * {@link ParseResult} の `errors` に積まれる
 */
export type RowError = {
  /** 1 始まりの行番号（CSV 上の実行番号） */
  row: number
  /** 該当列のヘッダー名（行全体のエラーなら省略） */
  column?: string
  /** 検証に失敗した実際の値 */
  value?: unknown
  /** 人が読めるメッセージ */
  message: string
}

// ───────────────────────────────────────────
// 結果
// ───────────────────────────────────────────
/**
 * パース結果 — file 単位の失敗と行単位のエラーを分離して返す
 *
 * - `ok: false` … ファイルが扱えない（{@link FileError}）
 * - `ok: true` … `data` は有効行、`errors` は検証に落ちた行（{@link RowError}）。
 *   schema 無しの場合 `errors` は常に空。正常行だけ insert しエラー行は提示する bulk フローに直結する
 *
 * @example
 * ```ts
 * const result = parse(text, { schema })
 * if (!result.ok) {
 *   console.error(result.error.message)
 * } else {
 *   await bulkInsert(result.data)
 *   for (const e of result.errors) console.warn(`${e.row}行目: ${e.message}`)
 * }
 * ```
 */
export type ParseResult<T> =
  | { ok: false; error: FileError }
  | { ok: true; data: T[]; errors: RowError[] }

// ───────────────────────────────────────────
// スキーマ（列定義と行型の推論）
// ───────────────────────────────────────────
/**
 * スキーマの列型
 */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date'

/**
 * 列定義の本体（`type` ごとに `defaultValue` の型が決まる）
 */
type ColumnOf<T extends ColumnType, V> = {
  /** 出力プロパティ名 */
  prop: string
  /** 期待する型（`'string'` は恒等変換で先頭ゼロを保つ） */
  type: T
  /** 必須なら未入力でエラー */
  required?: boolean
  /**
   * 空セル時の補完値（列の `type` に対応する型のみ）
   *
   * 型変換・`validate` を通さずそのまま出力行に入るため、
   * {@link InferRow} が主張する型と実体を一致させる目的で型を限定する
   */
  defaultValue?: V
  /** 追加検証（エラーメッセージ or null を返す） */
  validate?: (value: string) => string | null
}

/**
 * スキーマの 1 列定義
 *
 * `defaultValue` は `type` に対応する TS 型に限定される
 * （例: `type: 'date'` なら `Date`。文字列を渡すとコンパイルエラー）
 */
export type Column =
  | ColumnOf<'string', string>
  | ColumnOf<'number', number>
  | ColumnOf<'boolean', boolean>
  | ColumnOf<'date', Date>

/**
 * スキーマ — ヘッダー名 → 列定義（{@link Column}）のマップ
 *
 * `satisfies Schema` を付けると {@link InferRow} で行の型を推論できる
 *
 * @example
 * ```ts
 * const schema = {
 *   名前: { prop: 'name', type: 'string', required: true },
 *   年齢: { prop: 'age', type: 'number' },
 * } satisfies Schema
 * ```
 */
export type Schema = Record<string, Column>

/**
 * ColumnType → TS 型
 */
type CellTypeOf<C extends Column> = C['type'] extends 'string'
  ? string
  : C['type'] extends 'number'
    ? number
    : C['type'] extends 'boolean'
      ? boolean
      : C['type'] extends 'date'
        ? Date
        : never

/**
 * required でなければ null 許容
 */
type PropValue<C extends Column> = C extends { required: true }
  ? CellTypeOf<C>
  : CellTypeOf<C> | null

/**
 * スキーマから行の型を推論する
 *
 * `prop` をキー、`type` を値の型にマップする（`required: true` でない列は `null` 許容）
 *
 * NOTE: tsc 6.0.3 では `[K in keyof S as S[K]['prop']]` のキー再割り当てで `S[K]` の
 * K 対応が失われ、値が全列型の union に潰れる既知制約がある。
 * runtime は正しく型付けされる。tsc 更新時に解消見込み
 *
 * @example
 * ```ts
 * // { name: string; age: number | null }
 * type Employee = InferRow<typeof schema>
 * ```
 */
export type InferRow<S extends Schema> = {
  [K in keyof S as S[K]['prop']]: PropValue<S[K]>
}

// ───────────────────────────────────────────
// オプション
// ───────────────────────────────────────────
/**
 * パースオプション設定
 */
export type ParseOptions = {
  /** 1行目をヘッダーとして使うか（デフォルト true。headers 指定かつ header 省略時は false 扱い） */
  header?: boolean
  /** ヘッダーを明示指定。header を省略するとこのキーが使われる（header: false 相当） */
  headers?: readonly string[]
  /** 空行をスキップするか（デフォルト true） */
  skipEmptyLines?: boolean
}

/**
 * シリアライズオプション設定
 * keyof T を & string で絞り、symbol/number キーを除外（CSV は文字列キーのみを扱う）
 */
export type StringifyOptions<T> = {
  /** 出力する列とその順序（デフォルト: 1件目のオブジェクトの全キー） */
  headers?: readonly (keyof T & string)[]
  /** 表示用ヘッダー名マッピング（デフォルト: キー名そのまま） */
  headerLabels?: Partial<Record<keyof T & string, string>>
  /** BOM を付与するか（Excel 互換、デフォルト true） */
  bom?: boolean
  /** 改行コード（デフォルト '\r\n'） */
  newline?: '\r\n' | '\n'
  /** CSV インジェクション対策（デフォルト true） */
  sanitizeFormula?: boolean
}

// ───────────────────────────────────────────
// 第2引数（schema / options）
// ───────────────────────────────────────────
/**
 * parse / parseFile の第2引数
 *
 * 型付け・検証の `schema` と、取り込み調整の `options`（{@link ParseOptions}）を
 * 別キーに分けて渡す。どちらも省略できる
 */
export type ParseArgs = {
  schema?: never
  options?: ParseOptions
}

/**
 * スキーマ付きの第2引数
 */
export type ParseArgsWithSchema<S extends Schema> = {
  schema: S
  options?: ParseOptions
}
