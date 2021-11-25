const http = require('http')
const WebSocket = require('faye-websocket')

const server = http.createServer()

server.on('upgrade', (request, socket, body) => {
  const client = new WebSocket(request, socket, body)
  const target = new WebSocket.Client('ws://ws.ifelse.io')

  client.pipe(target)
  target.pipe(client)
})

server.listen(3000)