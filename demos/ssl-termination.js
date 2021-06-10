'use strict'

const gateway = require('./../index')
const PORT = process.env.PORT || 4443
const https = require('https')
const pem = require('pem')

pem.createCertificate({
  days: 1,
  selfSigned: true
}, (err, keys) => {
  if (err) console.error(err)

  gateway({
    restana: {
      server: https.createServer({
        key: keys.serviceKey,
        cert: keys.certificate
      })
    },
    middlewares: [
    ],

    routes: [{
      prefix: '/api',
      target: 'http://localhost:3000'
    }]
  }).start(PORT).then(server => {
    console.log(`API Gateway listening on ${PORT} port!`)
  })

  const api = require('restana')({})
  api.get('/ssl-protected', (req, res) => {
    res.send('SSL Terminated!')
  })

  api.start(3000).then(() => console.log('API service listening on 3000 port!'))
})
