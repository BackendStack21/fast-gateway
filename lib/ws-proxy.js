'use strict'

const WebSocket = require('faye-websocket')

function onOpenNoOp () {}

module.exports = (config) => {
  const { routes, server } = config

  const prefix2route = {}
  for (const route of routes) {
    prefix2route[route.prefix] = route
  }

  server.on('upgrade', async (req, socket, body) => {
    if (WebSocket.isWebSocket(req)) {
      const url = new URL('http://fw' + req.url)
      const route = prefix2route[url.pathname]

      if (route) {
        const subProtocols = route.subProtocols || []
        route.hooks = route.hooks || {}
        const onOpen = route.hooks.onOpen || onOpenNoOp

        const client = new WebSocket(req, socket, body, subProtocols)

        try {
          await onOpen(client, url.searchParams)

          const target = route.target + '?' + url.searchParams.toString()
          const remote = new WebSocket.Client(target, subProtocols, route.proxyConfig)

          client.pipe(remote)
          remote.pipe(client)
        } catch (err) {
          client.close(err.closeEventCode || 4500, err.message)
        }
      } else {
        socket.end()
      }
    }
  })
}
