import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { openDb } from './db.ts'
import { readConfig } from './config.ts'
import { newEntry, newGraph } from '../src/store.ts'
import { toShared } from '../src/share.ts'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer(
    createApp(openDb(':memory:'), {
      secureCookie: false,
      admin: { id: 'admin', password: 'admin-password-1234' },
      publicUrl: 'https://geuryeobom.example',
      devServer: true,
    }),
  )
  await new Promise<void>((ok) => server.listen(0, ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})
afterAll(() => server.close())

/** 쿠키를 기억하는 작은 클라이언트 (브라우저 한 개 = 사람 한 명) */
function client() {
  let cookie = ''
  // 사람마다 다른 IP (가입 · 로그인 횟수 제한은 IP 기준이라, 테스트가 늘어도 서로 막지 않게)
  const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'X-Requested-With': 'geuryeobom' }) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, data: await res.json() }
  }
  return Object.assign(call, { cookie: () => cookie })
}

const BIRTH = '20120315'
const signup = async (name: string, birth = BIRTH) => {
  const c = client()
  const r = await c('POST', '/auth/signup', { name, birth, nickname: name, agree: true })
  expect(r.status).toBe(200)
  return c
}

describe('api', () => {
  it('다른 사이트에서 보낸 요청(헤더 없음)은 막는다', async () => {
    const r = await client()('POST', '/auth/signup', { name: 'x', birth: BIRTH, nickname: 'x' }, {})
    expect(r.status).toBe(403)
  })

  it('내 그래프는 나만 읽고 고칠 수 있다', async () => {
    const a = await signup('alice')
    const b = await signup('bob')
    const g = { ...newGraph(), title: '앨리스의 선' }
    expect((await a('PUT', `/graphs/${g.id}`, { graph: g })).status).toBe(200)
    expect((await a('GET', '/graphs')).data).toHaveLength(1)
    expect((await b('GET', `/graphs/${g.id}`)).status).toBe(404)
    expect((await b('PUT', `/graphs/${g.id}`, { graph: { ...g, title: '덮어쓰기' } })).status).toBe(404)
    expect((await a('GET', `/graphs/${g.id}`)).data.title).toBe('앨리스의 선')
    expect((await client()('GET', '/graphs')).status).toBe(401)
  })

  it('이름 + 생년월일로 가입 · 로그인한다', async () => {
    await signup('김하늘')
    const login = (name: string, birth: string) => client()('POST', '/auth/login', { name, birth })
    expect((await login('김하늘', '20120316')).status).toBe(401)
    expect((await login('김 하늘', BIRTH)).status).toBe(200) // 띄어쓰기는 같은 이름으로 본다
    // 같은 이름 · 같은 생일은 한 계정만, 이름이 같아도 생일이 다르면 다른 사람
    expect((await client()('POST', '/auth/signup', { name: '김하늘', birth: BIRTH, nickname: 'x', agree: true })).status).toBe(409)
    expect((await client()('POST', '/auth/signup', { name: '김하늘', birth: '20100101', nickname: 'y', agree: true })).status).toBe(200)
  })

  it('같은 이름으로 생일을 계속 맞혀보면 막힌다', async () => {
    await signup('박노을', '20110707')
    const guess = (d: number) => client()('POST', '/auth/login', { name: '박노을', birth: `201101${String(d).padStart(2, '0')}` })
    // 가입 1번도 그 이름으로 한 시도로 센다 → 틀린 로그인 9번 뒤 막힌다 (15분에 10번)
    for (let d = 1; d <= 9; d++) expect((await guess(d)).status).toBe(401)
    expect((await guess(10)).status).toBe(429)
    expect((await client()('POST', '/auth/login', { name: '박노을', birth: '20110707' })).status).toBe(429) // 잠시 동안은 본인도 기다려야 한다
  })

  it('약관에 동의(agree: true)하지 않으면 가입되지 않는다', async () => {
    expect((await client()('POST', '/auth/signup', { name: '동의안함', birth: '20080808', nickname: 'n' })).status).toBe(400)
    expect((await client()('POST', '/auth/signup', { name: '동의안함', birth: '20080808', nickname: 'n', agree: 'yes' })).status).toBe(400)
    expect((await client()('POST', '/auth/signup', { name: '동의함', birth: '20080808', nickname: 'n', agree: true })).status).toBe(200)
  })

  it('없는 날짜 · 미래 날짜 · 8자리가 아닌 생년월일은 받지 않는다', async () => {
    for (const birth of ['20120230', '2012031', '20991231', '2012-03-15', '18991231']) {
      expect((await client()('POST', '/auth/signup', { name: '테스트', birth, nickname: 't', agree: true })).status).toBe(400)
    }
  })

  it('모임: 나누기 · 회고 차단 · 응원 · 나만 보기로 내리기', async () => {
    const owner = await signup('leader')
    const kid = await signup('kid')
    const outsider = await signup('outsider')

    const made = await owner('POST', '/groups', { name: '수요 모임' })
    const gid = made.data.id
    expect((await kid('POST', '/groups/join', { code: made.data.code.toLowerCase() })).data.id).toBe(gid)
    expect((await outsider('GET', `/groups/${gid}`)).status).toBe(404)

    const g = newGraph()
    const e = { ...newEntry(10, 3, '새 친구'), reflection: { feeling: '비밀 회고', why: '', now: '', toPast: '', fromPast: '' } }
    g.entries = [e]
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    const options = { title: '나의 선', entryIds: [e.id], descriptions: true, time: true }

    // 나만 보기 상태에서는 나눌 수 없다
    expect((await kid('POST', `/groups/${gid}/posts`, { graphId: g.id, options })).status).toBe(403)
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, visibility: 'link' } })
    // 나눌 내용은 서버가 그래프에서 만든다: 회고를 몰래 끼워 넣을 자리가 없다
    const post = await kid('POST', `/groups/${gid}/posts`, { graphId: g.id, options: { ...options, reflection: true }, shared: { entries: [{ reflection: '비밀 회고' }] } })
    expect(post.status).toBe(200)

    const seen = await owner('GET', `/groups/${gid}`)
    expect(JSON.stringify(seen.data)).not.toContain('비밀 회고')
    expect(seen.data.posts[0].nickname).toBe('kid')
    expect(seen.data.posts[0].counts).toBeUndefined() // 남의 응원 수는 보이지 않는다
    expect(seen.data.code).toBe(made.data.code)
    expect((await kid('GET', `/groups/${gid}`)).data.code).toBeUndefined() // 코드는 모임장만

    const pid = post.data.id
    expect((await owner('POST', `/posts/${pid}/cheers`, { kind: '응원해요' })).data.on).toBe(true)
    expect((await owner('POST', `/posts/${pid}/cheers`, { kind: '최고예요' })).status).toBe(400)
    expect((await kid('POST', `/posts/${pid}/cheers`, { kind: '응원해요' })).status).toBe(400)
    expect((await kid('GET', `/groups/${gid}`)).data.posts[0].counts).toEqual({ 응원해요: 1 })

    // 나만 보기로 돌리면 모임에서도 내려간다
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, visibility: 'private' } })
    expect((await owner('GET', `/groups/${gid}`)).data.posts).toHaveLength(0)
  })

  it('받은 응원 알림: since 이후 것만, 보낸 사람은 없이', async () => {
    const owner = await signup('응원장', '20000101')
    const kid = await signup('응원받는이', '20100101')
    const made = await owner('POST', '/groups', { name: '응원 모임' })
    await kid('POST', '/groups/join', { code: made.data.code })
    const g = { ...newGraph(), visibility: 'link' as const, title: '받는 선' }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    const options = { title: '받는 선', entryIds: [], descriptions: false, time: true }
    const post = await kid('POST', `/groups/${made.data.id}/posts`, { graphId: g.id, options })
    const before = new Date(Date.now() - 1000).toISOString()
    await owner('POST', `/posts/${post.data.id}/cheers`, { kind: '함께할게요' })
    const got = await kid('GET', `/me/cheers?since=${encodeURIComponent(before)}`)
    expect(got.data).toHaveLength(1)
    expect(got.data[0]).toMatchObject({ kind: '함께할게요', groupName: '응원 모임', title: '받는 선' })
    expect(JSON.stringify(got.data)).not.toContain('응원장') // 누가 보냈는지는 없다
    const later = await kid('GET', `/me/cheers?since=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`)
    expect(later.data).toHaveLength(0)
    expect((await kid('GET', '/me/cheers?since=nope')).status).toBe(400)
  })

  it('시각(hour) 그래프는 14일 안으로만, 모임장이 정한 질문은 아는 칸만 짧게 남는다', async () => {
    const u = await signup('시각이', '20080808')
    const s0 = Date.UTC(2026, 10, 8, 9) / 3_600_000
    const g = { ...newGraph(), timeScale: 'hour' as const, startPoint: s0 + 0.5, currentPoint: s0 + 9, prompts: { moments: ['캠프 첫날', ''], reflect: { feeling: '그때 웃었나요?', why: '', bogus: 'x' }, now: { word: '한 단어로' } } }
    const saved = (await u('PUT', `/graphs/${g.id}`, { graph: g })).data
    expect(saved).toMatchObject({ timeScale: 'hour', startPoint: s0 + 0.5, currentPoint: s0 + 9 })
    expect(saved.prompts).toEqual({ moments: ['캠프 첫날'], reflect: { feeling: '그때 웃었나요?', why: '' }, now: { word: '한 단어로' } })
    expect((await u('PUT', `/graphs/${g.id}`, { graph: { ...g, currentPoint: s0 + 400 } })).status).toBe(400)
  })

  it('선 색 · 답장은 저장되고, 이상한 선 색은 버린다', async () => {
    const u = await signup('색칠이', '20090909')
    const g = { ...newGraph(), lineColor: 'lilac' as const, entries: [{ ...newEntry(5), reflection: { feeling: '', why: '', now: '', toPast: '', fromPast: '잘 버텼어' } }] }
    const saved = await u('PUT', `/graphs/${g.id}`, { graph: g })
    expect(saved.data.lineColor).toBe('lilac')
    expect(saved.data.entries[0].reflection.fromPast).toBe('잘 버텼어')
    expect((await u('PUT', `/graphs/${g.id}`, { graph: { ...g, lineColor: 'neon' } })).data.lineColor).toBeUndefined()
  })

  it('정식 버전(DEV_SERVER 없음)에는 DB 초기화가 없다', async () => {
    expect(readConfig({}).devServer).toBe(false)
    expect(readConfig({ DEV_SERVER: 'true' }).devServer).toBe(true)
    const prod = createServer(createApp(openDb(':memory:'), { secureCookie: false, admin: { id: 'admin', password: 'admin-password-1234' } }))
    await new Promise<void>((ok) => prod.listen(0, ok))
    const url = `http://127.0.0.1:${(prod.address() as AddressInfo).port}/api`
    const h = { 'Content-Type': 'application/json', 'X-Requested-With': 'geuryeobom' }
    const login = await fetch(url + '/admin/login', { method: 'POST', headers: h, body: JSON.stringify({ id: 'admin', password: 'admin-password-1234' }) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const r = await fetch(url + '/admin/reset', { method: 'POST', headers: { ...h, Cookie: cookie }, body: JSON.stringify({ password: 'admin-password-1234', confirm: '모두 지우기' }) })
    expect(r.status).toBe(404)
    expect((await (await fetch(url + '/config')).json()).dev).toBe(false)
    // 1.1.0: 정식이 된 묶음은 열려 있고(로그인이 필요해 401), 보호자 동의만 아직 스위치로 꺼져 있다
    expect((await fetch(url + '/me/export')).status).toBe(401)
    expect((await fetch(url + '/orgs')).status).toBe(401)
    expect((await fetch(url + '/groups/bulk', { method: 'POST', headers: h, body: JSON.stringify({ names: ['x'] }) })).status).toBe(401)
    expect((await fetch(url + '/guardian/abcdefghijklmnopqrstu')).status).toBe(404)
    prod.close()
  })

  it('공유 주소 설정을 화면에 알려준다', async () => {
    expect((await client()('GET', '/config')).data).toMatchObject({ publicUrl: 'https://geuryeobom.example', developer: null, operator: null, dev: true })
  })

  it('관리자: 로그인 · 둘러보기 · 모든 기록 보기 · 지우기', async () => {
    const kid = await signup('최바다', '20100505')
    const g = { ...newGraph(), title: '바다의 선', entries: [{ ...newEntry(5, 1, '이사'), reflection: { feeling: '관리자만 여는 마음', why: '', now: '', toPast: '', fromPast: '' } }] }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })

    const adm = client()
    expect((await adm('GET', '/admin/overview')).status).toBe(401)
    expect((await kid('GET', '/admin/overview')).status).toBe(401) // 일반 계정 세션으로는 안 된다
    expect((await adm('POST', '/admin/login', { id: 'admin', password: 'wrong-password' })).status).toBe(401)
    expect((await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })).status).toBe(200)
    expect((await adm('GET', '/admin/me')).data).toMatchObject({ enabled: true, admin: true })

    const ov = await adm('GET', '/admin/overview')
    expect(ov.data.counts.users).toBeGreaterThan(0)
    expect(JSON.stringify(ov.data)).not.toContain('관리자만 여는 마음') // 둘러보기에는 숫자 · 제목만
    const target = ov.data.users.find((u: { nickname: string }) => u.nickname === '최바다')
    const all = await adm('GET', `/admin/users/${target.id}`)
    expect(all.data.nickname).toBe('최바다')
    expect(all.data.graphs[0].entries[0].reflection.feeling).toBe('관리자만 여는 마음')
    // 한눈에: 이번 주 다녀간 사람 · 새 그래프, 사람마다 마지막 방문 · 로그인된 기기
    expect(ov.data.stats.week.visitors).toBeGreaterThan(0)
    expect(ov.data.stats.week.graphs).toBeGreaterThan(0)
    expect(ov.data.stats.daily).toHaveLength(14)
    expect(target.lastSeenAt).not.toBe('')
    expect(all.data.sessions).toBe(1)
    expect((await kid('GET', `/admin/users/${target.id}`)).status).toBe(401)
    // 관리자 접속 기록: 틀린 시도와 들어온 것 모두, 별칭을 붙일 수 있다
    const logs = (await adm('GET', '/admin/logins')).data
    expect(logs.slice(0, 2).map((l: { ok: boolean }) => l.ok)).toEqual([true, false])
    await adm('PUT', '/admin/ip-aliases', { ip: logs[0].ip, alias: '사무실 PC' })
    expect((await adm('GET', '/admin/logins')).data[0].alias).toBe('사무실 PC')
    // DB 백업은 SQLite 파일 그대로
    const backup = await fetch(`${base}/admin/backup`, { headers: { Cookie: adm.cookie() } })
    expect(backup.headers.get('content-disposition')).toMatch(/geuryeobom-\d{4}-\d{2}-\d{2}\.db/)
    expect(Buffer.from(await backup.arrayBuffer()).subarray(0, 15).toString()).toBe('SQLite format 3')
    expect((await adm('DELETE', `/admin/users/${target.id}`)).status).toBe(200)
    expect((await kid('GET', '/graphs')).status).toBe(401) // 지워진 계정의 세션도 끝난다

    await adm('POST', '/admin/logout', {})
    expect((await adm('GET', '/admin/overview')).status).toBe(401)
  })

  it('계정을 지우면 기록도 함께 사라진다', async () => {
    const d = await signup('dave')
    const g = newGraph()
    await d('PUT', `/graphs/${g.id}`, { graph: g })
    expect((await d('POST', '/me/delete', { name: 'dave', birth: '20000101' })).status).toBe(401)
    expect((await d('POST', '/me/delete', { name: 'dave', birth: BIRTH })).status).toBe(200)
    expect((await client()('POST', '/auth/login', { name: 'dave', birth: BIRTH })).status).toBe(401)
  })

  it('모임장은 나의 시간을 미리 정하고, 모임 사람만 볼 수 있다', async () => {
    const owner = await signup('teacher')
    const { id, code } = (await owner('POST', '/groups', { name: '1학기 돌아보기' })).data
    const preset = { choice: 'age', start: 10, end: 14, title: '우리 반의 선' }
    expect((await owner('PUT', `/groups/${id}/preset`, { preset })).data.preset).toEqual(preset)
    expect((await owner('GET', `/groups/${id}`)).data.preset).toEqual(preset)
    expect((await owner('PUT', `/groups/${id}/preset`, { preset: { ...preset, start: 20 } })).status).toBe(400)
    const member = await signup('student')
    await member('POST', '/groups/join', { code })
    expect((await member('PUT', `/groups/${id}/preset`, { preset: null })).status).toBe(403)
    expect((await owner('PUT', `/groups/${id}/preset`, { preset: null })).data.preset).toBeNull()
  })

  it('초대 링크: 로그인 없이 이름 + 생일로 들어가고, 처음이면 별명 · 동의를 받아 가입한다', async () => {
    const owner = await signup('inviter')
    const { id, code } = (await owner('POST', '/groups', { name: '수요 모임' })).data
    await owner('PUT', `/groups/${id}/preset`, { preset: { choice: 'thisYear', start: 0, end: 0, title: '' } })

    const guest = client()
    const info = (await guest('GET', `/invite/${code.toLowerCase()}`)).data
    expect(info).toMatchObject({ name: '수요 모임', joined: false, preset: { choice: 'thisYear' } })
    expect(info.id).toBeUndefined() // 들어오기 전에는 모임 안을 볼 수 없다
    expect((await guest('GET', `/invite/NOPE99`)).status).toBe(404)

    // 처음 온 사람: 별명 없이 보내면 가입이 필요하다고만 알려준다
    expect((await guest('POST', `/invite/${code}`, { name: 'newbie', birth: BIRTH })).data).toEqual({ needSignup: true })
    expect((await guest('POST', `/invite/${code}`, { name: 'newbie', birth: BIRTH, nickname: '새싹' })).status).toBe(400) // 동의 없음
    const joined = await guest('POST', `/invite/${code}`, { name: 'newbie', birth: BIRTH, nickname: '새싹', agree: true })
    expect(joined.data).toMatchObject({ id, user: { nickname: '새싹' } })
    expect((await guest('GET', `/groups/${id}`)).data.members).toEqual([{ nickname: 'inviter', role: 'owner' }, { nickname: '새싹', role: 'member' }])

    // 이미 계정이 있는 사람은 이름 + 생일만으로 로그인하며 들어간다
    await signup('oldie')
    const again = client()
    expect((await again('POST', `/invite/${code}`, { name: 'oldie', birth: BIRTH })).data).toMatchObject({ id, user: { nickname: 'oldie' } })
    expect((await again('GET', '/me')).data.user.nickname).toBe('oldie')
  })

  it('초대 링크: 처음 온 사람은 이름 · 생일 · 별명 · 동의를 한 번에 보내면 바로 가입된다', async () => {
    const owner = await signup('one-owner')
    const { id, code } = (await owner('POST', '/groups', { name: '한 번에 모임', intro: '반가워요' })).data
    expect((await client()('GET', `/invite/${code}`)).data.intro).toBe('반가워요')
    const guest = client()
    const r = await guest('POST', `/invite/${code}`, { name: '한번에', birth: '20100303', nickname: '단번', agree: true })
    expect(r.data).toMatchObject({ id, user: { nickname: '단번' } })
    // 다음에는 같은 이름 · 생일로 로그인해서 쓰던 기록을 이어 쓴다
    expect((await client()('POST', '/auth/login', { name: '한번에', birth: '20100303' })).status).toBe(200)
    // 이미 계정이 있으면 별명은 무시하고 그 계정으로 들어간다
    const again = await client()('POST', `/invite/${code}`, { name: '한번에', birth: '20100303', nickname: '다른별명', agree: true })
    expect(again.data.user.nickname).toBe('단번')
  })

  it('모임 이름(30자) · 소개글은 모임장만 고친다', async () => {
    const owner = await signup('info-owner')
    expect((await owner('POST', '/groups', { name: 'ㄱ'.repeat(31) })).status).toBe(400)
    const { id, code } = (await owner('POST', '/groups', { name: 'ㄱ'.repeat(30), intro: '첫 소개' })).data
    expect((await owner('GET', `/groups/${id}`)).data).toMatchObject({ name: 'ㄱ'.repeat(30), intro: '첫 소개' })
    expect((await owner('PUT', `/groups/${id}`, { name: '새 이름', intro: '둘째 줄\n소개' })).data).toEqual({ name: '새 이름', intro: '둘째 줄\n소개' })
    const member = await signup('info-member')
    await member('POST', '/groups/join', { code })
    expect((await member('GET', `/groups/${id}`)).data.name).toBe('새 이름') // 고치면 바로 보인다
    expect((await member('PUT', `/groups/${id}`, { name: '몰래' })).status).toBe(403)
  })

  it('모임에서 그린 그래프는 완성하면 그 모임에 저절로 나눠지고, 고치면 바로 반영된다', async () => {
    const owner = await signup('auto-owner')
    const kid = await signup('auto-kid')
    const outsider = await signup('auto-out')
    const { id, code } = (await owner('POST', '/groups', { name: '자동 모임' })).data
    await kid('POST', '/groups/join', { code })
    const e = { ...newEntry(10, 2, '첫 순간'), description: '설명도 함께', reflection: { feeling: '비밀', why: '', now: '', toPast: '', fromPast: '' } }
    const g = { ...newGraph(), title: '모임의 선', groupId: id, entries: [e] }

    // 그리는 중에는 나눠지지 않고, 언제나 ‘함께 나누기’
    expect((await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, visibility: 'private' } })).data.visibility).toBe('link')
    expect((await owner('GET', `/groups/${id}`)).data.posts).toHaveLength(0)
    // 완성하면 모임에 나눠진다 (순간 · 시점 · 설명, 회고는 빼고)
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, completed: true } })
    const seen = (await owner('GET', `/groups/${id}`)).data.posts
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ bound: true, graph: { title: '모임의 선', showTime: true, entries: [{ title: '첫 순간', description: '설명도 함께' }] } })
    expect(JSON.stringify(seen)).not.toContain('비밀')
    // 고치면 모임 글도 바로
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, completed: true, title: '고친 선', entries: [{ ...e, title: '고친 순간' }] } })
    expect((await owner('GET', `/groups/${id}`)).data.posts[0].graph).toMatchObject({ title: '고친 선', entries: [{ title: '고친 순간' }] })
    // 그린 사람은 내릴 수 없고 (모임과 함께하는 선), 모임장은 모임을 지키려고 내릴 수 있다
    expect((await kid('DELETE', `/posts/${seen[0].id}`)).status).toBe(403)
    expect((await owner('DELETE', `/posts/${seen[0].id}`)).status).toBe(200)
    // 모임장이 내리면 그린 사람에게 알리고(myUnposted), 그린 사람이 고치면 바로 다시 올라간다 (1.0.0)
    expect((await owner('GET', `/groups/${id}`)).data.posts).toHaveLength(0)
    expect((await kid('GET', `/groups/${id}`)).data.myUnposted).toEqual([{ graphId: g.id, title: '고친 선' }])
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, completed: true, title: '또 고침' } })
    const back = (await owner('GET', `/groups/${id}`)).data.posts
    expect(back).toHaveLength(1)
    expect(back[0].graph.title).toBe('또 고침')
    expect((await kid('GET', `/groups/${id}`)).data.myUnposted).toEqual([])

    // 들어가지 않은 모임은 이어 둘 수 없다
    const h = { ...newGraph(), groupId: id, completed: true }
    expect((await outsider('PUT', `/graphs/${h.id}`, { graph: h })).data.groupId).toBeUndefined()
  })

  it('직접 나눈 그래프도 고치면 고른 순간만 바로 반영된다', async () => {
    const owner = await signup('sync-owner')
    const kid = await signup('sync-kid')
    const { id, code } = (await owner('POST', '/groups', { name: '동기 모임' })).data
    await kid('POST', '/groups/join', { code })
    const a = newEntry(1, 1, '고른 순간'), b = newEntry(2, -1, '안 고른 순간')
    const g = { ...newGraph(), visibility: 'link' as const, entries: [a, b] }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    await kid('POST', `/groups/${id}/posts`, { graphId: g.id, options: { title: '나눈 선', entryIds: [a.id], descriptions: false, time: false } })
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, entries: [{ ...a, title: '이름 바꿈' }, b] } })
    const post = (await owner('GET', `/groups/${id}`)).data.posts[0]
    expect(post.bound).toBe(false)
    expect(post.graph.entries.map((x: { title: string }) => x.title)).toEqual(['이름 바꿈'])
    expect((await kid('DELETE', `/posts/${post.id}`)).status).toBe(200) // 직접 나눈 건 언제든 내린다
  })

  it('관리자: 사이트 설정을 고치고 되돌리며, 문의처는 이메일만 받는다', async () => {
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const site = { publicUrl: 'https://grb.example/', operator: { name: '○○수련관', contact: 'privacy@grb.example' }, developer: { name: '팀', org: '', contact: '', url: '' } }
    expect((await adm('PUT', '/admin/settings', { ...site, operator: { name: 'x', contact: '031-000-0000' } })).status).toBe(400)
    expect((await adm('PUT', '/admin/settings', { ...site, publicUrl: 'javascript:alert(1)' })).status).toBe(400)
    expect((await adm('PUT', '/admin/settings', site)).status).toBe(200)
    expect((await client()('GET', '/config')).data).toMatchObject({
      publicUrl: 'https://grb.example', operator: { name: '○○수련관', contact: 'privacy@grb.example' }, developer: { name: '팀', org: '', contact: '', url: '' }, dev: true,
    })
    expect((await client()('PUT', '/admin/settings', site)).status).toBe(401)
    expect((await adm('GET', '/admin/settings')).data.saved).toBe(true)
    await adm('DELETE', '/admin/settings')
    expect((await client()('GET', '/config')).data.publicUrl).toBe('https://geuryeobom.example') // .env 값으로
  })

  it('관리자 공지 팝업: 켜면 누구나 받고, 끄면 사라지며, 고치면 at 이 바뀐다', async () => {
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    expect((await client()('GET', '/notice')).data.notice).toBeNull()
    expect((await client()('PUT', '/admin/notice', { on: true, title: 'x', body: '' })).status).toBe(401)
    expect((await adm('PUT', '/admin/notice', { on: true, title: '', body: '' })).status).toBe(400)
    const first = (await adm('PUT', '/admin/notice', { on: true, title: '점검 안내', body: '토요일 밤 10시' })).data
    expect((await client()('GET', '/notice')).data.notice).toEqual({ title: '점검 안내', body: '토요일 밤 10시', at: first.at })
    expect((await adm('PUT', '/admin/notice', { on: true, title: '점검 안내', body: '토요일 밤 10시' })).data.at).toBe(first.at) // 그대로면 다시 안 뜬다
    await new Promise((r) => setTimeout(r, 5))
    expect((await adm('PUT', '/admin/notice', { on: true, title: '점검 안내', body: '일요일로 바뀌었어요' })).data.at).not.toBe(first.at)
    await adm('PUT', '/admin/notice', { on: false, title: '점검 안내', body: '일요일로 바뀌었어요' })
    expect((await client()('GET', '/notice')).data.notice).toBeNull()
  })

  it('공동 모임장은 모임을 꾸리고, 모임장은 다른 사람에게 넘길 수 있다', async () => {
    const owner = await signup('lead-a')
    const b = await signup('lead-b')
    const m = await signup('lead-m')
    const { id, code } = (await owner('POST', '/groups', { name: '넘기는 모임' })).data
    await b('POST', '/groups/join', { code })
    await m('POST', '/groups/join', { code })
    const members = (await owner('GET', `/groups/${id}`)).data.members
    const bid = members.find((x: { nickname: string }) => x.nickname === 'lead-b').id
    const mid = members.find((x: { nickname: string }) => x.nickname === 'lead-m').id
    expect((await b('GET', `/groups/${id}`)).data.members[0]).toEqual({ nickname: 'lead-a', role: 'owner' }) // id 는 모임장에게만

    // 공동 모임장: 모임 꾸리기는 되고, 사람 정하기 · 없애기 · 넘기기는 안 된다
    expect((await m('PUT', `/groups/${id}/members/${bid}`, { role: 'co' })).status).toBe(403)
    expect((await owner('PUT', `/groups/${id}/members/${bid}`, { role: 'co' })).data).toEqual({ role: 'co' })
    const asCo = (await b('GET', `/groups/${id}`)).data
    expect([asCo.isOwner, asCo.isManager, asCo.code]).toEqual([false, true, code])
    expect((await b('PUT', `/groups/${id}`, { name: '공동이 고친 이름' })).status).toBe(200)
    expect((await b('PUT', `/groups/${id}/preset`, { preset: null })).status).toBe(200)
    expect((await b('DELETE', `/groups/${id}`)).status).toBe(403)
    expect((await b('POST', `/groups/${id}/transfer`, { userId: mid })).status).toBe(403)
    expect((await m('GET', `/groups/${id}`)).data.code).toBeUndefined()
    expect((await m('GET', '/groups')).data[0].role).toBe('member')
    expect((await b('GET', '/groups')).data[0].role).toBe('co')

    // 모임장 넘기기: 받은 사람이 모임장, 넘긴 사람은 공동 모임장으로 남아 나갈 수 있다
    expect((await owner('POST', '/groups/' + id + '/leave', {})).status).toBe(400)
    expect((await owner('POST', `/groups/${id}/transfer`, { userId: 'nobody' })).status).toBe(400)
    expect((await owner('POST', `/groups/${id}/transfer`, { userId: mid })).status).toBe(200)
    const after = (await m('GET', `/groups/${id}`)).data
    expect(after.isOwner).toBe(true)
    expect(after.members.map((x: { nickname: string; role: string }) => `${x.nickname}:${x.role}`)).toEqual(['lead-m:owner', 'lead-a:co', 'lead-b:co'])
    expect((await owner('POST', `/groups/${id}/leave`, {})).status).toBe(200)
  })

  it('짧은 공유 링크: 만들고 열고, 만든 사람 · 관리자는 끄고, 나만 보기 · 그래프 지우기면 꺼진다', async () => {
    const u = await signup('linker')
    const g = { ...newGraph(), visibility: 'link' as const, entries: [{ ...newEntry(5, 2, '반짝'), reflection: { feeling: '비밀', why: '', now: '', toPast: '', fromPast: '' } }] }
    await u('PUT', `/graphs/${g.id}`, { graph: g })
    const shared = toShared(g, { title: '짧은 선', entryIds: new Set([g.entries[0].id]), descriptions: false, time: true })
    const made = await u('POST', '/links', { shared: { ...shared, entries: [{ ...shared.entries[0], reflection: '비밀' }] }, graphId: g.id })
    expect(made.data.code).toMatch(/^[A-Za-z0-9]{8}$/)
    const seen = await client()('GET', `/links/${made.data.code}`)
    expect(seen.data.shared.title).toBe('짧은 선')
    expect(JSON.stringify(seen.data)).not.toContain('비밀')
    expect((await u('GET', `/graphs/${g.id}/links`)).data).toHaveLength(1)
    // 로그인 없이도 만들 수 있다 (누가 만들었는지는 남지 않는다)
    const anon = await client()('POST', '/links', { shared })
    expect(anon.status).toBe(200)
    expect((await client()('DELETE', `/links/${anon.data.code}`)).status).toBe(401)
    // 나만 보기로 바꾸면 링크도 꺼진다
    await u('PUT', `/graphs/${g.id}`, { graph: { ...g, visibility: 'private' } })
    expect((await client()('GET', `/links/${made.data.code}`)).status).toBe(404)
    // 그래프를 지우면 그 링크도
    await u('PUT', `/graphs/${g.id}`, { graph: g })
    const again = await u('POST', '/links', { shared, graphId: g.id })
    await u('DELETE', `/graphs/${g.id}`)
    expect((await client()('GET', `/links/${again.data.code}`)).status).toBe(404)
  })

  it('모임장이 내린 모임 선은 그린 사람에게 알려 주고, 다시 올릴 수 있다', async () => {
    const owner = await signup('down-own')
    const kid = await signup('down-kid')
    const { id, code } = (await owner('POST', '/groups', { name: '내림 모임' })).data
    await kid('POST', '/groups/join', { code })
    const g = { ...newGraph(), title: '다시 올릴 선', groupId: id, completed: true, entries: [newEntry(3, 1, '하나')] }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    const pid = (await owner('GET', `/groups/${id}`)).data.posts[0].id
    expect((await kid('GET', `/groups/${id}`)).data.myUnposted).toEqual([])
    await owner('DELETE', `/posts/${pid}`)
    expect((await kid('GET', `/groups/${id}`)).data.myUnposted).toEqual([{ graphId: g.id, title: '다시 올릴 선' }])
    const re = await kid('POST', `/groups/${id}/posts`, { graphId: g.id, options: { title: '', entryIds: null, descriptions: true, time: true } })
    expect(re.status).toBe(200)
    expect((await kid('GET', `/groups/${id}`)).data.myUnposted).toEqual([])
  })

  it('미래의 나에게 쓴 편지는 저장되고, 모임 · 링크에는 나가지 않는다', async () => {
    const u = await signup('letter')
    const g = { ...newGraph(), futureLetter: { text: '잘 지내니?', openAt: '2027-11-01T00:00:00.000Z' } }
    const saved = (await u('PUT', `/graphs/${g.id}`, { graph: g })).data
    expect(saved.futureLetter).toMatchObject({ text: '잘 지내니?', openAt: '2027-11-01T00:00:00.000Z' })
    expect((await u('PUT', `/graphs/${g.id}`, { graph: { ...g, futureLetter: { text: '날짜 없음' } } })).data.futureLetter).toBeUndefined()
  })

  it('[보안] 초대 링크 · 가입으로 남의 생일을 맞혀 보는 것도 이름 기준으로 막힌다 (IP 를 바꿔도)', async () => {
    await signup('피해자', '20110607')
    const owner = await signup('공격자모임')
    const { code } = (await owner('POST', '/groups', { name: '미끼 모임' })).data
    // 사람(IP)마다 새 클라이언트: IP 를 바꿔 가며 생일을 맞혀 본다
    const tryInvite = (d: number) => client()('POST', `/invite/${code}`, { name: '피해자', birth: `201106${String(d).padStart(2, '0')}`, nickname: '침입', agree: true })
    const statuses: number[] = []
    for (let d = 13; d <= 24; d++) statuses.push((await tryInvite(d)).status) // 모두 틀린 생일
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0) // 몇 번 틀리면 막힌다
    expect((await tryInvite(7)).status).toBe(429) // 맞는 생일이어도 막힌 동안은 들어갈 수 없다
    // 가입(409 = 이미 있음)으로 떠보는 것도 같은 이름 기준으로 막힌다
    const trySignup = (d: number) => client()('POST', '/auth/signup', { name: '피해자', birth: `201106${String(d).padStart(2, '0')}`, nickname: 'x', agree: true })
    expect((await trySignup(7)).status).toBe(429)
  })

  it('[보안] 로그인하지 않으면 관리자 · 남의 기록 · 모임 API 는 모두 막힌다', async () => {
    const anon = client()
    for (const [m, p] of [['GET', '/admin/overview'], ['GET', '/admin/users/x'], ['GET', '/admin/backup'], ['GET', '/admin/links'], ['GET', '/admin/logins'], ['PUT', '/admin/settings'], ['GET', '/graphs'], ['GET', '/groups'], ['GET', '/me/cheers?since=2020-01-01']] as const) {
      expect([m, p, (await anon(m, p, m === 'GET' ? undefined : {})).status]).toEqual([m, p, 401])
    }
  })

  it('나이 · 연도는 한 달 단위 소수 시점을 그대로 저장한다', async () => {
    const a = await signup('months')
    const g = { ...newGraph(), entries: [newEntry(3.5, 2, '세 살 반')] }
    expect((await a('PUT', `/graphs/${g.id}`, { graph: g })).data.entries[0].timePoint).toBe(3.5)
  })
})

