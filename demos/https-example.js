'use strict'

const gateway = require('./../index')

gateway({
  routes: [{
    prefix: '/httpbin',
    target: 'https://httpbin.org'
  }]
}).start(8080)
