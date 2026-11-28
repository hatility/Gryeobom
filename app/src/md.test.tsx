import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Md } from './md'

it('작은 마크다운: 문단 · 줄 바꿈 · 목록 · 굵게 · 링크, HTML 은 글자 그대로', () => {
  const h = renderToStaticMarkup(<Md text={'2026-11-24 시행 · 새로 모으는 정보는 없어요.\n- **새 기능**을 적었어요\n- 둘\n\n## 처리방침\n1. 하나\n2) 둘\n자세한 것은 [약관](https://x.y/terms)\n<b>x</b>\n\n\n끝 줄'} />)
  expect(h).toContain('<p>2026-11-24 시행 · 새로 모으는 정보는 없어요.</p>')
  expect(h).toContain('<ul><li><strong>새 기능</strong>을 적었어요</li><li>둘</li></ul>')
  expect(h).toContain('<p class="mdtext-h">처리방침</p><ol><li>하나</li><li>둘</li></ol>')
  expect(h).toContain('<p>자세한 것은 <a href="https://x.y/terms" target="_blank" rel="noopener noreferrer">약관</a><br/>&lt;b&gt;x&lt;/b&gt;</p>')
  expect(h).toContain('<p>끝 줄</p>')
  // 링크는 http(s) 만 — 나머지는 글자 그대로
  expect(renderToStaticMarkup(<Md text="[x](javascript:alert(1))" />)).toContain('[x](javascript:alert(1))')
})