/** AUTH_SECRET 안내를 뺀 나머지 경고 (그 안내는 아래 테스트가 따로 본다) */
const others = (w: string[]) => w.filter((x) => !x.startsWith('AUTH_SECRET 이 비어'))

describe('설정(.env) 읽기', () => {
  it('[보안] AUTH_SECRET 을 비우면 DB 에 저장된다고 경고하고, 정하면 경고하지 않는다', () => {
    expect(readConfig({}).warnings.some((w) => w.startsWith('AUTH_SECRET 이 비어'))).toBe(true)
    expect(readConfig({ AUTH_SECRET: 'x'.repeat(40) }).warnings).toEqual([])
  })

  it('관리자 비밀번호가 짧거나 하나만 있으면 관리자 기능을 끈다', () => {
    expect(readConfig({ ADMIN_ID: 'admin', ADMIN_PASSWORD: 'short' }).admin).toBeNull()
    expect(readConfig({ ADMIN_ID: 'admin' }).admin).toBeNull()
    expect(readConfig({ ADMIN_ID: ' admin ', ADMIN_PASSWORD: 'long-enough-pass' }).admin).toEqual({ id: 'admin', password: 'long-enough-pass' })
  })

  it('공유 주소는 정리해서 쓰고, 이상하면 끈다', () => {
    expect(readConfig({ PUBLIC_URL: 'https://geuryeobom.kr/' }).publicUrl).toBe('https://geuryeobom.kr')
    expect(readConfig({ PUBLIC_URL: 'https://example.org/grb//' }).publicUrl).toBe('https://example.org/grb')
    expect(readConfig({ PUBLIC_URL: 'javascript:alert(1)' }).publicUrl).toBeNull()
    expect(others(readConfig({ PUBLIC_URL: 'not a url' }).warnings)).toHaveLength(1)
  })

  it('만든 사람 정보: 이메일 · https 주소만, 비우면 없음', () => {
    expect(readConfig({}).developer).toBeNull()
    const c = readConfig({ DEV_NAME: '하프트웨어', DEV_CONTACT: 'team@example.org', DEV_URL: 'https://github.com/example' })
    expect(c.developer).toEqual({ name: '하프트웨어', org: '', contact: 'team@example.org', url: 'https://github.com/example' })
    const bad = readConfig({ DEV_NAME: 'x', DEV_URL: 'javascript:alert(1)', DEV_CONTACT: 'not contact' })
    expect([bad.developer?.url, bad.developer?.contact, others(bad.warnings).length]).toEqual(['', '', 2])
  })

  it('개인정보 문의처는 이메일만', () => {
    expect(readConfig({ PRIVACY_CONTACT: 'privacy@example.kr' }).operator).toEqual({ name: '', contact: 'privacy@example.kr' })
    const bad = readConfig({ SERVICE_OPERATOR: '수련관', PRIVACY_CONTACT: '031-000-0000' })
    expect([bad.operator?.contact, others(bad.warnings).length]).toEqual(['', 1])
  })

  it('기본값', () => {
    const c = readConfig({})
    expect([c.port, c.secureCookie, c.admin, c.publicUrl]).toEqual([3000, true, null, null])
  })
})

