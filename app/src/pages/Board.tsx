import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { confirmDialog } from '../components/confirm'
import { api, type BoardSaved } from '../api'
import { useLabs } from '../labs'
import { BOARD_BASE, BOARD_MADE, type BoardCfg } from '../boardFrame'

/**
 * 실험(1.3.0 · 사이트 지도 보드): 관리자만. 화면들을 실제로 돌아가는 노드(iframe)로 띄우고,
 * 화면 속 링크를 읽어 노드 사이를 자동으로 잇는다. 노드를 두 번 누르면 크게 열어 직접 써 본다.
 * 2차: 기기 · 낮밤 · 밝기 · 글자 · 움직임 · 계절 · 데이터 · 실험 기능 전환, 노드 메모, 손으로 배치, 보드 한 장 저장.
 * 3차: 바뀐 노드 표시, 나란히 비교, 점검 ✓, 찾기, 작은 지도, 단축키, 보드 연습 데이터 정리, 활동 기록.
 */
type Node = { key: string; path: string; name: string; group: string; row: number; col: number; admin: boolean }
type Status = { state: 'wait' | 'ok' | 'slow' | 'bad'; note: string }
type Rect = { x: number; y: number; w: number; h: number }
type Frame = { el: HTMLIFrameElement; id: string; seen: number; readyAt: number; scanUntil: number; done: boolean; errors: number; hooked: boolean }

const GROUPS: [string, [string, string][]][] = [
  ['그리기', [['/', '처음'], ['/graph/new', '그리기'], ['/example', '예시 그래프'], ['/welcome', '1분 투어'], ['/worksheet', '종이 활동지']]],
  ['나', [['/login', '로그인'], ['/me', '나'], ['/my', '기록 모아보기'], ['/my/book', '내 기록 한 권'], ['/me/overview', '내 흐름'], ['/lines', '오늘의 한 줄'], ['/words', '마음 서랍'], ['/letters', '편지함'], ['/inbox', '소식함'], ['/review', '한 해 돌아보기'], ['/share', '나누기'], ['/contact', '문의하기']]],
  ['함께 · 기관', [['/activities', '선 하나 활동'], ['/guide', '진행자 안내서'], ['/org', '기관']]],
  ['둘러보기', [['/credits', '만든 사람'], ['/terms', '이용약관'], ['/privacy', '개인정보 처리방침']]],
  ['관리자', [['/admin?tab=home', '한눈에'], ['/admin?tab=reports', '신고함'], ['/admin?tab=inquiries', '문의함'], ['/admin?tab=notice', '공지 · 점검'], ['/admin?tab=users', '사람'], ['/admin?tab=groups', '모임'], ['/admin?tab=settings', '설정'], ['/admin?tab=flags', '실험 기능'], ['/admin?tab=devlog', '변경 내역']]],
]

// 기기마다 노드 안 화면 크기(W×H)와 보드에서 보이는 높이(NH)
type Dev = 'pc' | 'tablet' | 'tabletL' | 'phone'
const DEV: Record<Dev, { W: number; H: number; NH: number; name: string; m: boolean }> = {
  pc: { W: 1280, H: 800, NH: 200, name: 'PC', m: false },
  tablet: { W: 820, H: 1180, NH: 280, name: '태블릿 세로', m: true },
  tabletL: { W: 1180, H: 820, NH: 220, name: '태블릿 가로', m: true },
  phone: { W: 390, H: 844, NH: 300, name: '휴대폰', m: true },
}
const GAP_X = 70, GAP_Y = 150, PAD = 60, TOP = 120

type Opts = { dev: Dev; time: '' | 'day' | 'night'; theme: '' | 'light' | 'dark'; text: '' | 'sm' | 'lg'; motion: '' | 'reduce'; season: '' | 'spring' | 'summer' | 'autumn' | 'winter'; data: 'account' | 'empty' | 'one' | 'many'; labs: 'dev' | 'official' }
const DEFAULT: Opts = { dev: 'pc', time: '', theme: '', text: '', motion: '', season: '', data: 'account', labs: 'dev' }
const OPT_KEY = 'geuryeobom:board:v1'
const loadOpts = (): Opts => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}') } } catch { return DEFAULT } }
const CHOICES: [keyof Opts, string, [string, string][]][] = [
  ['dev', '기기', [['pc', 'PC'], ['tablet', '태블릿 세로'], ['tabletL', '태블릿 가로'], ['phone', '휴대폰']]],
  ['time', '시간', [['', '지금'], ['day', '낮'], ['night', '밤 (조용한 시간)']]],
  ['theme', '밝기', [['', '자동'], ['light', '밝게'], ['dark', '어둡게']]],
  ['text', '글자', [['', '보통'], ['sm', '작게'], ['lg', '크게']]],
  ['motion', '움직임', [['', '그대로'], ['reduce', '줄이기']]],
  ['season', '계절', [['', '지금'], ['spring', '봄'], ['summer', '여름'], ['autumn', '가을'], ['winter', '겨울']]],
  ['data', '데이터', [['account', '내 계정'], ['empty', '손님 · 빈 상태'], ['one', '손님 · 그래프 1개'], ['many', '손님 · 많이']]],
  ['labs', '실험 기능', [['dev', '개발 (모두 켜짐)'], ['official', '정식 (정식 묶음만)']]],
]
// 나란히 비교: 한 화면을 네 상황으로
// 나란히 비교: PC · 태블릿 · 휴대폰 · 밤 — 기기 셋과 밤(조용한 시간 · 어두움)
const COMPARE: [string, Partial<Opts>][] = [['PC', { dev: 'pc' }], ['태블릿', { dev: 'tablet' }], ['휴대폰', { dev: 'phone' }], ['밤 (조용한 시간)', { time: 'night' }]]

