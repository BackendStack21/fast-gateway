'use strict'

/* eslint-disable no-useless-call */

const defaultProxyFactory = require('./lib/proxy-factory')
const restana = require('restana')
const defaultProxyHandler = (req, res, url, proxy, proxyOpts) => proxy(req, res, url, proxyOpts)
const DEFAULT_METHODS = require('restana/libs/methods').filter(method => method !== 'all')
const send = require('@polka/send-type')
const PROXY_TYPES = ['http', 'lambda']
const registerWebSocketRoutes = require('./lib/ws-proxy')

const gateway = (opts) => {
  const proxyFactory = opts.proxyFactory || defaultProxyFactory

  opts = Object.assign({
    middlewares: [],
    pathRegex: '/*'
  }, opts)

  const router = opts.server || restana(opts.restana)

  // registering global middlewares
  opts.middlewares.forEach(middleware => {
    router.use(middleware)
  })

  // registering services.json
  const services = opts.routes.map(route => ({
    prefix: route.prefix,
    docs: route.docs
  }))
  router.get('/services.json', (req, res) => {
    send(res, 200, services)
  })

  // processing websocket routes
  const wsRoutes = opts.routes.filter(route => route.proxyType === 'websocket')
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
  opts.routes.filter(route => route.proxyType !== 'websocket').forEach(route => {
    if (undefined === route.prefixRewrite) {
      route.prefixRewrite = ''
    }

    // retrieve proxy type
    const { proxyType = 'http' } = route
    if (!PROXY_TYPES.includes(proxyType)) {
      throw new Error('Unsupported proxy type, expecting one of ' + PROXY_TYPES.toString())
    }

    // retrieve default hooks for proxy
    const { onRequestNoOp, onResponse } = require('./lib/default-hooks')[proxyType]

    // populating required NOOPS
    route.hooks = route.hooks || {}
    route.hooks.onRequest = route.hooks.onRequest || onRequestNoOp
    route.hooks.onResponse = route.hooks.onResponse || onResponse

    // populating route middlewares
    route.middlewares = route.middlewares || []

    // populating pathRegex if missing
    route.pathRegex = undefined === route.pathRegex ? opts.pathRegex : String(route.pathRegex)

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
      route.prefix + route.pathRegex,
      // route middlewares
      ...route.middlewares,
      // route handler
      handler(route, proxy, proxyHandler)
    ]

    methods.forEach(method => {
      method = method.toLowerCase()
      if (router[method]) {
        router[method].apply(router, args)
      }
    })
  })

  return router
}

const handler = (route, proxy, proxyHandler) => async (req, res, next) => {
  try {
    req.url = route.urlRewrite
      ? route.urlRewrite(req)
      : req.url.replace(route.prefix, route.prefixRewrite)
    const shouldAbortProxy = await route.hooks.onRequest(req, res)
    if (!shouldAbortProxy) {
      const proxyOpts = Object.assign({
        request: {
          timeout: req.timeout || route.timeout
        },
        queryString: route.disableQsOverwrite ? null : req.query
      }, route.hooks)

      proxyHandler(req, res, req.url, proxy, proxyOpts)
    }
  } catch (err) {
    return next(err)
  }
}

module.exports = gateway
