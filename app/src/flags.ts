/**
 * 실험 기능 스위치. 개발 테스트 서버(DEV_SERVER=true)에서는 모두 켜져 있고,
 * 정식 서버에서는 official 묶음은 늘 켜지고(1.1.0~), 나머지만 관리자 ‘설정 → 실험 기능 스위치’ 에서 켠다 (처음엔 꺼짐).
 * 서버(labs(key)) · 화면(useLabs(key))이 같은 이름을 쓴다.
 */
export const FLAGS = [
  { key: 'graph', official: true, name: '나의 선 더하기', desc: '인생 구간 띠 · 나만의 질문 · 전환점 · 질문 묶음 · 단어 카드 · 나의 마음 단어 · A4 한 장 · 카드 배경 · 손글씨 · 고치기 전 모습 · 문장 도우미 · 쉬운 말 · 인터넷 없이 쓰기 · 시각으로 그리기' },
  { key: 'group', official: true, name: '모임 더하기', desc: '모임 소식 · 일정 · 출석 · 복제 · 여러 모임 한 번에 · 리포트 인쇄 · 끝내기 · 질문 묶음 · 도우미 · 진행안 · 큰 화면 진행 · QR · 종이 활동지 · 질문 정하기' },
  { key: 'org', official: true, name: '동아리', desc: '동아리 리포트 · 동아리 소식 한 번에 · 담당자 초대 링크 · 동아리 직접 등록(등록 안내 동의) · 맨 위 동아리 탭' },
  { key: 'me', official: true, name: '내 기록 · 문의 · 약관', desc: '내 기록 모두 내려받기 · 문의하기 · 약관 다시 동의 · 한 해 돌아보기 응원 수 · 홈 화면 설치' },
  { key: 'ops', official: true, name: '운영 도구', desc: '관리자: 오류 · CSP · 휴면 · 통계 · 흐름 · 서버 상태 · 자동 백업 · 차단 · 요청 대장 · 파기 기록 · 계정 · 점검 · 공지 예약 · 진단 · 문의함 · 접속 표 · 새 버전 · DB 점검' },
  { key: 'onelogin', name: '로그인 하나로', desc: '그려봄 로그인으로 들어온 뒤 관리자 화면은 비밀번호로 한 번 더 확인 (30분 · 쓰는 동안 이어짐) · 첫 관리자 비밀번호는 어느 계정이든 쓸 수 있고 어느 계정으로 들어왔는지 접속 기록에 남음 · 더 둔 관리자 계정은 처음 확인한 그려봄 계정에 묶임' },
  { key: 'board', name: '사이트 지도 보드', desc: '관리자: 화면들을 살아 있는 노드로 띄워 한눈에 확인 · 자동 배치 · 자동 선 · 노드 상태 표시' },
] as const
export type Flag = (typeof FLAGS)[number]['key']
/** 1.1.0 에서 정식이 된 묶음: 스위치와 상관없이 늘 켜진다 */
export const OFFICIAL: readonly Flag[] = FLAGS.filter((f) => 'official' in f).map((f) => f.key)
export const isFlag = (x: unknown): x is Flag => FLAGS.some((f) => f.key === x)
