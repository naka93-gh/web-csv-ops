import type { CSVError, ParsedRow, ParseOptions, Result } from './types.js'

const BOM = '﻿'

/**
 * CSV文字列をオブジェクト配列にパースする
 * BOM 除去、引用符、複数の改行コード（LF/CRLF/CR）に対応
 *
 * @example
 * ```ts
 * const result = parse<{ name: string; age: string }>('name,age\nAlice,30')
 * if (result.ok) {
 *   console.log(result.data) // [{ name: 'Alice', age: '30' }]
 * } else {
 *   console.error(result.error.message)
 * }
 * ```
 */
export function parse<T extends object = Record<string, string>>(
  text: string,
  options: ParseOptions = {},
): Result<ParsedRow<T>[]> {
  const { header = true, headers: explicitHeaders, skipEmptyLines = true } = options

  // BOM除去
  // 文字が含まれていなければ処理終了
  const stripped = text.startsWith(BOM) ? text.slice(1) : text
  if (stripped.length === 0) return { ok: true, data: [] }

  // パース処理実行
  // 失敗時は処理終了
  const rowsResult = parseRawRows(stripped)
  if (!rowsResult.ok) return rowsResult

  // 空の行をスキップする場合はここでフィルタリング
  const rows = skipEmptyLines ? rowsResult.data.filter(isNonEmptyRow) : rowsResult.data

  // ヘッダーとして使う場合のために、最初の行を取得
  // 空の行をスキップした場合などで、空になっていたなら処理終了
  const firstRow = rows[0]
  if (!firstRow) return { ok: true, data: [] }

  let keys: string[]
  let dataRows: string[][]

  if (header) {
    // ヘッダーありの場合は最初の行をキーとして取り扱う
    keys = firstRow
    dataRows = rows.slice(1)
  } else if (explicitHeaders) {
    // ヘッダーが明示的にオプションで渡されているときはそれをキーとして取り扱う
    keys = [...explicitHeaders]
    dataRows = rows
  } else {
    // ヘッダーなしでオプション指定もない場合は汎用的な名前をキーとして取り扱う
    keys = Array.from({ length: firstRow.length }, (_, i) => `column${i}`)
    dataRows = rows
  }

  // オブジェクト配列にパース
  // CSV のセルは常に文字列なので値型は string（ParsedRow<T>）
  const data = dataRows.map(
    (row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? ''])) as ParsedRow<T>,
  )
  return { ok: true, data }
}

/**
 * `<input type="file">` 等で取得したファイルを読み込んでパースする
 * 読み込み失敗時は `{ ok: false, error: { type: 'file-read' } }` を返す
 *
 * @example
 * ```ts
 * const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *   const file = e.target.files?.[0]
 *   if (!file) return
 *   const result = await parseFile<User>(file)
 *   if (result.ok) setUsers(result.data)
 * }
 * ```
 */
export async function parseFile<T extends object = Record<string, string>>(
  file: File,
  options?: ParseOptions,
): Promise<Result<ParsedRow<T>[]>> {
  try {
    const text = await file.text()
    return parse<T>(text, options)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'ファイル読込に失敗しました'
    return { ok: false, error: { type: 'file-read', message } }
  }
}

/**
 * 行データが空行でないかを判定する
 * 空フィールド1つだけの行 [''] を空行とみなす
 *
 * @param row 1行のデータ
 * @returns 空行でない場合はtrue
 */
function isNonEmptyRow(row: readonly string[]): boolean {
  return !(row.length === 1 && row[0] === '')
}

/**
 * CSVテキスト全体を行と列にパースする
 * 引用符内の改行をデータとして扱うため、行分割もこの関数で行う
 *
 * @param text CSV全文のテキスト
 * @returns 行 × 列の2次元配列
 */
function parseRawRows(text: string): Result<string[][]> {
  // 確定した行のリスト
  const rows: string[][] = []
  // 組み立て中の行（フィールドの配列）
  let currentRow: string[] = []
  // 組み立て中のフィールド文字列
  let currentField = ''
  // 現在の文字位置
  let i = 0
  // エラー報告用の行番号（1始まり）
  let line = 1
  // 引用符内モードかどうか
  let inQuotes = false

  // テキスト長分実行
  while (i < text.length) {
    // 文字を取得
    const char = text[i]

    // --- 引用符内モード ---
    // フィールド区切りや行区切りも文字として取り込む
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // "" はエスケープされた引用符1つとして追加（2文字進める）
          currentField += '"'
          i += 2
        } else {
          // 引用符の終端。後続は , か改行か末尾でなければ不正なCSV
          inQuotes = false
          i++
          const after = text[i]
          if (after !== undefined && after !== ',' && after !== '\n' && after !== '\r') {
            return parseError(`引用符の直後に予期しない文字: "${after}"`, line)
          }
        }
      } else {
        // 引用符以外はそのままフィールドに追加（改行も含む）
        // 行番号も正しくカウント。\r / \n / \r\n のいずれも1行として扱う
        if (char === '\r') {
          line++
          currentField += char
          i++
          // CRLF の場合は \n もまとめて取り込み、line を二重カウントしない
          if (text[i] === '\n') {
            currentField += '\n'
            i++
          }
          continue
        }
        if (char === '\n') line++
        currentField += char
        i++
      }
      continue
    }

    // --- 通常モード ---

    // 引用符はフィールド先頭でのみ許可。途中での出現は不正
    if (char === '"') {
      if (currentField.length > 0) {
        return parseError('フィールド途中での引用符は不正です', line)
      }
      inQuotes = true
      i++
      continue
    }

    // カンマ → フィールド確定
    if (char === ',') {
      currentRow.push(currentField)
      currentField = ''
      i++
      continue
    }

    // 改行 → フィールドと行を確定。CRLF は \n もまとめて消費
    if (char === '\r' || char === '\n') {
      currentRow.push(currentField)
      currentField = ''
      rows.push(currentRow)
      currentRow = []
      line++
      i++
      if (char === '\r' && text[i] === '\n') i++
      continue
    }

    // 通常文字はフィールドに追加
    currentField += char
    i++
  }

  // ループ後、引用符が閉じられていなければ不正なCSV
  if (inQuotes) {
    return parseError('閉じられていない引用符', line)
  }

  // 末尾に残ったフィールドと行を確定
  // テキストが改行で終わる場合は currentRow/currentField が空のままなので、
  // 幻の空行を生まないようスキップする（skipEmptyLines: false でも漏らさない）
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  return { ok: true, data: rows }
}

/**
 * エラー形式にラップする
 *
 * @param message エラーメッセージ
 * @param line 行数
 * @returns
 */
function parseError(message: string, line: number): Result<never> {
  const error: CSVError = { type: 'parse', message, line }
  return { ok: false, error }
}
