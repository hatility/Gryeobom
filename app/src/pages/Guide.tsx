import { Link } from 'react-router'
import { HELPLINE, PLAYBOOKS, STEPS } from '../content'

const TIMELINE: [string, string, string][] = [
  ['0~5분', '인사 · 오늘 할 일', '“점수도 순위도 없어요. 높낮이는 그때의 마음이에요.”'],
  ['5~10분', '예시 보기', '예시 그래프를 큰 화면에 띄우고 점 하나를 눌러 보여 줘요.'],
  ['10~25분', '각자 그리기', '순간 세 개만. 다 못 그려도 괜찮다고 미리 말해요.'],
  ['25~35분', '둘씩 이야기', '한 순간만 골라 짝에게. 듣는 사람은 평가 없이 “그랬구나”.'],
  ['35~45분', '나누기 · 응원', '원하는 사람만 모임에 나누고, 정해진 말로 응원해요.'],
  ['45~50분', '마무리', '‘오늘의 한 줄’ 한 문장으로 끝내요.'],
]
const FAQ: [string, string][] = [
  ['그리기 싫어하는 아이가 있어요', '점 하나만 찍어도 괜찮다고 해 주세요. 종이 활동지를 주거나, 친구 옆에서 보기만 해도 돼요.'],
  ['힘든 이야기를 적으면 어떻게 하나요', '그 자리에서 묻지 말고 활동이 끝난 뒤 조용히 “적어 줘서 고마워요”부터. 위기 신호가 보이면 6번을 따라 주세요.'],
  ['다른 아이의 그래프를 놀려요', '“선은 서로 달라요. 높낮이는 잘함이 아니에요.” 를 처음에 약속으로 정해 두면 줄어요. 반복되면 모임장이 그 그래프를 내릴 수 있어요.'],
  ['기기가 모자라요', '둘이 한 기기로 번갈아 쓰거나, 종이 활동지에 먼저 그리고 나중에 옮겨 적어요.'],
  ['기록은 누가 볼 수 있나요', '기본은 나만 보기. 모임에 나눈 선만 모임 사람에게 보이고, ‘그때의 마음’ 은 어디에도 나가지 않아요. 기관 담당자는 통계만 봐요.'],
]
const CHECK = ['모임 만들고 ‘시간 정하기’ 로 함께 그릴 기간 정했어요', '참여 코드 · QR 을 큰 화면에 띄울 준비 (또는 종이 활동지 인쇄)', '‘함께 그릴 주제’ 한 줄 정했어요', '예시 그래프를 한 번 열어 봤어요', '상담 안내 번호를 알고 있어요 (1388)']

