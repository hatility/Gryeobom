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
          <p className="eyebrow">CREDITS</p>
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
        <div role="tabpanel" id="panel-team" aria-labelledby="tab-team" className="tab-panel">
          <div className="card team-card">
            <p className="eyebrow">MADE BY</p>
            <p className="serif team-name">{dev?.name || '그려봄 만든 사람들'}</p>
            {dev?.org && <p className="muted">{dev.org}</p>}
            <dl className="team-facts">
              <div>
                <dt>운영</dt>
                <dd>하남시청소년수련관 Team HATILITY</dd>
              </div>
              <div>
                <dt>기획 · 개발</dt>
                <dd>윤예성 · 이명균</dd>
              </div>
              <div>
                <dt>무엇을</dt>
                <dd>9~24세 청소년을 위한 자기이해 · 감정 회고 인생 그래프</dd>
              </div>
              <div>
                <dt>버전</dt>
                <dd>v{__APP_VERSION__}</dd>
              </div>
              <div>
                <dt>라이선스</dt>
                <dd>GNU AGPL-3.0 · 저작권자 예외 있음</dd>
              </div>
              {dev?.contact && (
                <div>
                  <dt>연락</dt>
                  <dd>
                    <a href={dev.contact.includes('@') && !dev.contact.startsWith('http') ? `mailto:${dev.contact}` : dev.contact} target="_blank" rel="noreferrer">
                      {dev.contact}
                    </a>
                  </dd>
                </div>
              )}
              {dev?.url && (
                <div>
                  <dt>저장소</dt>
                  <dd>
                    <a href={dev.url} target="_blank" rel="noreferrer">{dev.url.replace(/^https?:\/\//, '')}</a>
                  </dd>
                </div>
              )}
            </dl>
            <p className="serif team-note">모든 사람의 선은 서로 달라요. 그 선을 함께 그려 주셔서 고마워요.</p>
          </div>
        </div>
      )}
    </section>
  )
}

function LicenseIntro() {
  return (
    <div className="card license-intro">
      <p className="eyebrow">LICENSE</p>
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
