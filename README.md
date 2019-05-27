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

## Benchmarks
Benchmark scripts can be found in benchmark folder.
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