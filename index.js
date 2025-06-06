'use strict'

/* eslint-disable no-useless-call */

const defaultProxyFactory = require('./lib/proxy-factory')
const restana = require('restana')
const defaultProxyHandler = (req, res, url, proxy, proxyOpts) =>
  proxy(req, res, url, proxyOpts)
const DEFAULT_METHODS = require('restana/libs/methods').filter(
  (method) => method !== 'all'
)
const NOOP = (req, res) => {}
const PROXY_TYPES = ['http', 'lambda']
const registerWebSocketRoutes = require('./lib/ws-proxy')

const gateway = (opts) => {
  let proxyFactory

  if (opts.proxyFactory) {
    proxyFactory = (...args) => {
      const result = opts.proxyFactory(...args)
      return result === undefined ? defaultProxyFactory(...args) : result
    }
  } else {
    proxyFactory = defaultProxyFactory
  }

  opts = Object.assign(
    {
      middlewares: [],
      pathRegex: '/*',
      enableServicesEndpoint: true
    },
    opts
  )

  const router = opts.server || restana(opts.restana)

  // registering global middlewares
  opts.middlewares.forEach((middleware) => {
    router.use(middleware)
  })

  // registering services.json
  const services = opts.routes.map((route) => ({
    prefix: route.prefix,
    docs: route.docs
  }))
  if (opts.enableServicesEndpoint) {
    router.get('/services.json', (req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(services))
    })
  }

  // processing websocket routes
  const wsRoutes = opts.routes.filter(
    (route) => route.proxyType === 'websocket'
  )
  if (wsRoutes.length) {
    if (typeof router.getServer !== 'function') {
      throw new Error(
        'Unable to retrieve the HTTP server instance. ' +
          'If you are not using restana, make sure to provide an "app.getServer()" alternative method!'
      )
    }
    registerWebSocketRoutes({
      routes: wsRoutes,
      server: router.getServer()
    })
  }

  // processing non-websocket routes
  opts.routes
    .filter((route) => route.proxyType !== 'websocket')
    .forEach((route) => {
      if (undefined === route.prefixRewrite) {
        route.prefixRewrite = ''
      }

      // retrieve proxy type
      const { proxyType = 'http' } = route
      const isDefaultProxyType = PROXY_TYPES.includes(proxyType)
      if (!opts.proxyFactory && !isDefaultProxyType) {
        throw new Error(
          'Unsupported proxy type, expecting one of ' + PROXY_TYPES.toString()
        )
      }

      // retrieve default hooks for proxy
      const hooksForDefaultType = isDefaultProxyType
        ? require('./lib/default-hooks')[proxyType]
        : {}
      const { onRequestNoOp = NOOP, onResponse = NOOP } = hooksForDefaultType

      // populating required NOOPS
      route.hooks = route.hooks || {}
      route.hooks.onRequest = route.hooks.onRequest || onRequestNoOp
      route.hooks.onResponse = route.hooks.onResponse || onResponse

      // populating route middlewares
      route.middlewares = route.middlewares || []

      // populating pathRegex if missing
      route.pathRegex =
        route.pathRegex === undefined ? opts.pathRegex : route.pathRegex

      // instantiate route proxy
      const proxy = proxyFactory({ opts, route, proxyType })

      // route proxy handler function
      const proxyHandler = route.proxyHandler || defaultProxyHandler

      // populating timeout config
      route.timeout = route.timeout || opts.timeout

      // registering route handlers
      const methods = route.methods || DEFAULT_METHODS

      const args = [
        // path
        route.prefix instanceof RegExp
          ? route.prefix
          : route.prefix + route.pathRegex,
        // route middlewares
        ...route.middlewares,
        // route handler
        handler(route, proxy, proxyHandler)
      ]

      methods.forEach((method) => {
        method = method.toLowerCase()
        if (router[method]) {
          router[method].apply(router, args)
        }
      })
    })

  return router
}

const handler = (route, proxy, proxyHandler) => async (req, res, next) => {
  const {
    urlRewrite,
    prefix,
    prefixRewrite,
    hooks,
    timeout,
    disableQsOverwrite
  } = route
  const { onRequest } = hooks

  try {
    if (typeof urlRewrite === 'function') {
      req.url = urlRewrite(req)
    } else if (typeof prefix === 'string') {
      req.url = req.url.replace(prefix, prefixRewrite)
    }

    const shouldAbortProxy = await onRequest(req, res)
    if (!shouldAbortProxy) {
      const proxyOpts = Object.assign(
        {
          request: {
            timeout: req.timeout || timeout
          },
          queryString: disableQsOverwrite ? null : req.query
        },
        route.hooks
      )

      proxyHandler(req, res, req.url, proxy, proxyOpts)
    }
  } catch (err) {
    return next(err)
  }
}

module.exports = gateway
