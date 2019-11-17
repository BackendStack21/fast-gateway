const gateway = require('../index')
const PORT = process.env.PORT || 8080
const onEnd = require('on-http-end')
const CircuitBreaker = require('opossum')

const REQUEST_TIMEOUT = 1.5 * 1000

const options = {
  timeout: REQUEST_TIMEOUT - 200, // If our function takes longer than "timeout", trigger a failure
  errorThresholdPercentage: 50, // When 50% of requests fail, trip the circuit
  resetTimeout: 30 * 1000 // After 30 seconds, try again.
}
const breaker = new CircuitBreaker(([req, res, url, proxy, proxyOpts]) => {
  return new Promise((resolve, reject) => {
    proxy(req, res, url, proxyOpts)
    onEnd(res, () => {
      // you can optionally evaluate response codes here...
      resolve()
    })
  })
}, options)

breaker.fallback(([req, res], err) => {
  if (err.code === 'EOPENBREAKER') {
    res.send({
      message: 'Upps, looks like "public" service is down. Please try again in 30 seconds!'
    }, 503)
  }
})

gateway({
  routes: [{
    timeout: REQUEST_TIMEOUT,
    proxyHandler: (...params) => breaker.fire(params),
    prefix: '/public',
    target: 'http://localhost:3000',
    docs: {
      name: 'Public Service',
      endpoint: 'swagger.json',
      type: 'swagger'
    }
  }]
}).start(PORT).then(() => {
  console.log(`API Gateway listening on ${PORT} port!`)
})

const service = require('restana')({})
service.get('/longop', (req, res) => {
  setTimeout(() => {
    res.send('This operation will trigger the breaker failure counter...')
  }, 2000)
})
service.get('/hi', (req, res) => {
  res.send('Hello World!')
})

service.start(3000).then(() => {
  console.log('Public service listening on 3000 port!')
})
