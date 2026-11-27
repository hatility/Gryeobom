import { Link } from 'react-router'
import { useAuth } from '../auth'

/** 처음 온 사람의 1분 투어 (/welcome): 첫 화면의 ‘세 걸음’ 과 같은 세 걸음을 한 화면에, 바로 시작할 수 있게 */
const STOPS: { title: string; body: string }[] = [
  { title: '나의 시간을 돌아봐요', body: '나이로 · 연도로 · 달로 돌아볼 시간의 길이를 정해요. 대략이면 충분해요.' },
  { title: '경험을 하나씩 기록해요', body: '빈 곳을 눌러 기억에 남는 순간을 점으로 남기고, 이름을 붙여요. 높고 낮음은 그때의 마음일 뿐이에요.' },
  { title: '지금의 나를 발견해요', body: '점마다 그때의 마음을 짧게 돌아보고, 이어진 선 끝에서 지금의 나에게 한 줄을 남겨요.' },
]

export default function Welcome() {
  const { user } = useAuth()
  return (
    <section className="container page welcome">
      <header className="page-head">
        <div>
          <p className="eyebrow en">FIRST STEPS</p>
          <h1 className="page-title">{user ? `${user.nickname}님, 반가워요` : '그려봄이 처음이라면'}</h1>
          <p className="muted">1분이면 충분해요. 세 걸음으로 선 하나를 그려요.</p>
        </div>
      </header>
      <ol className="welcome-stops">
        {STOPS.map((s, i) => (
          <li key={s.title} className="card welcome-stop">
            <span className="welcome-num" aria-hidden="true">{i + 1}</span>
            <h2 className="card-title">{s.title}</h2>
            <p className="muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="welcome-actions">
        <Link to="/graph/new" className="btn btn-primary btn-lg">나의 그래프 그리기</Link>
        <Link to="/example" className="btn btn-ghost btn-lg">예시 먼저 보기</Link>
      </div>
      <p className="muted small center">다 그리면 이미지 · PDF 로 간직하고, 원하면 <Link to="/share">모임이나 링크로 나눌 수</Link> 있어요. 기본은 나만 보기.</p>
      <p className="muted small center">로그인 없이도 이 기기에서 그릴 수 있어요. 다른 기기에서 이어 그리려면 <Link to="/login">로그인</Link>.</p>
    </section>
  )
}
