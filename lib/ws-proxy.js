'use strict'

const micromatch = require('micromatch')
const { onOpenNoOp } = require('./default-hooks').websocket

const CONNECTING = 0
const OPEN = 1
const MAX_CLOSE_REASON_BYTES = 123
// maximum size of the messages queued while the onOpen hook is pending
const MAX_PENDING_BYTES = 1 * 1024 * 1024 // 1MB
// time other 'upgrade' listeners get to handle a socket before it is ended
const UNHANDLED_UPGRADE_TIMEOUT = 1000

// faye-websocket only accepts 1000 or 3000-4999 as close codes
const toCloseCode = (code, fallback) =>
  Number.isInteger(code) && (code === 1000 || (code >= 3000 && code <= 4999))
    ? code
    : fallback

const toCloseReason = (reason) => {
  if (typeof reason !== 'string') return ''

  const buffer = Buffer.from(reason)
  if (buffer.length <= MAX_CLOSE_REASON_BYTES) return reason

  // don't cut a multi-byte UTF-8 character in half
  let end = MAX_CLOSE_REASON_BYTES
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--

  return buffer.toString('utf8', 0, end)
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

// onAbnormalClose is called when the close code can't be relayed
const relay = (from, to, onAbnormalClose) => {
  from.on('message', (event) => to.send(event.data))
  from.on('close', (event) => {
    const code = toCloseCode(event.code)
    if (code === undefined) return onAbnormalClose()

    close(to, code, event.reason)
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
    if (server.listenerCount('upgrade') === 1) return socket.end()

    // other 'upgrade' listeners on this server may still handle the socket
    setTimeout(() => {
      if (socket.writable && socket.bytesWritten === 0) socket.end()
    }, UNHANDLED_UPGRADE_TIMEOUT).unref()
  }

  const onUpgrade = async (req, socket, body) => {
    if (!WebSocket.isWebSocket(req)) return onUnhandled(socket)

    const url = new URL('http://fw' + req.url)
    const prefix = url.pathname

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

      relay(client, remote, () => close(remote, 1000))
      // drop the client connection, so it sees an abnormal close (1006)
      relay(remote, client, () => socket.destroy())
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
