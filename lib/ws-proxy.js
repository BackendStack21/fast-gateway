'use strict'

const micromatch = require('micromatch')
const { onOpenNoOp } = require('./default-hooks').websocket

module.exports = (config) => {
  const WebSocket = require('faye-websocket')

  const { routes, server } = config

  routes.forEach((route) => {
    route._isMatch = micromatch.matcher(route.prefix)
  })

  server.on('upgrade', async (req, socket, body) => {
    if (WebSocket.isWebSocket(req)) {
      const url = new URL('http://fw' + req.url)
      const prefix = url.pathname || '/'

      const route = routes.find((route) => route._isMatch(prefix))
      if (route) {
        const subProtocols = route.subProtocols || []
        route.hooks = route.hooks || {}
        const onOpen = route.hooks.onOpen || onOpenNoOp

        const client = new WebSocket(req, socket, body, subProtocols)

        try {
          await onOpen(client, url.searchParams)

          const target =
            route.target + url.pathname + '?' + url.searchParams.toString()
          const remote = new WebSocket.Client(
            target,
            subProtocols,
            route.proxyConfig
          )

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
