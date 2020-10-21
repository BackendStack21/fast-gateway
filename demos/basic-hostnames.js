'use strict'

const gateway = require('../index')
const PORT = process.env.PORT || 8080
const http = require('http')
const restana = require('restana')

const hostnames2prefix = [{
  prefix: '/public',
  hostname: 'nodejs.org'
}]
const hostnamesHook = require('./../lib/hostnames-hook')(hostnames2prefix)

const app = restana()
const server = http.createServer((req, res) => {
  hostnamesHook(req, res, () => {
    return app(req, res)
  })
})

gateway({
  server: app,
  middlewares: [
  ],

  routes: [{
    prefix: '/public',
    target: 'http://localhost:3000'
  }]
})

server.listen(PORT)

const origin = require('restana')({})
origin
  .get('/hi', (req, res) => res.send('Hello World!'))
  .start(3000)
