/* eslint-disable prefer-regex-literals */

'use strict'

const gateway = require('../index')
const express = require('express')
const PORT = process.env.PORT || 8080

gateway({
  server: express(),

  middlewares: [require('cors')(), require('helmet')()],

  routes: [
    {
      prefix: new RegExp('/public/.*'), // Express.js v5 requires a RegExp object
      // prefix: '/public', // Compatible with Express.js v4,

      urlRewrite: (req) => req.url.replace('/public', ''),
      target: 'http://localhost:3000',
      docs: {
        name: 'Public Service',
        endpoint: 'swagger.json',
        type: 'swagger'
      }
    },
    {
      prefix: new RegExp('/admin/.*'), // Express.js v5 requires a RegExp object
      // prefix: '/admin', // Compatible with Express.js v4,
      target: 'http://localhost:3001',
      middlewares: [
        /*
        require('express-jwt').expressjwt({
          secret: 'shhhhhhared-secret',
          algorithms: ['HS256'],
        }),
        */
      ]
    }
  ]
}).listen(PORT, () => {
  console.log(`API Gateway listening on ${PORT} port!`)
})

const service1 = require('restana')({})
service1
  .get('/hi', (req, res) => res.send('Hello World!'))
  .start(3000)
  .then(() => console.log('Public service listening on 3000 port!'))

const service2 = require('restana')({})
service2
  .get('/admin/users', (req, res) => res.send([]))
  .start(3001)
  .then(() => console.log('Admin service listening on 3001 port!'))
