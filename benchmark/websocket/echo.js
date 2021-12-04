'use strict'

const gateway = require('../../index')
const WebSocket = require('faye-websocket')
const http = require('http')

gateway({
  routes: [{
    proxyType: 'websocket',
    prefix: '/echo',
    target: 'ws://127.0.0.1:3000'
  }]
}).start(8080)

const service = http.createServer()
service.on('upgrade', (request, socket, body) => {
  if (WebSocket.isWebSocket(request)) {
    const ws = new WebSocket(request, socket, body)

    ws.on('message', (event) => {
      ws.send(event.data)
    })
  }
})
service.listen(3000)
