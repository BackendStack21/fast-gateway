const gateway = require('./../index')
const PORT = process.env.PORT || 8080

gateway({
  middlewares: [
    require('cors')(),
    require('helmet')()
  ],

  routes: [{
    prefix: '/public',
    target: 'http://public.myapp:300'
  }, {
    prefix: '/admin',
    target: 'http://admin.myapp:3000',
    middlewares: [
      require('express-jwt')({
        secret: 'shhhhhhared-secret'
      })
    ]
  }]
}).start(PORT).then(server => {
  console.log(`API Gateway listening on ${PORT} port!`)
})
