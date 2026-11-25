'use strict'

/* global describe, it, before, after */
const expect = require('chai').expect
const request = require('supertest')
const http = require('http')
const http2 = require('http2')
const net = require('net')
const crypto = require('crypto')
const WebSocket = require('faye-websocket')
const fastProxyLite = require('fast-proxy-lite')
const fastGateway = require('../index')
const hostnamesHook = require('../lib/hostnames-hook')
const rawRequest = require('./raw-http')

const UPSTREAM_PORT = 9601
const target = `http://127.0.0.1:${UPSTREAM_PORT}`

describe('review fixes', () => {
  let upstream
  const gateways = []
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)

  const start = async (opts, port) => {
    const gateway = fastGateway(opts)
    await gateway.start(port)
    gateways.push(gateway)

    return gateway
  }

  before(async () => {
    process.on('unhandledRejection', onUnhandled)

    upstream = http.createServer((req, res) => {
      if (req.url.startsWith('/truncated')) {
        res.writeHead(200, { 'content-length': '100' })
        res.write('partial-')
        setTimeout(() => res.destroy(), 50)

        return
      }

      const body = JSON.stringify({ url: req.url })
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-upstream': 'yes'
      })
      res.end(body)
    })
    await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, resolve))
  })

  after(async () => {
    process.removeListener('unhandledRejection', onUnhandled)

    for (const gateway of gateways) {
      await gateway.close()
    }
    upstream.closeAllConnections()
    await new Promise((resolve) => upstream.close(resolve))
  })

  describe('onResponse hook failures', () => {
    let gateway
    const errors = []

    before(async () => {
      gateway = await start({
        routes: [
          {
            prefix: '/async-reject',
            target,
            hooks: {
              async onResponse () {
                throw new Error('async onResponse failed')
              },
              onError (err) {
                errors.push(err.message)
              }
            }
          },
          {
            prefix: '/reject-after-headers',
            target,
            hooks: {
              async onResponse (req, res) {
                res.writeHead(200, { 'content-length': '100' })
                res.write('partial-')
                throw new Error('failed midway')
              }
            }
          },
          {
            prefix: '/lambda-reject',
            proxyType: 'lambda',
            target: 'a-lambda-function',
            proxyConfig: {
              lambdaProxy: (params, cb) => setImmediate(() => cb(null, {
                StatusCode: 200,
                Payload: JSON.stringify({ statusCode: 200, body: 'from lambda' })
              }))
            },
            hooks: {
              async onResponse () {
                throw new Error('lambda onResponse failed')
              }
            }
          },
          {
            prefix: '/sync-throw',
            target,
            hooks: {
              rewriteHeaders: (headers) => ({ ...headers, 'x-added': '1', 'cache-control': 'public' }),
              onResponse () {
                throw new Error('sync onResponse failed')
              },
              onError (err) {
                errors.push(err.message)
              }
            }
          },
          {
            prefix: '/both-fail',
            target,
            proxyHandler: async (req, res, url, proxy, proxyOpts) => {
              proxy(req, res, url, proxyOpts)
              await new Promise((resolve) => res.once('close', resolve))

              throw new Error('proxy handler failed')
            },
            hooks: {
              async onResponse () {
                throw new Error('async onResponse failed')
              },
              onError (err) {
                errors.push(err.message)
              }
            }
          },
          {
            prefix: '/lambda-headers',
            proxyType: 'lambda',
            target: 'a-lambda-function',
            proxyConfig: {
              lambdaProxy: (params, cb) => setImmediate(() => cb(null, {
                StatusCode: 200,
                Payload: JSON.stringify({
                  statusCode: 200,
                  headers: { 'content-length': '3', 'content-encoding': 'gzip' },
                  body: 'abc'
                })
              }))
            },
            hooks: {
              async onResponse () {
                throw new Error('lambda onResponse failed')
              }
            }
          },
          {
            prefix: '/sync-ok',
            target,
            hooks: {
              onResponse (req, res, stream) {
                res.statusCode = 201
                stream.pipe(res)
              }
            }
          }
        ]
      }, 9602)
    })

    it('a rejected async onResponse hook gets an error response', async () => {
      const response = await request(gateway)
        .get('/async-reject/info')
        .timeout(1000)
        .expect(500)

      expect(errors).to.deep.equal(['async onResponse failed'])
      // the upstream headers don't describe the error response
      expect(response.headers['x-upstream']).to.equal(undefined)
      expect(unhandled).to.deep.equal([])
    })

    it('a sync onResponse hook failure is handled the same way', async () => {
      errors.length = 0
      const response = await request(gateway)
        .get('/sync-throw/info')
        .timeout(1000)
        .expect(500)

      expect(errors).to.deep.equal(['sync onResponse failed'])
      // neither upstream headers nor the ones added by rewriteHeaders
      expect(response.headers['x-upstream']).to.equal(undefined)
      expect(response.headers['x-added']).to.equal(undefined)
      expect(response.headers['cache-control']).to.equal(undefined)
    })

    it('onError is called once when the proxy handler fails too', async () => {
      errors.length = 0
      await request(gateway)
        .get('/both-fail/info')
        .timeout(1000)
        .expect(500)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(errors).to.deep.equal(['async onResponse failed'])
      expect(unhandled).to.deep.equal([])
    })

    it('lambda response headers are not sent with the error response', async () => {
      const response = await rawRequest(9602, '/lambda-headers/info')

      expect(response.statusCode).to.equal(500)
      expect(response.headers['content-encoding']).to.equal(undefined)
      expect(response.headers['content-length']).to.not.equal('3')
    })

    it('a partially sent response is destroyed when the hook rejects', async () => {
      const error = await new Promise((resolve) => {
        http.get({ port: 9602, path: '/reject-after-headers/info' }, (res) => {
          res.on('data', () => {})
          res.on('error', resolve)
          res.on('end', () => resolve(null))
        }).on('error', resolve)
      })

      expect(error).to.be.an('error')
      expect(unhandled).to.deep.equal([])
    })

    it('a rejected async onResponse hook of a lambda route gets an error response', async () => {
      await request(gateway)
        .get('/lambda-reject/info')
        .timeout(1000)
        .expect(500)

      expect(unhandled).to.deep.equal([])
    })

    it('sync onResponse hooks keep working', async () => {
      await request(gateway)
        .get('/sync-ok/info')
        .expect(201)
        .then((response) => {
          expect(response.body.url).to.equal('/info')
        })
    })

    it('drops the connection when the server error handler fails too', async () => {
      // minimal HTTP framework, its "next" function throws
      let handler
      const framework = { get: (path, fn) => { handler = fn } }
      fastGateway({
        server: framework,
        enableServicesEndpoint: false,
        routes: [{
          prefix: '/svc',
          target,
          methods: ['GET'],
          hooks: {
            async onResponse () {
              throw new Error('async onResponse failed')
            }
          }
        }]
      })
      const server = http.createServer((req, res) => {
        handler(req, res, () => {
          throw new Error('error handler failed')
        })
      })
      await new Promise((resolve) => server.listen(9603, resolve))

      const response = await rawRequest(9603, '/svc/info')
      await new Promise((resolve) => server.close(resolve))

      // no response, and the process is still alive
      expect(response.statusCode).to.be.NaN // eslint-disable-line no-unused-expressions
      expect(response.body).to.equal('')
      expect(unhandled).to.deep.equal([])
    })
  })

  describe('custom proxy types', () => {
    it('the proxy delivers the response when there is no onResponse hook', async () => {
      const { proxy, close } = fastProxyLite({ base: target })
      const gateway = await start({
        proxyFactory: ({ proxyType }) => proxyType === 'custom' ? proxy : undefined,
        routes: [{ prefix: '/custom', proxyType: 'custom', target }]
      }, 9604)

      await request(gateway)
        .get('/custom/info')
        .timeout(1000)
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/info')
        })
      close()
    })
  })

  describe('query string', () => {
    it('req.query stays the source of the forwarded query string', async () => {
      const gateway = await start({
        middlewares: [(req, res, next) => {
          // e.g. sanitizing parameters
          delete req.query.admin

          return next()
        }],
        routes: [
          {
            prefix: '/rewrite',
            target,
            urlRewrite: (req) => {
              const url = new URL(req.url, 'http://gateway')

              return url.pathname.replace('/rewrite', '') + url.search
            }
          },
          {
            prefix: '/raw',
            target,
            disableQsOverwrite: true,
            urlRewrite: () => '/rewritten?added=1'
          }
        ]
      }, 9605)

      const expectUrl = (path, url) => request(gateway)
        .get(path)
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal(url)
        })

      // a client can't make the gateway forward the raw query string
      await expectUrl('/rewrite/a?id=1&admin=1', '/a?id=1')
      await expectUrl("/rewrite/a?id=1&admin=1&x='", '/a?id=1&x=%27')
      // disableQsOverwrite forwards the query string of req.url
      await expectUrl('/raw/a?z=9', '/rewritten?added=1')
    })
  })

  describe('truncated upstream responses', () => {
    it('HTTP/1: the client connection is dropped', async () => {
      await start({ routes: [{ prefix: '/svc', target }] }, 9606)

      const error = await new Promise((resolve) => {
        http.get({ port: 9606, path: '/svc/truncated' }, (res) => {
          res.on('data', () => {})
          res.on('error', resolve)
          res.on('end', () => resolve(null))
        }).on('error', resolve)
      })

      expect(error).to.be.an('error')
    })

    it('HTTP/2: the stream is reset instead of ended gracefully', async () => {
      await start({
        restana: { server: http2.createServer() },
        routes: [{ prefix: '/svc', target }]
      }, 9607)

      const client = http2.connect('http://127.0.0.1:9607')
      const result = await new Promise((resolve) => {
        const req = client.request({ ':path': '/svc/truncated' })
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('error', (err) => resolve({ err, body }))
        req.on('end', () => resolve({ err: null, body, rstCode: req.rstCode }))
        req.end()
      })
      client.close()

      expect(result.err).to.be.an('error')
      expect(result.err.code).to.equal('ERR_HTTP2_STREAM_ERROR')
    })
  })

  describe('default http hooks', () => {
    it('(Connection: close) HEAD responses are not buffered', async () => {
      const chunked = http.createServer((req, res) => {
        res.writeHead(200, { 'transfer-encoding': 'chunked', 'x-method': req.method })
        res.end()
      })
      await new Promise((resolve) => chunked.listen(9608, resolve))
      await start({ routes: [{ prefix: '/svc', target: 'http://127.0.0.1:9608' }] }, 9609)

      const response = await rawRequest(9609, '/svc/info', { method: 'HEAD' })
      await new Promise((resolve) => chunked.close(resolve))

      expect(response.statusCode).to.equal(200)
      expect(response.headers['x-method']).to.equal('HEAD')
      expect(response.headers['content-length']).to.equal(undefined)
    })
  })

  describe('lambda responses', () => {
    let gateway, aws
    let calledTwice = false
    const lambdaRoute = (prefix, payload, extra = {}) => ({
      prefix,
      proxyType: 'lambda',
      target: 'a-lambda-function',
      proxyConfig: {
        lambdaProxy: (params, cb) => setImmediate(() => cb(null, {
          StatusCode: 200,
          Payload: JSON.stringify(payload)
        }))
      },
      ...extra
    })

    before(async () => {
      // minimal AWS Lambda "Invoke" endpoint
      aws = http.createServer((req, res) => {
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ statusCode: 201, body: 'from aws: ' + req.url }))
        })
      })
      await new Promise((resolve) => aws.listen(9610, resolve))

      gateway = await start({
        routes: [
          lambdaRoute('/status', { statusCode: 'abc', body: 'x' }),
          lambdaRoute('/base64', { isBase64Encoded: true, body: 123 }),
          lambdaRoute('/header', { headers: { 'x-name': 'caf\u00e9 \u{1F600}' }, body: 'x' }),
          {
            prefix: '/twice',
            proxyType: 'lambda',
            target: 'a-lambda-function',
            proxyConfig: {
              lambdaProxy: (params, cb) => setImmediate(() => {
                const response = {
                  StatusCode: 200,
                  Payload: JSON.stringify({ headers: { 'x-name': 'ok' }, body: 'x' })
                }
                cb(null, response)
                // the response was already sent
                cb(null, response)
                calledTwice = true
              })
            }
          },
          {
            prefix: '/network',
            proxyType: 'lambda',
            target: 'a-lambda-function',
            proxyConfig: {
              lambdaProxy: (params, cb) => setImmediate(() => cb(new Error('socket hang up')))
            }
          },
          {
            prefix: '/aws',
            proxyType: 'lambda',
            target: 'a-lambda-function',
            proxyConfig: {
              endpoint: 'http://127.0.0.1:9610',
              accessKeyId: 'test',
              secretAccessKey: 'test',
              maxRetries: 0
            }
          }
        ]
      }, 9611)
    })

    after(async () => {
      aws.closeAllConnections()
      await new Promise((resolve) => aws.close(resolve))
    })

    it('invalid lambda responses get a 502 instead of crashing the process', async () => {
      const expected = {
        // rejected by the default onResponse hook
        '/status/a': 500,
        '/base64/a': 500,
        // rejected while the response is processed by the lambda proxy
        '/header/a': 502,
        '/network/a': 502
      }
      for (const path in expected) {
        const response = await request(gateway).get(path).timeout(1000)

        expect(response.status, path).to.equal(expected[path])
        expect(response.headers['x-name'], path).to.equal(undefined)
      }
      expect(unhandled).to.deep.equal([])
    })

    it('survives a failure after the response was sent', async () => {
      await request(gateway).get('/twice/a').timeout(1000).expect(200)

      expect(calledTwice).to.equal(true)
    })

    it('invokes the function using the aws-sdk when no lambdaProxy is given', async () => {
      await request(gateway)
        .get('/aws/info')
        .timeout(1500)
        .expect(201)
        .then((response) => {
          expect(response.text).to.equal('from aws: /2015-03-31/functions/a-lambda-function/invocations')
        })
    })
  })

  describe('websockets', function () {
    this.timeout(8000)

    const WS_UPSTREAM_PORT = 9612
    const WS_STALLED_PORT = 9613
    const WS_GATEWAY_PORT = 9614
    const MESSAGE = 'x'.repeat(1024 * 1024)
    const MESSAGES = 30

    let wsUpstream, stalled, gatewayServer
    const upstreamSockets = new Set()
    const stalledSockets = new Set()
    const gatewaySockets = new Set()
    const state = { received: 0, ws: null, onOpenArgs: null }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (predicate, timeout = 4000) => {
      const deadline = Date.now() + timeout
      while (!predicate()) {
        if (Date.now() > deadline) return false
        await sleep(20)
      }
      return true
    }
    const rawUpgrade = (path) => new Promise((resolve) => {
      const chunks = []
      const socket = net.connect(WS_GATEWAY_PORT, '127.0.0.1', () => {
        socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
          'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n' +
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n\r\n`)
      })
      socket.on('data', (chunk) => {
        chunks.push(chunk)
        // a successful handshake keeps the connection open
        if (Buffer.concat(chunks).toString().includes('\r\n\r\n')) socket.destroy()
      })
      socket.on('error', () => {})
      socket.on('close', () => resolve(Buffer.concat(chunks).toString()))
    })

    // resolves once the upstream connection of the client is open too
    const connect = async (path) => {
      state.ws = null
      const client = new WebSocket.Client(`ws://127.0.0.1:${WS_GATEWAY_PORT}${path}`)
      await new Promise((resolve) => client.on('open', resolve))
      expect(await waitFor(() => state.ws !== null && state.ws.readyState === 1)).to.equal(true)

      return client
    }

    before(async () => {
      wsUpstream = http.createServer()
      wsUpstream.on('connection', (socket) => upstreamSockets.add(socket))
      wsUpstream.on('upgrade', (req, socket, body) => {
        const ws = new WebSocket(req, socket, body)
        state.ws = ws
        state.url = req.url
        ws.on('message', (event) => {
          if (event.data === 'ping') return ws.send('pong')
          state.received++
        })
        // a slow consumer
        if (req.url.startsWith('/slow')) ws.pause()
      })
      await new Promise((resolve) => wsUpstream.listen(WS_UPSTREAM_PORT, resolve))

      // accepts connections, never answers the handshake
      stalled = net.createServer((socket) => {
        stalledSockets.add(socket)
        socket.on('error', () => {})
        socket.on('close', () => stalledSockets.delete(socket))
      })
      await new Promise((resolve) => stalled.listen(WS_STALLED_PORT, resolve))

      const target = `ws://127.0.0.1:${WS_UPSTREAM_PORT}`
      const gateway = await start({
        routes: [
          { proxyType: 'websocket', prefix: ['/slow', '/ws/*', '/glob/*-*-*'], target },
          {
            proxyType: 'websocket',
            prefix: '/hook',
            target,
            hooks: {
              onOpen (ws, searchParams, req) {
                state.onOpenArgs = { token: searchParams.get('token'), origin: req.headers.origin }
              }
            }
          },
          {
            proxyType: 'websocket',
            prefix: '/stalled',
            target: `ws://127.0.0.1:${WS_STALLED_PORT}`,
            timeout: 200
          },
          {
            proxyType: 'websocket',
            prefix: '/stalled-no-timeout',
            target: `ws://127.0.0.1:${WS_STALLED_PORT}`,
            timeout: 0
          },
          {
            proxyType: 'websocket',
            prefix: '/stalled-infinity',
            target: `ws://127.0.0.1:${WS_STALLED_PORT}`,
            timeout: Infinity
          },
          {
            proxyType: 'websocket',
            prefix: '/stalled-huge-timeout',
            target: `ws://127.0.0.1:${WS_STALLED_PORT}`,
            timeout: 3000000000
          }
        ]
      }, WS_GATEWAY_PORT)
      gatewayServer = gateway.getServer()
      gatewayServer.on('connection', (socket) => {
        gatewaySockets.add(socket)
        socket.on('close', () => gatewaySockets.delete(socket))
      })
    })

    after(async () => {
      gatewaySockets.forEach((socket) => socket.destroy())
      upstreamSockets.forEach((socket) => socket.destroy())
      stalledSockets.forEach((socket) => socket.destroy())
      await new Promise((resolve) => wsUpstream.close(resolve))
      await new Promise((resolve) => stalled.close(resolve))
    })

    it('stops reading from the client while the upstream is backed up', async () => {
      state.received = 0
      const client = await connect('/slow')
      const socket = [...gatewaySockets].pop()

      for (let i = 0; i < MESSAGES; i++) client.send(MESSAGE)
      await sleep(500)

      // most of the data is still waiting on the client side
      expect(socket.bytesRead).to.be.below(MESSAGES * MESSAGE.length / 2)
      expect(state.received).to.be.below(MESSAGES / 2)

      // everything is delivered once the upstream reads again
      state.ws.resume()
      expect(await waitFor(() => state.received === MESSAGES)).to.equal(true)

      client.close()
      await new Promise((resolve) => client.on('close', resolve))
    })

    it('releases a paused upstream when the client goes away', async () => {
      const client = await connect('/ws/echo')
      const upstreamSocket = [...upstreamSockets].pop()
      let upstreamClosed = false
      upstreamSocket.on('close', () => { upstreamClosed = true })

      // the client does not read, the gateway pauses the upstream
      client.pause()
      for (let i = 0; i < MESSAGES; i++) state.ws.send(MESSAGE)
      await sleep(300)
      const socket = [...gatewaySockets].pop()
      socket.destroy()

      expect(await waitFor(() => upstreamClosed, 2000)).to.equal(true)
    })

    it('stops reading from the upstream while the client is backed up', async () => {
      const client = await connect('/ws/echo')
      let received = 0
      client.on('message', () => received++)
      client.send('ping')
      expect(await waitFor(() => received === 1)).to.equal(true)

      client.pause()
      const socket = [...gatewaySockets].pop()
      for (let i = 0; i < MESSAGES; i++) state.ws.send(MESSAGE)
      await sleep(500)
      // the gateway does not buffer what the client is not reading
      expect(socket.writableLength).to.be.below(MESSAGES * MESSAGE.length / 2)

      client.resume()
      expect(await waitFor(() => received === MESSAGES + 1)).to.equal(true)

      client.close()
      await new Promise((resolve) => client.on('close', resolve))
    })

    it('closes the client when the upstream does not complete the handshake in time', async () => {
      const client = new WebSocket.Client(`ws://127.0.0.1:${WS_GATEWAY_PORT}/stalled`)
      const event = await new Promise((resolve) => client.on('close', resolve))

      expect(event.code).to.equal(4504)
      expect(event.reason).to.equal('Upstream handshake timeout')
    })

    it('timeout: 0, Infinity or huge values do not reject connections', async () => {
      for (const path of ['/stalled-no-timeout', '/stalled-infinity', '/stalled-huge-timeout']) {
        const client = new WebSocket.Client(`ws://127.0.0.1:${WS_GATEWAY_PORT}${path}`)
        let closed = false
        client.on('close', () => { closed = true })
        await new Promise((resolve) => client.on('open', resolve))
        await sleep(300)

        expect(closed, path).to.equal(false)
        client.close()
      }
    })

    it('passes the upgrade request to the onOpen hook', async () => {
      const client = new WebSocket.Client(
        `ws://127.0.0.1:${WS_GATEWAY_PORT}/hook?token=abc`,
        [],
        { headers: { Origin: 'https://app.example' } }
      )
      await new Promise((resolve) => client.on('open', resolve))
      client.close()
      await new Promise((resolve) => client.on('close', resolve))

      expect(state.onOpenArgs).to.deep.equal({ token: 'abc', origin: 'https://app.example' })
    })

    it('rejects encoded dot segments as HTTP routes do', async () => {
      for (const path of ['/ws/a%2f..%2f..%2fadmin', '/ws/a%5c..%5c..%5cadmin']) {
        expect(await rawUpgrade(path), path).to.match(/^HTTP\/1\.1 400 /)
      }
      expect(await rawUpgrade('/ws/echo')).to.match(/^HTTP\/1\.1 101 /)
    })

    it('does not match huge paths', async () => {
      const start = Date.now()

      expect(await rawUpgrade('/glob/' + 'a-'.repeat(3500))).to.equal('')
      expect(Date.now() - start).to.be.below(1000)
    })
  })

  describe('hostnames hook', () => {
    it('does not match huge host names', (cb) => {
      const hook = hostnamesHook([{ prefix: '/api', hostname: '*-*-*.company.tld' }])
      const req = { headers: { host: 'a-'.repeat(3500) + '.company.tld' }, url: '/hi' }
      const start = Date.now()

      hook(req, null, () => {
        expect(req.url).to.equal('/hi')
        expect(Date.now() - start).to.be.below(1000)
        cb()
      })
    })

    it('uses the :authority pseudo-header of HTTP/2 requests', (cb) => {
      const hook = hostnamesHook([{ prefix: '/api', hostname: 'api.company.tld' }])
      const req = { headers: { ':authority': 'API.company.tld:443' }, url: '/hi' }

      hook(req, null, () => {
        expect(req.url).to.equal('/api/hi')
        cb()
      })
    })
  })
})