describe('DB 이어 쓰기', () => {
  it('응원에 시각 칸이 없던 예전 DB도 지우지 않고 칸만 더한다', () => {
    const file = `${process.env.TMPDIR ?? '/tmp'}/grb-migrate-${Date.now()}.db`
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
    const old = new DatabaseSync(file)
    old.exec("CREATE TABLE cheers (post_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (post_id, user_id, kind)); INSERT INTO cheers VALUES ('p', 'u', '응원해요');")
    old.close()
    const db = openDb(file)
    const rows = db.prepare('SELECT * FROM cheers').all() as { created_at: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].created_at).toBe('')
    db.close()
  })
})

describe('0.17 모임 주제 · 오늘의 한 줄 · 신고 · 웹 복원', () => {
  const groupWithPost = async (tag: string) => {
    const owner = await signup(`${tag}장`, '20000101')
    const kid = await signup(`${tag}원`, '20100101')
    const { id, code } = (await owner('POST', '/groups', { name: `${tag} 모임` })).data
    await kid('POST', '/groups/join', { code })
    const g = { ...newGraph(), visibility: 'link' as const, title: `${tag}의 선` }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    const post = await kid('POST', `/groups/${id}/posts`, { graphId: g.id, options: { title: g.title, entryIds: [], descriptions: false, time: true } })
    return { owner, kid, id, postId: post.data.id as string }
  }

  it('함께 그릴 주제: 모임장만 정하고, 모임 사람은 목록과 모임 화면에서 본다', async () => {
    const { owner, kid, id } = await groupWithPost('주제')
    expect((await kid('PUT', `/groups/${id}/topic`, { topic: '나를 웃게 한 일' })).status).toBe(403)
    expect((await owner('PUT', `/groups/${id}/topic`, { topic: '  나를 웃게 한 일 ' })).data.topic).toBe('나를 웃게 한 일')
    expect((await kid('GET', '/groups')).data.find((g: { id: string }) => g.id === id).topic).toBe('나를 웃게 한 일')
    expect((await kid('GET', `/groups/${id}`)).data.topic).toBe('나를 웃게 한 일')
    await owner('PUT', `/groups/${id}/topic`, { topic: '' })
    expect((await kid('GET', `/groups/${id}`)).data.topicAt).toBe('')
  })

  it('오늘의 한 줄: 날마다 하나, 비우면 지우고, 이상한 날짜는 막는다', async () => {
    const u = await signup('한줄이', '20080808')
    expect((await u('PUT', '/me/answers/2026-11-03', { question: '오늘?', text: '좋았어' })).status).toBe(200)
    await u('PUT', '/me/answers/2026-11-03', { question: '오늘?', text: '아주 좋았어' })
    expect((await u('GET', '/me/answers')).data).toEqual([expect.objectContaining({ day: '2026-11-03', text: '아주 좋았어' })])
    expect((await u('PUT', '/me/answers/2999-01-01', { text: 'x' })).status).toBe(400)
    expect((await u('PUT', '/me/answers/nope', { text: 'x' })).status).toBe(400)
    await u('PUT', '/me/answers/2026-11-03', { text: '' })
    expect((await u('GET', '/me/answers')).data).toEqual([])
    expect((await client()('GET', '/me/answers')).status).toBe(401)
  })

  it('신고: 모임 사람만, 남의 글만, 한 번만 — 관리자가 보고 처리한다', async () => {
    const { owner, kid, postId } = await groupWithPost('신고')
    expect((await kid('POST', `/posts/${postId}/report`, { reason: 'hurt' })).status).toBe(400) // 내 글
    expect((await (await signup('밖사람', '19990101'))('POST', `/posts/${postId}/report`, { reason: 'hurt' })).status).toBe(404)
    expect((await owner('POST', `/posts/${postId}/report`, { reason: 'nope' })).status).toBe(400)
    expect((await owner('POST', `/posts/${postId}/report`, { reason: 'danger', detail: '걱정돼요' })).status).toBe(200)
    await owner('POST', `/posts/${postId}/report`, { reason: 'danger' }) // 두 번째는 무시
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const mine = (await adm('GET', '/admin/reports')).data.filter((r: { postId: string }) => r.postId === postId)
    expect(mine).toEqual([expect.objectContaining({ reason: 'danger', detail: '걱정돼요', postTitle: '신고의 선', postOwner: '신고원', groupName: '신고 모임', reporter: '신고장', resolvedAt: '' })])
    expect((await adm('GET', '/admin/overview')).data.stats.openReports).toBeGreaterThan(0)
    await adm('POST', `/admin/reports/${mine[0].id}/resolve`, {})
    expect((await adm('GET', '/admin/reports')).data.find((r: { id: string }) => r.id === mine[0].id).resolvedAt).not.toBe('')
    // 글을 내려도 신고 기록은 남는다
    await adm('DELETE', `/admin/posts/${postId}`)
    expect((await adm('GET', '/admin/reports')).data.find((r: { id: string }) => r.id === mine[0].id).postTitle).toBe('신고의 선')
  })

  it('웹 복원: 관리자 비밀번호를 다시 받고, 백업 때로 되돌린 뒤에도 로그인된다', async () => {
    const u = await signup('복원이', '20070707')
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const file = Buffer.from(await (await fetch(`${base}/admin/backup`, { headers: { Cookie: adm.cookie() } })).arrayBuffer())
    const g = newGraph()
    await u('PUT', `/graphs/${g.id}`, { graph: g }) // 백업 뒤에 생긴 것
    const restore = (body: Buffer, password: string, cookie = adm.cookie()) =>
      fetch(`${base}/admin/restore`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'geuryeobom', 'Content-Type': 'application/octet-stream', 'X-Admin-Password': encodeURIComponent(password), Cookie: cookie },
        body: new Uint8Array(body),
      })
    expect((await restore(file, 'admin-password-1234', u.cookie())).status).toBe(401) // 관리자 세션이 아니면
    expect((await restore(file, 'wrong-password')).status).toBe(401)
    expect((await restore(Buffer.from('not a db at all'), 'admin-password-1234')).status).toBe(400)
    const r = await restore(file, 'admin-password-1234')
    expect(r.status).toBe(200)
    expect((await r.json()).before).toMatch(/^before-restore-/)
    expect((await u('GET', '/graphs')).data).toEqual([]) // 백업 뒤의 그래프는 사라졌다
    expect((await client()('POST', '/auth/login', { name: '복원이', birth: '20070707' })).status).toBe(200)
    expect((await adm('GET', '/admin/overview')).status).toBe(200) // 관리자 세션은 그대로
  })
})

