import { useState } from 'react'
import { Link } from 'react-router'
import { NOW_QUESTIONS, QUESTION_SETS } from '../content'
import { useLabs } from '../labs'

/**
 * 실험: 종이 활동지 (A4). 기기 없이 교실에서 먼저 그려 보고, 나중에 그려봄에 옮겨 적는다.
 * 빈 그래프 칸 · 순간 표 · 그때의 마음 질문 · 지금의 나 질문.
 */
export default function Worksheet() {
  const labs = useLabs('group')
  const [set, setSet] = useState<keyof typeof QUESTION_SETS>('basic')
  const [rows, setRows] = useState(6)
  const [title, setTitle] = useState('나의 인생 그래프')
  const [scale, setScale] = useState<'age' | 'year'>('age')
  if (!labs) {
    return (
      <section className="container page empty-state">
        <h1>준비 중인 기능이에요</h1>
        <Link to="/" className="btn btn-primary">처음으로</Link>
      </section>
    )
  }
  const qs = QUESTION_SETS[set].questions
  return (
    <section className="container page worksheet-page">
      <div className="worksheet-options no-print card">
        <h1 className="page-title">종이 활동지</h1>
        <p className="muted">기기 없이 교실에서 먼저 그려 보고, 나중에 그려봄에 옮겨 적을 수 있어요. A4 한두 장으로 인쇄돼요.</p>
        <div className="field-row">
          <label className="field">
            <span className="field-label">활동지 제목</span>
            <input value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">질문 묶음</span>
            <select value={set} onChange={(e) => setSet(e.target.value as keyof typeof QUESTION_SETS)}>
              {Object.entries(QUESTION_SETS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">시간 기준</span>
            <select value={scale} onChange={(e) => setScale(e.target.value as 'age' | 'year')}>
              <option value="age">나이</option>
              <option value="year">연도</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">순간 칸</span>
            <select value={rows} onChange={(e) => setRows(Number(e.target.value))}>
              {[4, 6, 8, 10].map((n) => <option key={n} value={n}>{n}개</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>인쇄 · PDF로 저장</button>
      </div>

      <article className="worksheet">
        <header className="ws-head">
          <p className="ws-brand">그려봄 활동지</p>
          <h2>{title}</h2>
          <p className="ws-meta"><span>이름(별명) ______________</span><span>날짜 ______________</span></p>
        </header>

        <h3>1. 나의 선 그리기</h3>
        <p className="ws-hint">기억에 남는 순간을 점으로 찍고, 선으로 이어 봐요. 위는 환했던 마음, 아래는 무거웠던 마음이에요.</p>
        <svg className="ws-graph" viewBox="0 0 700 300" aria-hidden="true">
          {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((s) => (
            <g key={s}>
              <line x1="50" x2="690" y1={150 - s * 25} y2={150 - s * 25} className={s === 0 ? 'ws-zero' : 'ws-grid'} />
              {s % 5 === 0 && <text x="40" y={154 - s * 25} textAnchor="end">{s > 0 ? `+${s}` : s}</text>}
            </g>
          ))}
          {Array.from({ length: 11 }, (_, i) => <line key={i} x1={50 + i * 64} x2={50 + i * 64} y1="25" y2="275" className="ws-grid" />)}
          <text x="50" y="295">{scale === 'age' ? '그때 (   살)' : '그때 (     년)'}</text>
          <text x="690" y="295" textAnchor="end">지금</text>
        </svg>

        <h3>2. 기억에 남는 순간</h3>
        <table className="ws-table">
          <thead><tr><th style={{ width: '18%' }}>{scale === 'age' ? '몇 살' : '몇 년'}</th><th>어떤 순간이었나요?</th><th style={{ width: '16%' }}>마음 (-5 ~ +5)</th><th style={{ width: '18%' }}>그때의 감정</th></tr></thead>
          <tbody>{Array.from({ length: rows }, (_, i) => <tr key={i}><td /><td /><td /><td /></tr>)}</tbody>
        </table>

        <h3>3. 그때의 마음 <small>· 가장 기억에 남는 순간 하나를 골라요</small></h3>
        {qs.map((q) => (
          <div key={q.key} className="ws-q"><p>{q.q}</p><div className="ws-lines"><i /><i /></div></div>
        ))}

        <h3>4. 지금의 나</h3>
        {NOW_QUESTIONS.map((q) => (
          <div key={q.key} className="ws-q"><p>{q.q}</p><div className="ws-lines"><i />{!q.short && <i />}</div></div>
        ))}
        <p className="ws-foot">모든 사람의 선은 서로 달라요. 나만의 속도로 그려도 괜찮아요. · 그려봄</p>
      </article>
    </section>
  )
}