/** 진행자 안내서 (/guide): 모임장 · 선생님이 처음 진행할 때 읽는 한 장 — 인쇄해도 두 장 안쪽 */
export default function Guide() {
  return (
    <article className="container page guide-page">
      <header className="page-head">
        <div>
          <p className="eyebrow en">FACILITATOR GUIDE</p>
          <h1 className="page-title">진행자 안내서</h1>
          <p className="muted">모임장 · 선생님이 그려봄을 처음 진행할 때 읽는 한 장이에요. 인쇄해서 옆에 두어도 좋아요.</p>
        </div>
        <button type="button" className="btn btn-ghost no-print" onClick={() => window.print()}>인쇄 · PDF로 저장</button>
      </header>

      <nav className="guide-toc no-print" aria-label="안내서 차례">
        {['하는 일 · 안 하는 일', '준비 체크', '50분 흐름', '네 단계', '쓰는 말', '위기 신호', '자주 묻는 질문', '진행안 · 활동'].map((t, i) => <a key={t} href={`#g${i + 1}`}>{i + 1}. {t}</a>)}
      </nav>

      <section id="g1" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">1</span>그려봄이 하는 일, 하지 않는 일</h2>
        <div className="guide-two">
          <div><p className="eyebrow">하는 일</p><ul className="guide-list"><li>지나온 순간을 점으로 찍고 선으로 이어, 지금의 나를 천천히 바라봐요.</li><li>원하는 사람만 모임에 나누고, 정해진 말로만 응원해요.</li><li>기본은 나만 보기. ‘그때의 마음’ 은 어디에도 나가지 않아요.</li></ul></div>
          <div><p className="eyebrow">하지 않는 일</p><ul className="guide-list"><li>점수 · 순위 · 비교가 없어요. 높낮이는 ‘잘함’ 이 아니라 그때의 마음이에요.</li><li>상담 · 검사 · 진단이 아니에요. 도움이 필요해 보이면 6번을 따라요.</li><li>그리기를 강요하지 않아요. 점 하나도 괜찮아요.</li></ul></div>
        </div>
      </section>

      <section id="g2" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">2</span>준비 체크 <small className="muted">5분</small></h2>
        <ul className="guide-check">
          {CHECK.map((c) => <li key={c}><label><input type="checkbox" /> <span>{c}</span></label></li>)}
        </ul>
        <p className="muted small">모임은 <Link to="/share">함께 나누기</Link>에서, 활동지는 <Link to="/worksheet">종이 활동지</Link>에서, 큰 화면은 모임 화면의 ‘큰 화면으로 진행하기’ · ‘함께 그리기’ 로 열어요.</p>
      </section>

      <section id="g3" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">3</span>50분 흐름 <small className="muted">예시</small></h2>
        <ol className="guide-timeline">
          {TIMELINE.map(([t, title, body]) => <li key={t}><time>{t}</time><div><strong>{title}</strong><span className="muted">{body}</span></div></li>)}
        </ol>
        <p className="muted small">시간이 짧으면 10~25분 ‘각자 그리기’ 만으로도 한 회가 돼요. <Link to="/activities">선 하나 활동</Link>의 10분 틀을 써 보세요.</p>
      </section>

      <section id="g4" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">4</span>그리기의 네 단계</h2>
        <ol className="guide-steps">
          {STEPS.map((s) => <li key={s.name}><strong>{s.name}</strong><span className="muted">{s.whisper}</span></li>)}
        </ol>
        <p className="muted small">처음엔 ‘순간 세 개만’. 마음 높이를 정확히 정하지 않아도 된다고 꼭 말해 주세요.</p>
      </section>

      <section id="g5" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">5</span>진행자가 쓰는 말 · 쓰지 않는 말</h2>
        <div className="guide-two">
          <div><p className="eyebrow">이렇게</p><ul className="guide-say"><li>“그때 어떤 마음이었어요?”</li><li>“이야기해 줘서 고마워요.”</li><li>“적고 싶은 만큼만 적어도 돼요.”</li><li>“그랬구나.” (듣고 끝내기)</li></ul></div>
          <div><p className="eyebrow">이렇게는 말고</p><ul className="guide-say is-no"><li>“왜 그렇게 낮아요?” <small>평가</small></li><li>“○○는 더 높던데.” <small>비교</small></li><li>“꼭 나눠야 해요.” <small>강요</small></li><li>“그건 별일 아니네.” <small>축소</small></li></ul></div>
        </div>
      </section>

      <section id="g6" className="card guide-sec guide-danger">
        <h2 className="card-title"><span className="guide-num">6</span>위기 신호가 보이면</h2>
        <ol className="guide-list">
          <li>자해 · 자살 · 학대 같은 말이 보이면 그 자리에서 평가하지 말고, 활동 뒤 따로 조용히 이야기해요.</li>
          <li>혼자 판단하지 말고 기관 담당자 · 보호자와 함께 살펴요. 모임 글의 ‘신고’ 를 누르면 운영자도 함께 봐요.</li>
          <li><strong>{HELPLINE.label}</strong> ({HELPLINE.note}) 을 안내해 주세요. 위급하면 112 · 119.</li>
        </ol>
      </section>

      <section id="g7" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">7</span>자주 묻는 질문</h2>
        <dl className="guide-faq">
          {FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
        </dl>
      </section>

      <section id="g8" className="card guide-sec">
        <h2 className="card-title"><span className="guide-num">8</span>진행안 · 활동</h2>
        <ul className="guide-list">
          {PLAYBOOKS.map((p) => <li key={p.key}><strong>{p.title}</strong> <span className="muted">· {p.minutes}분 · {p.who}</span></li>)}
        </ul>
        <p className="muted small"><Link to="/activities">선 하나 활동 모음 ›</Link> · 모임 화면 ‘진행안 모음’ 에서 단계별로 띄울 수 있어요 · <Link to="/org">기관 리포트</Link>는 개인을 알 수 없는 흐름만 담아요.</p>
      </section>
    </article>
  )
}
