/** 세 걸음의 작은 화면: 그 단계의 실제 화면을 줄인 그림 (글자는 꼭 필요한 것만, 나머지는 회색 막대) */
export default function StepArt({ kind }: { kind: 'time' | 'moment' | 'reflect' | 'join' | 'share' }) {
  return (
    <svg className="step-art" viewBox="0 0 200 124" aria-hidden="true">
      <rect x="1" y="1" width="198" height="122" rx="12" className="sa-paper" />
      {kind === 'time' && (
        <>
          <rect x="16" y="18" width="168" height="26" rx="8" className="sa-well" />
          <rect x="19" y="21" width="48" height="20" rx="6" className="sa-on" />
          <text x="43" y="35" textAnchor="middle" className="sa-t sa-strong">나이로</text>
          <text x="98" y="35" textAnchor="middle" className="sa-t">연도로</text>
          <text x="148" y="35" textAnchor="middle" className="sa-t">달로</text>
          <rect x="16" y="58" width="76" height="28" rx="7" className="sa-field" />
          <text x="26" y="77" className="sa-t sa-strong">0</text><text x="82" y="77" textAnchor="end" className="sa-t">살</text>
          <rect x="108" y="58" width="76" height="28" rx="7" className="sa-field sa-focus" />
          <text x="118" y="77" className="sa-t sa-strong">17</text><text x="174" y="77" textAnchor="end" className="sa-t">살</text>
          <rect x="16" y="100" width="92" height="6" rx="3" className="sa-bar" />
        </>
      )}
      {kind === 'moment' && (
        <>
          <line x1="16" y1="64" x2="184" y2="64" className="sa-base" />
          <path d="M16 78 C40 50 56 34 72 42 S100 96 120 88 S152 30 184 36" className="sa-line" pathLength={1} />
          <circle cx="72" cy="42" r="5" className="sa-dot" />
          <circle cx="120" cy="88" r="5" className="sa-dot" />
          <circle cx="184" cy="36" r="6" className="sa-now" />
          <text x="72" y="28" textAnchor="middle" className="sa-t">첫 무대</text>
          <path d="M126 96 L126 110 L129.6 106.6 L132 112 L134.2 111 L131.8 105.8 L136.4 105.8 Z" className="sa-cursor" />
        </>
      )}
      {kind === 'reflect' && (
        <>
          <text x="16" y="30" className="sa-t sa-time">7살</text><text x="44" y="30" className="sa-t sa-strong">첫 무대</text>
          <text x="16" y="54" className="sa-t">그때 나는 어떤 마음이었나요?</text>
          <rect x="16" y="62" width="168" height="44" rx="8" className="sa-field sa-focus" />
          <rect x="26" y="74" width="110" height="6" rx="3" className="sa-bar sa-ink" />
          <rect x="26" y="88" width="70" height="6" rx="3" className="sa-bar" />
        </>
      )}
      {kind === 'join' && (
        <>
          <rect x="66" y="14" width="68" height="96" rx="12" className="sa-field" />
          <rect x="78" y="30" width="44" height="44" rx="4" className="sa-well" />
          {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => ((r * 3 + c) % 3 !== 1) && <rect key={`${r}${c}`} x={81 + c * 10} y={33 + r * 10} width="8" height="8" rx="1.5" className="sa-ink" />))}
          <rect x="78" y="84" width="44" height="14" rx="5" className="sa-on sa-focus" />
          <text x="100" y="94.5" textAnchor="middle" className="sa-t sa-strong" style={{ fontSize: 8.5 }}>들어가기</text>
        </>
      )}
      {kind === 'share' && (
        <>
          <path d="M16 70 C44 40 70 36 92 52 S140 86 184 40" className="sa-line" />
          <path d="M16 88 C46 92 72 64 100 72 S150 96 184 70" className="sa-line sa-line-2" />
          <circle cx="184" cy="40" r="5" className="sa-now" />
          <circle cx="184" cy="70" r="5" className="sa-now sa-now-2" />
          <rect x="22" y="18" width="62" height="20" rx="10" className="sa-on" />
          <text x="53" y="31.5" textAnchor="middle" className="sa-t sa-strong">응원해요</text>
        </>
      )}
    </svg>
  )
}
