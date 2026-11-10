import type { LifeGraph } from '../types'
import { useLabs } from '../labs'

/**
 * 실험: 나의 마음 단어 — 순간마다 고른 감정과 ‘지금의 나를 표현하는 단어’ 를 모아, 자주 쓴 것을 크게.
 * 나만 보는 화면에서만 쓴다 (서버에 따로 모으지 않는다).
 */
/** 자주 쓴 마음 단어 (많은 순) */
export function topWords(graphs: LifeGraph[], n = 14) {
  const count = new Map<string, number>()
  const add = (w: string) => {
    const k = w.trim()
    if (k) count.set(k, (count.get(k) ?? 0) + 1)
  }
  for (const g of graphs) {
    for (const e of g.entries) add(e.emotionLabel)
    add(g.currentReflection.word)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w)
}

export default function MoodWords({ graphs, title = '나의 마음 단어' }: { graphs: LifeGraph[]; title?: string }) {
  const labs = useLabs('graph')
  if (!labs) return null
  const count = new Map<string, number>()
  const add = (w: string) => {
    const k = w.trim()
    if (k) count.set(k, (count.get(k) ?? 0) + 1)
  }
  for (const g of graphs) {
    for (const e of g.entries) add(e.emotionLabel)
    add(g.currentReflection.word)
  }
  const words = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  if (words.length < 2) return null
  const max = words[0][1]
  return (
    <section className="card mood-words">
      <h2 className="card-title">{title}</h2>
      <p className="muted small">순간마다 고른 감정과 ‘지금의 나’ 단어를 모았어요. 자주 쓴 말일수록 크게 보여요. 나만 볼 수 있어요.</p>
      <p className="mood-cloud">
        {words.map(([w, n]) => (
          <span key={w} className="mood-word" style={{ fontSize: `${14 + Math.round((n / max) * 14)}px`, opacity: 0.55 + (n / max) * 0.45 }}>
            {w}<small>{n}</small>
          </span>
        ))}
      </p>
    </section>
  )
}
