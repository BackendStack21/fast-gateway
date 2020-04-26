'use strict'

const gateway = require('./../index')
const PORT = process.env.PORT || 8080

gateway({
  routes: [{
    prefix: '/service',
    target: 'http://127.0.0.1:3000',
    hooks: {
      async onRequest (req, res) {
        // you can alter the request object here
        // adding headers:
        req.headers['x-header'] = 'value'
      },
      rewriteHeaders (headers) {
        // you can alter response headers here
        return headers
      },
      onResponse (req, res, stream) {
        // you can alter the origin response and remote response here
        // default implementation explained here:
        // https://www.npmjs.com/package/fast-gateway#onresponse-hook-default-implementation
      }
    }
  }]
}).start(PORT).then(server => {
  console.log(`API Gateway listening on ${PORT} port!`)
})
