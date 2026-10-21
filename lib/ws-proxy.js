'use strict'

const micromatch = require('micromatch')
const { onOpenNoOp } = require('./default-hooks').websocket

const CONNECTING = 0
const OPEN = 1
const MAX_CLOSE_REASON_BYTES = 123
// maximum size of the messages queued while the onOpen hook is pending
const MAX_PENDING_BYTES = 1 * 1024 * 1024 // 1MB

// faye-websocket only accepts 1000 or 3000-4999 as close codes
const toCloseCode = (code, fallback) =>
  Number.isInteger(code) && (code === 1000 || (code >= 3000 && code <= 4999))
    ? code
    : fallback

const toCloseReason = (reason) => {
  reason = typeof reason === 'string' ? reason : ''
  while (Buffer.byteLength(reason) > MAX_CLOSE_REASON_BYTES) {
    reason = reason.slice(0, -1)
  }

  return reason
}

const close = (ws, code, reason) => {
  if (ws.readyState === CONNECTING || ws.readyState === OPEN) {
    ws.close(code, toCloseReason(reason))
  }
}

// resolves once the opening handshake has either completed or failed
const handshake = (ws) =>
  new Promise((resolve) => {
    if (ws.readyState !== CONNECTING) return resolve()
    ws.once('open', resolve)
    ws.once('close', resolve)
  })

const relay = (from, to) => {
  from.on('message', (event) => {
    if (to.send(event.data) === false) from.pause()
  })
  to.on('drain', () => from.resume())
  from.on('close', (event) => {
    const code = toCloseCode(event.code, 1000)
    close(to, code, code === event.code ? event.reason : '')
  })
}

module.exports = (config) => {
  const WebSocket = require('faye-websocket')

  const { routes, server } = config

  const matchers = routes.map((route) => ({
    route,
    isMatch: micromatch.matcher(route.prefix)
  }))

  const onUnhandled = (socket) => {
    // other 'upgrade' listeners on this server may still handle the socket
    if (server.listenerCount('upgrade') === 1) socket.end()
  }

  const onUpgrade = async (req, socket, body) => {
    if (!WebSocket.isWebSocket(req)) return onUnhandled(socket)

    const url = new URL('http://fw' + req.url)
    const prefix = url.pathname || '/'

    const match = matchers.find((matcher) => matcher.isMatch(prefix))
    if (!match) return onUnhandled(socket)

    const { route } = match

    const subProtocols = route.subProtocols || []
    const onOpen = (route.hooks && route.hooks.onOpen) || onOpenNoOp

    const client = new WebSocket(req, socket, body, subProtocols)

    // queue messages received while the onOpen hook is pending
    const pending = []
    let pendingBytes = 0
    const queue = (event) => {
      pendingBytes += Buffer.byteLength(event.data)
      if (pendingBytes > MAX_PENDING_BYTES) {
        client.removeListener('message', queue)
        pending.length = 0
        close(client, 4413, 'Too much data before the connection was ready')

        return
      }
      pending.push(event.data)
    }
    client.on('message', queue)

    try {
      await onOpen(client, url.searchParams)
      await handshake(client)
      if (client.readyState !== OPEN) return

      const target = route.target + url.pathname + url.search
      const remote = new WebSocket.Client(
        target,
        client.protocol ? [client.protocol] : [],
        route.proxyConfig
      )

      client.removeListener('message', queue)
      pending.forEach((data) => remote.send(data))

      relay(client, remote)
      relay(remote, client)
    } catch (err) {
      await handshake(client)
      close(
        client,
        toCloseCode(err && err.closeEventCode, 4500),
        err && err.message
      )
    }
  }

  server.on('upgrade', (req, socket, body) => {
    onUpgrade(req, socket, body).catch(() => socket.destroy())
  })
}
