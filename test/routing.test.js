'use strict'

/* global describe, it, before, after */
const expect = require('chai').expect
const request = require('supertest')
const http = require('http')
const fastGateway = require('../index')
const rawRequest = require('./raw-http')

const UPSTREAM_PORT = 9501
const target = `http://127.0.0.1:${UPSTREAM_PORT}`

describe('routing', () => {
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
      const reply = () => {
        res.setHeader('content-type', 'application/json')
        // the gateway always appends '?' when forwarding req.query, ignore it
        res.end(JSON.stringify({ method: req.method, url: req.url.replace(/\?$/, '') }))
      }
      if (req.url.startsWith('/slow')) {
        setTimeout(reply, 300)
      } else {
        reply()
      }
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

  describe('error handling', () => {
    let gateway
    const onErrorCalls = []

    before(async () => {
      gateway = await start({
        routes: [
          {
            prefix: '/on-error-responds',
            target,
            hooks: {
              async onRequest (req) {
                throw Object.assign(new Error('unauthorized'), { status: 401 })
              },
              onError (err, req, res) {
                res.statusCode = err.status
                res.end(JSON.stringify({ error: err.message }))
              }
            }
          },
          {
            prefix: '/partial-response',
            target,
            proxyHandler: (req, res) => {
              res.writeHead(200)
              res.write('partial')

              throw new Error('failed after the response started')
            }
          },
          {
            prefix: '/async-proxy-handler',
            target,
            proxyHandler: async () => {
              throw new Error('proxy handler failed')
            },
            hooks: {
              onError (err) {
                onErrorCalls.push(err)
              }
            }
          }
        ]
      }, 9502)
    })

    it('onError hook sending its own response does not trigger a second response', async () => {
      unhandled.length = 0

      await request(gateway)
        .get('/on-error-responds/info')
        .expect(401)
        .then((response) => {
          expect(JSON.parse(response.text)).to.deep.equal({ error: 'unauthorized' })
        })

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(unhandled.map((err) => err.code)).to.deep.equal([])
    })

    it('rejecting async proxyHandler is routed to onError and answered with 500', async () => {
      onErrorCalls.length = 0

      await request(gateway)
        .get('/async-proxy-handler/info')
        .timeout(1000)
        .expect(500)

      expect(onErrorCalls).to.have.lengthOf(1)
      expect(onErrorCalls[0].message).to.equal('proxy handler failed')
    })

    it('terminates a partially sent response when the handler fails', async () => {
      // resolves once the gateway closes the connection, rejects if it hangs
      const response = await rawRequest(9502, '/partial-response/info', { timeout: 1000 })

      expect(response.body).to.not.match(/0\r\n\r\n$/)
    })
  })

  describe('url rewriting', () => {
    let gateway

    before(async () => {
      gateway = await start({
        routes: [
          { prefix: '/public', prefixRewrite: '/api/public', target },
          { prefix: '/users', target },
          { prefix: '/internal', prefixRewrite: '/v$&', target },
          { prefix: '/slash', prefixRewrite: '/v2/', target },
          { prefix: '/', target }
        ]
      }, 9503)
    })

    it('forwards regular paths with the prefix rewritten', async () => {
      await request(gateway)
        .get('/public/docs')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/api/public/docs')
        })
    })

    for (const path of [
      '/public/../../admin/users',
      '/public/%2e%2e/%2e%2e/admin/users',
      '/public/.%2E/admin/users',
      '/public/..\\..\\admin/users',
      '/public/..;/..;/admin/users'
    ]) {
      it(`rejects dot-segment traversal: ${path}`, async () => {
        const response = await rawRequest(9503, path)
        expect(response.statusCode).to.equal(400)
      })
    }

    it('strips the prefix case-insensitively, matching how routes are matched', async () => {
      await request(gateway)
        .get('/Users/42')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/42')
        })
    })

    it('only strips the prefix from the beginning of the url', async () => {
      await request(gateway)
        .get('/USERS/a/users/b')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/a/users/b')
        })
    })

    it('uses prefixRewrite literally (no replacement patterns)', async () => {
      await request(gateway)
        .get('/internal/info')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/v$&/info')
        })
    })

    it('prefixRewrite ending with "/" does not produce a double slash', async () => {
      await request(gateway)
        .get('/slash/users')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/v2/users')
        })
    })

    it('"/" prefix acts as a catch-all route', async () => {
      await request(gateway)
        .get('/foo/bar')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/foo/bar')
        })
    })
  })

  describe('trailing slash prefix', () => {
    let gateway

    before(async () => {
      gateway = await start({
        routes: [{ prefix: '/svc/', prefixRewrite: '/api', target }]
      }, 9504)
    })

    it('matches nested paths and rewrites them', async () => {
      await request(gateway)
        .get('/svc/foo')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/api/foo')
        })
    })
  })

  describe('query string', () => {
    let gateway

    before(async () => {
      gateway = await start({
        routes: [
          { prefix: '/svc', target },
          {
            prefix: '/set-query',
            target,
            hooks: {
              onRequest (req) {
                req.query.name = 'fast-gateway'
              }
            }
          }
        ]
      }, 9505)
    })

    it('keeps repeated query parameters', async () => {
      await request(gateway)
        .get('/svc/items?a=1&a=2&b=3')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/items?a=1&a=2&b=3')
        })
    })

    it('allows onRequest to set req.query when the request has no query string', async () => {
      await request(gateway)
        .get('/set-query/items')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/items?name=fast-gateway')
        })
    })
  })

  describe('timeouts', () => {
    let gateway

    before(async () => {
      gateway = await start({
        timeout: 100,
        routes: [
          {
            prefix: '/request-opts',
            target,
            hooks: {
              request: { family: 4 }
            }
          },
          {
            prefix: '/disabled',
            timeout: 0,
            target
          }
        ]
      }, 9506)
    })

    it('keeps the route timeout when hooks.request is set', async () => {
      await request(gateway).get('/request-opts/slow').expect(504)
    })

    it('timeout: 0 disables the global timeout for a route', async () => {
      await request(gateway).get('/disabled/slow').expect(200)
    })
  })

  describe('route configuration objects', () => {
    it('shared hooks object between http and lambda routes', async () => {
      const hooks = {}
      const gateway = await start({
        routes: [
          { prefix: '/http', target, hooks },
          {
            prefix: '/lambda',
            proxyType: 'lambda',
            target: 'a-lambda-function',
            proxyConfig: {
              lambdaProxy: (params, cb) => setImmediate(() => cb(null, {
                StatusCode: 200,
                Payload: JSON.stringify({ statusCode: 200, body: 'from lambda' })
              }))
            },
            hooks
          }
        ]
      }, 9507)

      await request(gateway)
        .get('/http/info')
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/info')
        })

      await request(gateway)
        .get('/lambda/info')
        .timeout(1000)
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('from lambda')
        })

      expect(hooks).to.deep.equal({})
    })

    it('reusing routes for another gateway does not leak settings', async () => {
      const routes = [{ prefix: '/svc', target }]
      await start({ timeout: 100, routes }, 9508)
      const gateway = await start({ routes }, 9509)

      await request(gateway).get('/svc/slow').expect(200)
    })

    it('supports the documented "http-legacy" proxy type', async () => {
      const fastProxyLite = require('fast-proxy-lite')
      const gateway = await start({
        proxyFactory: ({ proxyType, route }) => {
          if (proxyType === 'http-legacy') {
            return fastProxyLite({ base: route.target }).proxy
          }
        },
        routes: [{ prefix: '/legacy', proxyType: 'http-legacy', target }]
      }, 9510)

      await request(gateway)
        .get('/legacy/info')
        .timeout(1000)
        .expect(200)
        .then((response) => {
          expect(response.body.url).to.equal('/info')
        })

      expect(() => fastGateway({
        routes: [{ prefix: '/legacy', proxyType: 'http-legacy', target }]
      })).to.not.throw(/Unsupported proxy type/)
    })

    it('passes req.query unchanged to non "http" proxy types', async () => {
      const gateway = await start({
        proxyFactory: () => () => {},
        routes: [
          {
            prefix: '/legacy',
            proxyType: 'http-legacy',
            target,
            proxyHandler: (req, res, url, proxy, proxyOpts) => {
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({
                isURLSearchParams: proxyOpts.queryString instanceof URLSearchParams,
                queryString: proxyOpts.queryString
              }))
            }
          }
        ]
      }, 9512)

      await request(gateway)
        .get('/legacy/items?a=1&a=2&b=3')
        .expect(200)
        .then((response) => {
          expect(response.body).to.deep.equal({
            isURLSearchParams: false,
            queryString: { a: ['1', '2'], b: '3' }
          })
        })
    })

    it('services.json describes RegExp prefixes', async () => {
      const gateway = await start({
        routes: [{ prefix: /\/regex\/.*/, target }]
      }, 9511)

      await request(gateway)
        .get('/services.json')
        .expect(200)
        .then((response) => {
          expect(response.body).to.deep.equal([{ prefix: '/\\/regex\\/.*/' }])
        })
    })
  })
})
