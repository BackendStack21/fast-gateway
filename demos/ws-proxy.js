'use strict'

const gateway = require('./../index')
const PORT = process.env.PORT || 8080

gateway({
  routes: [{
    // ... other HTTP or WebSocket routes
  }, {
    proxyType: 'websocket',
    prefix: '/echo',
    target: 'ws://ws.ifelse.io',
    hooks: {
      onOpen: (ws, searchParams) => {

      }
    }
  }]
}).start(PORT).then(server => {
  console.log(`API Gateway listening on ${PORT} port!`)
})
