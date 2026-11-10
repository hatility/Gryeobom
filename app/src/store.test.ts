import { describe, expect, it } from 'vitest'
import { GROUP_POST, decodeShared, encodeShared, postShared, sanitizePostOptions, toShared } from './share'
import { hourTicks, invert, layoutLabels, smoothPath, spreadSameTime, sx, sy, type Frame } from './graph'
import { newEntry, newGraph, normalizeGraph, sortEntries } from './store'
import { fromParts, hourInput, hourOf, monthIndex, monthInput, monthOf, presetRange, rangeLabel, rangeValid, seasonOf, sinceLabel, timeLabel, timeParts, withPrompts } from './content'
import { resolveTheme } from './view'

const sample = () => {
  const g = newGraph()
  const a = { ...newEntry(12, 3, '새 친구'), description: '같은 반', reflection: { feeling: '비밀 회고', why: '', now: '', toPast: '', fromPast: '' } }
  const b = { ...newEntry(5, -2, '이사') }
  g.entries = [a, b]
  return { g, a, b }
}

describe('share', () => {
  it('공유 데이터에 회고가 절대 들어가지 않는다', () => {
    const { g, a, b } = sample()
    g.currentReflection.message = '나에게 쓴 편지'
    const s = toShared(g, { title: '내 선', entryIds: new Set([a.id, b.id]), descriptions: true, time: true })
    const json = JSON.stringify(s)
    expect(json).not.toContain('비밀 회고')
    expect(json).not.toContain('나에게 쓴 편지')
    expect(s.entries.map((e) => e.title)).toEqual(['이사', '새 친구']) // 과거 → 현재
  })

  it('고르지 않은 순간과 설명·시점은 빠진다', () => {
    const { g, a } = sample()
    const s = toShared(g, { title: 't', entryIds: new Set([a.id]), descriptions: false, time: false })
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0].description).toBe('')
    expect([s.startPoint, s.currentPoint, s.entries[0].timePoint]).toEqual([0, 100, 71])
  })

  it('인코딩/디코딩 왕복 (한글 포함)', () => {
    const { g, a, b } = sample()
    const s = toShared(g, { title: '나의 작은 이야기', entryIds: new Set([a.id, b.id]), descriptions: true, time: true })
    expect(decodeShared(encodeShared(s))).toEqual(s)
  })

  it('망가지거나 범위를 벗어난 링크는 막는다', () => {
    expect(decodeShared('!!!')).toBeNull()
    expect(decodeShared(btoa('{"v":2}'))).toBeNull()
    const bad = btoa(JSON.stringify({ v: 1, startPoint: 0, currentPoint: 10, entries: [{ title: 'x'.repeat(99), timePoint: 99, emotionScore: 40 }] }))
    const s = decodeShared(bad)!
    expect(s.entries[0]).toMatchObject({ timePoint: 10, emotionScore: 5 })
    expect(s.entries[0].title).toHaveLength(40)
  })
})

describe('12개월 기준', () => {
  it('월 라벨과 기간 설명', () => {
    const t = 2026 * 12 + 9 // 2026년 10월
    expect(timeLabel('month', t)).toBe('10월')
    expect(timeLabel('month', t - 10)).toBe('12월')
    expect(rangeLabel('month', t - 11, t)).toBe('2025년 11월부터 2026년 10월까지, 12개월')
    expect(monthIndex(new Date(2026, 9, 29))).toBe(t)
  })

  it('월 기준 공유 링크도 왕복된다', () => {
    const g = { ...newGraph(), timeScale: 'month' as const, startPoint: 24310, currentPoint: 24321 }
    const e = newEntry(24315, 2, '여름방학')
    g.entries = [e]
    const s = toShared(g, { title: '올해', entryIds: new Set([e.id]), descriptions: false, time: true })
    expect(decodeShared(encodeShared(s))).toEqual(s)
  })
})

describe('graph', () => {
  it('좌표 변환이 왕복된다', () => {
    const f: Frame = { w: 600, h: 300, l: 40, r: 20, t: 30, b: 40, start: 0, end: 17 }
    expect(invert(f, sx(f, 9), sy(f, -3))).toEqual({ timePoint: 9, score: -3 })
    expect(invert(f, -100, -100)).toEqual({ timePoint: 0, score: 5 })
  })

  it('시간 순서로 정렬된다', () => {
    expect(sortEntries([{ timePoint: 9 }, { timePoint: 1 }, { timePoint: 4 }]).map((e) => e.timePoint)).toEqual([1, 4, 9])
  })
})

