import { Link } from 'react-router'
import LifeGraph from '../components/LifeGraph'
import { scoreWord, signed, timeLabel } from '../content'
import { graphPoints, newGraph, sortEntries } from '../store'
import type { LifeGraph as Graph } from '../types'
import { LineStory } from './GraphResult'

/** 처음 온 사람이 직접 쓰기 전에 둘러보는 예시. 실제 누군가의 기록이 아니다. 저장하지 않는다. */
const moment = (id: string, timePoint: number, emotionScore: number, title: string, emotionLabel: string, description: string, toPast = '') => ({
  id, title, timePoint, emotionScore, emotionLabel, description, showOnGraph: true,
  reflection: { feeling: '', why: '', now: '', toPast, fromPast: '' },
})
const SAMPLE: Graph = {
  ...newGraph(),
  id: 'example',
  title: '봄이의 열여섯 해',
  completed: true,
  currentPoint: 16,
  entries: [
    moment('e1', 5, 3, '동생이 태어난 날', '설렘', '병원 복도에서 한참 기다렸다'),
    moment('e2', 8, -2, '전학 온 봄', '외로움', '아는 사람이 하나도 없었다', '괜찮아, 금방 친구가 생겨.'),
    moment('e3', 10, 2, '먼저 말 걸어 준 친구', '고마움', '그 애 덕분에 학교가 좋아졌다'),
    moment('e4', 13, -3, '진로를 고민했던 시간', '불안함', '뭘 좋아하는지 몰랐다', '몰라도 괜찮았어. 지금도 찾는 중이야.'),
    moment('e5', 15, 4, '처음 무대에 선 날', '뿌듯함', '떨렸지만 끝까지 했다'),
  ],
  currentReflection: { changed: '', word: '자라는 중', influence: '', message: '', oneLine: '나는 천천히, 나만의 속도로 자라고 있다.' },
}

export default function Example() {
  const g = SAMPLE
  return (
    <article className="container page result">
      <p className="demo-note">예시예요 · 실제 누군가의 기록이 아니라 그려봄이 만든 이야기예요.</p>
      <header className="result-head">
        <p className="eyebrow en">EXAMPLE</p>
        <h1 className="page-title">{g.title}</h1>
        <p className="muted">0살부터 지금까지 · 다섯 개의 순간</p>
      </header>

      <section className="card graph-card">
        <LifeGraph points={graphPoints(g)} timeScale={g.timeScale} start={g.startPoint} end={g.currentPoint} />
        <p className="hint center">점을 눌러 보세요. 그때의 이야기가 나와요.</p>
      </section>

      <LineStory graph={g} />

      <section className="now-card">
        <p className="eyebrow en">ME, NOW</p>
        <blockquote className="serif">{g.currentReflection.oneLine}</blockquote>
      </section>

      <section className="section-tight">
        <h2 className="section-title">이런 순간들을 적었어요</h2>
        <ol className="moment-list">
          {sortEntries(g.entries).map((e) => (
            <li key={e.id} className="card moment">
              <div className="moment-head">
                <span className="entry-time">{timeLabel(g.timeScale, e.timePoint)}</span>
                <span className="muted small">마음 {signed(e.emotionScore)} · {scoreWord(e.emotionScore)}</span>
              </div>
              <h3>{e.title}</h3>
              <span className="chip chip-static">{e.emotionLabel}</span>
              <p>{e.description}</p>
              {e.reflection.toPast && <p className="serif example-letter">“{e.reflection.toPast}”</p>}
            </li>
          ))}
        </ol>
      </section>

      <aside className="card soft-card center">
        <p className="serif big">이제 나의 선을 그려볼까요?</p>
        <p className="muted small">정답은 없어요. 떠오르는 순간 하나면 시작할 수 있어요.</p>
        <Link to="/graph/new" className="btn btn-primary">나의 그래프 그리기</Link>
      </aside>
    </article>
  )
}
