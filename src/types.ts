/**
 * 成功/失敗を表すResult型
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: CSVError }

/**
 * CSV操作で発生するエラー型
 */
export type CSVError = {
  type: CSVErrorType
  message: string
  /** パースエラーで該当行が特定できる場合の行番号（1始まり） */
  line?: number
}

/**
 * CSV操作で発生するエラー型のタイプ定義
 * パース or ファイル読み込み
 */
export type CSVErrorType = 'parse' | 'file-read'

/**
 * parse / parseFile の結果1行の型
 * CSV のセルは常に文字列のため、T のキーは保ちつつ値型をすべて string に矯正する
 */
export type ParsedRow<T> = { [K in keyof T]: string }

/**
 * パースオプション設定
 */
export type ParseOptions = {
  /** 1行目をヘッダーとして使うか（デフォルト true） */
  header?: boolean
  /** ヘッダーを明示指定（header: false 時に有効） */
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
