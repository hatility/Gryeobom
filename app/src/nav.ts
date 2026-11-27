import { useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate as useRouterNavigate, type NavigateFunction, type NavigateOptions, type To } from 'react-router'

/**
 * 코드로 화면을 옮길 때도(저장 뒤 · 로그인 뒤 · 모임 만든 뒤) 링크를 눌렀을 때와 같은 전환 효과.
 * 뒤로 가기(숫자) · 전환을 못 하는 브라우저 · 움직임 줄이기 · 조용한 시간에는 그냥 옮긴다.
 */
export function useNavigate(): NavigateFunction {
  const nav = useRouterNavigate()
  return useMemo<NavigateFunction>(() => {
    const go = ((to: To | number, opts?: NavigateOptions) => {
      const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
      const still = !d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || !!document.documentElement.dataset.quiet
      if (typeof to === 'number') return nav(to)
      if (still) return nav(to, opts)
      d.startViewTransition(() => flushSync(() => nav(to, opts)))
    }) as NavigateFunction
    return go
  }, [nav])
}