describe('그래프 이름표 자리', () => {
  const area = { w: 600, top: 2, bottom: 300 }
  it('가까이 붙은 점들의 이름표는 겹치지 않게 위아래로 나누거나 숨긴다', () => {
    const pts = [0, 1, 2].map((i) => ({ x: 300 + i * 30, y: 150, title: '진로를 고민했던 시간', up: true }))
    const spots = layoutLabels(pts, area, 10)
    const boxes = spots.flatMap((s, i) => (s ? [{ l: pts[i].x + s.dx - 70, r: pts[i].x + s.dx + 70, y: pts[i].y + s.dy }] : []))
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) expect(boxes[a].y === boxes[b].y && boxes[a].l < boxes[b].r && boxes[b].l < boxes[a].r).toBe(false)
    expect(spots[0]?.text).toBe('진로를 고민했던 시…') // 11자 → 10자 + …
  })

  it('긴 이름은 …으로 줄이고, 화면 끝에서는 안쪽으로 당긴다', () => {
    const [s] = layoutLabels([{ x: 595, y: 150, title: '아주아주 긴 이름을 가진 순간', up: true }], area, 6)
    expect(s?.text).toBe('아주아주 긴…')
    expect(595 + s!.dx).toBeLessThan(600 - 30)
  })

  it('고른 점은 먼저 자리를 잡는다', () => {
    const pts = [0, 1].map((i) => ({ x: 300 + i * 10, y: 150, title: '가나다라마바', up: true }))
    expect(layoutLabels(pts, area, 10, 1)[1]?.dy).toBe(-18)
  })
})

describe('늦은 밤 모드', () => {
  it('자동이면 밤 9시 ~ 새벽 5시에 어둡게', () => {
    expect(resolveTheme('auto', 22)).toBe('dark')
    expect(resolveTheme('auto', 3)).toBe('dark')
    expect(resolveTheme('auto', 14)).toBe('light')
    expect(resolveTheme('light', 23)).toBe('light')
    expect(resolveTheme('dark', 12)).toBe('dark')
  })
})

describe('0.10.0 새 칸', () => {
  it('예전 기록을 불러오면 답장 칸과 선 색을 채운다', () => {
    const old = { ...newGraph(), lineColor: undefined, entries: [{ ...newEntry(3), reflection: { feeling: 'a', why: '', now: '', toPast: 'b' } as never }] }
    const g = normalizeGraph(old)
    expect(g.lineColor).toBe('rose')
    expect(g.entries[0].reflection).toEqual({ feeling: 'a', why: '', now: '', toPast: 'b', fromPast: '' })
  })
  it('다시 찾아온 간격 · 계절', () => {
    expect([sinceLabel(9), sinceLabel(21), sinceLabel(70), sinceLabel(400)]).toEqual(['9일', '3주', '2달', '1년'])
    expect([seasonOf(3), seasonOf(7), seasonOf(10), seasonOf(1), seasonOf(12)]).toEqual(['spring', 'summer', 'autumn', 'winter', 'winter'])
  })
  it('선 색은 공유 링크로도 이어진다', () => {
    const g = { ...newGraph(), lineColor: 'sage' as const }
    const s = toShared(g, { title: 't', entryIds: new Set(), descriptions: false, time: true })
    expect(decodeShared(encodeShared(s))?.tone).toBe('sage')
    expect(decodeShared(encodeShared({ ...s, tone: 'neon' as never }))?.tone).toBeUndefined()
  })
})

