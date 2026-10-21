'use strict'

/* eslint-disable no-useless-call */

const defaultProxyFactory = require('./lib/proxy-factory')
const restana = require('restana')
const defaultProxyHandler = (req, res, url, proxy, proxyOpts) =>
  proxy(req, res, url, proxyOpts)
const DEFAULT_METHODS = require('restana/libs/methods').BASE.filter(
  (method) => method !== 'all'
)
const NOOP = (req, res) => {}
const PROXY_TYPES = ['http', 'http-legacy', 'lambda']
const registerWebSocketRoutes = require('./lib/ws-proxy')
// "." and ".." path segments, also percent-encoded or backslash separated
// (a ";" path parameter is ignored by some upstreams, e.g. "/..;/")
const DOT_SEGMENT_REGEX = /(?:^|[/\\])(?:\.|%2e){1,2}(?:;[^/\\]*)?(?:[/\\]|$)/i

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
    prefix:
      route.prefix instanceof RegExp ? route.prefix.toString() : route.prefix,
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
    .forEach((routeConfig) => {
      // route configs can be shared between routes or gateways, don't mutate them
      const route = Object.assign({}, routeConfig)

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
        ? require('./lib/default-hooks')[
          proxyType === 'http-legacy' ? 'http' : proxyType
        ]
        : {}
      const { onRequestNoOp = NOOP, onResponse = NOOP } = hooksForDefaultType

      // populating required NOOPS
      const hooks = route.hooks || {}
      route.hooks = Object.assign({}, hooks, {
        onRequest: hooks.onRequest || onRequestNoOp,
        onResponse: hooks.onResponse || onResponse
      })

      // populating route middlewares
      route.middlewares = route.middlewares || []

      // populating pathRegex if missing
      route.pathRegex =
        route.pathRegex === undefined ? opts.pathRegex : route.pathRegex

      // instantiate route proxy
      const proxy = proxyFactory({ opts, route, proxyType })

      // route proxy handler function
      const proxyHandler = route.proxyHandler || defaultProxyHandler

      // populating timeout config, 0 disables the timeout
      route.timeout = route.timeout ?? opts.timeout

      // avoid a double slash between prefix and pathRegex, e.g. prefix: '/'
      let prefix = route.prefix
      if (
        typeof prefix === 'string' &&
        prefix.endsWith('/') &&
        route.pathRegex.startsWith('/')
      ) {
        prefix = prefix.slice(0, -1)
      }

      // registering route handlers
      const methods = route.methods || DEFAULT_METHODS

      const args = [
        // path
        prefix instanceof RegExp ? prefix : prefix + route.pathRegex,
        // route middlewares
        ...route.middlewares,
        // route handler
        handler(route, prefix, proxy, proxyHandler)
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

const hasDotSegment = (url) => {
  const queryIndex = url.indexOf('?')

  return DOT_SEGMENT_REGEX.test(
    queryIndex === -1 ? url : url.slice(0, queryIndex)
  )
}

// routes are matched case-insensitively, so the prefix is stripped the same way
const stripPrefix = (url, prefix, prefixRewrite) => {
  if (url.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) {
    return url
  }

  // avoid a double slash when prefixRewrite ends with "/", e.g. '/api/'
  const rest = url.slice(prefix.length)

  return prefixRewrite.endsWith('/') && rest.startsWith('/')
    ? prefixRewrite + rest.slice(1)
    : prefixRewrite + rest
}

// URLSearchParams(object) would join repeated parameters (arrays) with commas,
// only fast-proxy-lite ('http') stringifies queryString using URLSearchParams
const toQueryString = (query, proxyType) => {
  if (proxyType !== 'http') return query

  for (const name in query) {
    if (Array.isArray(query[name])) {
      const params = new URLSearchParams()
      for (const key in query) {
        [].concat(query[key]).forEach((value) => params.append(key, value))
      }

      return params
    }
  }

  return query
}

const handler = (route, prefix, proxy, proxyHandler) => async (req, res, next) => {
  const {
    urlRewrite,
    prefixRewrite,
    hooks,
    timeout,
    disableQsOverwrite,
    proxyType = 'http'
  } = route
  const { onRequest } = hooks

  try {
    // the upstream would resolve dot segments, escaping the route prefix
    if (hasDotSegment(req.url)) {
      res.statusCode = 400
      res.end('Bad Request')

      return
    }

    if (typeof urlRewrite === 'function') {
      req.url = urlRewrite(req)
    } else if (typeof prefix === 'string') {
      req.url = stripPrefix(req.url, prefix, prefixRewrite)
    }

    // restana shares a frozen empty req.query when there is no query string
    if (req.query && Object.isFrozen(req.query)) {
      req.query = Object.create(null)
    }

    const shouldAbortProxy = await onRequest(req, res)
    if (!shouldAbortProxy) {
      const proxyOpts = Object.assign(
        {
          queryString: disableQsOverwrite ? null : toQueryString(req.query, proxyType)
        },
        hooks,
        {
          request: Object.assign({}, hooks.request, {
            timeout: req.timeout ?? hooks.request?.timeout ?? timeout
          })
        }
      )

      await proxyHandler(req, res, req.url, proxy, proxyOpts)
    }
  } catch (err) {
    const { onError } = hooks
    if (typeof onError === 'function') {
      try {
        await onError(err, req, res)
      } catch (_) {
        // onError hook failure must not suppress the original error
      }
    }

    // the onError hook may have already sent a response
    if (!res.headersSent) {
      return next(err)
    }

    // a partially sent response can't be turned into an error response
    if (typeof onError !== 'function' && !res.writableEnded) {
      res.destroy(err)
    }
  }
}

module.exports = gateway
