# Introduction
[![tests](https://github.com/BackendStack21/fast-gateway/actions/workflows/tests.yaml/badge.svg)](https://github.com/BackendStack21/fast-gateway/actions/workflows/tests.yaml)
[![NPM version](https://badgen.net/npm/v/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![NPM Total Downloads](https://badgen.net/npm/dt/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![License](https://badgen.net/npm/license/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![TypeScript support](https://badgen.net/npm/types/fast-gateway)](https://www.npmjs.com/package/fast-gateway)
[![Github stars](https://badgen.net/github/stars/jkyberneees/fast-gateway?icon=github)](https://github.com/jkyberneees/fast-gateway)

A super fast, framework agnostic Node.js API Gateway for the masses ❤️  
*Docker images: https://hub.docker.com/repository/docker/kyberneees/rproxy* 
> Since v2.3.0, [AWS Lambda](https://www.youtube.com/watch?v=EBSdyoO3goc) proxying integration is supported via [`http-lambda-proxy`](https://www.npmjs.com/package/http-lambda-proxy) 🔥  
> Since v3.1.0, WebSockets proxying is supported via [`faye-websocket`](https://www.npmjs.com/package/faye-websocket) 🔥

Read more online:
- A “.js” API Gateway for the masses: https://itnext.io/a-js-api-gateway-for-the-masses-a12fdb9e961c

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
### Testing
```bash
curl -v http://127.0.0.1:8080/service/get
```
## More
- Website and documentation: https://fgw.21no.de