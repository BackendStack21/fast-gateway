# fast-gateway
A super fast, framework agnostic Node.js API Gateway for the masses ❤️

## Medium articles:
- https://medium.com/@kyberneees/node-js-api-gateway-a-developer-perspective-8defe575ed21
- https://medium.com/sharenowtech/k-fastify-gateway-a-node-js-api-gateway-that-you-control-e7388c229b21


## Install
```js
npm i fast-gateway
```

## Usage
### Gateway
```js
const gateway = require('fast-gateway')
const server = gateway({
  routes: [{
    prefix: '/service',
    target: 'http://127.0.0.1:3000'
  }]
})

server.start(8080)
```
### Remote Service
```js
const service = require('restana')()
service.get('/get', (req, res) => res.send('Hello World!'))

service.start(3000)
```

## Configuration options explained
```js
{
  // Optional server instance. Any HTTP framework that supports the following signature is compatible:
  // - server[HTTP_METHOD](pattern, [middleware1, middleware2,], handler)
  // 
  // Known compatible frameworks: Restana, Express.js
  // If omitted, restana is used as default HTTP framework
  server, 
  // Optional restana library configuration (https://www.npmjs.com/package/restana#configuration)  
  // 
  // Please note that if "server" is provided, this settings are ignored.
  restana: {},
  // Optional global middlewares in the format: (req, res, next) => next() 
  // Default value: []
  middlewares: [],
  // Optional global value for routes "pathRegex". Default value: '/*'
  pathRegex: '/*',
  // Optional global requests timeout value (given in milliseconds). Default value: '0' (DISABLED)
  timeout: 0,
  // Optional "target" value that overrides the routes "target" config value. Feature intended for testing purposes.
  targetOverride: "https://yourdev.api-gateway.com",

  // HTTP proxy
  routes: [{
    // Optional `fast-proxy` library configuration (https://www.npmjs.com/package/fast-proxy#options)
    // base parameter defined as the route target. Default value: {}
    fastProxy: {},
    // Optional proxy handler function. Default value: (req, res, url, proxy, proxyOpts) => proxy(req, res, url, proxyOpts)
    proxyHandler: () => {},
    // Optional flag to indicate if target uses the HTTP2 protocol. Default value: false
    http2: false,
    // Optional path matching regex. Default value: '/*'
    // In order to disable the 'pathRegex' at all, you can use an empty string: ''
    pathRegex: '/*',
    // Optional service requests timeout value (given in milliseconds). Default value: '0' (DISABLED)
    timeout: 0,
    // route prefix
    prefix: '/public',
    // Optional documentation configuration (unrestricted schema)
    docs: {
      name: 'Public Service',
      endpoint: '/api-docs',
      type: 'swagger'
    },
    // Optional "prefix rewrite" before request is forwarded. Default value: ''
    prefixRewrite: '',
    // Remote HTTP server URL to forward the request
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
      //   return true // truthy value returned will abort the request forwarding
      },
      onResponse (req, res, stream) {  
        // do some post-processing here
        // ...
      }

      // other options allowed https://www.npmjs.com/package/fast-proxy#opts
    }
  }]
}
```
### onResponse Hook default implementation
For developers reference, next we describe how the default `onResponse` hook looks like: 
```js
const pump = require('pump')
const toArray = require('stream-to-array')
const TRANSFER_ENCODING_HEADER_NAME = 'transfer-encoding'

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
```
## The "*GET /services.json*" endpoint
Since version `1.3.5` the gateway exposes minimal documentation about registered services at: `GET /services.json`

Example output:
```json
[  
   {  
      "prefix":"/public",
      "docs":{  
         "name":"Public Service",
         "endpoint":"/swagger.json",
         "type":"swagger"
      }
   },
   {  
      "prefix":"/admin"
   }
]
```
> NOTE: Please see `docs` configuration entry explained above.

## Timeouts and Unavailability 
We can restrict requests timeouts globally or at service level using the `timeout` configuration.  

You can also define endpoints specific timeout using the property `timeout` of the request object, normally inside a middleware:
```js
req.timeout = 500 // define a 500ms timeout on a custom request.
```
> NOTE: You might want to also check https://www.npmjs.com/package/middleware-if-unless

### Circuit Breakers
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
      handler: (req, res) => res.send('Too many requests, please try again later.', 429)
    })
  ],

  // your downstream services
  routes: [{
    prefix: '/public',
    target: 'http://localhost:3000'
  }, {
    // ...
  }]
})
```
> In this example we have used the [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) module.

## Gateway level caching
Caching support is provided by the `http-cache-middleware` module. https://www.npmjs.com/package/http-cache-middleware

### Why?
> Because `caching` is the last mile for low latency distributed systems!  

Enabling proper caching strategies at gateway level will drastically reduce the latency of your system,
as it reduces network round-trips and remote services processing.  
We are talking here about improvements in response times from `X ms` to `~2ms`, as an example.  
> We use the `http-cache-middleware` module to support gateway level caching. Read more about it: https://github.com/jkyberneees/http-cache-middleware

###  Setting up gateway level cache available for all services
#### Single node cache (memory):
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

#### Multi nodes cache (redis):
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

### How to cache remote services endpoints response?
https://github.com/jkyberneees/http-cache-middleware#enabling-cache-for-service-endpoints

### How to invalidate caches?
https://github.com/jkyberneees/http-cache-middleware#invalidating-caches


### Custom cache keys
Cache keys are generated using: `req.method + req.url`, however, for indexing/segmenting requirements it makes sense to allow cache keys extensions.  
Unfortunately, this feature can't be implemented at remote service level, because the gateway needs to know the entire lookup key when a request
reaches the gateway.  

For doing this, we simply recommend using middlewares on the service configuration:
```js
routes: [{
  prefix: '/users',
  target: 'http://localhost:3000',
  middlewares: [(req, res, next) => {
    req.cacheAppendKey = (req) => req.user.id // here cache key will be: req.method + req.url + req.user.id
    return next()
  }]
}]
```
> In this example we also distinguish cache entries by `user.id`, very common case!

### Disable cache for custom endpoints
You can also disable cache checks for certain requests programmatically:
```js
routes: [{
  prefix: '/users',
  target: 'http://localhost:3000',
  middlewares: [(req, res, next) => {
    req.cacheDisabled = true
    return next()
  }]
}]
```

## Want to contribute?
This is your repo ;)  

> Note: We aim to be 100% code coverage, please consider it on your pull requests.

## Related projects
- middleware-if-unless (https://www.npmjs.com/package/middleware-if-unless)
- fast-proxy (https://www.npmjs.com/package/fast-proxy)
- restana (https://www.npmjs.com/package/restana)

## Benchmarks
Benchmark scripts can be found in benchmark folder.
> Laptop: MacBook Pro 2016, 2,7 GHz Intel Core i7, 16 GB 2133 MHz LPDDR3  
> wrk -t8 -c50 -d20s http://127.0.0.1:8080/service/get

- fast-gateway: **18069.77** reqs/secs
- k-fastify-gateway: 9763.61 reqs/secs

## Sponsors
- Kindly sponsored by [ShareNow](https://www.share-now.com/), a company that promotes innovation!  