describe('0.18 모임 리포트', () => {
  it('모임장만, 누가 그렸는지 없이 — 나눈 사람이 3명이 안 되면 마음 분포는 숨긴다', async () => {
    const owner = await signup('리포트장', '19880101')
    const { id, code } = (await owner('POST', '/groups', { name: '리포트 모임' })).data
    const share = async (name: string, score: number) => {
      const k = await signup(name, '20100202')
      await k('POST', '/groups/join', { code })
      const g = { ...newGraph(), visibility: 'link' as const, title: `${name}의 선`, entries: [{ ...newEntry(5, score, '순간'), emotionLabel: '설렘', reflection: { feeling: '비밀 회고', why: '', now: '', toPast: '', fromPast: '' } }] }
      await k('PUT', `/graphs/${g.id}`, { graph: g })
      await k('POST', `/groups/${id}/posts`, { graphId: g.id, options: { title: g.title, entryIds: g.entries.map((e) => e.id), descriptions: false, time: true } })
      return k
    }
    const k1 = await share('리포트원1', 3)
    expect((await k1('GET', `/groups/${id}/report`)).status).toBe(403)
    const few = (await owner('GET', `/groups/${id}/report`)).data
    expect(few).toMatchObject({ members: 2, sharers: 1, enough: false, scores: null, labels: null })
    await share('리포트원2', -2)
    await share('리포트원3', 3)
    const r = await owner('GET', `/groups/${id}/report`)
    expect(r.data).toMatchObject({ members: 4, sharers: 3, posts: 3, moments: 3, enough: true, labels: [{ label: '설렘', n: 3 }] })
    expect(r.data.scores[8]).toBe(2) // +3 두 개
    expect(r.data.scores[3]).toBe(1) // -2 한 개
    expect(JSON.stringify(r.data)).not.toMatch(/리포트원|비밀 회고/)
  })
})

