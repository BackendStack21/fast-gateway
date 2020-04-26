'use strict'

const gateway = require('../index')
const rateLimit = require('express-rate-limit')
const requestIp = require('request-ip')

gateway({
  middlewares: [
    // acquire request IP
    (req, res, next) => {
      req.ip = requestIp.getClientIp(req)
      return next()
    },
    // rate limiter
    rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minutes
      max: 60, // limit each IP to 60 requests per windowMs
      handler: (req, res) => {
        res.send('Too many requests, please try again later.', 429)
      }
    })
  ],
  routes: [{
    prefix: '/public',
    target: 'http://localhost:3000'
  }]
}).start(8080).then(() => console.log('API Gateway listening on 8080 port!'))

const service = require('restana')({})
service
  .get('/hi', (req, res) => res.send('Hello World!'))
  .start(3000).then(() => console.log('Public service listening on 3000 port!'))
