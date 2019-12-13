const fastProxy = require('fast-proxy')
const restana = require('restana')
const pump = require('pump')
const toArray = require('stream-to-array')
const defaultProxyHandler = (req, res, url, proxy, proxyOpts) => proxy(req, res, url, proxyOpts)
const DEFAULT_METHODS = require('restana/libs/methods')

const gateway = (opts) => {
  opts = Object.assign({
    middlewares: [],
    pathRegex: '/*'
  }, opts)

  const server = (opts.restana instanceof Function) ? opts.restana() : restana(opts.restana || {
    disableResponseEvent: true
  })

  // registering global middlewares
  opts.middlewares.forEach(middleware => {
    server.use(middleware)
  })

  // registering services.json
  const services = opts.routes.map(route => ({
    prefix: route.prefix,
    docs: route.docs
  }))
  server.get('/services.json', (req, res) => {
    res.send(services)
  })

  // processing routes
  opts.routes.forEach(route => {
    if (undefined === route.prefixRewrite) {
      route.prefixRewrite = ''
    }

    // populating required NOOPS
    route.hooks = route.hooks || {}
    route.hooks.onRequest = route.hooks.onRequest || onRequestNoOp
    route.hooks.onResponse = route.hooks.onResponse || onResponse

    // populating pathRegex if missing
    route.pathRegex = undefined === route.pathRegex ? opts.pathRegex : String(route.pathRegex)

    // instantiate route proxy
    const { proxy } = fastProxy({
      base: opts.targetOverride || route.target,
      http2: !!route.http2,
      ...(opts.fastProxy)
    })

    // route proxy handler function
    const proxyHandler = route.proxyHandler || defaultProxyHandler

    // populating timeout config
    route.timeout = route.timeout || opts.timeout

    // registering route handlers
    const methods = route.methods || DEFAULT_METHODS
    methods.forEach(method => {
      method = method.toLowerCase()

      if (server[method]) {
        server[method](
        // path
          route.prefix + route.pathRegex,
          // route handler
          handler(route, proxy, proxyHandler),
          // route middlewares
          route.middlewares
        )
      }
    })
  })

  return server
}

const handler = (route, proxy, proxyHandler) => async (req, res) => {
  req.url = req.url.replace(route.prefix, route.prefixRewrite)
  const shouldAbortProxy = await route.hooks.onRequest(req, res)
  if (!shouldAbortProxy) {
    const proxyOpts = Object.assign({
      request: {
        timeout: req.timeout || route.timeout
      }
    }, route.hooks)

    proxyHandler(req, res, req.url, proxy, proxyOpts)
  }
}

const onRequestNoOp = (req, res) => { }
const onResponse = async (req, res, stream) => {
  if (!res.hasHeader('content-length')) {
    try {
      const resBuffer = Buffer.concat(await toArray(stream))
      res.setHeader('content-length', '' + Buffer.byteLength(resBuffer))
      res.statusCode = stream.statusCode
      res.end(resBuffer)
    } catch (err) {
      res.send(err)
    }
  } else {
    res.statusCode = stream.statusCode
    pump(stream, res)
  }
}

module.exports = gateway
