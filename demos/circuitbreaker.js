'use strict'

const gateway = require('../index')
const onEnd = require('on-http-end')
const CircuitBreaker = require('opossum')

const options = {
  timeout: 1500, // If our function takes longer than "timeout", trigger a failure
  errorThresholdPercentage: 50, // When 50% of requests fail, trip the circuit
  resetTimeout: 30 * 1000 // After 30 seconds, try again.
}
const breaker = new CircuitBreaker(([req, res, url, proxy, proxyOpts]) => {
  return new Promise((resolve, reject) => {
    proxy(req, res, url, proxyOpts)
    onEnd(res, () => resolve()) // you can optionally evaluate response codes here...
  })
}, options)

breaker.fallback(([req, res], err) => {
  if (err.code === 'EOPENBREAKER') {
    res.send({
      message: 'Upps, looks like we are under heavy load. Please try again in 30 seconds!'
    }, 503)
  }
})

gateway({
  routes: [{
    proxyHandler: (...params) => breaker.fire(params),
    prefix: '/public',
    target: 'http://localhost:3000'
  }]
}).start(8080).then(() => console.log('API Gateway listening on 8080 port!'))

const service = require('restana')({})
service
  .get('/longop', (req, res) => setTimeout(() => res.send('This operation will trigger the breaker failure counter...'), 2000))
  .get('/hi', (req, res) => res.send('Hello World!'))
  .start(3000).then(() => console.log('Public service listening on 3000 port!'))
