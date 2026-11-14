import test from 'node:test'
import assert from 'node:assert/strict'
import { collapseDuplicates, normalizeTitle, isRemovedPost } from '../lib/feed.js'

const post = (id, title, author, score = 1, num_comments = 0, created_utc = 1000) =>
  ({ id, title, author, score, num_comments, created_utc, permalink: `/r/startups/comments/${id}/x/` })

test('标题归一化：去标签 / 去强制尾巴 / 统一空白与标点', () => {
  assert.equal(normalizeTitle('Imposter syndrome. (I will not promote)'), 'imposter syndrome')
  assert.equal(normalizeTitle('Imposter Syndrome. I will not promote'), 'imposter syndrome')
  assert.equal(normalizeTitle('[I will not promote] Just found a competitor EXTREMELY similar to mine- i will not promote'),
    'just found a competitor extremely similar to mine')
})

test('同一作者同标题刷量帖：折叠成 1 条，保留评论最多的', () => {
  const r = collapseDuplicates([
    post('a', 'Imposter syndrome. (I will not promote)', 'crustymallsanta', 2, 6),
    post('b', 'Imposter Syndrome. I will not promote', 'crustymallsanta', 1, 0),
    post('c', 'imposter syndrome — I will not promote', 'crustymallsanta', 1, 0),
  ])
  assert.equal(r.posts.length, 1)
  assert.equal(r.posts[0].id, 'a')
  assert.equal(r.collapsed, 2)
})

test('不同作者同标题不折叠（避免误杀真实讨论）', () => {
  const r = collapseDuplicates([
    post('a', 'How do I find a cofounder?', 'u1'),
    post('b', 'How do I find a cofounder?', 'u2'),
  ])
  assert.equal(r.posts.length, 2)
  assert.equal(r.collapsed, 0)
})

test('重复 post id 折叠（分页边界同一秒帖被重复取回）', () => {
  const r = collapseDuplicates([post('same', 'AAA', 'u1'), post('same', 'AAA', 'u1')])
  assert.equal(r.posts.length, 1)
  assert.equal(r.collapsed, 1)
})

test('已删/已移除占位帖直接剔除', () => {
  const r = collapseDuplicates([post('a', '[ Removed by moderator ]', 'x'), post('b', 'Real question', 'u2')])
  assert.equal(r.posts.length, 1)
  assert.equal(r.posts[0].id, 'b')
  assert.ok(isRemovedPost({ title: '[removed]' }))
  assert.ok(!isRemovedPost({ title: 'Removed my app from store' }))
})

test('标题只剩强制标签（"I will not promote"）：视为无内容剔除', () => {
  const r = collapseDuplicates([post('a', 'I will not promote', 'u9'), post('b', 'Real question', 'u2')])
  assert.equal(r.posts.length, 1)
  assert.equal(r.posts[0].id, 'b')
})

test('保序：折叠后仍按原顺序输出', () => {
  const r = collapseDuplicates([
    post('a', 'First', 'u1'), post('b', 'Second', 'u2'), post('c', 'First', 'u1'),
  ])
  assert.deepEqual(r.posts.map((p) => p.id), ['a', 'b'])
})

test('同作者 6 小时内换标题重发：折叠，保留互动高的那条', () => {
  const r = collapseDuplicates([
    post('a', 'I am 23 and building an AI studio', 'joel313', 1, 0, 1000),
    post('b', 'I am 23, building an AI company that builds companies', 'joel313', 9, 4, 1600),
  ])
  assert.equal(r.posts.length, 1)
  assert.equal(r.posts[0].id, 'b')
  assert.equal(r.burst, 1)
})

test('同作者超过 6 小时的两条不同内容：都保留', () => {
  const r = collapseDuplicates([
    post('a', 'Question about pricing', 'u1', 1, 0, 1000),
    post('b', 'Question about hiring', 'u1', 1, 0, 1000 + 7 * 3600),
  ])
  assert.equal(r.posts.length, 2)
  assert.equal(r.collapsed, 0)
})
