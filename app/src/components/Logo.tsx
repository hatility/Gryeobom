import { Link } from 'react-router'

/** CSS와 텍스트만으로 그리는 워드마크. 연필 곡선은 .logo::after 에서. */
export default function Logo() {
  return (
    <Link to="/" className="logo" aria-label="그려봄 처음으로">
      그려봄<span className="logo-dot" aria-hidden="true" />
    </Link>
  )
}
