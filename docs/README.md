# Introduction

[![tests](https://github.com/BackendStack21/fast-gateway/actions/workflows/tests.yaml/badge.svg)](https://github.com/BackendStack21/fast-gateway/actions/workflows/tests.yaml)
[![NPM version](https://badgen.net/npm/v/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![NPM Total Downloads](https://badgen.net/npm/dt/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![License](https://badgen.net/npm/license/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![TypeScript support](https://badgen.net/npm/types/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![Github stars](https://badgen.net/github/stars/jkyberneees/fast-gateway?icon=github)](https://github.com/jkyberneees/fast-gateway)

<img src="fast-gateway-logo.svg" width="400">

A super fast, framework agnostic Node.js API Gateway for the masses ❤️  
_Docker images: https://hub.docker.com/repository/docker/kyberneees/rproxy_

> Since v2.3.0, [AWS Lambda](https://www.youtube.com/watch?v=EBSdyoO3goc) proxying integration is supported via [`http-lambda-proxy`](https://www.npmjs.com/package/http-lambda-proxy) 🔥  
> Since v3.1.0, WebSockets proxying is supported via [`faye-websocket`](https://www.npmjs.com/package/faye-websocket) 🔥

Read more online:

- A “.js” API Gateway for the masses: https://itnext.io/a-js-api-gateway-for-the-masses-a12fdb9e961c

# Install

```js
npm i fast-gateway
```

# Usage

Next we describe two examples proxying HTTP and Lambda downstream services.

> For simplicity of reading, both examples are separated, however a single gateway configuration supports all routes configurations.

## HTTP proxying

### Gateway

```js
const gateway = require('fast-gateway')
const server = gateway({
  routes: [
    {
      prefix: '/service',
      target: 'http://127.0.0.1:3000',
    },
  ],
})

server.start(8080)
```

### Remote Service

```js
const service = require('restana')()
service.get('/get', (req, res) => res.send('Hello World!'))

service.start(3000)
```

## AWS Lambda proxying

### Gateway

```bash
npm i http-lambda-proxy
```

```js
const gateway = require('fast-gateway')
const server = gateway({
  routes: [
    {
      prefix: '/service',
      target: 'my-lambda-serverless-api',
      proxyType: 'lambda',
      proxyConfig: {
        region: 'eu-central-1',
      },
    },
  ],
})

server.start(8080)
```

> You might also want to read: [Setting AWS Credentials in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html)

### Function implementation

```js
const serverless = require('serverless-http')
const json = require('serverless-json-parser')
const restana = require('restana')

const service = restana()
service.use(json())

// routes
service.get('/get', (req, res) => {
  res.send({msg: 'Go Serverless!'})
})
service.post('/post', (req, res) => {
  res.send(req.body)
})

// export handler
module.exports.handler = serverless(service)
```

# Configuration options explained

```js
{
  // Optional server instance. Any HTTP framework that supports the following signature is compatible:
  // - server[HTTP_METHOD](pattern, [middleware1, middleware2,], handler)
  //
  // Known compatible frameworks: Restana, Express.js
  // If omitted, restana is used as default HTTP framework
  server,
  // Optional restana library configuration (https://www.npmjs.com/package/restana#configuration)
  // Please note that if "server" is provided, this settings are ignored.
  restana: {},
  // Optional global middlewares in the format: (req, res, next) => next()
  // Default value: []
  middlewares: [],
  // Optional global value for routes "pathRegex". Default value: '/*'
  pathRegex: '/*',
  // Optional global requests timeout value (given in milliseconds). Default value: '0' (DISABLED)
  // Ignored if proxyType = 'lambda'
  timeout: 0,
  // Optional "target" value that overrides the routes "target" config value. Feature intended for testing purposes.
  targetOverride: "https://yourdev.api-gateway.com",
  // Optional "Proxy Factory" implementation, allows integration of custom proxying strategies.
  // Behavior:
  // - If it returns any value (e.g. a custom proxy), that value will be used directly.
  // - If it returns `undefined` (or does not return anything), the default factory from `fast-gateway` will be used as a fallback.
  // - If it returns `null`, no proxy will be used and the default factory will be skipped entirely.
  // Default: the built-in proxy factory from `fast-gateway`
  proxyFactory: ({ proxyType, opts, route }) => {...}
   // Optional toggle for exposing minimal documentation of registered services at `GET /services.json`
   // Default value: true
  enableServicesEndpoint: true

  // HTTP proxy
  routes: [{
    // Optional proxy type definition. Supported values: http, http-legacy, lambda
    // Modules:
    // - http: fast-proxy-lite
    // - http-legacy: fast-proxy
    // - lambda: http-lambda-proxy
    // Default value: http
    proxyType: 'http'
    // Optional proxy library configuration:
    // - fast-proxy-lite: https://www.npmjs.com/package/fast-proxy-lite#options
    // - fast-proxy: https://www.npmjs.com/package/fast-proxy#options
    // - http-lambda-proxy: https://www.npmjs.com/package/http-lambda-proxy#options
    // Default value: {}
    proxyConfig: {},
    // Optional proxy handler function. Default value: (req, res, url, proxy, proxyOpts) => proxy(req, res, url, proxyOpts)
    proxyHandler: () => {},
    // Optional path matching regex. Default value: '/*'
    // In order to disable the 'pathRegex' at all, you can use an empty string: ''. Please note, when prefix is instance of RegExp, this setting is ignored.
    pathRegex: '/*',
    // Optional service requests timeout value (given in milliseconds). Default value: '0' (DISABLED)
    // This setting apply only when proxyType = 'http'
    timeout: 0,
    // Route prefix, defined as string or as a RegExp instance.
    prefix: '/public',
    // Uses the raw request query string value instead of req.query. Default value: false
    disableQsOverwrite: true,
    // Optional documentation configuration (unrestricted schema)
    docs: {
      name: 'Public Service',
      endpoint: '/api-docs',
      type: 'swagger'
    },
    // Optional "prefix rewrite" before request is forwarded. Default value: ''
    prefixRewrite: '',
    // Optional "url rewrite" hook. If defined, the prefixRewrite setting is ignored.
    urlRewrite: (req) => req.url,
    // Remote HTTP server URL to forward the request.
    // If proxyType = 'lambda', the value is the name of the Lambda function, version, or alias.
    target: 'http://localhost:3000',
    // Optional HTTP methods to limit the requests proxy to certain verbs only
    // Supported HTTP methods: ['GET', 'DELETE', 'PATCH', 'POST', 'PUT', 'HEAD', 'OPTIONS', 'TRACE']
    methods: ['GET', 'POST', ...],
    // Optional route level middlewares. Default value: []
    middlewares: [],
    // Optional proxy lifecycle hooks. Default value: {}
    hooks: {
      async onRequest (req, res) {
      //   // we can optionally reply from here if required
      //   res.end('Hello World!')
      //
      //   // we can optionally update the request query params from here if required
      //   req.query.category = 'js'
      //
      //   return true // truthy value returned will abort the request forwarding
      },
      onResponse (req, res, stream) {
        // do some post-processing here
        // ...
      }

      // if proxyType= 'http', other options allowed https://www.npmjs.com/package/fast-proxy-lite#opts
    }
  }]
}
```

## Default hooks

For developers reference, default hooks implementation are located in `lib/default-hooks.js` file.

# The "_GET /services.json_" endpoint

Since version `1.3.5` the gateway exposes minimal documentation about registered services at: `GET /services.json`

Since version `4.2.0`, the `/services.json` route can be disabled by setting `enableServicesEndpoint: false` in the gateway options.

Example output:

```json
[
  {
    "prefix": "/public",
    "docs": {
      "name": "Public Service",
      "endpoint": "/swagger.json",
      "type": "swagger"
    }
  },
  {
    "prefix": "/admin"
  }
]
```

> NOTE: Please see `docs` configuration entry explained above.

# WebSockets

WebSockets proxying is supported since `v3.1.0`. Main considerations:

- The `faye-websocket` module dependency require to be installed:
  ```bash
  npm i faye-websocket
  ```
- WebSockets middlewares are not supported.
- WebSocketRoute configuration definition:

  ```ts
  interface WebSocketRoute {
    proxyType: 'websocket'
    // https://github.com/faye/faye-websocket-node#initialization-options
    proxyConfig?: {}
    // used as micromatch matcher pattern: https://www.npmjs.com/package/micromatch
    // prefix examples: '/graphql', '/ws-all/*', ['/rtp', '/rtp/*.flv'], '!/media/*.avi'
    prefix: string
    target: string
    // https://github.com/faye/faye-websocket-node#subprotocol-negotiation
    subProtocols?: []
    hooks?: WebSocketHooks
  }

  interface WebSocketHooks {
    onOpen?: (ws: any, searchParams: URLSearchParams) => Promise<void>
  }
  ```

- The `/` route prefix is considered the default route.

## Configuration example

```js
gateway({
  routes: [
    {
      // ... other HTTP or WebSocket routes
    },
    {
      proxyType: 'websocket',
      prefix: '/echo',
      target: 'ws://ws.ifelse.io',
    },
  ],
}).start(PORT)
```

# Traffic Management

## Timeouts and Unavailability

We can restrict requests timeouts globally or at service level using the `timeout` configuration.

You can also define endpoints specific timeout using the property `timeout` of the request object, normally inside a middleware:

```js
req.timeout = 500 // define a 500ms timeout on a custom request.
```

> NOTE: You might want to also check https://www.npmjs.com/package/middleware-if-unless

## Circuit Breakers

By using the `proxyHandler` hook, developers can optionally intercept and modify the default gateway routing behavior right before the origin request is proxied to the remote service. Therefore, connecting advanced monitoring mechanisms like [Circuit Breakers](https://martinfowler.com/bliki/CircuitBreaker.html) is rather simple.

Please see the `demos/circuitbreaker.js` example for more details using the `opossum` library.

## Rate Limiting

[Rate limiting](https://en.wikipedia.org/wiki/Rate_limiting), as well many other gateway level features can be easily implemented using `fast-gateway`:

```js
const rateLimit = require('express-rate-limit')
const requestIp = require('request-ip')

gateway({
  middlewares: [
    // first acquire request IP
    (req, res, next) => {
      req.ip = requestIp.getClientIp(req)
      return next()
    },
    // second enable rate limiter
    rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minutes
      max: 60, // limit each IP to 60 requests per windowMs
      handler: (req, res) =>
        res.send('Too many requests, please try again later.', 429),
    }),
  ],

  // your downstream services
  routes: [
    {
      prefix: '/public',
      target: 'http://localhost:3000',
    },
    {
      // ...
    },
  ],
})
```

> In this example we have used the [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) module.

# Hostnames support

We can also implement hostnames support with fast-gateway, basically we translate hostnames to prefixes:

```js
...

// binding hostnames to prefixes
const hostnames2prefix = [{
  prefix: '/api',
  hostname: 'api.company.tld'
}]
// instantiate hostnames hook, this will prefix request urls according to data in hostnames2prefix
const hostnamesHook = require('fast-gateway/lib/hostnames-hook')(hostnames2prefix)

// separately instantiate and configure restana application
const app = restana()
const server = http.createServer((req, res) => {
  hostnamesHook(req, res, () => {
    return app(req, res)
  })
})

// gateway configuration
gateway({
  server: app, // injecting existing restana application
  routes: [{
    prefix: '/api',
    target: 'http://localhost:3000'
  }]
})

...
```

> Afterwards:  
> `curl --header "Host: api.company.tld:8080" http://127.0.0.1:8080/api-service-endpoint`

Using micromatch patterns as hostname value:

```js
const hostnames2prefix = [
  {
    prefix: '/admin',
    hostname: '*.admin.company.tld',
  },
  {
    prefix: '/services',
    hostname: ['services.company.tld', '*.services.company.tld'],
  },
]
```

For more details, please checkout the `basic-hostnames.js` demo.

# Caching

Caching support is provided by the `http-cache-middleware` module. https://www.npmjs.com/package/http-cache-middleware

## Introduction

Enabling proper caching strategies at gateway level will drastically reduce the latency of your system,
as it reduces network round-trips and remote services processing.  
We are talking here about improvements in response times from `X ms` to `~2ms`, as an example.

> We use the `http-cache-middleware` module to support gateway level caching. Read more about it: https://github.com/jkyberneees/http-cache-middleware

## Caching responses from all services

### Single node cache (memory)

```js
// cache middleware
const cache = require('http-cache-middleware')()
// enable http cache middleware
const gateway = require('fast-gateway')
const server = gateway({
  middlewares: [cache],
  routes: [...]
})
```

> Memory storage is recommended if there is only one gateway instance and you are not afraid of losing cache data.

### Multi nodes cache (redis)

```js
// redis setup
const CacheManager = require('cache-manager')
const redisStore = require('cache-manager-ioredis')
const redisCache = CacheManager.caching({
  store: redisStore,
  db: 0,
  host: 'localhost',
  port: 6379,
  ttl: 30
})

// cache middleware
const cache = require('http-cache-middleware')({
  stores: [redisCache]
})

// enable http cache middleware
const gateway = require('fast-gateway')
const server = gateway({
  middlewares: [cache],
  routes: [...]
})
```

> Required if there are more than one gateway instances

## Enabling caching on remote services

https://github.com/jkyberneees/http-cache-middleware#enabling-cache-for-service-endpoints

## Cache invalidation

https://github.com/jkyberneees/http-cache-middleware#invalidating-caches

## Custom cache keys

Cache keys are generated using: `req.method + req.url`, however, for indexing/segmenting requirements it makes sense to allow cache keys extensions.  
Unfortunately, this feature can't be implemented at remote service level, because the gateway needs to know the entire lookup key when a request
reaches the gateway.

For doing this, we simply recommend using middlewares on the service configuration:

```js
routes: [
  {
    prefix: '/users',
    target: 'http://localhost:3000',
    middlewares: [
      (req, res, next) => {
        req.cacheAppendKey = (req) => req.user.id // here cache key will be: req.method + req.url + req.user.id
        return next()
      },
    ],
  },
]
```

> In this example we also distinguish cache entries by `user.id`, very common case!

## Disabling caching programmatically

You can also disable cache checks for certain requests programmatically:

```js
routes: [
  {
    prefix: '/users',
    target: 'http://localhost:3000',
    middlewares: [
      (req, res, next) => {
        req.cacheDisabled = true
        return next()
      },
    ],
  },
]
```

# Related projects

- middleware-if-unless (https://www.npmjs.com/package/middleware-if-unless)
- fast-proxy-lite (https://www.npmjs.com/package/fast-proxy-lite)
- http-lambda-proxy (https://www.npmjs.com/package/http-lambda-proxy)
- restana (https://www.npmjs.com/package/restana)

# Benchmarks

https://github.com/jkyberneees/nodejs-proxy-benchmarks

# Sponsors

- (INACTIVE) Kindly sponsored by [ShareNow](https://www.share-now.com/), a company that promotes innovation!

# Support / Donate 💚

You can support the maintenance of this project:

- PayPal: https://www.paypal.me/kyberneees
- [TRON](https://www.binance.com/en/buy-TRON) Wallet: `TJ5Bbf9v4kpptnRsePXYDvnYcYrS5Tyxus`

# Breaking Changes

## v3.x

- The `fast-proxy-lite` module is used by default to support `http` proxy type 🔥. This means, no `undici` or `http2` are supported by default.
- The old `fast-proxy` module is available under the `http-legacy` proxy type, but the module is not installed by default.
- Proxy configuration is now generalized under the `proxyConfig` property.

# Express.js v5 compatibility

Since `v5.0.0`, Express.js has introduced a breaking change that affects the compatibility with `fast-gateway`. Changes in [Path route matching syntax](https://expressjs.com/en/guide/migrating-5.html#path-syntax) require a minor adjustment in the gateway configuration.

Before:

```js
{
  prefix: '/public',
  // ...
}
```

After:

```js
{
  prefix: new RegExp('/public/.*'),
  urlRewrite: (req) => req.url.replace('/public', ''), // optional if you want to rewrite the URL
  // ...
}
```

Full example:

```js
'use strict'

const gateway = require('fast-gateway')
const express = require('express')
const PORT = process.env.PORT || 8080

gateway({
  server: express(),

  middlewares: [require('cors')(), require('helmet')()],

  routes: [
    {
      prefix: new RegExp('/public/.*'), // Express.js v5 requires a RegExp object
      //prefix: '/public', // Compatible with Express.js v4,

      urlRewrite: (req) => req.url.replace('/public', ''),
      target: 'http://localhost:3000',
      docs: {
        name: 'Public Service',
        endpoint: 'swagger.json',
        type: 'swagger',
      },
    },
    {
      prefix: new RegExp('/admin/.*'), // Express.js v5 requires a RegExp object
      //prefix: '/admin', // Compatible with Express.js v4,
      target: 'http://localhost:3001',
      middlewares: [
        /*
        require('express-jwt').expressjwt({
          secret: 'shhhhhhared-secret',
          algorithms: ['HS256'],
        }),
        */
      ],
    },
  ],
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
```
