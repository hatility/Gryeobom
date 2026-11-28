import { useEffect } from 'react'

/**
 * 검색 노출 (1.3.0): 공개 화면마다 제목 · 설명 · 대표 주소(canonical)를 정하고, 나머지(개인 기록 · 모임 · 관리자)는 noindex.
 * 같은 목록을 서버의 sitemap.xml 과 빌드 때 미리 그리는 화면(scripts/prerender.mjs)이 함께 쓴다.
 */
export const PAGE_META: Record<string, { title: string; desc: string }> = {
  '/': { title: '그려봄 · 인생 그래프로 지나온 나를 그리고, 지금의 나를 만나다', desc: '청소년 자기이해 · 감정 회고 프로그램 그려봄. 기억에 남는 순간을 점으로 찍고 선으로 이어 지금의 나를 천천히 바라봐요. 수업 · 상담 · 모임에서 바로 쓸 수 있어요.' },
  '/welcome': { title: '1분 투어 · 그려봄 처음 시작하기', desc: '세 걸음으로 인생 그래프 하나를 그려요. 나의 시간을 돌아보고, 경험을 하나씩 기록하고, 지금의 나를 발견해요.' },
  '/activities': { title: '선 하나 활동 · 10분 인생 그래프 활동 모음', desc: '오늘 하루 · 이번 주 · 올해 · 이번 학기 · 처음 해낸 일 — 10~15분 짧은 자기이해 활동 다섯과 45~50분 모임 진행안 다섯.' },
  '/guide': { title: '진행자 안내서 · 교사 · 모임장을 위한 인생 그래프 수업 진행법', desc: '준비 체크, 50분 흐름, 그리기의 네 단계, 쓰는 말과 쓰지 않는 말, 위기 신호 대응, 자주 묻는 질문까지 한 장에.' },
  '/example': { title: '예시 그래프 · 인생 그래프는 이렇게 그려요', desc: '봄이의 열여섯 해 — 순간과 마음 높이, 지금의 나까지 완성된 인생 그래프 예시를 먼저 둘러봐요.' },
  '/share': { title: '함께 나누기 · 모임에서 인생 그래프 나누고 응원하기', desc: '참여 코드로 모임에 들어가 서로의 선을 판단 없이 바라보고 정해진 말로 응원해요. 학급 · 상담 모임 · 친구끼리.' },
  '/credits': { title: '만든 사람 · 오픈소스 · 그려봄', desc: '하남시청소년수련관 Team HATILITY 가 만든 그려봄의 만든 사람, 오픈소스 고지, 지나온 길.' },
  '/terms': { title: '이용약관 · 그려봄', desc: '그려봄 서비스 이용약관.' },
  '/privacy': { title: '개인정보 처리방침 · 그려봄', desc: '그려봄이 처리하는 개인정보와 목적, 보유 기간, 안전하게 지키기 위한 조치.' },
  '/contact': { title: '문의하기 · 그려봄', desc: '그려봄 이용 · 기관 도입 · 개인정보 요청 문의.' },
  '/worksheet': { title: '종이 활동지 · 인생 그래프 A4 활동지 인쇄', desc: '기기 없이 교실에서 먼저 그려 보는 인생 그래프 종이 활동지(A4). 나중에 그려봄에 옮겨 적어요.' },
}
/** 검색에 내보낼 공개 화면 (사이트맵 · 미리 그리기 순서) */
export const PUBLIC_PAGES = Object.keys(PAGE_META)

const setMeta = (sel: string, make: () => HTMLElement, value: string | null) => {
  let el = document.head.querySelector<HTMLElement>(sel)
  if (value === null) { el?.remove(); return }
  if (!el) { el = make(); document.head.appendChild(el) }
  if (el instanceof HTMLMetaElement) el.content = value
  else if (el instanceof HTMLLinkElement) el.href = value
}
const meta = (name: string) => { const m = document.createElement('meta'); m.name = name; return m }
const prop = (p: string) => { const m = document.createElement('meta'); m.setAttribute('property', p); return m }

/** 주소가 바뀔 때마다 제목 · 설명 · canonical · robots 를 맞춘다 (휴대폰 틀 /m 도 같은 화면으로 본다) */
export function useRouteMeta(pathname: string) {
  useEffect(() => {
    const p = (pathname.replace(/^\/m(?=\/|$)/, '') || '/').replace(/(.)\/$/, '$1')
    const m = PAGE_META[p]
    const title = m?.title ?? '그려봄'
    if (!document.title.replace(/^\[개발\] /, '').replace(/^\(\d+\) /, '').startsWith(title)) document.title = title
    const desc = m?.desc ?? PAGE_META['/'].desc
    setMeta('meta[name="description"]', () => meta('description'), desc)
    setMeta('meta[property="og:title"]', () => prop('og:title'), title)
    setMeta('meta[property="og:description"]', () => prop('og:description'), desc)
    setMeta('link[rel="canonical"]', () => { const l = document.createElement('link'); l.rel = 'canonical'; return l }, m ? `${location.origin}${p === '/' ? '/' : p}` : null)
    setMeta('meta[name="robots"]', () => meta('robots'), m ? null : 'noindex, nofollow')
  }, [pathname])
}