describe('0.18 오래 운영하기', () => {
  it('손질: 끝난 로그인을 지우고, 자동 백업은 한 시간에 하나 · 최근 keep 개만 (예전 하루 백업도 함께 센다)', async () => {
    const { maintain } = await import('./db.ts')
    const { mkdtempSync, readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'grb-maint-'))
    const db = openDb(':memory:')
    db.prepare("INSERT INTO users (id, login_key, nickname, created_at) VALUES ('u', 'k', 'n', '2026-01-01')").run()
    db.prepare("INSERT INTO sessions VALUES ('old', 'u', '2000-01-01T00:00:00.000Z')").run()
    db.prepare("INSERT INTO sessions VALUES ('new', 'u', '2999-01-01T00:00:00.000Z')").run()
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const folder = join(dir, 'backups')
    mkdirSync(folder)
    writeFileSync(join(folder, 'auto-2026-11-01.db'), '') // 1.0.x 의 하루 백업
    // 한국 시간 10 · 11 · 12시 (같은 시간에 두 번 돌아도 하나)
    for (const t of ['01:00', '02:00', '03:00', '03:30']) maintain(db, folder, 2, new Date(`2026-11-03T${t}:00Z`))
    expect((db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[]).map((r) => r.token_hash)).toEqual(['new'])
    expect(readdirSync(folder).sort()).toEqual(['auto-2026-11-03-11.db', 'auto-2026-11-03-12.db'])
    expect(maintain(db, dir, 0)).toBeNull() // 0 이면 끔
    db.close()
  })

  it('BACKUP_KEEP: 비우면 168 (7일), 0 이면 끔, 이상한 값은 0', () => {
    expect(readConfig({}).backupKeep).toBe(168)
    expect(readConfig({ BACKUP_KEEP: '0' }).backupKeep).toBe(0)
    expect(readConfig({ BACKUP_KEEP: '30' }).backupKeep).toBe(30)
    expect(readConfig({ BACKUP_KEEP: 'abc' }).backupKeep).toBe(0)
  })

  it('순간 100개에 회고를 가득 적은 큰 그래프도 저장된다', async () => {
    const u = await signup('긴회고', '20050505')
    const full = '가'.repeat(1000)
    const g = { ...newGraph(), entries: Array.from({ length: 100 }, (_, i) => ({ ...newEntry(i % 17, 0, '순간'), description: '나'.repeat(300), reflection: { feeling: full, why: full, now: full, toPast: full, fromPast: full } })) }
    const r = await u('PUT', `/graphs/${g.id}`, { graph: g })
    expect(r.status).toBe(200)
    expect(r.data.entries).toHaveLength(100)
  })
})

describe('0.19 마음 색', () => {
  it('정해진 색만 남기고, 다른 값은 비운다', async () => {
    const u = await signup('색일기', '20090303')
    expect((await u('PUT', '/me/answers/2026-11-01', { question: 'q', text: '맑았다', color: 'sky' })).data.color).toBe('sky')
    expect((await u('PUT', '/me/answers/2026-11-02', { question: 'q', text: '흐렸다', color: '<script>' })).data.color).toBe('')
    expect((await u('GET', '/me/answers')).data.map((a: { day: string; color: string }) => [a.day, a.color])).toEqual([['2026-11-02', ''], ['2026-11-01', 'sky']])
  })
})

