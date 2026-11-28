import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router'
import { siteConfig, type Developer } from '../api'

const TABS = [
  ['oss', '오픈소스'],
  ['team', '만든 사람'],
] as const
type Tab = (typeof TABS)[number][0]

export default function Credits() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'oss'
  const [dev, setDev] = useState<Developer | null | undefined>(undefined)
  const [lic, setLic] = useState<Licenses | null | undefined>(undefined)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    siteConfig().then((c) => setDev(c.developer))
  }, [])

  // 고지문은 빌드 때 만들어진다 (scripts/licenses.mjs). 오픈소스 탭을 열 때 한 번만 불러온다
  useEffect(() => {
    if (tab !== 'oss' || lic !== undefined) return
    fetch('/licenses.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => setLic(v && Array.isArray(v.groups) ? v : null))
      .catch(() => setLic(null))
  }, [tab, lic])

  const choose = (t: Tab) => setParams(t === 'oss' ? {} : { tab: t }, { replace: true })
  // 탭 키보드: ← → 로 옮기기
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
    choose(TABS[next][0])
    tabRefs.current[next]?.focus()
  }

  return (
    <section className="container page credits">
      <header className="page-head">
        <div>
          <p className="eyebrow en">CREDITS</p>
          <h1 className="page-title">그려봄을 함께 만든 것들</h1>
          <p className="muted">고마운 도구와 사람들을 남겨 둬요.</p>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="크레딧">
        {TABS.map(([key, label], i) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className="tab-btn"
            onClick={() => choose(key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'oss' ? (
        <div role="tabpanel" id="panel-oss" aria-labelledby="tab-oss" className="tab-panel">
          <LicenseIntro />
          <OssGroups lic={lic} />
          <p className="muted small center">
            <a href="/licenses.txt" target="_blank" rel="noreferrer">모든 전문을 한 파일로 보기</a>
            <br />
            좋은 도구를 나눠 주신 분들께 고마워요.
          </p>
        </div>
      ) : (
        <div role="tabpanel" id="panel-team" aria-labelledby="tab-team" className="tab-panel team">
          {/* 인사말: 종이 한 장에 마스킹테이프 */}
          <div className="card team-hero">
            <p className="eyebrow en">MADE BY</p>
            <p className="serif team-hello">
              <span className="line">{dev?.name || '하남시청소년수련관 Team HATILITY'} 가</span> <span className="line">마음을 담아 만들었어요.</span>
            </p>
            <p className="muted">{dev?.org || '9~24세 청소년을 위한 자기이해 · 감정 회고 인생 그래프'}</p>
          </div>

          {/* 역할: 폴라로이드 석 장 */}
          <ul className="team-people">
            <li className="card team-person">
              <span className="team-ic" aria-hidden="true"><Ic d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></span>
              <p className="team-role">운영</p>
              <p className="serif team-who">하남시청소년수련관<br />Team HATILITY</p>
              <p className="muted small">청소년과 함께 쓰며 다듬어요</p>
            </li>
            <li className="card team-person">
              <span className="team-ic" aria-hidden="true"><Ic d="M4 20l4-1 11-11-3-3L5 16zM13 7l3 3" /></span>
              <p className="team-role">기획 · 개발</p>
              <p className="serif team-who">윤예성 · 이명균</p>
              <p className="muted small">그림부터 코드까지 손으로 지었어요</p>
            </li>
            <li className="card team-person">
              <span className="team-ic" aria-hidden="true"><Ic d="M3 17c3 0 4-8 7-8s3 6 6 6 3-5 5-5" /><Ic d="M21 10a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z" fill /></span>
              <p className="team-role">무엇을</p>
              <p className="serif team-who">지나온 나를 그리고,<br />지금의 나를 만나는 선</p>
              <p className="muted small">평가하지 않고, 마음은 내 것으로</p>
            </li>
            <li className="card team-person team-ai">
              <span className="team-ic" aria-hidden="true"><Ic d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" /><Ic d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill /></span>
              <p className="team-role">함께한 도구</p>
              <p className="serif team-who">AI 와 짝을 지어<br />만들었어요</p>
              <p className="muted small">Claude(Anthropic) 와 함께 화면 · 코드 · 글을 다듬었어요. 무엇을 만들지와 그 책임은 사람이 정했어요.</p>
            </li>
          </ul>

          {/* 발자취: 버전을 선 위의 점으로 — 선은 점들을 정확히 지나도록 점에서 계산해 그린다 */}
          <div className="card team-path">
            <p className="eyebrow">지나온 길</p>
            {(() => {
              const pts: [number, number, string, string][] = [[20, 92, '0.1.0', '첫 화면 하나'], [230, 46, '1.0.0', '첫 정식'], [340, 90, '1.1.0', '휴대폰 · 모임 · 동아리'], [450, 58, '1.2.0', '감성 일기장 틀'], [580, 30, `${__APP_VERSION__}`, '지금']]
              // 점을 모두 지나는 부드러운 선 (Catmull-Rom → 베지어)
              const d = pts.map(([x, y], i) => {
                if (i === 0) return `M${x} ${y}`
                const [x0, y0] = pts[i - 2] ?? pts[i - 1], [x1, y1] = pts[i - 1], [x3, y3] = pts[i + 1] ?? pts[i]
                return `C ${x1 + (x - x0) / 6} ${y1 + (y - y0) / 6}, ${x - (x3 - x1) / 6} ${y - (y3 - y1) / 6}, ${x} ${y}`
              }).join(' ')
              return (
                <svg viewBox="0 0 600 136" role="img" aria-label="0.1.0 부터 지금 버전까지 이어진 선">
                  <path d={d} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" />
                  {pts.map(([x, y, v, t], i) => {
                    const last = i === pts.length - 1
                    // 골짜기(양옆보다 낮은 점)는 글자를 모두 아래에 — 선과 겹치지 않게
                    const valley = i > 0 && !last && y > pts[i - 1][1] && y > pts[i + 1][1]
                    const anchor = i === 0 ? 'start' : last ? 'end' : 'middle'
                    return (
                      <g key={v} className={last ? 'is-now' : ''}>
                        <circle cx={x} cy={y} r={last ? 8 : 6} />
                        <text x={x} y={valley ? y + 24 : y - 16} textAnchor={anchor} className="v">{v}</text>
                        <text x={x} y={valley ? y + 40 : y + 26} textAnchor={anchor} className="t">{t}</text>
                      </g>
                    )
                  })}
                </svg>
              )
            })()}
          </div>

          {/* 정보: 도장 모양 칩 */}
          <ul className="team-stamps">
            <li><span className="team-stamp"><Ic d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" /><b>v{__APP_VERSION__}</b><small>지금 버전</small></span></li>
            <li><span className="team-stamp"><Ic d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><b>AGPL-3.0</b><small>누구나 쓰고 고쳐요</small></span></li>
            <li><span className="team-stamp"><Ic d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" /><b>AI 와 함께</b><small>사람이 정하고, AI 가 거들었어요</small></span></li>
            {dev?.url && (
              <li><a className="team-stamp" href={dev.url} target="_blank" rel="noreferrer"><Ic d="M9 18l-5-6 5-6M15 6l5 6-5 6" /><b>저장소</b><small>{dev.url.replace(/^https?:\/\/(www\.)?/, '')}</small></a></li>
            )}
            {dev?.contact && (
              <li><a className="team-stamp" href={dev.contact.includes('@') && !dev.contact.startsWith('http') ? `mailto:${dev.contact}` : dev.contact} target="_blank" rel="noreferrer"><Ic d="M3 6h18v12H3zM3 7l9 6 9-6" /><b>연락</b><small>{dev.contact}</small></a></li>
            )}
          </ul>

          {/* 맺음: 노란 쪽지 */}
          <p className="team-note serif">
            모든 사람의 선은 서로 달라요.<br />그 선을 함께 그려 주셔서 고마워요.
          </p>
        </div>
      )}
    </section>
  )
}

/** 선으로 그린 작은 아이콘 (화면 다른 곳과 같은 굵기 · 둥근 끝) */
function Ic({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LicenseIntro() {
  return (
    <div className="card license-intro">
      <p className="eyebrow en">LICENSE</p>
      <p className="serif team-name">
        <span className="line">그려봄은</span> <span className="line">GNU AGPL-3.0 이에요</span>
      </p>
      <p className="muted">누구나 쓰고, 고치고, 나눌 수 있어요. 고쳐서 서비스로 운영한다면 이용하는 사람도 그 소스를 볼 수 있어야 해요.</p>
      <p className="muted small">저작권자(하남시청소년수련관 · 하남시청소년수련관 Team HATILITY · 윤예성 · 이명균)에게는 이 의무가 적용되지 않아요.</p>
    </div>
  )
}

type OssItem = { name: string; version: string; license: string; by?: string; url?: string; text?: string; refs?: string[]; note?: string }
type Licenses = { groups: { id: string; title: string; note: string; items: OssItem[] }[]; texts: Record<string, string> }

/** 원문은 80자마다 줄을 끊어 두어서, 문단 안의 줄바꿈만 풀어 화면 폭에 맞게 흐르게 한다 (저작권 줄은 줄마다 유지) */
const flow = (t: string) => t.replace(/([^\n])\n(?!\n|Copyright|\s*[-*•]|\s*\d+\.)/g, '$1 ')

/**
 * 쓰고 있는 모든 오픈소스: 화면 · 서버 · 글꼴 · 만들 때 쓴 도구 · Docker 이미지 속 패키지.
 * 빌드 때 scripts/licenses.mjs 가 원문과 라이선스 표기가 맞는지 확인한 것만 실린다. 눌러서 전문을 펼친다.
 */
function OssGroups({ lic }: { lic: Licenses | null | undefined }) {
  if (lic === undefined) return <p className="muted">천천히 불러오는 중이에요…</p>
  if (!lic) {
    return (
      <p className="muted">
        고지문을 불러오지 못했어요. <a href="/licenses.txt" target="_blank" rel="noreferrer">원문 파일</a>로 볼 수 있어요.
      </p>
    )
  }
  const total = lic.groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <>
      <p className="muted small">모두 {total}개 · 이름을 누르면 라이선스 전문이 펼쳐져요. 원문과 라이선스 표기가 맞는지 빌드할 때마다 확인해요.</p>
      {lic.groups.map((g) => (
        <section key={g.id} className="oss-group">
          <h2 className="card-title">
            {g.title} <small className="muted">{g.items.length}</small>
          </h2>
          <p className="muted small">{g.note}</p>
          <div className="card license-list">
            {g.items.map((it) => (
              <details key={`${it.name}@${it.version}`} className="license-item">
                <summary>
                  <span className="oss-name">
                    {it.name} <small className="muted">{it.version}</small>
                    {it.by && <small className="oss-by muted"> · {it.by}</small>}
                  </span>
                  <span className="badge oss-license">{it.license}</span>
                </summary>
                {it.url && (
                  <p className="small license-link">
                    <a href={it.url} target="_blank" rel="noreferrer">{it.url.replace(/^https?:\/\//, '')}</a>
                  </p>
                )}
                {it.note && <p className="muted small">{it.note}</p>}
                {it.text ? (
                  <p className="license-text">{flow(it.text)}</p>
                ) : (
                  it.refs?.map((r) => (
                    <div key={r}>
                      <p className="field-label">{r}</p>
                      <p className="license-text">{flow(lic.texts[r] ?? '')}</p>
                    </div>
                  ))
                )}
              </details>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
