# fast-gateway
A super fast Node.js API Gateway for the masses!  

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
  // Optional global middlewares (https://www.fastify.io/docs/latest/Middlewares/). Default value: []
  middlewares: [],
  // Optional global value for routes "pathRegex". Default value: '/*'
  pathRegex: '/*',

  // HTTP proxy
  routes: [{
    // Optional `fast-proxy` library configuration (https://www.npmjs.com/package/fast-proxy#options)
    // base parameter defined as the route target
    fastProxy: {},
    // Optional flag to indicate if target uses the HTTP2 protocol 
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
        // Default implementation: 
        pump(stream, res)
      }

      // other options allowed https://www.npmjs.com/package/fast-proxy#opts
    }
  }]
}
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
```bash
Running 20s test @ http://127.0.0.1:8080/service/get
  8 threads and 50 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     2.66ms  581.30us  12.72ms   69.64%
    Req/Sec     2.27k   138.20     2.57k    93.31%
  361552 requests in 20.01s, 38.62MB read
Requests/sec:  18069.77
Transfer/sec:      1.93MB
```