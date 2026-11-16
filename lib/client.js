/**
 * Client half: a channel capsule plus a live status dot on the ONE Session each
 * IM channel is currently bound to, in the GUI session list.
 *
 * `sidebar.session.row.trailing` is declared by ui-workspace: after the time
 * label, before the pin marker, non-interactive icons ordered by `order`. Every
 * row seat receives `sessionId` plus the global standard props, including the
 * `useSessionStatus(selector)` snapshot hook.
 *
 * Stability rules this file follows:
 *   - one shared poll feeds every row (no per-row request, no per-row timer);
 *   - the poll backs off on failure (5 s → 10 s → 20 s → 40 s → 60 s) and pauses
 *     while the page is hidden, then refreshes once when it becomes visible;
 *   - a malformed or unversioned response is ignored, never rendered;
 *   - hooks are feature-detected, so a DSH client that stops passing them renders
 *     nothing instead of throwing;
 *   - every timer, listener, and style element is disposed with the plugin.
 */

const CHANNELS = {
  feishu: { label: '飞书', fg: '#15803d', bg: 'rgba(34,197,94,.14)', border: 'rgba(34,197,94,.35)' },
  wechat: { label: '微信', fg: '#0a7d43', bg: 'rgba(7,193,96,.14)', border: 'rgba(7,193,96,.35)' },
}

const ENDPOINT = '/im-indicator/bound'
const BASE_INTERVAL_MS = 5_000
const MAX_INTERVAL_MS = 60_000
const PAYLOAD_VERSION = 1

window.__ModuleLoader__.load({
  id: 'dsh-im-indicator',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Shared binding store. The snapshot reference only changes when an id does.
    let snapshot = Object.freeze({ feishu: '', wechat: '' })
    const listeners = new Set()

    function publish(next) {
      if (next.feishu === snapshot.feishu && next.wechat === snapshot.wechat) return
      snapshot = Object.freeze(next)
      for (const listener of listeners) listener()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    const getSnapshot = () => snapshot

    function channelOfSession(sessionId) {
      if (!sessionId) return ''
      if (snapshot.feishu === sessionId) return 'feishu'
      if (snapshot.wechat === sessionId) return 'wechat'
      return ''
    }

    /**
     * Poll the host route with backoff and visibility awareness.
     * @returns {() => void} disposer
     */
    function startPolling() {
      let timer
      let interval = BASE_INTERVAL_MS
      let stopped = false

      const schedule = (delay) => {
        if (stopped) return
        clearTimeout(timer)
        timer = setTimeout(tick, delay)
      }

      async function tick() {
        if (stopped) return
        if (document.hidden) {
          // Hidden pages stay quiet; visibilitychange restarts the loop.
          schedule(MAX_INTERVAL_MS)
          return
        }
        try {
          const response = await fetch(ENDPOINT, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (!payload || payload.v !== PAYLOAD_VERSION || typeof payload.bound !== 'object') {
            throw new Error('unexpected payload')
          }
          publish({
            feishu: String(payload.bound.feishu ?? ''),
            wechat: String(payload.bound.wechat ?? ''),
          })
          interval = BASE_INTERVAL_MS
        } catch {
          // Keep the last good binding; retry slower.
          interval = Math.min(MAX_INTERVAL_MS, Math.round(interval * 2))
        }
        schedule(interval)
      }

      const onVisibility = () => {
        if (document.hidden) return
        interval = BASE_INTERVAL_MS
        schedule(0)
      }
      document.addEventListener('visibilitychange', onVisibility)
      schedule(0)

      return () => {
        stopped = true
        clearTimeout(timer)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    function StatusDot({ channel, running, unread }) {
      if (!running && !unread) return null
      const label = running ? `${CHANNELS[channel].label}会话正在回答` : `${CHANNELS[channel].label}会话有新回复未读`
      return h('span', {
        'data-im-indicator-dot': running ? 'running' : 'unread',
        role: 'img',
        'aria-label': label,
        title: label,
        style: {
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: running ? '#22c55e' : '#f59e0b',
          marginInlineStart: 4,
          flex: '0 0 auto',
          pointerEvents: 'none',
          animation: running ? 'dshImIndicatorPulse 1.2s ease-in-out infinite' : undefined,
        },
      })
    }

    function ImChannelTag({ sessionId, useSessionStatus }) {
      const bound = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const channel = bound.feishu === sessionId ? 'feishu' : bound.wechat === sessionId ? 'wechat' : ''

      let status
      if (typeof useSessionStatus === 'function') {
        try {
          status = useSessionStatus((map) => map.get(sessionId))
        } catch {
          status = undefined
        }
      }

      if (!channel) return null
      const meta = CHANNELS[channel]

      return h(React.Fragment, null,
        h('span', {
          'data-im-indicator-capsule': channel,
          title: `当前绑定到${meta.label}的会话`,
          style: {
            display: 'inline-block',
            marginInlineStart: 6,
            padding: '1px 5px',
            borderRadius: 999,
            fontSize: 10,
            lineHeight: '14px',
            fontFamily: 'inherit',
            color: meta.fg,
            background: meta.bg,
            border: `1px solid ${meta.border}`,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            flex: '0 0 auto',
          },
        }, meta.label),
        h(StatusDot, {
          channel,
          running: Boolean(status?.running),
          unread: Boolean(status?.completionUnread),
        }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = '@keyframes dshImIndicatorPulse{0%,100%{opacity:1}50%{opacity:.35}}'
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-im-indicator: pulse keyframes')

        ctx.effect(() => startPolling(), 'dsh-im-indicator: bound-session poll')

        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing',
          id: 'im-indicator',
          order: 100,
        }, ImChannelTag))
      },
    }
  },
})
