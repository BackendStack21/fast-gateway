'use strict'

const gateway = require('../index')
const { P2cBalancer } = require('load-balancers')
const lambdaProxy = require('http-lambda-proxy')

// @TODO: update the list of target origins or proxy instances
const targets = [
  'http://localhost:3000',
  lambdaProxy({
    target: process.env.FUNCTION_NAME,
    region: process.env.AWS_REGION
  })
]
const balancer = new P2cBalancer(targets.length)

gateway({
  routes: [{
    proxyHandler: (req, res, url, proxy, proxyOpts) => {
      const target = targets[balancer.pick()]
      if (typeof target === 'string') {
        proxyOpts.base = target
      } else {
        proxy = target
      }

      return proxy(req, res, url, proxyOpts)
    },
    prefix: '/balanced'
  }]
}).start(8080).then(() => console.log('API Gateway listening on 8080 port!'))

const service = require('restana')({})
service
  .get('/get', (req, res) => res.send({ msg: 'Hello from service 1!' }))
  .start(3000).then(() => console.log('Public service listening on 3000 port!'))

// Usage: curl 'http://localhost:8080/balanced/get'
