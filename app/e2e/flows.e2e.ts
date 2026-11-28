import { expect, test, type Page } from '@playwright/test'

// 사람이 하는 그대로 화면을 눌러 보는 핵심 흐름. PC 크기 기본, 모바일은 따로.
const uniq = () => Math.random().toString(36).slice(2, 7)

async function signup(page: Page, name: string, birth: string, nickname: string) {
  await page.goto('/login')
  await page.getByText('처음이에요', { exact: true }).click()
  await page.locator('input[name=name]').fill(name)
  await page.locator('input[name=birth]').fill(birth)
  await page.locator('input[name=nickname]').fill(nickname)
  for (const box of await page.locator('.check.agree input[type=checkbox]').all()) await box.check() // 약관 동의 · 만 14세 이상
}

test('로그인 없이 그래프를 그리고 결과를 본다', async ({ page }) => {
  await page.goto('/graph/new')
  await page.getByRole('button', { name: '다음 단계 ›' }).click()
  await page.getByRole('button', { name: '+ 순간 적기' }).click()
  await page.getByPlaceholder('예) 새로운 친구를 만났던 날').fill('처음 무대에 선 날')
  await page.getByRole('button', { name: '이 순간 담기' }).click()
  await expect(page.locator('.entry-list')).toContainText('처음 무대에 선 날')
  await page.getByRole('button', { name: '다음 단계 ›' }).click()
  await page.getByRole('button', { name: '다음 단계 ›' }).click()
  await page.getByRole('button', { name: '나의 이야기 완성하기' }).click()
  await expect(page).toHaveURL(/\/graph\/[^/]+\?done=1/)
  await expect(page.locator('.life-graph svg').first()).toBeVisible()
})

test('가입하고 모임을 만들어 소식 · 일정을 올린다', async ({ page }) => {
  await signup(page, `모임장${uniq()}`, '19900101', '선생님')
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(page).toHaveURL(/\/my/)
  await page.goto('/share')
  await page.getByPlaceholder('예) 수요일 마음 모임').fill('자동 시험 모임')
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await expect(page).toHaveURL(/\/groups\//)
  await expect(page.getByRole('heading', { name: '자동 시험 모임' })).toBeVisible()
  // 실험: 모임 소식 · 활동 일정
  await page.getByText('+ 모임 사람들에게 알릴 소식을 남겨 보세요').click()
  await page.locator('.news-card textarea').fill('다음 주에 만나요')
  await page.getByRole('button', { name: '올리기' }).click()
  await expect(page.locator('.news-card')).toContainText('다음 주에 만나요')
  const day = new Date(Date.now() + 9 * 3600_000 + 3 * 864e5).toISOString().slice(0, 10)
  // 1.2.0: 활동 입력 칸은 ‘+ 함께 모일 날을 정해 보세요’ 를 눌러야 펼쳐져요
  await page.getByRole('button', { name: /함께 모일 날/ }).click()
  await page.getByLabel('날짜').fill(day)
  await page.getByLabel('무엇을 하나요').fill('처음 해낸 일 그리기')
  await page.getByRole('button', { name: '더하기', exact: true }).click()
  await expect(page.locator('.events-card')).toContainText('처음 해낸 일 그리기')
})

test('만 14세 미만은 가입되지 않고, 안내가 보인다', async ({ page }) => {
  await signup(page, `아이${uniq()}`, '20150505', '새싹')
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(page.getByText('만 14세 미만은 가입할 수 없어요')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('선 하나 활동에서 고른 틀로 그리기가 열린다', async ({ page }) => {
  await page.goto('/activities')
  await page.getByRole('button', { name: /이번 주 한 선/ }).click()
  await expect(page.locator('.act-panel h2')).toHaveText('이번 주 한 선')
  await page.getByRole('tab', { name: /모임 진행안/ }).click()
  await expect(page.locator('.act-pbp .tbar i').first()).toBeVisible() // 단계마다 시간 띠
  await page.getByRole('tab', { name: /짧은 활동/ }).click()
  await page.getByRole('link', { name: '이 틀로 그리기' }).click()
  await expect(page).toHaveURL(/\/graph\/new\?tpl=week/)
})

test.describe('모바일', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('휴대폰은 /m 으로 열리고 아래 탭바로 다닌다', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/m$/)
    await expect(page.locator('.m-tabs')).toBeVisible()
    await page.locator('.m-tab', { hasText: '나' }).click()
    await expect(page).toHaveURL(/\/m\/me$/)
    await expect(page.getByText('PC 화면으로 보기')).toBeVisible()
  })
})
