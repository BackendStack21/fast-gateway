'use strict'

/* global describe, it, before, after */
const expect = require('chai').expect
const request = require('supertest')
const http = require('http')
const net = require('net')
const fastGateway = require('../index')
const defaultHooks = require('../lib/default-hooks')
const rawRequest = require('./raw-http')

const UPSTREAM_PORT = 9551
const GATEWAY_PORT = 9552
const RAW_UPSTREAM_PORT = 9553

const binaryParser = (res, cb) => {
  const chunks = []
  res.on('data', (chunk) => chunks.push(chunk))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

const lambdaRoute = (prefix, payload, response = { StatusCode: 200 }) => ({
  prefix,
  proxyType: 'lambda',
  target: 'a-lambda-function',
  proxyConfig: {
    lambdaProxy: (params, cb) => setImmediate(() => cb(null, {
      ...response,
      Payload: JSON.stringify(payload)
    }))
  }
})

describe('default hooks', () => {
  let gateway, upstream, rawUpstream
  const upstreamClosed = []
  const pending = []

  before(async () => {
    upstream = http.createServer((req, res) => {
      // the gateway always appends '?' when forwarding req.query, ignore it
      req.url = req.url.replace(/\?$/, '')
      if (req.url === '/large-chunked') {
        res.setHeader('content-type', 'application/octet-stream')
        res.write(Buffer.alloc(2 * 1024 * 1024, 'x'))
        res.end()
      } else if (req.url === '/endless') {
        res.on('close', () => upstreamClosed.push(req.url))
        const timer = setInterval(() => res.write('data: tick\n\n'), 20)
        res.on('close', () => clearInterval(timer))
        pending.push(res)
      } else if (req.url === '/gzip-aborted') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
        res.write(Buffer.from([0x1f, 0x8b]))
        setTimeout(() => res.destroy(), 20)
      }
    })
    await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, resolve))

    // writes a response node's http server can't produce
    rawUpstream = net.createServer((socket) => {
      socket.once('data', () => {
        socket.end('HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n')
      })
    })
    await new Promise((resolve) => rawUpstream.listen(RAW_UPSTREAM_PORT, resolve))

    gateway = fastGateway({
      routes: [
        { prefix: '/http', target: `http://127.0.0.1:${UPSTREAM_PORT}` },
        { prefix: '/raw', target: `http://127.0.0.1:${RAW_UPSTREAM_PORT}` },
        lambdaRoute('/lambda-no-status', { body: 'no status' }, {}),
        lambdaRoute('/lambda-no-body', { statusCode: 204 }),
        lambdaRoute('/lambda-no-status-code', { body: 'hello' }),
        lambdaRoute('/lambda-object-body', { statusCode: 201, body: { name: 'fast-gateway' } }),
        lambdaRoute('/lambda-base64', {
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
          isBase64Encoded: true,
          body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]).toString('base64')
        })
      ]
    })
    await gateway.start(GATEWAY_PORT)
  })

  after(async () => {
    pending.forEach((res) => res.destroy())
    await gateway.close()
    upstream.closeAllConnections()
    await new Promise((resolve) => upstream.close(resolve))
    await new Promise((resolve) => rawUpstream.close(resolve))
  })

  describe('http', () => {
    it('(Connection: close) chunked response above the buffer limit is streamed', async () => {
      await request(gateway)
        .get('/http/large-chunked')
        .set('Connection', 'close')
        .buffer(true)
        .parse(binaryParser)
        .expect(200)
        .then((response) => {
          expect(response.body.length).to.equal(2 * 1024 * 1024)
        })
    })

    it('(Connection: close) upstream is released when the client goes away while buffering', async () => {
      await new Promise((resolve) => {
        const req = http.get({
          port: GATEWAY_PORT,
          path: '/http/endless',
          headers: { Connection: 'close' }
        })
        req.on('error', () => {})
        setTimeout(() => {
          req.destroy()
          resolve()
        }, 100)
      })

      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(upstreamClosed).to.deep.equal(['/endless'])
    })

    it('(Connection: close) buffered response does not mix transfer-encoding and content-length', async () => {
      const response = await rawRequest(GATEWAY_PORT, '/raw/gzip-chunked')

      expect(response.statusCode).to.equal(200)
      expect(response.headers['transfer-encoding']).to.equal(undefined)
      expect(response.headers['content-length']).to.equal('5')
      expect(response.body).to.equal('hello')
    })

    it('(Connection: close) failed upstream body does not leak upstream headers', async () => {
      const response = await rawRequest(GATEWAY_PORT, '/http/gzip-aborted')

      expect(response.statusCode).to.equal(500)
      expect(response.headers['content-encoding']).to.equal(undefined)
    })
  })

  describe('lambda', () => {
    it('defaults the status code when the payload has none', async () => {
      await request(gateway)
        .get('/lambda-no-status-code/info')
        .timeout(1000)
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('hello')
        })
    })

    it('defaults to 200 when neither the payload nor the invocation has a status code', async () => {
      await request(gateway)
        .get('/lambda-no-status/info')
        .timeout(1000)
        .expect(200)
        .then((response) => {
          expect(response.text).to.equal('no status')
        })
    })

    it('sends an empty body when the payload has none', async () => {
      await request(gateway)
        .get('/lambda-no-body/info')
        .timeout(1000)
        .expect(204)
    })

    it('handles a null payload', () => {
      const res = {
        end (body) {
          this.ended = true
          this.body = body
        }
      }
      defaultHooks.lambda.onResponse({}, res, { StatusCode: 200, Payload: 'null' })

      expect(res.statusCode).to.equal(200)
      expect(res.ended).to.equal(true)
      expect(res.body).to.equal(undefined)
    })

    it('serializes non-string bodies', async () => {
      await request(gateway)
        .get('/lambda-object-body/info')
        .timeout(1000)
        .expect(201)
        .then((response) => {
          expect(response.text).to.equal('{"name":"fast-gateway"}')
        })
    })

    it('decodes base64 encoded bodies', async () => {
      await request(gateway)
        .get('/lambda-base64/info')
        .timeout(1000)
        .buffer(true)
        .parse(binaryParser)
        .expect(200)
        .then((response) => {
          expect(response.headers['content-type']).to.equal('image/png')
          expect(response.body.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]))).to.equal(true)
        })
    })
  })
})
