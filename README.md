# fast-gateway
A super fast Node.js API Gateway for the masses!  
> Here you can optionally read more about it: https://medium.com/sharenowtech/k-fastify-gateway-a-node-js-api-gateway-that-you-control-e7388c229b21

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
  // Optional restana library configuration (https://www.npmjs.com/package/restana#configuration)
  restana: {},
  // Optional global middlewares in the format: (req, res, next) => next() 
  // Default value: []
  middlewares: [],
  // Optional global value for routes "pathRegex". Default value: '/*'
  pathRegex: '/*',

  // HTTP proxy
  routes: [{
    // Optional `fast-proxy` library configuration (https://www.npmjs.com/package/fast-proxy#options)
    // base parameter defined as the route target. Default value: {}
    fastProxy: {},
    // Optional flag to indicate if target uses the HTTP2 protocol. Default value: false
    http2: false,
    // Optional path matching regex. Default value: '/*'
    // In order to disable the 'pathRegex' at all, you can use an empty string: ''
    pathRegex: '/*',
    // route prefix
    prefix: '/public',
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

const onResponse = async (req, res, stream) => {
  if (!res.hasHeader('content-length')) {
    try {
      const resBuffer = Buffer.concat(await toArray(stream))
      res.statusCode = stream.statusCode
      res.setHeader('content-length', '' + Buffer.byteLength(resBuffer))
      res.end(resBuffer)
    } catch (err) {
      res.send(err)
    }
  } else {
    res.statusCode = stream.statusCode
    pump(stream, res)
  }
}
```

## Gateway level caching
### Why?
> Because `caching` is the last mile for low latency distributed systems!  

Enabling proper caching strategies at gateway level will drastically reduce the latency of your system,
as it reduces network round-trips and remote services processing.  
We are talking here about improvements in response times from `X ms` to `~2ms`, as an example.  

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

### Enabling cache for service endpoints
Although API Gateway level cache aims as a centralized cache for all services behind the wall, are the services
the ones who indicate the responses to be cached and for how long.  

Cache entries will be created for all remote responses coming with the `x-cache-timeout` header:
```js
res.setHeader('x-cache-timeout', '1 hour')
```
> Here we use the [`ms`](`https://www.npmjs.com/package/ms`) package to convert timeout to seconds. Please note that `millisecond` unit is not supported!  

Example on remote service using `restana`:
```js
service.get('/numbers', (req, res) => {
  res.setHeader('x-cache-timeout', '1 hour')

  res.send([
    1, 2, 3
  ])
})
```

### Invalidating cache
> Let's face it, gateway level cache invalidation was complex..., until now!  

Remote services can also expire cache entries on demand, i.e: when the data state changes. Here we use the `x-cache-expire` header to indicate the gateway cache entries to expire using a matching pattern:
```js
res.setHeader('x-cache-expire', '*/numbers')
```
> Here we use the [`matcher`](`https://www.npmjs.com/package/matcher`) package for matching patterns evaluation.

Example on remote service using `restana`:
```js
service.patch('/numbers', (req, res) => {
  res.setHeader('x-cache-expire', '*/numbers')

  // ...
  res.send(200)
})
```

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