// 노드 화면은 다 열리면 멈춰 둔다 (움직임 · 흐림을 꺼서 보드를 가볍게, 장면은 끝 모습으로)
const FREEZE = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'

/** 주소 → 노드 열쇠 (휴대폰 /m 은 떼고, 관리자 화면은 탭까지) */
const keyOf = (href: string) => {
  const u = new URL(href, location.origin)
  if (u.origin !== location.origin) return ''
  const p = u.pathname === '/m' ? '/' : u.pathname.startsWith('/m/') ? u.pathname.slice(2) : u.pathname
  return p === '/admin' ? `/admin?tab=${u.searchParams.get('tab') || 'home'}` : p
}
/** 화면 지문: 본문 글자 + 요소 수 (바뀐 노드 찾기) */
const print = (doc: Document) => {
  const main = doc.querySelector('main')
  const s = (main?.innerText ?? '') + '|' + (main?.querySelectorAll('*').length ?? 0)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export default function Board() {
  const on = useLabs('board')
  const [admin, setAdmin] = useState<boolean | null>(null)
  useEffect(() => { api.adminMe().then((m) => setAdmin(m.admin), () => setAdmin(false)) }, [])

  const nodes = useMemo<Node[]>(() => GROUPS.flatMap(([group, items], row) => items.map(([path, name], col) => ({ key: keyOf(path), path, name, group, row, col, admin: path.startsWith('/admin') }))), [])
  const byKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes])
  const [opts, setOpts] = useState<Opts>(loadOpts)
  const [edges, setEdges] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [prints, setPrints] = useState<Record<string, string>>({})
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Node | null>(null)
  const [compare, setCompare] = useState<Node | null>(null)
  const [here, setHere] = useState('')
  const [saved, setSaved] = useState<BoardSaved>({ notes: {}, pos: {} })
  const [q, setQ] = useState('')
  const [made, setMade] = useState(0)
  const [menu, setMenu] = useState(false)
  const [help, setHelp] = useState(false)
  const [hot, setHot] = useState('') // 마우스를 올린 노드: 그 노드의 선만 진하게
  const texts = useRef<Record<string, string>>({})
  const frames = useRef(new Map<string, Frame>())

  useEffect(() => { if (admin) api.adminBoard().then((b) => setSaved({ prints: {}, checks: {}, ...b, notes: b.notes ?? {}, pos: b.pos ?? {} }), () => {}) }, [admin])
  const persist = (next: BoardSaved) => { setSaved(next); api.saveAdminBoard(next).catch(() => {}) }
  const sig = JSON.stringify(opts) // 같은 상황끼리만 ‘바뀜’ 을 비교한다

  const choose = (k: keyof Opts, v: string) => {
    const next = { ...opts, [k]: v } as Opts
    setOpts(next)
    setStatus({})
    try { localStorage.setItem(OPT_KEY, JSON.stringify(next)) } catch { /* 이번만 */ }
  }
  const reset = () => { setOpts(DEFAULT); setStatus({}); try { localStorage.removeItem(OPT_KEY) } catch { /* */ } }
  const devOf = (n: Node, o = opts): Dev => (n.admin ? 'pc' : o.dev)
  const cfgOf = (n: Node, o = opts): string => {
    const c: BoardCfg = {
      ...(o.theme && { theme: o.theme }), ...(o.text && { text: o.text }), ...(o.time && { time: o.time }),
      ...(o.season && { season: o.season }), ...(o.motion && { motion: o.motion }),
      data: n.admin ? 'account' : o.data, labs: o.labs,
    }
    return 'board:' + JSON.stringify(c)
  }
  const srcOf = (n: Node, o = opts) => (!DEV[devOf(n, o)].m || n.admin ? n.path : n.path === '/' ? '/m' : '/m' + n.path)

  const addEdges = (from: string, tos: string[]) => setEdges((old) => {
    const next = new Set(old)
    for (const to of tos) if (to && to !== from && byKey.has(to)) next.add(`${from}→${to}`)
    return next.size === old.size ? old : next
  })

  // 노드 살피기: 로드 신호를 기다리지 않고 0.7초마다 직접 확인한다 (상태가 ‘여는 중’ 에 멈추지 않게)
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now()
      for (const [key, f] of frames.current) {
        // 다 살핀 뒤에도 10초 동안은 늦게 그려지는 링크 · 글자를 더 모은다
        if (f.done) {
          if (t < f.scanUntil) {
            try {
              const doc = f.el.contentDocument!
              addEdges(key, [...doc.querySelectorAll<HTMLAnchorElement>('main a[href]')].filter((a) => !a.closest('footer, nav, .dock, .site-footer')).map((a) => keyOf(a.href)))
              texts.current[key] = (doc.querySelector('main') as HTMLElement | null)?.innerText.slice(0, 4000) ?? ''
              if (t + 700 >= f.scanUntil) setPrints((p) => ({ ...p, [key]: print(doc) }))
            } catch { /* */ }
          }
          continue
        }
        try {
          const win = f.el.contentWindow as (Window & typeof globalThis) | null, doc = f.el.contentDocument
          if (win && !f.hooked && doc?.readyState !== 'loading') {
            f.hooked = true
            win.addEventListener('error', () => { f.errors++ })
            const orig = win.console.error
            win.console.error = (...a: unknown[]) => { f.errors++; orig.apply(win.console, a) }
          }
          if (!f.readyAt && doc?.readyState === 'complete' && doc.querySelector('main')) f.readyAt = t
          const ready = !!f.readyAt && t - f.readyAt > 1500
          if (!ready) {
            if (t - f.seen > 25000) { f.done = true; setStatus((s) => ({ ...s, [key]: { state: 'bad', note: '열지 못함' } })) }
            continue
          }
          f.done = true
          f.scanUntil = t + 10000
          const ms = f.readyAt - f.seen
          const links = [...doc!.querySelectorAll<HTMLAnchorElement>('main a[href]')].filter((a) => !a.closest('footer, nav, .dock, .site-footer'))
          addEdges(key, links.map((a) => keyOf(a.href)))
          texts.current[key] = (doc!.querySelector('main') as HTMLElement | null)?.innerText.slice(0, 4000) ?? ''
          const lost = /길을 잠시 잃었어요/.test(doc!.body.innerText)
          const wide = doc!.documentElement.scrollWidth > win!.innerWidth + 1
          const notes = [lost && '없는 화면', wide && '가로 넘침', f.errors && `오류 ${f.errors}`].filter(Boolean) as string[]
          setStatus((s) => ({ ...s, [key]: notes.length ? { state: 'bad', note: notes.join(' · ') } : ms > 10000 ? { state: 'slow', note: `느림 ${(ms / 1000).toFixed(1)}초` } : { state: 'ok', note: '정상' } }))
          setPrints((p) => ({ ...p, [key]: print(doc!) }))
          const st = doc!.createElement('style')
          st.textContent = FREEZE
          doc!.head.append(st)
        } catch {
          f.done = true
          setStatus((s) => ({ ...s, [key]: { state: 'bad', note: '열지 못함' } }))
        }
      }
      // 보드 안에서 내 계정으로 만든 그래프 수
      try {
        const m: string[] = JSON.parse(localStorage.getItem(BOARD_MADE) ?? '[]'), b: string[] = JSON.parse(localStorage.getItem(BOARD_BASE) ?? '[]')
        setMade(m.filter((x) => !b.includes(x)).length)
      } catch { /* */ }
    }, 700)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const frameRef = (n: Node, id: string) => (el: HTMLIFrameElement | null) => {
    if (!el) return
    const cur = frames.current.get(n.key)
    if (!cur || cur.id !== id || cur.el !== el) frames.current.set(n.key, { el, id, seen: performance.now(), readyAt: 0, scanUntil: 0, done: false, errors: 0, hooked: false })
  }

  // 연습 데이터: 보드를 처음 열 때 이미 있던 내 그래프를 기억해 둔다
  useEffect(() => {
    if (!admin) return
    try { if (JSON.parse(localStorage.getItem(BOARD_MADE) ?? '[]').length) return } catch { /* */ }
    fetch('/api/graphs').then((r) => (r.ok ? r.json() : [])).then((j) => {
      const list = (Array.isArray(j) ? j : j?.graphs ?? []) as { id: string }[]
      try { localStorage.setItem(BOARD_BASE, JSON.stringify(list.map((g) => g.id))) } catch { /* */ }
    }, () => {})
  }, [admin])
  const cleanMade = async () => {
    const m: string[] = JSON.parse(localStorage.getItem(BOARD_MADE) ?? '[]'), b: string[] = JSON.parse(localStorage.getItem(BOARD_BASE) ?? '[]')
    const ids = m.filter((x) => !b.includes(x))
    if (!ids.length || !await confirmDialog(`보드 안에서 내 계정으로 만든 그래프 ${ids.length}개를 지울까요? 되돌릴 수 없어요.`)) return
    for (const id of ids) await fetch(`/api/graphs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Requested-With': 'geuryeobom' } }).catch(() => {})
    localStorage.removeItem(BOARD_MADE)
    localStorage.removeItem(BOARD_BASE)
    setMade(0)
  }

  // 크게 연 화면이 어디로 가는지 따라가며 선을 더한다
  const bigRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    if (!open) return
    let last = open.key
    setHere(last)
    const id = setInterval(() => {
      try {
        const k = keyOf(bigRef.current!.contentWindow!.location.href)
        if (k && k !== last) { addEdges(last, [k]); last = k; setHere(k) }
      } catch { /* 아직 열리는 중 */ }
    }, 400)
    return () => clearInterval(id)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 자리: 자동 배치 (줄마다 묶음) + 손으로 옮긴 자리 ──
  const size = (n: Node) => { const d = DEV[devOf(n)]; return { w: Math.round((d.W * d.NH) / d.H), h: d.NH, k: d.NH / d.H, W: d.W, H: d.H } }
  const rowY: number[] = []
  let yy = PAD
  GROUPS.forEach(([g, items], r) => {
    rowY[r] = yy
    const h = Math.max(...items.map(([p]) => size(byKey.get(keyOf(p))!).h))
    yy += closed.has(g) ? 80 : h + GAP_Y
  })
  const autoPos = (n: Node) => {
    let x = PAD
    for (const m of nodes) { if (m.row === n.row && m.col < n.col) x += size(m).w + GAP_X }
    return { x, y: rowY[n.row] + 40 }
  }
  const rectOf = (n: Node): Rect => { const p = saved.pos[n.key] ?? autoPos(n), s = size(n); return { x: p.x, y: p.y, w: s.w, h: s.h } }
  const shown = (n: Node) => !closed.has(n.group)

  // ── 선: 서로 오가면 하나로, 같은 쪽에서 여러 선이 나가면 간격을 벌린다, 선은 화면 아래로 ──
  type Side = 'r' | 'l' | 't' | 'b'
  const drawn = (() => {
    const list: { a: Node; b: Node; both: boolean; sa: Side; sb: Side }[] = []
    for (const e of edges) {
      const [a, b] = e.split('→').map((k) => byKey.get(k)!)
      if (!shown(a) || !shown(b)) continue
      const both = edges.has(`${b.key}→${a.key}`)
      if (both && a.key > b.key) continue
      const ra = rectOf(a), rb = rectOf(b)
      let sa: Side, sb: Side
      if (Math.abs(ra.y - rb.y) < 40) {
        const near = rb.x > ra.x + ra.w && rb.x - (ra.x + ra.w) < 160
        sa = near ? 'r' : 't'; sb = near ? 'l' : 't'
      } else if (rb.y > ra.y) { sa = 'b'; sb = 't' } else { sa = 't'; sb = 'b' }
      list.push({ a, b, both, sa, sb })
    }
    // 노드 · 쪽마다 붙는 선을 상대 노드 x 순으로 줄 세워 자리를 나눈다
    const ports = new Map<string, { id: number; ox: number }[]>()
    list.forEach((l, i) => {
      for (const [n, s, other] of [[l.a, l.sa, l.b], [l.b, l.sb, l.a]] as const) {
        const k = `${n.key}|${s}`
        ports.set(k, [...(ports.get(k) ?? []), { id: i * 2 + (n === l.a ? 0 : 1), ox: rectOf(other).x }])
      }
    })
    const offset = new Map<number, number>()
    for (const [k, ps] of ports) {
      const [key, s] = k.split('|')
      const r = rectOf(byKey.get(key)!)
      const span = (s === 'l' || s === 'r' ? r.h : r.w) * 0.6
      ps.sort((x, y) => x.ox - y.ox).forEach((p, i) => offset.set(p.id, ps.length === 1 ? 0 : -span / 2 + (span * i) / (ps.length - 1)))
    }
    // 화살표 끝: 위쪽은 제목 줄 위(CAP), 아래쪽은 화면 아래
    const CAP = 34
    const anchor = (r: Rect, s: Side, o: number): [number, number] =>
      s === 'r' ? [r.x + r.w, r.y + r.h / 2 + o] : s === 'l' ? [r.x - 4, r.y + r.h / 2 + o] : s === 't' ? [r.x + r.w / 2 + o, r.y - CAP - 2] : [r.x + r.w / 2 + o, r.y + r.h + 2]
    // 노드를 가로지르지 않게: 줄 사이 통로로 내려가 가로로 가고, 여러 줄을 건널 땐 노드 사이 세로 통로로. 선마다 통로 안 높이를 달리해 겹치지 않게
    return list.map((l, i) => {
      const ra = rectOf(l.a), rb = rectOf(l.b)
      const [x1, y1] = anchor(ra, l.sa, offset.get(i * 2) ?? 0), [x2, y2] = anchor(rb, l.sb, offset.get(i * 2 + 1) ?? 0)
      const lane = 20 + (i % 6) * 13
      const gx = rb.x > PAD + 10 ? rb.x - GAP_X / 2 - 9 + (i % 4) * 6 : rb.x + rb.w + GAP_X / 2 - 9 + (i % 4) * 6
      let d: string
      if (l.sa === 'r') d = `M${x1} ${y1} L${x2} ${y2}`
      else if (l.sa === 't' && l.sb === 't') d = `M${x1} ${y1} V${Math.min(y1, y2) - lane} H${x2} V${y2}`
      else if (l.sa === 'b') {
        const g1 = y1 + lane, g2 = y2 - lane
        d = g2 - g1 < 30 ? `M${x1} ${y1} V${g1} H${x2} V${y2}` : `M${x1} ${y1} V${g1} H${gx} V${g2} H${x2} V${y2}`
      } else {
        const g1 = y1 - lane, g2 = y2 + lane
        d = g1 - g2 < 30 ? `M${x1} ${y1} V${g1} H${x2} V${y2}` : `M${x1} ${y1} V${g1} H${gx} V${g2} H${x2} V${y2}`
      }
      const mine = (k: string) => l.a.key === k || l.b.key === k
      return { key: `${l.a.key}→${l.b.key}`, d, both: l.both, live: !!open && mine(here), hot: !!hot && mine(hot) }
    })
  })()

  // ── 카메라: React 를 거치지 않고 스타일만 바꾼다. 움직이는 동안만 GPU 레이어 (멈추면 선명하게 다시 그린다) ──
  const boardEl = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const miniView = useRef<SVGRectElement>(null)
  const cam = useRef({ x: 40, y: TOP, k: 0.6 })
  const raf = useRef(0)
  const still = useRef(0)
  const bounds = nodes.filter(shown).map(rectOf)
  const worldW = Math.max(...bounds.map((r) => r.x + r.w)) + PAD, worldH = Math.max(...bounds.map((r) => r.y + r.h)) + PAD
  const paint = () => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const { x, y, k } = cam.current
      if (world.current) world.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`
      const v = miniView.current
      if (v) { v.setAttribute('x', String(-x / k)); v.setAttribute('y', String(-y / k)); v.setAttribute('width', String(innerWidth / k)); v.setAttribute('height', String(innerHeight / k)) }
    })
    boardEl.current?.classList.add('is-moving')
    clearTimeout(still.current)
    still.current = window.setTimeout(() => boardEl.current?.classList.remove('is-moving'), 180)
  }
  const barH = () => (document.querySelector<HTMLElement>('.board-bar')?.offsetHeight ?? TOP) + 12
  const fit = () => {
    const top = barH()
    const k = Math.min(1, (innerWidth - 60) / worldW, (innerHeight - top - 20) / worldH)
    cam.current = { x: 30, y: top, k }
    paint()
  }
  const focusRect = (r: Rect, k = 0.9) => {
    cam.current = { k, x: innerWidth / 2 - (r.x + r.w / 2) * k, y: (innerHeight + barH()) / 2 - (r.y + r.h / 2) * k }
    paint()
  }
  useEffect(() => { if (admin) fit() }, [admin, opts.dev]) // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useRef<{ x: number; y: number } | null>(null)
  const nodeDrag = useRef<{ key: string; el: HTMLElement; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const down = (e: RPointerEvent) => {
    setMenu(false)
    if (e.button !== 0) return
    drag.current = { x: e.clientX - cam.current.x, y: e.clientY - cam.current.y }
    // 캡처는 누른 그 요소에 — 보드 전체에 잡으면 뒤따르는 클릭 · 두 번 누르기가 노드에 닿지 않는다
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const move = (e: RPointerEvent) => {
    const nd = nodeDrag.current
    if (nd) {
      nd.el.style.left = `${nd.ox + (e.clientX - nd.sx) / cam.current.k}px`
      nd.el.style.top = `${nd.oy - 34 + (e.clientY - nd.sy) / cam.current.k}px`
      return
    }
    if (!drag.current) return
    cam.current.x = e.clientX - drag.current.x
    cam.current.y = e.clientY - drag.current.y
    paint()
  }
  const up = (e: RPointerEvent) => {
    const nd = nodeDrag.current
    if (nd) {
      const dx = (e.clientX - nd.sx) / cam.current.k, dy = (e.clientY - nd.sy) / cam.current.k
      if (Math.abs(dx) + Math.abs(dy) > 3) persist({ ...saved, pos: { ...saved.pos, [nd.key]: { x: Math.round(nd.ox + dx), y: Math.round(nd.oy + dy) } } })
      nodeDrag.current = null
    }
    drag.current = null
  }
  const grabNode = (n: Node) => (e: RPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const r = rectOf(n)
    nodeDrag.current = { key: n.key, el: (e.currentTarget as HTMLElement).closest('figure')!, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const wheel = (e: RWheelEvent) => {
    const c = cam.current
    const k = Math.min(2.5, Math.max(0.12, c.k * Math.exp(-e.deltaY * 0.0015)))
    cam.current = { k, x: e.clientX - ((e.clientX - c.x) * k) / c.k, y: e.clientY - ((e.clientY - c.y) * k) / c.k }
    paint()
  }

  // 찾기: 화면 이름 · 화면 속 글자
  const matches = q.trim() ? nodes.filter((n) => shown(n) && (n.name.includes(q.trim()) || (texts.current[n.key] ?? '').includes(q.trim()))) : []
  const searchRef = useRef<HTMLInputElement>(null)

  // 단축키: F 전체 · 1~5 묶음으로 · / 찾기 · Esc 닫기
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(null); setCompare(null); setMenu(false); setHelp(false); return }
      if (open || compare || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return
      if (e.key === '?') setHelp((h) => !h)
      else if (e.key === 'f') fit()
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (/^[1-5]$/.test(e.key)) {
        const g = GROUPS[Number(e.key) - 1]?.[0]
        const rs = nodes.filter((n) => n.group === g).map(rectOf)
        if (rs.length) {
          const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)), w = Math.max(...rs.map((r) => r.x + r.w)) - x, h = Math.max(...rs.map((r) => r.y + r.h)) - y
          focusRect({ x, y, w, h }, Math.min(1.2, (innerWidth - 80) / w, (innerHeight - barH() - 60) / h))
        }
      }
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }) // 매번 최신 상태로

  const memo = (n: Node) => {
    const t = window.prompt(`‘${n.name}’ 메모 (비우면 지워요)`, saved.notes[n.key] ?? '')
    if (t === null) return
    const notes = { ...saved.notes }
    if (t.trim()) notes[n.key] = t.trim().slice(0, 500)
    else delete notes[n.key]
    persist({ ...saved, notes })
  }
  const toggleCheck = (n: Node) => {
    const checks = { ...(saved.checks ?? {}) }
    if (checks[n.key]) delete checks[n.key]
    else checks[n.key] = true
    persist({ ...saved, checks })
  }
  const setBaseline = () => {
    const p = { ...(saved.prints ?? {}) }
    for (const [k, v] of Object.entries(prints)) p[`${sig}|${k}`] = v
    persist({ ...saved, prints: p })
  }
  const changed = (n: Node) => { const base = saved.prints?.[`${sig}|${n.key}`]; return !!base && !!prints[n.key] && base !== prints[n.key] }

  // 보드 한 장 저장: 브라우저의 ‘이 탭 공유’ 로 지금 보이는 그대로 한 장
  const shot = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true } as DisplayMediaStreamOptions)
      const v = document.createElement('video')
      v.srcObject = stream
      v.muted = true
      await v.play()
      await new Promise((r) => setTimeout(r, 300))
      const cv = document.createElement('canvas')
      cv.width = v.videoWidth
      cv.height = v.videoHeight
      cv.getContext('2d')!.drawImage(v, 0, 0)
      stream.getTracks().forEach((t) => t.stop())
      cv.toBlob((b) => {
        if (!b) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(b)
        a.download = `그려봄-사이트지도-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }, 'image/png')
    } catch {
      window.alert('‘이 탭’ 을 골라 공유를 허락해야 한 장으로 저장할 수 있어요.')
    }
  }

  if (!on) return <p className="container page muted">사이트 지도 보드는 실험 기능이에요. 관리자 ‘실험 기능 스위치’ 에서 켜 주세요.</p>
  if (admin === null) return <p className="container page loading serif">확인하는 중이에요…</p>
  if (!admin) {
    return (
      <section className="container page empty-state">
        <h1 className="page-title">관리자만 볼 수 있어요</h1>
        <p className="muted">관리자 확인을 한 뒤 다시 열어 주세요.</p>
        <a className="btn btn-primary" href="/admin">관리자 확인하러 가기</a>
      </section>
    )
  }

  const counts = Object.values(status).reduce((a, s) => ({ ...a, [s.state]: (a[s.state] ?? 0) + 1 }), {} as Record<string, number>)
  const checked = nodes.filter((n) => saved.checks?.[n.key]).length
  const changedN = nodes.filter(changed).length
  const hasBase = Object.keys(saved.prints ?? {}).some((k) => k.startsWith(sig + '|'))
  const big = open ? DEV[devOf(open)] : null
  const MINI = 160, ms = MINI / Math.max(worldW, worldH)

  return (
    <div className="board" ref={boardEl} onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={wheel}>
      <header className="board-bar" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="board-row board-row-main">
          <div className="board-title"><b>사이트 지도 보드</b><span className="board-chip">실험</span></div>
          <div className="board-stats" aria-label="상태 요약">
            <span className="board-stat" title="정상"><i className="board-dot is-ok" />{counts.ok ?? 0}</span>
            <span className="board-stat" title="느림"><i className="board-dot is-slow" />{counts.slow ?? 0}</span>
            <span className="board-stat" title="오류"><i className="board-dot is-bad" />{counts.bad ?? 0}</span>
            <span className="board-stat-sep" />
            <span className="board-stat" title="점검한 노드">✓ {checked}/{nodes.length}</span>
            <span className="board-stat" title="선">선 {drawn.length}</span>
            {hasBase && <span className={`board-stat${changedN ? ' is-changed' : ''}`} title="기준과 달라진 노드">바뀜 {changedN}</span>}
          </div>
          <span className="board-sp" />
          <label className="board-search-wrap">
            <input ref={searchRef} className="board-search" type="search" placeholder="찾기  /" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) focusRect(rectOf(matches[0])) }} />
            {q.trim() && <span className="board-search-n">{matches.length}곳</span>}
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={fit} title="전체 보기 (F)">전체 보기</button>
          <div className="board-menu">
            <button type="button" className={`btn btn-ghost btn-sm${menu ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>더 보기 ▾</button>
            {menu && (
              <div className="board-menu-list" role="menu">
                <button type="button" role="menuitem" onClick={() => { setBaseline(); setMenu(false) }}><b>지금 모습을 기준으로</b><small>다음에 달라진 노드에 ‘바뀜’ 표시</small></button>
                <button type="button" role="menuitem" onClick={() => { shot(); setMenu(false) }}><b>보드 한 장 저장</b><small>‘이 탭’ 공유를 허락하면 PNG 로</small></button>
                <button type="button" role="menuitem" disabled={!Object.keys(saved.pos).length} onClick={() => { persist({ ...saved, pos: {} }); setMenu(false) }}><b>자동 배치로 되돌리기</b><small>손으로 옮긴 자리 {Object.keys(saved.pos).length}개</small></button>
                <button type="button" role="menuitem" disabled={!checked} onClick={() => { persist({ ...saved, checks: {} }); setMenu(false) }}><b>점검 ✓ 모두 비우기</b><small>{checked}개</small></button>
                <button type="button" role="menuitem" disabled={!made} onClick={() => { cleanMade(); setMenu(false) }}><b>보드에서 만든 그래프 정리</b><small>내 계정에 {made}개</small></button>
              </div>
            )}
          </div>
          <button type="button" className={`btn btn-ghost btn-sm board-help-btn${help ? ' is-on' : ''}`} aria-label="도움말" aria-expanded={help} title="도움말 (?)" onClick={() => setHelp((h) => !h)}>?</button>
          <a className="btn btn-ghost btn-sm" href="/admin">관리자로</a>
        </div>
        <div className="board-row board-opts">
          <span className="board-opts-label">상황</span>
          {CHOICES.map(([k, label, items]) => (
            <label key={k} className={opts[k] !== DEFAULT[k] ? 'is-set' : ''}>
              <span>{label}</span>
              <select value={opts[k]} onChange={(e) => choose(k, e.target.value)}>
                {items.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          ))}
          {sig !== JSON.stringify(DEFAULT) && <button type="button" className="board-reset" onClick={reset}>처음대로</button>}
        </div>
      </header>

      {help && (
        <aside className="board-help" role="dialog" aria-label="보드 도움말" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <div className="board-help-head"><b>도움말</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => setHelp(false)}>닫기 (Esc)</button></div>
          <div className="board-help-grid">
            <section>
              <h3>움직이기</h3>
              <p>빈 곳을 <b>끌어서</b> 이동하고, <b>휠</b>로 확대 · 축소해요. 오른쪽 아래 작은 지도를 누르면 그곳으로 가요.</p>
            </section>
            <section>
              <h3>노드</h3>
              <p><b>두 번 누르면</b> 크게 열려 직접 써 볼 수 있어요. 안에서 다른 화면으로 가면 보드에 선이 더해져요.</p>
              <p>제목을 <b>끌어</b> 자리를 옮기고, 제목 위에 마우스를 올리면 <b>✓ 점검 · ⧉ 나란히 비교 · 📝 메모</b>가 나와요.</p>
              <p>점 색: <i className="board-dot is-ok" /> 정상 · <i className="board-dot is-slow" /> 느림 · <i className="board-dot is-bad" /> 없는 화면 · 가로 넘침 · 오류</p>
            </section>
            <section>
              <h3>상황</h3>
              <p>둘째 줄에서 기기 · 시간 · 밝기 등을 바꾸면 노드 안에만 적용돼요. 내 보기 설정과 그래프는 그대로예요.</p>
              <p>관리자 화면은 늘 PC · 내 계정으로 열려요.</p>
            </section>
            <section>
              <h3>단축키</h3>
              <dl>
                <dt><kbd>F</kbd></dt><dd>전체 보기</dd>
                <dt><kbd>1</kbd>~<kbd>5</kbd></dt><dd>묶음으로 이동</dd>
                <dt><kbd>/</kbd></dt><dd>찾기</dd>
                <dt><kbd>?</kbd></dt><dd>이 도움말</dd>
                <dt><kbd>Esc</kbd></dt><dd>닫기</dd>
              </dl>
            </section>
          </div>
        </aside>
      )}

      <div className="board-world" ref={world}>
        {GROUPS.map(([g, items], gi) => {
          const rs = items.map(([p]) => rectOf(byKey.get(keyOf(p))!))
          const x = Math.min(...rs.map((r) => r.x)) - 24, y = Math.min(...rs.map((r) => r.y)) - 52
          const w = Math.max(...rs.map((r) => r.x + r.w)) - x + 24, h = closed.has(g) ? 56 : Math.max(...rs.map((r) => r.y + r.h)) - y + 30
          return (
            <section key={g} className={`board-group${closed.has(g) ? ' is-closed' : ''}`} style={{ left: x, top: y, width: w, height: h }}>
              <button type="button" className="board-group-head" onPointerDown={(e) => e.stopPropagation()} onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n })}>
                {closed.has(g) ? '▸' : '▾'} {g} <span className="muted">{items.length} · {gi + 1}</span>
              </button>
            </section>
          )
        })}

        <svg className={`board-edges${hot || open ? ' has-focus' : ''}`} width={worldW + 400} height={worldH + 400}>
          <defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" /></marker></defs>
          {drawn.map((l) => <path key={l.key} className={`${l.live || l.hot ? 'is-hot' : ''}${l.both ? ' is-both' : ''}`} d={l.d} markerEnd="url(#board-arrow)" markerStart={l.both ? 'url(#board-arrow)' : undefined} />)}
        </svg>

        {nodes.filter(shown).map((n) => {
          const s = status[n.key] ?? { state: 'wait', note: '여는 중' }
          const r = rectOf(n), z = size(n), cfg = cfgOf(n), src = srcOf(n)
          const hit = matches.includes(n)
          return (
            <figure key={n.key} className={`board-node is-${s.state}${here === n.key && open ? ' is-here' : ''}${hit ? ' is-match' : ''}${q.trim() && !hit ? ' is-dim' : ''}`} style={{ left: r.x, top: r.y - 34, width: r.w }} onDoubleClick={() => setOpen(n)} onPointerEnter={() => setHot(n.key)} onPointerLeave={() => setHot((h) => (h === n.key ? '' : h))}>
              <figcaption onPointerDown={grabNode(n)} title="끌어서 옮기기 · 두 번 눌러 크게">
                <i className="board-dot" aria-hidden="true" />
                <span className="board-name">{n.name}</span>
                {saved.checks?.[n.key] && <span className="board-tag is-check" title="점검함">✓</span>}
                {changed(n) && <span className="board-tag">바뀜</span>}
                <span className="muted board-state">{s.note}</span>
                <span className="board-tools" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                  <button type="button" className={saved.checks?.[n.key] ? 'is-on' : ''} onClick={() => toggleCheck(n)} aria-label={`${n.name} 점검`} title="점검 ✓">✓</button>
                  <button type="button" onClick={() => setCompare(n)} aria-label={`${n.name} 나란히 비교`} title="나란히 비교">⧉</button>
                  <button type="button" onClick={() => memo(n)} aria-label={`${n.name} 메모`} title="메모">📝</button>
                </span>
              </figcaption>
              <div className="board-screen" style={{ height: r.h }}>
                <iframe key={cfg + src} ref={frameRef(n, cfg + src)} name={cfg} title={n.name} src={src} width={z.W} height={z.H} style={{ transform: `scale(${z.k})` }} tabIndex={-1} />
              </div>
              {saved.notes[n.key] && <p className="board-note" onDoubleClick={(e) => { e.stopPropagation(); memo(n) }}>{saved.notes[n.key]}</p>}
            </figure>
          )
        })}
      </div>

      {/* 작은 지도: 누르면 그곳으로 */}
      <svg className="board-mini" width={worldW * ms} height={worldH * ms} viewBox={`0 0 ${worldW} ${worldH}`} onPointerDown={(e) => {
        e.stopPropagation()
        const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const wx = ((e.clientX - b.left) / b.width) * worldW, wy = ((e.clientY - b.top) / b.height) * worldH
        const k = cam.current.k
        cam.current = { k, x: innerWidth / 2 - wx * k, y: (innerHeight + barH()) / 2 - wy * k }
        paint()
      }}>
        {nodes.filter(shown).map((n) => { const r = rectOf(n); return <rect key={n.key} className={`is-${status[n.key]?.state ?? 'wait'}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={8} /> })}
        <rect ref={miniView} className="board-mini-view" x={0} y={0} width={0} height={0} />
      </svg>

      {open && big && (
        <div className="board-open" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <div className="board-open-bar">
            <b>{byKey.get(here)?.name ?? here}</b>
            <span className="muted small">{here} · {big.name} · 이동하면 보드에 선이 더해져요</span>
            <span className="board-sp" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompare(byKey.get(here) ?? open)}>⧉ 나란히 비교</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => memo(byKey.get(here) ?? open)}>📝 메모</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>닫기 (Esc)</button>
          </div>
          <div className="board-open-stage">
            <iframe ref={bigRef} name={cfgOf(open)} title={`${open.name} 크게`} src={srcOf(open)} style={{ width: devOf(open) === 'pc' ? '100%' : big.W }} />
          </div>
        </div>
      )}

      {compare && (
        <div className="board-open board-compare" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
          <div className="board-open-bar">
            <b>{compare.name}</b>
            <span className="muted small">한 화면을 네 상황으로 나란히 · 지금 고른 다른 설정은 그대로</span>
            <span className="board-sp" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompare(null)}>닫기 (Esc)</button>
          </div>
          <div className="board-compare-grid">
            {COMPARE.map(([label, over]) => {
              const o = { ...opts, ...over } as Opts
              const d = DEV[devOf(compare, o)]
              const paneW = (innerWidth - 64 - 3 * 16) / 4 - 16, paneH = innerHeight - 104 - 24 - 60 - 40
              const k = Math.min(paneW / d.W, paneH / d.H)
              return (
                <figure key={label} className="board-compare-pane">
                  <figcaption>{label}</figcaption>
                  <div className="board-screen" style={{ width: d.W * k, height: d.H * k }}>
                    <iframe name={cfgOf(compare, o)} title={`${compare.name} · ${label}`} src={srcOf(compare, o)} width={d.W} height={d.H} style={{ transform: `scale(${k})`, pointerEvents: 'auto' }} />
                  </div>
                </figure>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
