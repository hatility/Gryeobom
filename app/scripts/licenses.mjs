// 그려봄이 쓰는 모든 오픈소스의 목록과 라이선스 전문을 모은다 → dist/licenses.json (‘오픈소스’ 탭) · dist/licenses.txt (원문 한 파일)
//   1) 화면에 담긴 npm 패키지   2) 서버 · 배포 (Node.js · SQLite · nginx …)   3) 글꼴
//   4) 만들 때 쓴 도구 (npm 개발용)   5) Docker 이미지 속 Alpine Linux 패키지
// 더블 체크: 각 원문이 표기한 라이선스가 맞는지 문구로 확인하고, 다르면 빌드를 멈춘다.
// 원문 출처: npm 은 패키지 안의 LICENSE, 나머지는 licenses/texts/ (Docker 이미지 · 공식 저장소 · SPDX 공식 전문).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p) => new URL(p, import.meta.url)
const read = (p) => readFileSync(at(p), 'utf8').trim()

/** 원문에 반드시 있어야 하는 문구 (라이선스 → 확인 방법) */
const SIGN = {
  MIT: /Permission is hereby granted, free of charge/i,
  ISC: /Permission to use, copy, modify, and\/or distribute this software for any\s+purpose/i,
  'Apache-2.0': /Apache License,?\s+Version 2\.0/i,
  'BSD-2-Clause': /Redistribution and use in source and binary forms/i,
  'BSD-3-Clause': /(Neither the name|names? of (its|the)\s+(copyright holder|contributors))/i,
  'MPL-2.0': /Mozilla Public License,?\s+(v\.\s*|Version\s+)2\.0/i,
  'OFL-1.1': /SIL OPEN FONT LICENSE/i,
  'Artistic-2.0': /Artistic License 2\.0/i,
  'Public Domain': /public domain/i,
}

/** 표기(SPDX 식)가 원문과 맞는지: AND 는 모두, OR 는 하나라도 */
export function matches(expr, text) {
  const ok = (id) => (SIGN[id] ? SIGN[id].test(text) : false)
  return expr
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((alt) => alt.split(/\s+AND\s+/).every((id) => ok(id.trim())))
}

const fail = (msg) => {
  throw new Error(`[오픈소스 고지] ${msg}`)
}

