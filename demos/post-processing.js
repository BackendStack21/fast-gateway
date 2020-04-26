'use strict'

const toArray = require('stream-to-array')
const gateway = require('../index')

gateway({
  routes: [{
    prefix: '/httpbin',
    target: 'https://httpbin.org',
    hooks: {
      async onResponse (req, res, stream) {
        // collect all streams parts
        const resBuffer = Buffer.concat(await toArray(stream))

        // parse response body, for example: JSON
        const payload = JSON.parse(resBuffer)
        // modify the response, for example adding new properties
        payload.newProperty = 'post-processing'

        // stringify response object again
        const newResponseBody = JSON.stringify(payload)

        // set new content-length header
        res.setHeader('content-length', '' + Buffer.byteLength(newResponseBody))
        // set response statusCode
        res.statusCode = stream.statusCode

        // send new response payload
        res.end(newResponseBody)
      }
    }
  }]
}).start(8080)
