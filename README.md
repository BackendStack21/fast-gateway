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
    Latency     2.76ms  609.81us  12.76ms   68.36%
    Req/Sec     2.19k   297.42    12.43k    94.94%
  349138 requests in 20.10s, 37.29MB read
Requests/sec:  17369.68
Transfer/sec:      1.86MB
```