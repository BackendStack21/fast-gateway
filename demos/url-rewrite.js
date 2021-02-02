'use strict'

const gateway = require('../index')
const PORT = process.env.PORT || 8080

gateway({
  routes: [{
    pathRegex: '',
    prefix: '/customers/:customerId',
    target: 'http://localhost:3000',
    urlRewrite: ({ params: { customerId } }) => `/users/${customerId}`
  }]
}).start(PORT).then(server => {
  console.log(`API Gateway listening on ${PORT} port!`)
})

const service = require('restana')({})
service
  .get('/users/:id', (req, res) => res.send('Hello ' + req.params.id))
  .start(3000).then(() => console.log('Service listening on 3000 port!'))
