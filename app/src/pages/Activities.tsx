import { Link } from 'react-router'
import { PLAYBOOKS } from '../content'

/** 10~15분의 짧은 활동: 선 하나 — 누르면 그 틀로 바로 그리기가 열린다 */
export const ONE_LINE: { key: string; title: string; minutes: number; who: string; body: string; how: [string, string, string]; ask: string; tpl: string; art: string }[] = [
  { key: 'today', title: '오늘 하루 한 선', minutes: 10, who: '혼자 · 잠들기 전', body: '아침부터 지금까지를 시간으로 놓고, 마음이 움직인 순간 세 개만 점으로.', how: ['일어난 시각부터 지금까지를 한 줄로 놓아요', '마음이 올라갔거나 내려간 때 세 곳만 점으로', '점마다 한 단어씩 이름을 붙여요'], ask: '오늘 가장 가벼웠던 순간은 언제였나요?', tpl: 'today', art: 'M4 28c8-4 14-18 22-10s12 14 20 2 14-10 22-14' },
  { key: 'week', title: '이번 주 한 선', minutes: 10, who: '혼자 · 모임', body: '월요일부터 오늘까지. 가장 환했던 날과 무거웠던 날 하나씩.', how: ['월요일 아침을 왼쪽 끝에 두어요', '환했던 날 · 무거웠던 날을 먼저 점으로', '남은 날은 떠오르는 만큼만'], ask: '이번 주의 나를 한 단어로 하면?', tpl: 'week', art: 'M4 20c10-14 14 4 24 0s10-14 20-6 12 10 20 4' },
  { key: 'year', title: '올해 한 선', minutes: 15, who: '혼자 · 모임 · 연말', body: '1월부터 이번 달까지. 달마다 떠오르는 순간을 하나씩.', how: ['달마다 떠오르는 일을 하나씩만', '없는 달은 비워 두어도 괜찮아요', '마지막에 ‘지금의 나’ 한 줄'], ask: '올해 내가 조금 달라진 점이 있나요?', tpl: 'year', art: 'M4 24c6-2 8-16 14-14s8 16 14 10 8-14 14-8 8 10 20 2' },
  { key: 'school', title: '이번 학기 한 선', minutes: 15, who: '학급 · 동아리', body: '학기 시작부터 지금까지. 나를 웃게 한 순간을 중심으로.', how: ['개학 날을 왼쪽 끝에', '웃었던 순간부터 점으로, 힘들었던 순간은 적고 싶을 때만', '둘씩 짝지어 한 순간만 이야기해요'], ask: '이번 학기 나를 웃게 한 사람은 누구였나요?', tpl: 'term', art: 'M4 26c8-10 10-2 16-4s8-14 16-8 10 12 18 0 8-6 12-8' },
  { key: 'first', title: '처음 해낸 일 한 선', minutes: 10, who: '초등 · 중학생', body: '0살부터 지금까지, ‘처음 해낸 일’ 만 점으로. 자전거 · 혼자 버스 타기 같은 것.', how: ['처음 해낸 일을 떠오르는 대로 세 개', '몇 살쯤이었는지 대략만', '그때의 기분을 단어 하나로'], ask: '처음 해냈을 때 누가 곁에 있었나요?', tpl: 'firsts', art: 'M4 30c10-2 12-22 20-18s8 14 16 6 12-12 22-16' },
]

/** 선 하나 활동 (/activities): 짧은 활동 다섯 + 모임 진행안 다섯 — 각각 바로 그리기 틀을 연다 */
export default function Activities() {
  return (
    <section className="container page activities-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">ONE LINE ACTIVITIES</p>
          <h1 className="page-title">선 하나 활동</h1>
          <p className="muted">10~15분이면 되는 짧은 활동이에요. 누르면 그 틀로 바로 그리기가 열리고, 모임에서는 ‘이 모임에서 그리기’ 로 같은 틀을 함께 써요.</p>
        </div>
      </header>

      <ul className="activity-grid">
        {ONE_LINE.map((a) => (
          <li key={a.key} className="card activity-card">
            <svg className="activity-art" viewBox="0 0 72 36" aria-hidden="true"><path d={a.art} pathLength={1} /></svg>
            <h2 className="card-title">{a.title}</h2>
            <p className="muted">{a.body}</p>
            <p className="activity-meta muted small">{a.minutes}분 · {a.who}</p>
            <Link to={`/graph/new?tpl=${a.tpl}`} className="btn btn-primary btn-sm">이 틀로 그리기</Link>
            <details className="activity-more">
              <summary>자세히</summary>
              <ol className="activity-how">{a.how.map((h) => <li key={h}>{h}</li>)}</ol>
              <p className="activity-ask serif">“{a.ask}”</p>
            </details>
          </li>
        ))}
      </ul>

      <section className="activity-group">
        <div className="activity-group-head">
          <div>
            <p className="eyebrow en">FOR GROUPS</p>
            <h2 className="section-title">모임 진행안 <small className="muted">45~50분</small></h2>
            <p className="muted">모임장이 큰 화면에 띄우고 단계마다 넘겨요. 모임 화면 ‘진행안 모음’ 에서 그대로 쓸 수 있어요.</p>
          </div>
          <Link to="/share" className="btn btn-ghost btn-sm">모임 만들기 ›</Link>
        </div>
        <ul className="activity-grid is-playbooks">
          {PLAYBOOKS.map((p) => (
            <li key={p.key} className="card activity-card">
              <h2 className="card-title">{p.title}</h2>
              <p className="muted">{p.topic}</p>
              <p className="activity-meta muted small">{p.minutes}분 · {p.who}</p>
              <details className="activity-more">
                <summary>진행 순서 {p.steps.length}단계</summary>
                <ol className="activity-how">{p.steps.map((st) => <li key={st}>{st}</li>)}</ol>
                <p className="activity-ask serif">{p.tip}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <p className="muted small center activity-foot"><Link to="/guide">진행자 안내서 ›</Link> · <Link to="/worksheet">종이 활동지 ›</Link> · <Link to="/welcome">1분 투어 ›</Link></p>
    </section>
  )
}
