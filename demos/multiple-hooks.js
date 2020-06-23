'use strict'

const gateway = require('./../index')
const PORT = process.env.PORT || 8080

const { multipleHooks } = require('fg-multiple-hooks')

const hook1 = async (req, res) => {
  console.log('hook1 with logic 1 called')
  // res.send('hook failed here');
  return false // do not abort the request
}

const hook2 = async (req, res) => {
  console.log('hook2 with logic 2 called')
  const shouldAbort = true
  if (shouldAbort) {
    res.send('handle a rejected request here')
  }
  return shouldAbort
}

gateway({
  routes: [{
    prefix: '/service',
    target: 'http://127.0.0.1:3000',
    hooks: {
      onRequest: (req, res) => multipleHooks(req, res, hook1, hook2), // you can add as many hooks as you please
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
