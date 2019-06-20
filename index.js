const fastProxy = require('fast-proxy')
const restana = require('restana')
const pump = require('pump')
const toArray = require('stream-to-array')

const gateway = (opts) => {
  opts = Object.assign({
    middlewares: [],
    pathRegex: '/*'
  }, opts)

  const server = restana(opts.restana || {
    disableResponseEvent: true
  })

  // registering global middlewares
  opts.middlewares.forEach(middleware => {
    server.use(middleware)
  })

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
      base: route.target,
      http2: !!route.http2,
      ...(opts.fastProxy)
    })

    // registering route handler
    const methods = route.methods || ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']
    server.route(methods, route.prefix + route.pathRegex, handler(route, proxy), null, route.middlewares)
  })

  return server
}

const handler = (route, proxy) => async (req, res) => {
  req.url = req.url.replace(route.prefix, route.prefixRewrite)
  const shouldAbortProxy = await route.hooks.onRequest(req, res)
  if (!shouldAbortProxy) {
    proxy(req, res, req.url, Object.assign({}, route.hooks))
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
