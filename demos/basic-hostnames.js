'use strict'

const gateway = require('../index')
const PORT = process.env.PORT || 8080
const http = require('http')
const restana = require('restana')

// binding hostnames to prefixes
const hostnames2prefix = [{
  prefix: '/api',
  hostname: 'api.company.tld'
}]
// instantiate hostnames hook, this will prefix request urls according to data in hostnames2prefix
const hostnamesHook = require('./../lib/hostnames-hook')(hostnames2prefix)

// separately instantiate and configure restana application
const app = restana()
const server = http.createServer((req, res) => {
  hostnamesHook(req, res, () => {
    return app(req, res)
  })
})

// gateway configuration
gateway({
  server: app, // injecting existing restana application
  middlewares: [
  ],

  routes: [{
    prefix: '/api',
    target: 'http://localhost:3000'
  }]
})

server.listen(PORT)

const origin = require('restana')({})
origin
  .get('/hi', (req, res) => res.send('Hello World!'))
  .start(3000)
