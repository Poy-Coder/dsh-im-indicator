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
 *   - the plugin waits for `webServer` through `inject` instead of assuming it;
 *   - the route authenticates every request: `webServer` named routes answer
 *     before any trust check, so without `connection.requestRejection` a foreign
 *     Origin or Host would read the payload. A check that itself fails returns
 *     403 rather than the data, because leaking a Session id is worse than a
 *     blank indicator.
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

/** The one route this plugin owns; also the client's polling target. */
export const ROUTE_PATH = '/im-indicator/bound'

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

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * Run Connection's Host/Origin and browser-authentication checks for this route.
 * @param {unknown} connection the `connection` Service, when the profile has one
 * @param {Request} request the incoming request
 * @returns {401 | 403 | undefined} a rejection status, or undefined to proceed
 */
export function connectionRejection(connection, request) {
  const check = connection?.requestRejection
  // A profile without Connection serves no browser at all; there is nothing to
  // authenticate against, and the carrier is loopback-only in that case.
  if (typeof check !== 'function') return undefined
  try {
    return check.call(connection, { headers: request?.headers ?? {} }) ?? undefined
  } catch {
    // An authentication check that throws must not fall through to the payload.
    return 403
  }
}

/**
 * Answer one request for the route.
 * @param {unknown} connection the `connection` Service, when the profile has one
 * @param {Request} request the incoming request
 * @returns {Promise<Response>}
 */
export async function boundResponse(connection, request) {
  const rejection = connectionRejection(connection, request)
  if (rejection) return new Response(null, { status: rejection, headers: NO_STORE })
  return new Response(JSON.stringify(boundPayload()), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // The payload names Sessions in this profile; never hand it to a page
      // served from another origin even if a browser is asked to.
      'x-content-type-options': 'nosniff',
    },
  })
}

export function apply(ctx) {
  // `connection` stays optional: the indicator is a Web decoration, and a
  // profile without a browser carrier has no trust checks to apply.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    resource: async (request) => boundResponse(ctx.get('connection'), request),
  }), 'dsh-im-indicator: bound session route')
}
