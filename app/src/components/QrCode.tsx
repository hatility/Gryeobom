import qrcode from 'qrcode-generator'

/** 주소를 QR 로 (휴대폰 카메라로 찍어 바로 열게). 흰 바탕 · 검은 칸, 둘레 여백 */
/** pad: 둘레 여백 칸 (흰 바탕 위에서는 2칸이면 충분하다) */
export default function QrCode({ text, size = 240, label, pad = 2 }: { text: string; size?: number; label: string; pad?: number }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + pad},${r + pad}h1v1h-1z`
  return (
    <svg className="qr" viewBox={`0 0 ${n + pad * 2} ${n + pad * 2}`} width={size} height={size} role="img" aria-label={label}>
      <rect width={n + pad * 2} height={n + pad * 2} fill="#fff" />
      <path d={d} fill="#111" shapeRendering="crispEdges" />
    </svg>
  )
}
