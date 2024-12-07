// Gateway implementation

'use strict'

const gateway = require('../index')
const ConsistentHash = require('consistent-hash')

const targets = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002'
]

const consistentHash = new ConsistentHash()
targets.forEach((target) => consistentHash.add(target))

gateway({
  routes: [
    {
      proxyHandler: (req, res, url, proxy, proxyOpts) => {
        const target = consistentHash.get(req.path)
        proxyOpts.base = target

        return proxy(req, res, url, proxyOpts)
      },
      prefix: '/api'
    }
  ]
})
  .start(8080)
  .then(() => console.log('API Gateway listening on 8080 port!'))

// Below is the services implementation, commonly located on separated projects
const express = require('express')

// service1.js
const service1 = express()
service1.get('/orders/:orderId', (req, res) => {
  res.header('Service-Id', 'service1')
  res.send('Order from service 1!')
})
service1.listen(3000, () => {
  console.log('Service 1 running!')
})

// service2.js
const service2 = express()

service2.get('/orders/:orderId', (req, res) => {
  res.header('Service-Id', 'service2')
  res.send('Order from service 2!')
})

service2.listen(3001, () => {
  console.log('Service 2 running!')
})

// service3.js
const service3 = express()

service3.get('/orders/:orderId', (req, res) => {
  res.header('Service-Id', 'service3')
  res.send('Order from service 3!')
})

service3.listen(3002, () => {
  console.log('Service 3 running!')
})
