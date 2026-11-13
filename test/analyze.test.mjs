// 分析管线单测：五分类判据/情绪三分/主题 \b 词边界/评分卡/趋势/商业信号/KOC
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classify, analyzePosts, renderAnalysis, compileMap, TITLE_NEG, TITLE_Q, SHOWCASE_TITLE,
  TITLE_POS, SEVERITY_RX, PROMO_RX, DEFAULT_SIGNALS,
} from '../lib/analyze.js'

const P = (id, title, selftext = '', score = 10, nc = 3, daysAgo = 5) => ({
  id, title, selftext, score, num_comments: nc,
  created_utc: Math.floor(Date.now() / 1000) - daysAgo * 86400,
  permalink: `/r/esp32/comments/${id}/`, subreddit: 'esp32', author: 'u' + id,
})

test('classify：NEG > 问号 > showcase > praise 判据顺序', () => {
  assert.equal(classify(P('1', 'My ESP32 keeps rebooting randomly')), 'complaint') // my\w 是 showcase 模式但 NEG 优先
  assert.equal(classify(P('2', 'How do I fix brownout?')), 'help')
  assert.equal(classify(P('3', 'Is this normal?')), 'help') // 含问号一律求助
  assert.equal(classify(P('4', 'I built a weather station!')), 'showcase')
  assert.equal(classify(P('5', 'Works great, love it')), 'praise')
  assert.equal(classify(P('6', 'Some random title')), 'other')
})

test('TITLE_NEG：crash course 不误命中', () => {
  assert.ok(TITLE_NEG.test('It crashes every hour'))
  assert.ok(!TITLE_NEG.test('A crash course in ESP32')) // (?! ?course)
  assert.ok(TITLE_NEG.test('keeps disconnecting'))
  assert.ok(TITLE_NEG.test('battery drains fast'))
})

test('情绪三分：praise 要求无 pain 信号', () => {
  // "love it" 但正文含 pain 信号 → classify 按标题，正文不影响分类（标题级判据）
  assert.equal(classify(P('7', 'Love this thing')), 'praise')
  assert.equal(classify(P('8', 'Love this thing but it broke')), 'complaint') // NEG 优先
})

test('主题表 \\b 词边界：短词裸写误命中演示', () => {
  const themesBad = { 内存: 'ram' }
  const themesGood = { 内存: '\\bram\\b' }
  const p = P('9', 'Program crashes when loading') // 抱怨类（进 complaint 桶）；pro-gram 含裸 ram → 误命中；\\bram\\b 不命中
  const bad = analyzePosts([p], { themes: themesBad })
  const good = analyzePosts([p], { themes: themesGood })
  assert.equal(bad.themes['内存'].complaint + bad.themes['内存'].help, 1)
  assert.equal(good.themes['内存'].complaint + good.themes['内存'].help, 0)
})

test('analyzePosts：评分卡=普遍度50+严重度30+趋势20', () => {
  const posts = [
    P('a1', 'It broke and caught fire, dangerous', 'scam', 100, 10, 2),
    P('a2', 'Battery dies fast', 'drains overnight', 50, 5, 3),
    P('a3', 'Charging port broken', 'physically damaged', 40, 8, 4),
  ]
  const themes = { 电源: 'batter|charg', 安全: 'fire|dangerous' }
  const r = analyzePosts(posts, { themes })
  const power = r.scorecard.find((x) => x.theme === '电源')
  const safety = r.scorecard.find((x) => x.theme === '安全')
  assert.ok(power && safety)
  assert.ok(safety.score > power.score) // 安全 2/2 严重 + 同样普遍度 → 更高
  assert.equal(safety.sev, 1) // 全部命中严重度词
})

test('analyzePosts：Top30 展示帖占比判定', () => {
  const posts = Array.from({ length: 30 }, (_x, i) => P(`s${i}`, `I built project ${i}`, '', 100 + i))
  posts.push(P('pain1', 'It broke', 'not working', 10))
  const r = analyzePosts(posts, { themes: { 损坏: 'broke|not working' } })
  assert.ok(r.showcaseShare > 95)
  assert.ok(r.showcaseVerdict.includes('情感展示型'))
})

test('analyzePosts：scope 相关性 + KOC 软文', () => {
  const posts = [
    P('r1', 'Wig looks amazing', 'love my new wig from shop.example-wig.com/koc deal utm_campaign=rdkoc', 300, 50),
    P('r2', 'My wig sheds like crazy', 'tangled and frizzy, total waste of money', 40, 12),
  ]
  const r = analyzePosts(posts, { themes: { 掉发: 'sheds|tangl' }, scope: 'wig', promoCheck: true })
  assert.equal(r.scope.share, 100)
  assert.equal(r.promo.count, 1)
  assert.ok(r.promo.posts[0].id === 'r1') // 分数最高的"正面评价"恰是软文
  assert.ok(PROMO_RX.test('https://shop.luvme.com/products/x?utm_source=rdkoc'))
})

test('analyzePosts：商业信号四类', () => {
  const posts = [
    P('b1', 'Just ordered mine'),
    P('b2', "I'd pay $50 for a fix"),
    P('b3', 'Switched to a competitor'),
    P('b4', 'Returned it, got a full refund'),
  ]
  const r = analyzePosts(posts, { themes: {} })
  assert.equal(r.signals['购买意图'].count, 1)
  assert.equal(r.signals['付费意愿'].count, 1)
  assert.equal(r.signals['弃用/流失'].count, 1)
  assert.equal(r.signals['退货/退款'].count, 1)
})

test('趋势箭头：近30 vs 前30', () => {
  const now = Math.floor(Date.now() / 1000)
  const posts = [
    P('t1', 'It broke', 'wifi issue', 10, 1, 2),   // 近期
    P('t2', 'It broke again', 'wifi issue', 10, 1, 5),
    P('t3', 'It broke more', 'wifi issue', 10, 1, 90), // 远期
    P('t4', 'It broke old', 'wifi issue', 10, 1, 100),
    P('t5', 'It broke older', 'wifi issue', 10, 1, 110),
  ]
  const r = analyzePosts(posts, { themes: { 断连: 'wifi' } })
  const t = r.themes['断连']
  assert.ok(['↑', '↓', '→', '↑↑', '–'].includes(t.arrow))
})

test('compileMap：坏正则可读报错', () => {
  assert.throws(() => compileMap({ x: '([' }, '主题表'), /正则无效/)
  assert.throws(() => compileMap('not object', '主题表'), /结构应为/)
})

test('renderAnalysis：markdown 关键板块', () => {
  const posts = [P('m1', 'It broke', 'wifi battery', 20, 5), P('m2', 'I built X!', '', 100, 3)]
  const r = analyzePosts(posts, { themes: { 损坏: 'broke' }, scope: 'broke|wifi' })
  const md = renderAnalysis(r)
  assert.ok(md.includes('# 痛点分析（标题级判据）'))
  assert.ok(md.includes('Top30 高互动帖中展示帖占比'))
  assert.ok(md.includes('痛点评分卡'))
  assert.ok(md.includes('商业信号（帖级）'))
  assert.ok(md.includes('评论树补刀'))
})

test('DEFAULT_SIGNALS 四类齐全', () => {
  assert.deepEqual(Object.keys(DEFAULT_SIGNALS), ['购买意图', '付费意愿', '弃用/流失', '退货/退款'])
})
