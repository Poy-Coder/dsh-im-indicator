/**
 * Host half: tell the browser which Session each IM channel is driving.
 *
 * The binding is channel runtime state (`~/.dsh/<channel>-channel-state.json` →
 * `sessionId`), not a Session property, so the page cannot derive it. A tiny
 * same-origin GET route carries it; the client polls it slowly and only repaints
 * when an id actually changes.
 *
 * Stability rules this file follows:
 *   - the route body is read fresh per request and never cached;
 *   - a missing, unreadable, or malformed state file yields an empty id, never
 *     an exception (a broken channel plugin must not break the indicator);
 *   - the plugin waits for `webServer` through `inject` instead of assuming it.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const inject = ['webServer']

/** Channel id → the state file its plugin writes. */
export const CHANNEL_STATE_FILES = {
  feishu: 'feishu-channel-state.json',
  wechat: 'wechat-channel-state.json',
}

export const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * Extract the bound Session id from one parsed channel state document.
 * Pure, so the test suite can pin the tolerance rules.
 * @param {unknown} state
 * @returns {string} the Session id, or '' when absent or malformed.
 */
export function boundSessionOf(state) {
  const id = String(state?.sessionId ?? '').trim()
  return id.startsWith('session-') ? id : ''
}

/**
 * Read one channel's bound Session id without throwing.
 * @param {string} file state file name under the DSH home
 * @returns {string}
 */
export function readBoundSession(file) {
  try {
    return boundSessionOf(JSON.parse(readFileSync(join(dshHome(), file), 'utf8')))
  } catch {
    return ''
  }
}

/**
 * The route payload. Versioned so a future shape change can be ignored by an
 * older page instead of rendering garbage.
 * @returns {{ v: number, bound: Record<string, string>, at: number }}
 */
export function boundPayload() {
  const bound = {}
  for (const [channel, file] of Object.entries(CHANNEL_STATE_FILES)) bound[channel] = readBoundSession(file)
  return { v: 1, bound, at: Date.now() }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/im-indicator/bound',
    resource: async () => new Response(JSON.stringify(boundPayload()), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    }),
  }), 'dsh-im-indicator: bound session route')
}