describe('같은 시기 · 사이 시점', () => {
  it('나이 · 연도 사이를 한 달 단위로 적고 읽는다', () => {
    expect(timeLabel('age', fromParts('age', 3, 6))).toBe('3살 6개월')
    expect(timeLabel('age', 3)).toBe('3살')
    expect(timeLabel('year', fromParts('year', 2019, 1))).toBe('2019년 1월')
    expect(timeLabel('year', fromParts('year', 2019, 12))).toBe('2019년 12월')
    expect(timeLabel('year', 2019)).toBe('2019년')
    for (const part of [0, 1, 5, 11]) expect(timeParts('age', fromParts('age', 7, part))).toEqual({ whole: 7, part })
    for (const part of [0, 1, 2, 12]) expect(timeParts('year', fromParts('year', 2020, part))).toEqual({ whole: 2020, part })
  })

  it('끌어 옮기면 나이 · 연도는 한 달 단위로 맞춘다', () => {
    const f: Frame = { w: 1240, h: 300, l: 20, r: 20, t: 0, b: 0, start: 0, end: 10 }
    expect(invert(f, sx(f, 3.5), sy(f, 0), 12).timePoint).toBe(3.5)
    expect(invert(f, sx(f, 3.5), sy(f, 0)).timePoint).toBe(4)
  })

  it('같은 시기의 점은 옆으로 벌리되 이웃을 넘지 않고, 선은 뒤로 감기지 않는다', () => {
    const pts = [{ x: 100, y: 0 }, { x: 200, y: 10 }, { x: 200, y: 50 }, { x: 200, y: 20 }, { x: 260, y: 30 }]
    const out = spreadSameTime(pts, 18, 0, 400)
    const xs = out.map((p) => p.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b)) // 순서 유지
    expect(new Set(xs).size).toBe(xs.length) // 겹치지 않음
    expect(xs[1]).toBeGreaterThan(100)
    expect(xs[3]).toBeLessThan(260)
    expect(out.map((p) => p.y)).toEqual(pts.map((p) => p.y)) // 높이는 그대로
    // 곡선의 조절점이 앞 점보다 왼쪽으로 가지 않는다
    const cx = [...smoothPath(out).matchAll(/C([\d.]+),[\d.-]+ ([\d.]+),/g)].flatMap((m) => [+m[1], +m[2]])
    expect(cx.length).toBe(8)
    expect(cx).toEqual([...cx].sort((a, b) => a - b))
  })

  it('모임장이 정한 나의 시간을 그래프 범위로 바꾼다', () => {
    expect(presetRange({ choice: 'age', start: 10, end: 14, title: '' })).toMatchObject({ timeScale: 'age', startPoint: 10, currentPoint: 14 })
    expect(presetRange({ choice: 'recent12', start: 0, end: 24300, title: '' })).toMatchObject({ timeScale: 'month', startPoint: 24289, currentPoint: 24300 })
    expect(presetRange({ choice: 'thisYear', start: 0, end: 0, title: '' })).toMatchObject({ timeScale: 'month', currentPoint: monthIndex() })
    expect(presetRange({ choice: 'month', start: 24290, end: 24300, title: '' })).toMatchObject({ timeScale: 'month', startPoint: 24290, currentPoint: 24300 })
    expect(presetRange({ choice: 'hour', start: 490000, end: 490009, title: '' })).toMatchObject({ timeScale: 'hour', startPoint: 490000 })
  })

  it('시각(hour): 입력 ↔ 수, 이름표, 기간', () => {
    const t = hourOf('2026-11-08T14:30')!
    expect(t).toBeCloseTo(Date.UTC(2026, 10, 8, 14) / 3_600_000 + 0.5)
    expect(hourInput(t)).toBe('2026-11-08T14:30')
    expect(timeLabel('hour', t, [t - 5, t + 2])).toBe('14시 30분')
    expect(timeLabel('hour', t)).toBe('11월 8일 14시 30분')
    expect(rangeLabel('hour', hourOf('2026-11-08T09:00')!, hourOf('2026-11-08T18:00')!)).toBe('2026년 11월 8일 9시부터 18시까지')
    expect(rangeLabel('hour', hourOf('2026-11-08T09:00')!, hourOf('2026-11-09T12:00')!)).toBe('2026년 11월 8일 9시부터 11월 9일 12시까지')
    expect(rangeValid({ timeScale: 'hour', startPoint: t, currentPoint: t + 337 })).toBe(false)
    expect(rangeValid({ timeScale: 'month', startPoint: 5, currentPoint: 5 })).toBe(true)
    expect(monthInput(monthOf('2026-03')!)).toBe('2026-03')
  })

  it('모임장이 정한 질문으로 바꾸고 빈 글은 뺀다', () => {
    const qs = [{ key: 'feeling', q: 'a' }, { key: 'why', q: 'b' }, { key: 'now', q: 'c' }]
    expect(withPrompts(qs, { feeling: '바뀐 질문', why: '' }).map((q) => q.q)).toEqual(['바뀐 질문', 'c'])
  })
})

