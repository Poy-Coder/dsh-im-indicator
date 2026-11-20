/**
 * Hermetic checks for the host half: tolerance for missing/malformed channel
 * state and the payload shape. Run: node --test test/verify.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { boundPayload, boundResponse, boundSessionOf, connectionRejection, CHANNEL_STATE_FILES } from '../index.mjs'

test('boundSessionOf accepts a well-formed binding', () => {
  assert.equal(boundSessionOf({ sessionId: 'session-1234' }), 'session-1234')
})

test('boundSessionOf trims and rejects foreign ids', () => {
  assert.equal(boundSessionOf({ sessionId: '  session-9  ' }), 'session-9')
  assert.equal(boundSessionOf({ sessionId: 'other-1' }), '')
  assert.equal(boundSessionOf({}), '')
  assert.equal(boundSessionOf(undefined), '')
  assert.equal(boundSessionOf('session-1'), '')
})

test('boundPayload reads both channels and tolerates absence', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-im-indicator-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    writeFileSync(join(home, CHANNEL_STATE_FILES.feishu), JSON.stringify({ sessionId: 'session-feishu' }))
    // The WeChat file is deliberately absent.
    const payload = boundPayload()
    assert.equal(payload.v, 1)
    assert.equal(payload.bound.feishu, 'session-feishu')
    assert.equal(payload.bound.wechat, '')
    assert.equal(typeof payload.at, 'number')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('boundPayload ignores a malformed state file', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-im-indicator-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    writeFileSync(join(home, CHANNEL_STATE_FILES.wechat), '{not json')
    assert.equal(boundPayload().bound.wechat, '')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

const request = () => new Request('http://127.0.0.1:3080/im-indicator/bound', {
  headers: { origin: 'http://127.0.0.1:3080' },
})

test('a rejected request never reaches the payload', async () => {
  const connection = { requestRejection: () => 403 }
  assert.equal(connectionRejection(connection, request()), 403)
  const response = await boundResponse(connection, request())
  assert.equal(response.status, 403)
  assert.equal(await response.text(), '')
})

test('an accepted request returns the payload', async () => {
  const connection = { requestRejection: () => undefined }
  const response = await boundResponse(connection, request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).v, 1)
})

test('a throwing trust check fails closed', async () => {
  const connection = { requestRejection: () => { throw new Error('boom') } }
  assert.equal(connectionRejection(connection, request()), 403)
  assert.equal((await boundResponse(connection, request())).status, 403)
})

test('a profile without Connection still serves the payload', async () => {
  // No Connection Service means no browser carrier to authenticate; the route
  // must keep working rather than deny every request.
  assert.equal(connectionRejection(undefined, request()), undefined)
  assert.equal((await boundResponse(undefined, request())).status, 200)
})
