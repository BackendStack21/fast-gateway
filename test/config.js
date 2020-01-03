const pump = require('pump')

module.exports = async () => {
  return {
    timeout: 1.5 * 1000,

    middlewares: [
      require('cors')(),
      require('http-cache-middleware')()
    ],

    routes: [{
      pathRegex: '',
      prefix: '/endpoint-proxy',
      prefixRewrite: '/endpoint-proxy',
      target: 'http://localhost:3000',
      middlewares: [(req, res, next) => {
        req.cacheDisabled = true

        return next()
      }],
      hooks: {
        async onRequest (req, res) {},
        onResponse (req, res, stream) { pump(stream, res) }
      }
    }, {
      prefix: '/users/response-time',
      prefixRewrite: '',
      target: 'http://localhost:3000',
      middlewares: [require('response-time')()],
      hooks: {
        rewriteHeaders (headers) {
          headers['post-processed'] = true

          return headers
        }
      }
    }, {
      prefix: '/users/proxy-aborted',
      target: 'http://localhost:5000',
      hooks: {
        async onRequest (req, res) {
          res.setHeader('x-cache-timeout', '1 second')
          res.statusCode = 200
          res.end('Hello World!')

          return true
        }
      }
    }, {
      prefix: '/users/on-request-error',
      target: 'http://localhost:3000',
      hooks: {
        async onRequest (req, res) {
          throw new Error('ups, pre-processing error...')
        }
      }
    }, {
      prefix: '/users',
      target: 'http://localhost:3000',
      docs: {
        name: 'Users Service',
        endpoint: 'swagger.json',
        type: 'swagger'
      }
    },
    {
      pathRegex: '',
      prefix: '/endpoint-proxy-methods',
      prefixRewrite: '/endpoint-proxy-methods',
      target: 'http://localhost:3000',
      methods: ['GET', 'POST']
    },
    {
      pathRegex: '',
      prefix: '/endpoint-proxy-methods-put',
      prefixRewrite: '/endpoint-proxy-methods-put',
      target: 'http://localhost:3000',
      methods: ['PUT']
    }]
  }
}
