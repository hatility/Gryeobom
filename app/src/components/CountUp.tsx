import { useEffect, useRef, useState } from 'react'
/** 숫자가 차오르는 장면 (처음엔 0 에서, 값이 바뀌면 지난 값에서) — 움직임 줄이기면 바로 */
export default function CountUp({ n, instant = false }: { n: number; instant?: boolean }) {
  const still = () => instant || !!document.documentElement.dataset.quiet || matchMedia('(prefers-reduced-motion: reduce)').matches
  const [v, setV] = useState(() => (still() ? n : 0))
  const from = useRef(v)
  useEffect(() => {
    if (still()) { from.current = n; return setV(n) }
    let raf = 0
    const a = from.current, t0 = performance.now(), dur = 900
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur)
      const x = Math.round(a + (n - a) * (1 - (1 - k) ** 3))
      from.current = x
      setV(x)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n])
  return <>{v}</>
}