describe('0.13.0 주 단위 · 모임 글', () => {
  it('최근 12개월 · 올해는 몇째 주까지 적고 읽는다', () => {
    const m = 2026 * 12 + 9 // 2026년 10월
    expect(timeLabel('month', m)).toBe('10월')
    expect(timeLabel('month', fromParts('month', m, 3))).toBe('10월 셋째 주')
    // 서버처럼 소수 셋째 자리로 반올림해도 같은 주로 읽힌다
    for (let k = 1; k <= 4; k++) expect(timeParts('month', Math.round(fromParts('month', m, k) * 1000) / 1000)).toEqual({ whole: m, part: k })
    // 끌어 옮기면 4분의 1달(한 주) 단위로 맞춘다
    const f: Frame = { w: 400, h: 200, l: 0, r: 0, t: 0, b: 0, start: m - 11, end: m }
    expect(invert(f, sx(f, m - 5.3), 100, 4).timePoint).toBe(m - 5.25)
  })

  it('모임에서 그린 그래프: 보이는 순간 · 시점 · 설명을 그래프 제목으로 나누고, 회고는 없다', () => {
    const { g, a, b } = sample()
    g.entries = [a, { ...b, showOnGraph: false }]
    const s = postShared({ ...g, title: '' }, GROUP_POST)
    expect(s.title).toBe('나의 작은 인생 이야기')
    expect(s.entries.map((e) => e.title)).toEqual(['새 친구'])
    expect(s.entries[0].description).toBe('같은 반')
    expect(JSON.stringify(s)).not.toContain('비밀 회고')
    expect(sanitizePostOptions({ title: 'x', entryIds: 'nope' })).toBeNull()
    expect(sanitizePostOptions({ title: ' 제목 ', entryIds: [a.id], time: 'yes' })).toEqual({ title: '제목', entryIds: [a.id], descriptions: false, time: false })
  })
})

describe('오픈소스 고지', () => {
  it('설치된 모든 npm 패키지와 플랫폼 · 글꼴 · Docker 패키지가 원문과 함께, 표기한 라이선스가 맞게 실린다', async () => {
    // @ts-expect-error — 빌드 스크립트(.mjs)라 타입이 없다
    const { collect, matches } = await import('../scripts/licenses.mjs')
    const all = collect() // 원문과 표기가 맞지 않으면 여기서 던진다
    const lock = JSON.parse((await import('../package-lock.json?raw')).default).packages
    const names = new Set(all.groups.flatMap((g: { items: { name: string; version: string }[] }) => g.items.map((it) => `${it.name}@${it.version}`)))
    // 다른 플랫폼용 선택 패키지(optional)는 이 기기에 설치되지 않으니 빼고, 나머지는 모두 있어야 한다
    for (const [path, info] of Object.entries(lock as Record<string, { version: string; optional?: boolean }>)) {
      if (path && !info.optional) expect(names).toContain(`${path.replace(/.*node_modules\//, '')}@${info.version}`)
    }
    for (const want of ['Node.js@24.22.2', 'nginx@1.27.5', 'Pretendard@1.3.9', 'busybox@1.37.0-r31', 'musl@1.2.6-r3']) expect(names).toContain(want)
    // 확인 장치 자체도 확인: 다른 라이선스 원문은 통과하지 않는다
    const mit = 'Permission is hereby granted, free of charge, to any person'
    expect(matches('MIT', mit)).toBe(true)
    expect(matches('Apache-2.0', mit)).toBe(false)
    expect(matches('BSD-3-Clause', 'Redistribution and use in source and binary forms')).toBe(false)
    expect(matches('GPL-2.0-only OR MIT', mit)).toBe(true)
    expect(matches('MIT AND Apache-2.0', mit)).toBe(false)
  })
})

it('시각 눈금은 폭에 맞춰 겹치지 않고, 며칠이면 자정에만 날짜', () => {
  const h = (d: number, hr: number) => Date.UTC(2026, 10, d, hr) / 3_600_000
  const day = hourTicks(h(10, 9), h(10, 18), 420)
  expect(day.length).toBeLessThanOrEqual(6)
  expect(day.every(([, l]) => /^\d+시$/.test(l))).toBe(true)
  const two = hourTicks(h(9, 1), h(10, 12), 420)
  expect(two.length).toBeLessThanOrEqual(6)
  expect(two.find(([t]) => t === h(10, 0))?.[1]).toBe('11/10')
  expect(hourTicks(h(1, 0), h(14, 0), 420).every(([, l]) => l.includes('/'))).toBe(true)
})
