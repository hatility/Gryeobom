import { flushSync } from 'react-dom'
import { NavLink, useNavigate, type NavLinkProps } from 'react-router'
/**
 * 메뉴 링크: 화면이 바뀔 때 종이가 살짝 겹쳐 넘어가요 (View Transitions — 되는 브라우저만, 움직임 줄이기면 그냥 이동).
 * 새 탭 · 가운데 클릭 · 단축키는 브라우저 기본대로.
 */
export default function PageLink(props: NavLinkProps) {
  const navigate = useNavigate()
  return (
    <NavLink
      {...props}
      onClick={(e) => {
        props.onClick?.(e)
        const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !d.startViewTransition) return
        // 움직임 줄이기 · 조용한 시간에는 그냥 이동
        if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.quiet) return
        e.preventDefault()
        d.startViewTransition(() => flushSync(() => navigate(props.to)))
      }}
    />
  )
}