function npmGroups() {
  const lock = JSON.parse(read('../package-lock.json')).packages
  const runtime = [], dev = []
  for (const [path, info] of Object.entries(lock)) {
    if (!path || !existsSync(fileURLToPath(at(`../${path}`)))) continue // 다른 플랫폼용(설치 안 됨)은 쓰지 않는다
    const name = path.replace(/.*node_modules\//, '')
    const pkg = JSON.parse(read(`../${path}/package.json`))
    const file = readdirSync(at(`../${path}/`)).find((f) => /^(licen[cs]e|copying)/i.test(f))
    let note = ''
    let text
    if (file) text = read(`../${path}/${file}`)
    else if (name.startsWith('@rolldown/binding-')) {
      // 플랫폼별 바이너리 패키지는 LICENSE 를 따로 싣지 않는다 — 같은 저장소(rolldown)의 LICENSE
      text = read('../node_modules/rolldown/LICENSE')
      note = '이 패키지에는 LICENSE 파일이 없어, 같은 저장소(rolldown)의 LICENSE 를 붙였어요.'
    } else fail(`${name}: LICENSE 파일이 없어요`)
    if (!info.license) fail(`${name}: 라이선스 표기가 없어요`)
    if (!matches(info.license, text)) fail(`${name} ${info.version}: 표기(${info.license})와 LICENSE 원문이 맞지 않아요`)
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? ''
    const url = pkg.homepage || repo.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://') || `https://www.npmjs.com/package/${name}`
    const by = typeof pkg.author === 'string' ? pkg.author.replace(/\s*[<(].*$/, '') : pkg.author?.name ?? ''
    const item = { name, version: info.version, license: info.license, by, url, text, ...(note && { note }) }
    // 타입 정의만 있는 패키지는 화면 코드에 들어가지 않는다 (만들 때만 쓴다)
    ;(info.dev || name.startsWith('@types/') || name === 'csstype' ? dev : runtime).push(item)
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  return { runtime: runtime.sort(byName), dev: dev.sort(byName) }
}

function platformGroups() {
  const m = JSON.parse(read('../licenses/platform.json'))
  const withText = (it) => {
    const text = read(`../licenses/texts/${it.file}`)
    if (!text.includes(it.check) || !matches(it.license, text)) fail(`${it.name}: 표기(${it.license})와 원문이 맞지 않아요`)
    const { file, check, ...rest } = it
    return { ...rest, text }
  }
  // apk 표기의 라이선스마다 원문 파일 하나 (SPDX 공식 전문, 아니면 apkTexts)
  const texts = {}
  const textOf = (id) => {
    const file = m.apkTexts[id] ?? `spdx-${id}.txt`
    if (!existsSync(fileURLToPath(at(`../licenses/texts/${file}`)))) fail(`Alpine 라이선스 ‘${id}’ 원문이 없어요 (licenses/texts/${file})`)
    texts[id] = read(`../licenses/texts/${file}`)
  }
  const images = m.images.map((img) => ({
    id: img.id,
    title: img.title,
    items: read(`../licenses/${img.file}`)
      .split('\n')
      .map((line) => {
        const r = /^(.+)-(\d[^-\s]*-r\d+) \S+ \{([^}]+)\} \((.+)\) \[installed\]$/.exec(line.trim())
        if (!r) fail(`apk 목록을 읽지 못했어요: ${line}`)
        const [, name, version, origin, license] = r
        const ids = [...new Set(license.split(/\s+(?:AND|OR)\s+/).map((s) => s.replace(/[()]/g, '').trim()))]
        ids.forEach(textOf)
        return { name, version, license, by: `Alpine 패키지 ${origin}`, url: `https://pkgs.alpinelinux.org/packages?name=${encodeURIComponent(name)}`, refs: ids }
      }),
  }))
  return { server: m.server.map(withText), fonts: m.fonts.map(withText), images, texts }
}

/** 모든 묶음. 테스트(store.test.ts)와 빌드가 같이 쓴다. */
export function collect() {
  const npm = npmGroups()
  const p = platformGroups()
  return {
    groups: [
      { id: 'web', title: '화면에 담긴 것', note: '브라우저로 내려가는 화면 코드에 함께 들어 있어요.', items: npm.runtime },
      { id: 'server', title: '서버 · 배포', note: 'Docker 로 서비스를 돌릴 때 쓰는 것이에요.', items: p.server },
      { id: 'fonts', title: '글꼴', note: '각 배포처(CDN)에서 불러와요.', items: p.fonts },
      { id: 'dev', title: '만들 때 쓴 도구', note: '빌드 · 테스트에만 쓰고 서비스에는 들어가지 않아요.', items: npm.dev },
      ...p.images.map((img) => ({ id: `apk-${img.id}`, title: img.title, note: '라이선스 표기는 Alpine Linux 패키지 정보(apk)를 따르고, 전문은 SPDX 공식 원문이에요.', items: img.items })),
    ],
    texts: p.texts,
  }
}

// 빌드: npm run build 끝에서 실행 (dist 가 있어야 한다)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(fileURLToPath(at('../dist/')))) fail('dist 가 없어요. vite build 뒤에 실행하세요')
  const all = collect()
  const bar = '='.repeat(72)
  const body = all.groups.flatMap((g) => [
    `\n${'#'.repeat(72)}\n# ${g.title}\n${'#'.repeat(72)}\n`,
    ...g.items.map((it) => `${bar}\n${it.name} ${it.version} (${it.license})\n${bar}\n\n${it.text ?? it.refs.map((r) => `[${r}] — 맨 아래 ‘공통 라이선스 전문’`).join('\n')}\n`),
  ])
  const common = Object.entries(all.texts).map(([id, t]) => `${bar}\n${id}\n${bar}\n\n${t}\n`)
  writeFileSync(
    at('../dist/licenses.txt'),
    `그려봄이 쓰는 오픈소스와 라이선스 전문\n그려봄 자체의 라이선스는 GNU AGPL-3.0 입니다 (저장소의 LICENSE · NOTICE.md).\n` +
      body.join('\n') + `\n${'#'.repeat(72)}\n# 공통 라이선스 전문 (Alpine 패키지)\n${'#'.repeat(72)}\n\n` + common.join('\n'),
  )
  writeFileSync(at('../dist/licenses.json'), JSON.stringify(all))
  const n = all.groups.reduce((s, g) => s + g.items.length, 0)
  console.log(`✓ licenses: ${n}개 (${all.groups.map((g) => `${g.title} ${g.items.length}`).join(' · ')}) · 원문 확인 완료`)
}
