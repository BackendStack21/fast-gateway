'use strict'

const gateway = require('./../index')
const PORT = process.env.PORT || 8080

gateway({
  middlewares: [
    require('cors')(),
    require('helmet')()
  ],

  routes: [{
    prefix: '/public',
    target: 'http://localhost:3000'
    /*
    // applicable in case Swagger Definitions would be supported on downstream service
    docs: {
      name: 'Public Service',
      endpoint: 'swagger.json',
      type: 'swagger'
    }
    */
  }, {
    prefix: '/admin',
    target: 'http://localhost:3001',
    middlewares: [
      require('express-jwt')({
        secret: 'shhhhhhared-secret'
      })
    ]
  }, {
    // this route definition makes http://localhost:3000 (/public) a default service if other routes prefixes are omitted
    prefix: '/*',
    pathRegex: '',
    target: 'http://localhost:3000'
  }]
}).start(PORT).then(server => {
  console.log(`API Gateway listening on ${PORT} port!`)
})

const service1 = require('restana')({})
service1
  .get('/hi', (req, res) => res.send('Hello World!'))
  .get('/hi-chunked', (req, res) => {
    res.write('Hello ')
    res.write('World!')
    res.end()
  })
  .start(3000).then(() => console.log('Public service listening on 3000 port!'))

const service2 = require('restana')({})
service2
  .get('/users', (req, res) => res.send([]))
  .start(3001).then(() => console.log('Admin service listening on 3001 port!'))
