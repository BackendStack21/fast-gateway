/* eslint-disable no-useless-call */

const fastProxy = require('fast-proxy')
const restana = require('restana')
const pump = require('pump')
const toArray = require('stream-to-array')
const defaultProxyHandler = (req, res, url, proxy, proxyOpts) => proxy(req, res, url, proxyOpts)
const DEFAULT_METHODS = require('restana/libs/methods').filter(method => method !== 'all')
const send = require('@polka/send-type')
const TRANSFER_ENCODING_HEADER_NAME = 'transfer-encoding'

const gateway = (opts) => {
  opts = Object.assign({
    middlewares: [],
    pathRegex: '/*'
  }, opts)

  const server = opts.server || restana(opts.restana)

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
    send(res, 200, services)
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

    // populating route middlewares
    route.middlewares = route.middlewares || []

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

    const args = [
      // path
      route.prefix + route.pathRegex,
      // route middlewares
      ...route.middlewares,
      // route handler
      handler(route, proxy, proxyHandler)
    ]

    methods.forEach(method => {
      method = method.toLowerCase()
      if (server[method]) {
        server[method].apply(server, args)
      }
    })
  })

  return server
}

const handler = (route, proxy, proxyHandler) => async (req, res, next) => {
  try {
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
  } catch (err) {
    return next(err)
  }
}

const onRequestNoOp = (req, res) => { }
const onResponse = async (req, res, stream) => {
  const chunked = stream.headers[TRANSFER_ENCODING_HEADER_NAME]
    ? stream.headers[TRANSFER_ENCODING_HEADER_NAME].endsWith('chunked')
    : false

  if (req.headers.connection === 'close' && chunked) {
    try {
      // remove transfer-encoding header
      const transferEncoding = stream.headers[TRANSFER_ENCODING_HEADER_NAME].replace(/(,( )?)?chunked/, '')
      if (transferEncoding) {
        res.setHeader(TRANSFER_ENCODING_HEADER_NAME, transferEncoding)
      } else {
        res.removeHeader(TRANSFER_ENCODING_HEADER_NAME)
      }

      if (!stream.headers['content-length']) {
      // pack all pieces into 1 buffer to calculate content length
        const resBuffer = Buffer.concat(await toArray(stream))

        // add content-length header and send the merged response buffer
        res.setHeader('content-length', '' + Buffer.byteLength(resBuffer))
        res.statusCode = stream.statusCode
        res.end(resBuffer)

        return
      }
    } catch (err) {
      res.statusCode = 500
      res.end(err.message)
    }
  }

  res.statusCode = stream.statusCode
  pump(stream, res)
}

module.exports = gateway
