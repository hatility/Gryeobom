import { describe, expect, it } from 'vitest'
import { layoutTarget } from './device'

describe('모바일 /m 으로 옮기기', () => {
  it('휴대폰 · 태블릿은 /m 으로', () => {
    expect(layoutTarget('/', true, null)).toBe('/m')
    expect(layoutTarget('/groups/abc', true, null)).toBe('/m/groups/abc')
  })
  it('PC 는 그대로, 이미 /m 이면 그대로', () => {
    expect(layoutTarget('/my', false, null)).toBeNull()
    expect(layoutTarget('/m/my', false, null)).toBeNull()
  })
  it('고른 화면을 따른다', () => {
    expect(layoutTarget('/my', true, 'pc')).toBeNull()
    expect(layoutTarget('/my', false, 'm')).toBe('/m/my')
  })
  it('관리자는 언제나 PC판', () => {
    expect(layoutTarget('/admin', true, 'm')).toBeNull()
    expect(layoutTarget('/m/admin', true, null)).toBe('/admin')
  })
  it('/mine 같은 주소는 /m 이 아니다', () => {
    expect(layoutTarget('/mine', false, null)).toBeNull()
  })
})
