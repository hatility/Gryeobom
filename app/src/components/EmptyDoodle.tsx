/** 빈 화면의 작은 선 그림 — 기록 없음 · 모임 없음 · 길 잃음 · 찾을 수 없는 기록에서 같은 모양으로 */
export default function EmptyDoodle() {
  return (
    <svg className="empty-doodle" viewBox="0 0 160 70" aria-hidden="true">
      <path d="M8 50c20-2 26-30 46-28s22 30 44 26 30-30 52-34" pathLength={1} />
      <circle cx="150" cy="14" r="5" />
    </svg>
  )
}
