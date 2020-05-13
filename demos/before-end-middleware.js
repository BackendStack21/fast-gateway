'use strict'

const gateway = require('./../index')
const PORT = process.env.PORT || 8080

const middleware503to404 = (req, res, next) => {
  const end = res.end
  res.end = function (...args) {
    if (res.statusCode === 503) {
      res.statusCode = 404
    }
    return end.apply(res, args)
  }

  return next()
}

gateway({
  routes: [{
    prefix: '/service',
    target: 'http://127.0.0.1:3000',
    middlewares: [
      middleware503to404
    ]
  }]
}).start(PORT).then(server => {
  console.log(`API Gateway listening on ${PORT} port!`)
})
