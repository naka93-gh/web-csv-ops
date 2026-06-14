import { describe, expect, it } from 'vitest'
import { parse } from '../../src/core/parse'
import type { Schema } from '../../src/core/types'

// schema を渡した高レベル経路（検証＋型付け）の挙動を担保する。
// 受理規則: 10進数値・true/1・ISO 日付・先頭ゼロ保持

const schema = {
  名前: { prop: 'name', type: 'string', required: true },
  年齢: { prop: 'age', type: 'number' },
  入社日: { prop: 'hireDate', type: 'date' },
  有効: { prop: 'active', type: 'boolean' },
} satisfies Schema

describe('parse（schema）', () => {
  describe('型付け', () => {
    it('各列を型に変換して返す', () => {
      const result = parse('名前,年齢,入社日,有効\nAlice,30,2020-01-15,true', { schema })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.errors).toEqual([])
      const row = result.data[0]
      expect(row?.name).toBe('Alice')
      expect(row?.age).toBe(30)
      expect(row?.active).toBe(true)
      // 値は Date（InferRow の静的型は tsc 6.0.3 の制約で全列 union のため cast して読む）
      expect(row?.hireDate).toBeInstanceOf(Date)
      const d = row?.hireDate as unknown as Date
      // ローカル壁時計で 2020-01-15 0:00
      expect(d.getFullYear()).toBe(2020)
      expect(d.getMonth()).toBe(0)
      expect(d.getDate()).toBe(15)
    })

    it("type:'string' は恒等変換で先頭ゼロを保つ", () => {
      const s = { 郵便番号: { prop: 'zip', type: 'string' } } satisfies Schema
      const result = parse('郵便番号\n01234', { schema: s })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data[0]?.zip).toBe('01234')
    })

    it('boolean は true/1 → true、false/0 → false', () => {
      const s = { f: { prop: 'flag', type: 'boolean' } } satisfies Schema
      const r = parse('f\ntrue\n1\nfalse\n0', { schema: s })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.map((d) => d.flag)).toEqual([true, true, false, false])
    })
  })

  describe('行エラー（検証 NG）', () => {
    it('数値でない値は行エラーになり data から落ちる', () => {
      const result = parse('名前,年齢\nAlice,30\nBob,xx', { schema })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.map((d) => d.name)).toEqual(['Alice'])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatchObject({
        column: '年齢',
        value: 'xx',
        message: '数値ではありません',
      })
    })

    it('日付でない値は行エラー', () => {
      const result = parse('名前,入社日\nAlice,2020-13-40', { schema })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.errors[0]?.message).toBe('日付ではありません')
    })

    it('必須列が空なら「必須です」の行エラー', () => {
      const result = parse('名前,年齢\n,30', { schema })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data).toEqual([])
      expect(result.errors[0]).toMatchObject({ column: '名前', message: '必須です' })
    })

    it('行エラーの row は CSV の物理行番号（1始まり）', () => {
      // ヘッダー=1行目、Alice=2行目、Bob(不正)=3行目
      const result = parse('名前,年齢\nAlice,30\nBob,xx', { schema })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.errors[0]?.row).toBe(3)
    })

    it('空行スキップ後も row は元の物理行番号を保つ', () => {
      // 2行目が空行 → Bob は 4行目
      const result = parse('名前,年齢\n\nAlice,30\nBob,xx', { schema })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.errors[0]?.row).toBe(4)
    })
  })

  describe('defaultValue / 任意列', () => {
    it('空セルは defaultValue で補完される', () => {
      const s = { 年齢: { prop: 'age', type: 'number', defaultValue: 0 } } satisfies Schema
      const result = parse('年齢\n', { schema: s })
      // ヘッダーのみ → データ0件。空セルの補完は下のケースで担保
      expect(result.ok).toBe(true)
      const s2 = {
        名前: { prop: 'name', type: 'string' },
        年齢: { prop: 'age', type: 'number', defaultValue: 0 },
      } satisfies Schema
      const r2 = parse('名前,年齢\nAlice,', { schema: s2 })
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(r2.data[0]?.age).toBe(0)
    })

    it('任意列の空セルは null', () => {
      const s = { 年齢: { prop: 'age', type: 'number' } } satisfies Schema
      const result = parse('名前,年齢\nAlice,', {
        schema: { 名前: { prop: 'name', type: 'string' }, ...s },
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data[0]?.age).toBeNull()
    })
  })

  describe('validate', () => {
    it('validate が文字列を返すと行エラー', () => {
      const s = {
        年齢: {
          prop: 'age',
          type: 'number',
          validate: (v) => (Number(v) >= 18 ? null : '18歳未満'),
        },
      } satisfies Schema
      const result = parse('年齢\n20\n15', { schema: s })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.map((d) => d.age)).toEqual([20])
      expect(result.errors[0]?.message).toBe('18歳未満')
    })

    it('validate が throw しても parse 全体を巻き込まず行エラーに落とす', () => {
      const s = {
        x: {
          prop: 'x',
          type: 'string',
          validate: () => {
            throw new Error('検証で例外')
          },
        },
      } satisfies Schema
      const result = parse('x\nval', { schema: s })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.errors[0]?.message).toBe('検証で例外')
    })
  })

  describe('file エラー（schema 経路）', () => {
    it('同名ヘッダーは duplicate-header で拒否', () => {
      const s = { col: { prop: 'c', type: 'string' } } satisfies Schema
      const result = parse('col,col\n1,2', { schema: s })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('duplicate-header')
    })

    it('必須列がヘッダーに無ければ missing-column', () => {
      const s = { 名前: { prop: 'name', type: 'string', required: true } } satisfies Schema
      const result = parse('年齢\n30', { schema: s })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('missing-column')
    })

    it('schema の prop 重複は invalid-option', () => {
      const s = {
        a: { prop: 'x', type: 'string' },
        b: { prop: 'x', type: 'string' },
      } satisfies Schema
      const result = parse('a,b\n1,2', { schema: s })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid-option')
    })
  })

  describe('golden（coerce 挙動の固定）', () => {
    // 同一入力・同一 schema に対する期待出力を固定し、coerce のドリフトを検知する
    it('混在データ（有効行は data、NG 行は errors）', () => {
      const text = '名前,年齢,入社日\nAlice,30,2020-01-15\nBob,xx,2021-02-01\nCarol,25,bad-date'
      const s = {
        名前: { prop: 'name', type: 'string', required: true },
        年齢: { prop: 'age', type: 'number' },
        入社日: { prop: 'hireDate', type: 'date' },
      } satisfies Schema
      const result = parse(text, { schema: s })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Alice のみ全列通過、Bob は年齢NG・Carol は日付NG
      expect(result.data.map((d) => d.name)).toEqual(['Alice'])
      expect(
        result.errors.map((e) => ({ row: e.row, column: e.column, message: e.message })),
      ).toEqual([
        { row: 3, column: '年齢', message: '数値ではありません' },
        { row: 4, column: '入社日', message: '日付ではありません' },
      ])
    })
  })
})