describe('1.0 신고 기록 지우기 · 내린 글 다시 나누기', () => {
  it('직접 나눈 글도 운영자가 내리면, 고칠 때 고른 내용 그대로 다시 나눠진다 — 내가 내린 글은 그대로', async () => {
    const owner = await signup('내림장', '19870101')
    const kid = await signup('내림원', '20100303')
    const { id, code } = (await owner('POST', '/groups', { name: '내림 모임' })).data
    await kid('POST', '/groups/join', { code })
    const e = { ...newEntry(5, 1, '고른 순간'), description: '설명' }
    const g = { ...newGraph(), visibility: 'link' as const, title: '나눈 선', entries: [e, newEntry(7, 0, '안 고른 순간')] }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    const post = await kid('POST', `/groups/${id}/posts`, { graphId: g.id, options: { title: '나눈 선', entryIds: [e.id], descriptions: true, time: true } })
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    await adm('DELETE', `/admin/posts/${post.data.id}`)
    expect((await owner('GET', `/groups/${id}`)).data.posts).toHaveLength(0)
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, title: '고친 선' } })
    const back = (await owner('GET', `/groups/${id}`)).data.posts
    expect(back).toHaveLength(1)
    expect(back[0].graph.entries.map((x: { title: string }) => x.title)).toEqual(['고른 순간']) // 고른 것만 그대로
    // 내가 직접 내린 글은 고쳐도 다시 올라가지 않는다
    await kid('DELETE', `/posts/${back[0].id}`)
    await kid('PUT', `/graphs/${g.id}`, { graph: { ...g, title: '또 고친 선' } })
    expect((await owner('GET', `/groups/${id}`)).data.posts).toHaveLength(0)
  })

  it('신고 기록은 사유를 남겨야 지워지고, 지운 신고에서 볼 수 있다', async () => {
    const owner = await signup('지움장', '19860101')
    const kid = await signup('지움원', '20100404')
    const { id, code } = (await owner('POST', '/groups', { name: '지움 모임' })).data
    await kid('POST', '/groups/join', { code })
    const g = { ...newGraph(), visibility: 'link' as const, title: '신고될 선' }
    await kid('PUT', `/graphs/${g.id}`, { graph: g })
    const post = await kid('POST', `/groups/${id}/posts`, { graphId: g.id, options: { title: g.title, entryIds: [], descriptions: false, time: true } })
    await owner('POST', `/posts/${post.data.id}/report`, { reason: 'other', detail: 'x'.repeat(300) })
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const r = (await adm('GET', '/admin/reports')).data.find((x: { postId: string }) => x.postId === post.data.id)
    expect((await adm('DELETE', `/admin/reports/${r.id}`, { reason: '' })).status).toBe(400)
    expect((await adm('DELETE', `/admin/reports/${r.id}`, { reason: '시험 신고' })).status).toBe(200)
    expect((await adm('GET', '/admin/reports')).data.some((x: { id: string }) => x.id === r.id)).toBe(false)
    expect((await adm('GET', '/admin/reports?deleted=1')).data.find((x: { id: string }) => x.id === r.id)).toMatchObject({ deleteReason: '시험 신고' })
    expect((await kid('DELETE', `/admin/reports/${r.id}`, { reason: '시험' })).status).toBe(401)
  })

  it('실험: 만 14세 미만은 보호자 동의가 있어야 가입되고, 관리자에게 보인다', async () => {
    const kid = client()
    const base = { name: '어린이', birth: '20150101', nickname: '어린이', agree: true }
    expect((await kid('POST', '/auth/signup', base)).status).toBe(400)
    expect((await kid('POST', '/auth/signup', { ...base, guardian: { relation: '부모님', contact: '1234', agreed: true } })).status).toBe(400)
    const ok = await kid('POST', '/auth/signup', { ...base, guardian: { relation: '부모님', contact: '010-1234-5678', agreed: true } })
    expect(ok.status).toBe(200)
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const detail = (await adm('GET', `/admin/users/${ok.data.user.id}`)).data
    expect(detail.guardian).toMatchObject({ relation: '부모님', contact: '01012345678' })
    // 14세 이상은 그대로
    expect((await client()('POST', '/auth/signup', { name: '청소년', birth: '20100101', nickname: '청소년', agree: true })).status).toBe(200)
  })

  it('실험: 내 기록 내려받기 · 모임 여러 개 만들기 · 질문 묶음 · 기간 통계', async () => {
    const t = await signup('담당선생님')
    const g = { ...newGraph(), id: 'labs-g1', title: '진로 그래프', questionSet: 'career' }
    expect((await t('PUT', '/graphs/labs-g1', { graph: g })).status).toBe(200)
    expect((await t('GET', '/graphs/labs-g1')).data.questionSet).toBe('career')
    await t('PUT', '/graphs/labs-g1', { graph: { ...g, questionSet: 'nope' } })
    expect((await t('GET', '/graphs/labs-g1')).data.questionSet).toBeUndefined()

    const bulk = await t('POST', '/groups/bulk', { names: ['1반', ' 2반 ', '', '3반'], intro: '수요일 프로그램' })
    expect(bulk.data.groups.map((x: { name: string }) => x.name)).toEqual(['1반', '2반', '3반'])
    expect((await t('POST', '/groups/bulk', { names: Array.from({ length: 31 }, (_, i) => `${i}반`) })).status).toBe(400)
    expect((await client()('POST', '/groups/bulk', { names: ['x'] })).status).toBe(401)

    const ex = (await t('GET', '/me/export')).data
    expect(ex.profile.nickname).toBe('담당선생님')
    expect(ex.graphs.map((x: { id: string }) => x.id)).toContain('labs-g1')
    expect(ex.groups).toHaveLength(3)
    expect((await client()('GET', '/me/export')).status).toBe(401)

    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const st = (await adm('GET', `/admin/stats?from=${today}&to=${today}`)).data
    expect(st.rows).toHaveLength(1)
    expect(st.total.groups).toBeGreaterThanOrEqual(3)
    expect((await adm('GET', '/admin/stats?from=2020-01-01&to=2026-01-01')).status).toBe(400)
    expect((await t('GET', '/admin/stats')).status).toBe(401)
  })

  it('실험: 모임 소식은 모임장만 올리고 모임 사람에게 보이며, 관리자 활동은 기록된다', async () => {
    const lead = await signup('소식모임장')
    const kid = await signup('소식아이')
    const { id, code } = (await lead('POST', '/groups', { name: '소식 모임' })).data
    await kid('POST', '/groups/join', { code })
    expect((await kid('PUT', `/groups/${id}/news`, { news: '몰래' })).status).toBe(403)
    expect((await lead('PUT', `/groups/${id}/news`, { news: '이번 주는 쉬어요\n다음 주에 만나요' })).status).toBe(200)
    const g = (await kid('GET', `/groups/${id}`)).data
    expect(g.news).toBe('이번 주는 쉬어요\n다음 주에 만나요')
    expect((await kid('GET', '/groups')).data.find((x: { id: string }) => x.id === id).newsAt).toBeTruthy()
    await lead('PUT', `/groups/${id}/news`, { news: '' })
    expect((await kid('GET', `/groups/${id}`)).data.news).toBe('')

  })

  it('실험: 보호자는 링크로 동의를 확인하고, 아이 화면은 확인됐는지 안다', async () => {
    const kid = client()
    const r = await kid('POST', '/auth/signup', { name: '링크아이', birth: '20160101', nickname: '링크아이', agree: true, guardian: { relation: '보호자', contact: 'mom@example.kr', agreed: true } })
    expect(r.status).toBe(200)
    const st = (await kid('GET', '/me/guardian')).data
    expect(st).toMatchObject({ needed: true, confirmed: false })
    expect(st.token.length).toBeGreaterThan(16)
    const guardian = client()
    expect((await guardian('GET', '/guardian/not-a-real-token-123')).status).toBe(404)
    expect((await guardian('GET', `/guardian/${st.token}`)).data).toMatchObject({ nickname: '링크아이', confirmed: false })
    expect((await guardian('POST', `/guardian/${st.token}`, {})).status).toBe(400)
    expect((await guardian('POST', `/guardian/${st.token}`, { agree: true })).status).toBe(200)
    expect((await kid('GET', '/me/guardian')).data).toMatchObject({ confirmed: true, token: null })
    expect((await (await signup('어른계정'))('GET', '/me/guardian')).data.needed).toBe(false)
  })

  it('실험: 모임 일정 · 기관 담당자 리포트 · 올해 받은 응원', async () => {
    const lead = await signup('일정모임장')
    const kid = await signup('일정아이')
    const { id, code } = (await lead('POST', '/groups', { name: '일정 모임' })).data
    await kid('POST', '/groups/join', { code })
    const soon = new Date(Date.now() + 9 * 3600_000 + 3 * 864e5).toISOString().slice(0, 10)
    expect((await kid('POST', `/groups/${id}/events`, { day: soon, title: '몰래' })).status).toBe(403)
    expect((await lead('POST', `/groups/${id}/events`, { day: '2020-01-01', title: '지난 일' })).status).toBe(400)
    const ev = (await lead('POST', `/groups/${id}/events`, { day: soon, title: '처음 해낸 일 그리기' })).data
    expect((await kid('GET', `/groups/${id}`)).data.events).toEqual([{ id: ev.id, day: soon, title: '처음 해낸 일 그리기', count: 0, mine: false }])
    expect((await kid('GET', '/groups')).data.find((g: { id: string }) => g.id === id).nextEvent.title).toBe('처음 해낸 일 그리기')
    await lead('DELETE', `/groups/${id}/events/${ev.id}`)
    expect((await kid('GET', `/groups/${id}`)).data.events).toEqual([])

    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const staffId = (await kid('GET', '/me')).data.user.id
    expect((await adm('PUT', '/admin/orgs/new', { name: '○○수련관', codes: ['ZZZZZZ'], managerIds: [] })).status).toBe(400)
    const org = (await adm('PUT', '/admin/orgs/new', { name: '○○수련관', codes: [code.toLowerCase()], managerIds: [staffId] })).data
    expect(org.groups.map((g: { name: string }) => g.name)).toEqual(['일정 모임'])
    const mine = (await kid('GET', '/orgs')).data
    expect(mine[0]).toMatchObject({ name: '○○수련관', total: { groups: 1, members: 2 } })
    expect(mine[0].groups[0].report.members).toBe(2)
    expect((await lead('GET', '/orgs')).data).toEqual([]) // 담당자가 아니면 없다
    expect((await kid('PUT', `/admin/orgs/${org.id}`, { name: 'x' })).status).toBe(401)
    await adm('DELETE', `/admin/orgs/${org.id}`)
    expect((await kid('GET', '/orgs')).data).toEqual([])

    const y = new Date(Date.now() + 9 * 3600_000).getUTCFullYear()
    expect((await kid('GET', `/me/cheers/${y}`)).data).toMatchObject({ year: y, received: 0 })
  })

  it('실험: 출석 · 모임 복제 · 기관 기간 리포트 · 휴면 계정', async () => {
    const lead = await signup('출석모임장')
    const kid = await signup('출석아이')
    const { id, code } = (await lead('POST', '/groups', { name: '출석 모임', intro: '소개글' })).data
    await lead('PUT', `/groups/${id}/topic`, { topic: '처음 해낸 일' })
    await kid('POST', '/groups/join', { code })
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const later = new Date(Date.now() + 9 * 3600_000 + 2 * 864e5).toISOString().slice(0, 10)
    const ev = (await lead('POST', `/groups/${id}/events`, { day: today, title: '오늘 활동' })).data
    const ev2 = (await lead('POST', `/groups/${id}/events`, { day: later, title: '다음 활동' })).data
    expect((await kid('POST', `/groups/${id}/events/${ev2.id}/attend`)).status).toBe(400) // 아직 안 온 날
    expect((await kid('POST', `/groups/${id}/events/${ev.id}/attend`)).data).toEqual({ mine: true, count: 1 })
    expect((await lead('GET', `/groups/${id}`)).data.events[0]).toMatchObject({ count: 1, mine: false })
    expect((await kid('POST', `/groups/${id}/events/${ev.id}/attend`)).data).toEqual({ mine: false, count: 0 })
    await kid('POST', `/groups/${id}/events/${ev.id}/attend`)
    expect((await client()('POST', `/groups/${id}/events/${ev.id}/attend`)).status).toBe(401)

    expect((await kid('POST', `/groups/${id}/copy`, { name: '복제' })).status).toBe(403)
    const copy = (await lead('POST', `/groups/${id}/copy`, { name: '출석 모임 2학기' })).data
    const cg = (await lead('GET', `/groups/${copy.id}`)).data
    expect(cg).toMatchObject({ name: '출석 모임 2학기', intro: '소개글', topic: '처음 해낸 일', events: [] })
    expect(cg.members).toHaveLength(1)

    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const leadId = (await lead('GET', '/me')).data.user.id
    await adm('PUT', '/admin/orgs/new', { name: '기간기관', codes: [code], managerIds: [leadId] })
    const o = (await lead('GET', `/orgs?from=${today}&to=${today}`)).data.find((x: { name: string }) => x.name === '기간기관')
    expect(o.groups[0].period).toMatchObject({ joined: 2, events: 1, attended: 1 })
    expect((await lead('GET', '/orgs')).data[0].groups[0].period).toBeNull()
    expect((await lead('GET', `/orgs?from=${today}&to=2020-01-01`)).status).toBe(400)

    // 휴면: 갓 가입한 사람은 휴면이 아니다
    const d = (await adm('GET', '/admin/dormant?months=12')).data
    expect(d.months).toBe(12)
    expect(d.users.some((u: { id: string }) => u.id === leadId)).toBe(false)
    expect((await adm('POST', '/admin/dormant/purge', { months: 12, ids: [leadId] })).data.deleted).toBe(0) // 지울 때도 다시 확인
    expect((await lead('GET', '/me')).data.user.id).toBe(leadId)
    expect((await kid('GET', '/admin/dormant')).status).toBe(401)
    expect((await adm('GET', '/admin/errors')).status).toBe(200)
  })

  it('실험 5: 구간 띠 · 나만의 질문 · 전환점 · 모임 끝내기 · 기관 소식 · 담당자 초대 · 약관 재동의', async () => {
    const t = await signup('구간띠')
    const e = { ...newEntry(5, 3, '첫 무대'), turningPoint: true, reflection: { feeling: '', why: '', now: '', toPast: '', fromPast: '', extra: ['곁에 엄마'] } }
    const g = { ...newGraph(), id: 'labs5-g1', entries: [e], stages: [{ label: '초등학교', from: 7, to: 13 }, { label: '', from: 1, to: 2 }, { label: '거꾸로', from: 9, to: 3 }], myQuestions: ['그때 곁에 누가 있었나요?', ' '] }
    await t('PUT', '/graphs/labs5-g1', { graph: g })
    const saved = (await t('GET', '/graphs/labs5-g1')).data
    expect(saved.stages).toEqual([{ label: '초등학교', from: 7, to: 13 }]) // 이름 없는 것 · 거꾸로 된 것은 빠진다
    expect(saved.myQuestions).toEqual(['그때 곁에 누가 있었나요?'])
    expect(saved.entries[0]).toMatchObject({ turningPoint: true, reflection: { extra: ['곁에 엄마'] } })

    // 모임 끝내기: 새로 들어오기 · 나누기 · 일정은 멈추고, 이미 있던 사람은 그대로 본다
    const lead = await signup('끝모임장')
    const kid = await signup('끝아이')
    const late = await signup('늦은아이')
    const { id, code } = (await lead('POST', '/groups', { name: '끝날 모임' })).data
    await kid('POST', '/groups/join', { code })
    expect((await kid('PUT', `/groups/${id}/closed`, { closed: true })).status).toBe(403)
    expect((await lead('PUT', `/groups/${id}/closed`, { closed: true })).data.closedAt).toBeTruthy()
    expect((await late('POST', '/groups/join', { code })).status).toBe(400)
    expect((await late('POST', `/invite/${code}`, {})).status).toBe(400)
    expect((await client()('GET', `/invite/${code}`)).data.closed).toBe(true)
    expect((await kid('POST', '/groups/join', { code })).status).toBe(200) // 이미 있던 사람은 괜찮다
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    expect((await lead('POST', `/groups/${id}/events`, { day, title: '못 더함' })).status).toBe(400)
    expect((await kid('GET', '/groups')).data.find((x: { id: string }) => x.id === id).closedAt).toBeTruthy()
    await lead('PUT', `/groups/${id}/closed`, { closed: false })
    expect((await late('POST', '/groups/join', { code })).status).toBe(200)

    // 기관: 담당자 초대 링크 (한 번 쓰면 꺼짐) · 모든 모임에 소식
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const org = (await adm('PUT', '/admin/orgs/new', { name: '초대기관', codes: [code], managerIds: [] })).data
    const { invite } = (await adm('POST', `/admin/orgs/${org.id}/invite`)).data
    expect(invite.length).toBeGreaterThan(16)
    expect((await client()('GET', `/org-invite/${invite}`)).data).toMatchObject({ name: '초대기관', groups: 1, already: false })
    expect((await client()('POST', `/org-invite/${invite}`)).status).toBe(401)
    expect((await kid('POST', `/org-invite/${invite}`)).data.name).toBe('초대기관')
    expect((await late('POST', `/org-invite/${invite}`)).status).toBe(404) // 한 번 쓰면 꺼진다
    expect((await late('PUT', `/orgs/${org.id}/news`, { news: '휴관' })).status).toBe(404)
    expect((await kid('PUT', `/orgs/${org.id}/news`, { news: '다음 주 휴관이에요' })).data.groups).toBe(1)
    expect((await lead('GET', `/groups/${id}`)).data.news).toBe('다음 주 휴관이에요')

    // 약관 재동의: 올리기 전 동의한 사람은 다시, 동의하면 끝
    expect((await kid('GET', '/me/terms')).data.need).toBe(false)
    expect((await kid('PUT', '/admin/terms', { summary: '출석 기록을 남겨요' })).status).toBe(401)
    await adm('PUT', '/admin/terms', { summary: '출석 기록을 남겨요' })
    expect((await kid('GET', '/me/terms')).data).toMatchObject({ need: true, summary: '출석 기록을 남겨요' })
    await kid('POST', '/me/agree', { agree: true })
    expect((await kid('GET', '/me/terms')).data.need).toBe(false)
    expect((await adm('GET', '/admin/terms')).data.agreed).toBe(1)
  })

  it('실험 5: 공지 예약 · 서버 상태 · 자동 백업 · 차단 현황 · 개인정보 요청 대장', async () => {
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const future = new Date(Date.now() + 3600_000).toISOString()
    await adm('PUT', '/admin/notice', { on: true, title: '예약 공지', body: '', from: future })
    expect((await client()('GET', '/notice')).data.notice).toBeNull() // 아직
    await adm('PUT', '/admin/notice', { on: true, title: '예약 공지', body: '', from: '', to: future })
    expect((await client()('GET', '/notice')).data.notice.title).toBe('예약 공지')
    expect((await adm('PUT', '/admin/notice', { on: true, title: 'x', body: '', from: future, to: future })).status).toBe(400)
    await adm('PUT', '/admin/notice', { on: false, title: '예약 공지', body: '' })

    const h = (await adm('GET', '/admin/health')).data
    expect(h.requests.served).toBeGreaterThan(0)
    expect(h.storage.db).toBeGreaterThan(0)
    expect((await client()('GET', '/admin/health')).status).toBe(401)
    expect((await adm('GET', '/admin/backups')).data).toMatchObject({ keep: 168, dir: false, files: [] })
    expect((await adm('PUT', '/admin/backups', { keep: 3 })).data.keep).toBe(3)
    expect((await adm('GET', '/admin/backups')).data.keep).toBe(3)
    expect((await adm('GET', '/admin/backups/..%2Fx')).status).toBe(404)

    // 같은 IP 로 없는 링크를 계속 맞혀 보면 막히고, 관리자가 풀 수 있다
    const bad = client()
    for (let i = 0; i < 61; i++) await bad('GET', '/links/zzzzzzzz')
    const blocks = (await adm('GET', '/admin/blocks')).data as { limit: string; key: string }[]
    const b = blocks.find((x) => x.limit === '없는 링크 · 확인 링크 맞히기')!
    expect(b).toBeTruthy()
    expect((await bad('GET', '/links/zzzzzzzz')).status).toBe(429)
    await adm('POST', '/admin/blocks/release', { limit: b.limit, key: b.key })
    expect((await bad('GET', '/links/zzzzzzzz')).status).toBe(404)

    const r = (await adm('PUT', '/admin/privacy/new', { kind: '열람', who: '바다 · 메일', detail: '내 기록 파일', receivedAt: '2026-11-01', status: '받음', note: '' })).data
    expect((await adm('PUT', '/admin/privacy/new', { kind: '없음' })).status).toBe(400)
    await adm('PUT', `/admin/privacy/${r.id}`, { kind: '열람', who: '바다 · 메일', detail: '내 기록 파일', receivedAt: '2026-11-01', status: '완료', note: '메일로 보냄' })
    const list = (await adm('GET', '/admin/privacy')).data
    expect(list[0]).toMatchObject({ status: '완료', note: '메일로 보냄' })
    expect(list[0].doneAt).toBeTruthy()
    await adm('DELETE', `/admin/privacy/${r.id}`)
    expect((await adm('GET', '/admin/privacy')).data).toEqual([])
  })

  it('실험 6: 지난 모습 · 모임 질문 묶음 · 헬스체크 · 점검 모드 · 가입 흐름 · CSP 보고', async () => {
    const t = await signup('지난모습')
    const g = { ...newGraph(), id: 'labs6-g1', title: '처음 제목' }
    await t('PUT', '/graphs/labs6-g1', { graph: g })
    expect((await t('GET', '/graphs/labs6-g1/versions')).data).toEqual([]) // 처음 저장은 남길 지난 모습이 없다
    await t('PUT', '/graphs/labs6-g1', { graph: { ...g, title: '두 번째' } })
    await t('PUT', '/graphs/labs6-g1', { graph: { ...g, title: '세 번째' } }) // 10분 안이라 하나만
    let vs = (await t('GET', '/graphs/labs6-g1/versions')).data
    expect(vs).toHaveLength(1)
    expect(vs[0].title).toBe('처음 제목')
    await t('PUT', '/graphs/labs6-g1', { graph: { ...g, title: '처음 제목' }, snapshot: true }) // 되돌리기는 꼭 남긴다
    vs = (await t('GET', '/graphs/labs6-g1/versions')).data
    expect(vs[0].title).toBe('세 번째')
    expect((await t('GET', `/graphs/labs6-g1/versions/${vs[1].id}`)).data.graph.title).toBe('처음 제목')
    const other = await signup('남의모습')
    expect((await other('GET', '/graphs/labs6-g1/versions')).status).toBe(404)

    // 모임 질문 묶음
    const lead = await signup('질문모임장')
    const { id } = (await lead('POST', '/groups', { name: '진로 모임' })).data
    await lead('PUT', `/groups/${id}/question-set`, { set: 'career' })
    expect((await lead('GET', `/groups/${id}`)).data.questionSet).toBe('career')
    await lead('PUT', `/groups/${id}/question-set`, { set: 'nope' })
    expect((await lead('GET', `/groups/${id}`)).data.questionSet).toBe('')

    // 헬스체크
    expect((await client()('GET', '/health')).data.ok).toBe(true)

    // 점검 모드: 관리자 말고는 저장이 멈춘다
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    await adm('PUT', '/admin/maintenance', { on: true, message: '서버를 옮겨요' })
    expect((await client()('GET', '/config')).data.maintenance.message).toBe('서버를 옮겨요')
    const r = await t('PUT', '/graphs/labs6-g1', { graph: g })
    expect(r.status).toBe(503)
    expect(r.data.error).toContain('서버를 옮겨요')
    expect((await t('GET', '/graphs/labs6-g1')).status).toBe(200) // 보기는 된다
    expect((await adm('PUT', '/admin/notice', { on: false, title: '', body: '' })).status).toBe(200) // 관리자는 된다
    await adm('PUT', '/admin/maintenance', { on: false, message: '' })
    expect((await t('PUT', '/graphs/labs6-g1', { graph: g })).status).toBe(200)
    expect((await client()('GET', '/config')).data.maintenance).toBeUndefined()

    // 가입 흐름
    const f = (await adm('GET', '/admin/funnel')).data
    expect(f.signup).toBeGreaterThan(0)
    expect(f.started).toBeGreaterThan(0)
    expect(f.signup).toBeGreaterThanOrEqual(f.started)

    // CSP 보고: 이 앱의 헤더 없이 와도 받고, 주소 속 코드는 가린다
    const csp = (body: unknown, type = 'application/csp-report') => fetch(`${base}/csp-report`, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) })
    expect((await csp({ 'csp-report': { 'document-uri': 'https://geuryeobom.example/join/ABC123', 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js' } })).status).toBe(200)
    await csp({ 'csp-report': { 'document-uri': 'https://geuryeobom.example/join/ZZZ999', 'violated-directive': 'script-src', 'blocked-uri': 'https://evil.example/x.js' } })
    await csp([{ type: 'csp-violation', body: { documentURL: 'https://geuryeobom.example/', effectiveDirective: 'font-src', blockedURL: 'https://fonts.example/a.woff2' } }], 'application/reports+json')
    const rows = (await adm('GET', '/admin/csp')).data
    expect(rows.find((x: { directive: string }) => x.directive === 'script-src')).toMatchObject({ page: '/join/…', blocked: 'https://evil.example/x.js', count: 2 })
    expect(rows.some((x: { directive: string }) => x.directive === 'font-src')).toBe(true)
    expect((await fetch(`${base}/csp-report`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status).toBe(403)
    await adm('DELETE', '/admin/csp')
    expect((await adm('GET', '/admin/csp')).data).toEqual([])
  })

  it('실험 6: 관리자 계정 여러 개 — 보기만 · 바꾸기까지 · 처음 관리자만 계정 관리', async () => {
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    expect((await adm('GET', '/admin/me')).data).toMatchObject({ admin: true, who: 'admin', role: 'owner' })
    expect((await adm('PUT', '/admin/accounts/viewer1', { role: 'viewer', password: 'short' })).status).toBe(400)
    expect((await adm('PUT', '/admin/accounts/admin', { role: 'full', password: 'long-enough-password' })).status).toBe(400)
    await adm('PUT', '/admin/accounts/viewer1', { role: 'viewer', password: 'viewer-password-123' })
    await adm('PUT', '/admin/accounts/full1', { role: 'full', password: 'full-password-1234' })

    const v = client()
    expect((await v('POST', '/admin/login', { id: 'viewer1', password: 'wrong-password-000' })).status).toBe(401)
    expect((await v('POST', '/admin/login', { id: 'viewer1', password: 'viewer-password-123' })).status).toBe(200)
    expect((await v('GET', '/admin/me')).data).toMatchObject({ who: 'viewer1', role: 'viewer' })
    expect((await v('GET', '/admin/overview')).status).toBe(200) // 보기는 된다
    expect((await v('PUT', '/admin/notice', { on: false, title: '', body: '' })).status).toBe(403)
    expect((await v('GET', '/admin/backup')).status).toBe(403)
    expect((await v('GET', '/admin/accounts')).status).toBe(403)

    const fu = client()
    await fu('POST', '/admin/login', { id: 'full1', password: 'full-password-1234' })
    expect((await fu('PUT', '/admin/notice', { on: false, title: '', body: '' })).status).toBe(200)
    expect((await fu('PUT', '/admin/accounts/x-new', { role: 'full', password: 'x-new-password-12' })).status).toBe(403)

    // 권한을 바꾸거나 지우면 그 계정의 로그인은 끊긴다
    await adm('PUT', '/admin/accounts/viewer1', { role: 'full' })
    expect((await v('GET', '/admin/overview')).status).toBe(401)
    await adm('DELETE', '/admin/accounts/full1')
    expect((await fu('GET', '/admin/overview')).status).toBe(401)
    expect((await adm('GET', '/admin/accounts')).data.map((a: { id: string }) => a.id)).toEqual(['viewer1'])
  })

  it('실험 7: 도우미 · 문의함 → 요청 대장 · 설정 진단 · DB 점검 · 접속 표 · 파기 기록', async () => {
    const lead = await signup('도우미모임장')
    const help = await signup('도우미')
    const { id, code } = (await lead('POST', '/groups', { name: '도우미 모임' })).data
    await help('POST', '/groups/join', { code })
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    expect((await help('POST', `/groups/${id}/events`, { day, title: '못 함' })).status).toBe(403)
    const hid = (await lead('GET', `/groups/${id}`)).data.members.find((m: { nickname: string }) => m.nickname === '도우미').id
    expect((await lead('PUT', `/groups/${id}/members/${hid}`, { role: 'helper' })).data.role).toBe('helper')
    const g = (await help('GET', `/groups/${id}`)).data
    expect(g).toMatchObject({ isHelper: true, isManager: false })
    expect(g.code).toBeUndefined() // 참여 코드 · 사람 관리는 여전히 못 한다
    expect((await help('POST', `/groups/${id}/events`, { day, title: '도우미가 더함' })).status).toBe(200)
    expect((await help('PUT', `/groups/${id}/news`, { news: '도우미 소식' })).status).toBe(200)
    expect((await help('PUT', `/groups/${id}/topic`, { topic: 'x' })).status).toBe(403)
    expect((await help('GET', `/groups/${id}/report`)).status).toBe(403)
    expect((await lead('GET', `/groups/${id}`)).data.members.find((m: { nickname: string }) => m.nickname === '도우미').role).toBe('helper')

    // 문의함
    const anon = await signup('문의하는사람')
    expect((await anon('POST', '/contact', { kind: '궁금해요', message: '짧' })).status).toBe(400)
    expect((await anon('POST', '/contact', { kind: '개인정보', message: '제 기록을 모두 지워 주세요' })).status).toBe(200)
    expect((await help('POST', '/contact', { kind: '궁금해요', message: '모임 코드는 어디서 보나요?' })).status).toBe(200)
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const inq = (await adm('GET', '/admin/inquiries')).data
    const priv = inq.find((q: { kind: string }) => q.kind === '개인정보')
    expect(priv).toMatchObject({ member: true, nickname: '문의하는사람', status: '새 문의' })
    expect(inq.find((q: { kind: string }) => q.kind === '궁금해요')).toMatchObject({ member: true, nickname: '도우미' })
    const moved = (await adm('POST', `/admin/inquiries/${priv.id}/to-privacy`, { kind: '삭제' })).data
    expect((await adm('GET', '/admin/privacy')).data.find((r: { id: string }) => r.id === moved.id)).toMatchObject({ kind: '삭제', who: '문의하는사람', status: '받음' })
    const q2 = inq.find((q: { kind: string }) => q.kind === '궁금해요')
    await adm('PUT', `/admin/inquiries/${q2.id}`, { status: '답함', note: '메일로 답함' })
    const after = (await adm('GET', '/admin/inquiries')).data.find((q: { id: string }) => q.id === q2.id)
    expect(after.status).toBe('답함')
    expect(after.doneAt).toBeTruthy()

    // 진단 · DB 점검 · 손질
    const d = (await adm('GET', '/admin/diagnose')).data as { name: string; ok: boolean }[]
    expect(d.find((x) => x.name.startsWith('로그인 비밀값'))!.ok).toBe(false) // 테스트 서버는 AUTH_SECRET 이 없다
    expect(d.find((x) => x.name.startsWith('쿠키 보안'))!.ok).toBe(false)
    const chk = (await adm('GET', '/admin/db-check')).data
    expect(chk.integrity).toBe('ok')
    expect(chk.tables.some((t: { name: string }) => t.name === 'users')).toBe(true)
    expect((await adm('POST', '/admin/db-tidy')).status).toBe(200)

    // 접속 표 (가입 때 한 번 세짐)
    expect((await adm('GET', '/admin/hours')).data.reduce((n: number, r: { n: number }) => n + r.n, 0)).toBeGreaterThan(0)

    // 파기 기록: 탈퇴 · 관리자 지움 — 건수만
    const bye = await signup('떠나는사람')
    await bye('POST', '/me/delete', { name: '떠나는사람', birth: '20120315' })
    const byeId = (await (await signup('지워질사람'))('GET', '/me')).data.user.id
    await adm('DELETE', `/admin/users/${byeId}`)
    const purges = (await adm('GET', '/admin/purges')).data
    expect(purges.slice(0, 2).map((r: { kind: string }) => r.kind)).toEqual(['관리자가 지움', '탈퇴'])
    expect(JSON.stringify(purges)).not.toContain('떠나는사람')

  })

  it('실험 기능 스위치: 정식 서버는 정식 묶음만 늘 켜져 있고, 보호자 동의는 관리자가 켜야 열린다', async () => {
    const prod = createServer(createApp(openDb(':memory:'), { secureCookie: false, admin: { id: 'admin', password: 'admin-password-1234' }, devServer: false }))
    await new Promise<void>((ok) => prod.listen(0, ok))
    const pbase = `http://127.0.0.1:${(prod.address() as AddressInfo).port}/api`
    let cookie = ''
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(pbase + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'geuryeobom', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      return { status: r.status, data: await r.json() }
    }
    try {
      const official = ['graph', 'group', 'org', 'me', 'ops']
      expect((await call('GET', '/config')).data).toMatchObject({ dev: false, flags: official })
      expect((await call('POST', '/contact', { kind: '궁금해요', message: '정식에서도 되나요' })).status).toBe(401) // 열려 있고, 로그인이 필요
      expect((await call('GET', '/guardian/abcdefghijklmnopqrstu')).status).toBe(404) // 보호자 동의는 꺼짐
      await call('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
      expect((await call('GET', '/admin/hours')).status).toBe(200)
      await call('PUT', '/admin/flags', { flags: { guardian: true, nope: true } })
      expect((await call('GET', '/config')).data.flags).toEqual(['graph', 'group', 'org', 'guardian', 'me', 'ops'])
      await call('PUT', '/admin/flags', { flags: { ops: false } }) // 정식 묶음은 꺼도 그대로
      expect((await call('GET', '/admin/hours')).status).toBe(200)
      expect((await call('GET', '/config')).data.flags).toEqual(official)
      expect((await call('POST', '/admin/reset', { password: 'admin-password-1234', confirm: '모두 지우기' })).status).toBe(404) // 초기화는 스위치와 상관없이 개발 서버만
    } finally {
      prod.close()
    }
  })

  it('손질 8: 기관 직접 등록 · 연결 코드로 모임 잇기 · 담당자만 · 문의 답', async () => {
    const boss = await signup('기관등록자')
    const lead = await signup('잇는모임장')
    const kid = await signup('기관모르는아이')
    expect((await boss('POST', '/orgs', { name: '바다수련관' })).status).toBe(400) // 안내 동의 없이는 안 됨
    const org = (await boss('POST', '/orgs', { name: '바다수련관', agree: true })).data
    expect(org.code).toMatch(/^[A-Z0-9]{6}$/)
    // 만 14세 미만(보호자 기록이 있는 계정)은 기관을 등록하지 못한다
    const young = client()
    await young('POST', '/auth/signup', { name: '기관아이', birth: '20160101', nickname: '기관아이', agree: true, guardian: { relation: '보호자', contact: 'mom@example.kr', agreed: true } })
    expect((await young('POST', '/orgs', { name: '장난기관', agree: true })).status).toBe(403)
    const { id: gid, code } = (await lead('POST', '/groups', { name: '이을 모임' })).data
    await kid('POST', '/groups/join', { code })
    expect((await kid('POST', `/groups/${gid}/org`, { code: org.code })).status).toBe(403) // 회원은 못 잇는다
    expect((await lead('POST', `/groups/${gid}/org`, { code: 'ZZZZZZ' })).status).toBe(404)
    expect((await lead('POST', `/groups/${gid}/org`, { code: org.code })).data.name).toBe('바다수련관')
    expect((await lead('GET', `/groups/${gid}`)).data.orgs).toEqual([{ id: org.id, name: '바다수련관' }])
    expect((await kid('GET', `/groups/${gid}`)).data.orgs).toBeUndefined() // 회원에게는 기관이 안 보인다
    const mine = (await boss('GET', '/orgs')).data[0]
    expect(mine).toMatchObject({ name: '바다수련관', code: org.code, total: { groups: 1, members: 2 } })
    expect((await boss('GET', '/orgs?lite=1')).data).toEqual([{ id: org.id, name: '바다수련관', groupIds: [gid] }])
    expect((await kid('GET', '/orgs')).data).toEqual([])
    expect((await kid('PUT', `/orgs/${org.id}`, { name: '뺏기' })).status).toBe(404)
    expect((await boss('POST', `/orgs/${org.id}/groups`, { groupId: gid })).status).toBe(404) // 담당자라도 남의 모임은 직접 못 더한다 (모임에 없음)
    // 담당자 초대 링크 (담당자가 직접) → 한 번 쓰면 꺼짐
    const { invite } = (await boss('POST', `/orgs/${org.id}/invite`)).data
    expect((await lead('POST', `/org-invite/${invite}`)).data.id).toBe(org.id)
    expect((await lead('POST', `/orgs/${org.id}/leave`)).status).toBe(200)
    expect((await boss('POST', `/orgs/${org.id}/leave`)).status).toBe(400) // 마지막 담당자
    await lead('DELETE', `/groups/${gid}/org`)
    expect((await boss('GET', '/orgs')).data[0].total.groups).toBe(0)
    await boss('DELETE', `/orgs/${org.id}`)
    expect((await boss('GET', '/orgs')).data).toEqual([])

    // 문의: 로그인한 사람만, 운영자의 답은 ‘내 문의’ 에
    expect((await client()('POST', '/contact', { kind: '궁금해요', message: '로그인 없이 묻기' })).status).toBe(401)
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    const before = (await adm('GET', '/admin/me')).data.alerts.inquiries
    await kid('POST', '/contact', { kind: '궁금해요', message: '모임 코드는 어디서 보나요?' })
    expect((await adm('GET', '/admin/me')).data.alerts.inquiries).toBe(before + 1) // 알림
    expect((await kid('GET', '/admin/me')).data.alerts).toBeUndefined() // 회원에게는 없다
    const q = (await adm('GET', '/admin/inquiries')).data.find((x: { message: string }) => x.message === '모임 코드는 어디서 보나요?')
    await adm('PUT', `/admin/inquiries/${q.id}`, { status: '보는 중', note: '내부 메모', answer: '모임장에게 물어봐 주세요.' })
    expect((await adm('GET', '/admin/me')).data.alerts.inquiries).toBe(before) // 답하면 줄어든다
    const my = (await kid('GET', '/me/inquiries')).data[0]
    expect(my).toMatchObject({ answer: '모임장에게 물어봐 주세요.', status: '답함' })
    expect(my.note).toBeUndefined() // 운영자 메모는 안 보인다
    expect(my.answeredAt).toBeTruthy()
    // 탈퇴하면 문의도 함께 지운다
    const kidId = (await kid('GET', '/me')).data.user.id
    await adm('DELETE', `/admin/users/${kidId}`)
    expect((await adm('GET', '/admin/inquiries')).data.some((x: { id: string }) => x.id === q.id)).toBe(false)
  })

  // 맨 끝에 둔다: 이 테스트가 DB 를 비우므로
  it('관리자 DB 초기화: 비밀번호 · 확인 문구가 맞아야 하고, 회원 · 기록만 지우고 설정 · 공지는 남긴다', async () => {
    const kid = await signup('초기화될아이')
    await kid('PUT', '/graphs/reset-g1', { graph: { id: 'reset-g1', title: '지워질 그래프', timeScale: 'age', startPoint: 0, currentPoint: 10, visibility: 'private', entries: [], currentReflection: {}, completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } })
    const adm = client()
    await adm('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })
    await adm('PUT', '/admin/notice', { on: true, title: '남을 공지', body: '' })
    expect((await kid('POST', '/admin/reset', { password: 'admin-password-1234', confirm: '모두 지우기' })).status).toBe(401)
    expect((await adm('POST', '/admin/reset', { password: 'wrong-password-0000', confirm: '모두 지우기' })).status).toBe(401)
    expect((await adm('POST', '/admin/reset', { password: 'admin-password-1234', confirm: '지우기' })).status).toBe(400)
    const r = await adm('POST', '/admin/reset', { password: 'admin-password-1234', confirm: '모두 지우기' })
    expect(r.status).toBe(200)
    expect(r.data.before).toMatch(/^before-reset-.*\.db$/)
    const o = (await adm('GET', '/admin/overview')).data
    expect(o.counts).toMatchObject({ users: 0, graphs: 0, groups: 0, posts: 0, links: 0 })
    expect((await kid('GET', '/graphs')).status).toBe(401) // 로그인도 풀린다
    expect((await client()('GET', '/notice')).data.notice.title).toBe('남을 공지')
    expect((await adm('GET', '/admin/settings')).status).toBe(200) // 관리자는 그대로
  })
})

describe('11차 모임 질문 정하기 · 달로 · 시간으로', () => {
  it('모임장만 질문을 정하고, 모르는 칸 · 긴 글은 걸러진다', async () => {
    const lead = await signup('질문정하기장')
    const { id, code } = (await lead('POST', '/groups', { name: '질문 모임' })).data
    const member = await signup('질문정하기원')
    await member('POST', '/groups/join', { code })
    expect((await lead('GET', `/groups/${id}`)).data.prompts).toBeNull()

    expect((await member('PUT', `/groups/${id}/prompts`, { prompts: { moments: ['x'] } })).status).toBe(403)
    const r = await lead('PUT', `/groups/${id}/prompts`, {
      prompts: {
        moments: ['  처음 캠프 간 날 ', '', 'ㄱ'.repeat(80), ...Array(10).fill('더')],
        reflect: { feeling: '그때 어땠어요?', why: '', hacked: 'x', now: 3 },
        now: { word: '한 단어로?' },
        present: ['QR 찍기 (3분)'],
        evil: '<script>',
      },
    })
    expect(r.status).toBe(200)
    expect(r.data.prompts.moments).toHaveLength(8)
    expect(r.data.prompts.moments[0]).toBe('처음 캠프 간 날')
    expect(r.data.prompts.moments[1]).toHaveLength(40)
    expect(r.data.prompts.reflect).toEqual({ feeling: '그때 어땠어요?', why: '' }) // '' = 묻지 않기
    expect(r.data.prompts.now).toEqual({ word: '한 단어로?' })
    expect(r.data.prompts).not.toHaveProperty('evil')
    expect((await member('GET', `/groups/${id}`)).data.prompts.present).toEqual(['QR 찍기 (3분)'])

    // 복제하면 질문도 따라간다
    const copy = (await lead('POST', `/groups/${id}/copy`, { name: '질문 모임 2' })).data
    expect((await lead('GET', `/groups/${copy.id}`)).data.prompts.now).toEqual({ word: '한 단어로?' })

    // 비우면 기본으로
    expect((await lead('PUT', `/groups/${id}/prompts`, { prompts: {} })).data.prompts).toBeNull()
    expect((await lead('GET', `/groups/${id}`)).data.prompts).toBeNull()
  })

  it('나의 시간: 달로(시작~끝 달) · 시간으로(14일까지)', async () => {
    const lead = await signup('달시간장')
    const { id } = (await lead('POST', '/groups', { name: '시간 모임' })).data
    const m = new Date().getFullYear() * 12 + new Date().getMonth()
    expect((await lead('PUT', `/groups/${id}/preset`, { preset: { choice: 'month', start: m - 5, end: m, title: '' } })).data.preset.choice).toBe('month')
    expect((await lead('PUT', `/groups/${id}/preset`, { preset: { choice: 'month', start: m, end: m - 1, title: '' } })).status).toBe(400)
    const h = Date.UTC(2026, 10, 8, 9) / 3_600_000
    expect((await lead('PUT', `/groups/${id}/preset`, { preset: { choice: 'hour', start: h, end: h + 9, title: '캠프' } })).data.preset).toMatchObject({ choice: 'hour', start: h, end: h + 9 })
    expect((await lead('PUT', `/groups/${id}/preset`, { preset: { choice: 'hour', start: h, end: h + 15 * 24, title: '' } })).status).toBe(400)
    // 예전 값도 그대로 받는다
    expect((await lead('PUT', `/groups/${id}/preset`, { preset: { choice: 'recent12', start: 0, end: m, title: '' } })).status).toBe(200)
  })
})

// 새 버전이 표에 칸을 더해도(예: 1.1.0 이 admin_sessions 에 who · role 을 더함) 예전 방식의 INSERT 가 깨지지 않게, 모든 INSERT 는 칸 이름을 적는다
describe('칸이 더 생긴 DB 에서도', () => {
  it('가입 · 그래프 저장 · 공유 링크 · 관리자 로그인이 된다', async () => {
    const db = openDb(':memory:')
    for (const t of ['meta', 'sessions', 'graphs', 'links', 'takedowns', 'ip_aliases', 'admin_sessions']) db.exec(`ALTER TABLE ${t} ADD COLUMN future_col TEXT NOT NULL DEFAULT ''`)
    const s = createServer(createApp(db, { secureCookie: false, admin: { id: 'admin', password: 'admin-password-1234' }, publicUrl: 'https://geuryeobom.example', devServer: true }))
    await new Promise<void>((ok) => s.listen(0, ok))
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api`
    let cookie = ''
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'geuryeobom', 'X-Real-IP': '10.9.9.9', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      const set = res.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      return res.status
    }
    try {
      expect(await call('POST', '/auth/signup', { name: 'future', birth: BIRTH, nickname: 'future', agree: true })).toBe(200)
      const g = { ...newGraph(), visibility: 'link' as const, entries: [newEntry(5, 2, '반짝')] }
      expect(await call('PUT', `/graphs/${g.id}`, { graph: g })).toBe(200)
      const shared = toShared(g, { title: '선', entryIds: new Set([g.entries[0].id]), descriptions: false, time: true })
      expect(await call('POST', '/links', { shared, graphId: g.id })).toBe(200)
      expect(await call('POST', '/admin/login', { id: 'admin', password: 'admin-password-1234' })).toBe(200)
    } finally {
      s.close()
    }
  })
})
