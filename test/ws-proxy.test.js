'use strict'

const gateway = require('../index')
const WebSocket = require('faye-websocket')
const http = require('http')

/* global describe, it */
const expect = require('chai').expect

describe('ws-proxy', () => {
  let gw, echoServer

  it('initialize', async () => {
    echoServer = http.createServer()
    echoServer.on('upgrade', (request, socket, body) => {
      if (WebSocket.isWebSocket(request)) {
        const ws = new WebSocket(request, socket, body)

        ws.on('message', (event) => {
          ws.send(JSON.stringify({
            data: event.data,
            url: request.url
          }))
        })
      }
    })
    echoServer.listen(3000)

    gw = gateway({
      routes: [{
        proxyType: 'websocket',
        prefix: '/',
        target: 'ws://127.0.0.1:3000'
      }, {
        proxyType: 'websocket',
        prefix: '/echo',
        target: 'ws://127.0.0.1:3000'
      }, {
        proxyType: 'websocket',
        prefix: '/*-auth',
        target: 'ws://127.0.0.1:3000',
        hooks: {
          onOpen (ws, searchParams) {
            if (searchParams.get('accessToken') !== '12345') {
              const err = new Error('Unauthorized')
              err.closeEventCode = 4401

              throw err
            }
          }
        }
      }, {
        proxyType: 'websocket',
        prefix: '/echo-params',
        target: 'ws://127.0.0.1:3000',
        hooks: {
          onOpen (ws, searchParams) {
            searchParams.set('x-token', 'abc')
          }
        }
      }]
    })

    await gw.start(8080)
  })

  it('should echo using default prefix', (done) => {
    const ws = new WebSocket.Client('ws://127.0.0.1:8080')
    const msg = 'hello'

    ws.on('message', (event) => {
      const { data } = JSON.parse(event.data)
      expect(data).equals('hello')

      ws.close()
      done()
    })

    ws.send(msg)
  })

  it('should echo', (done) => {
    const ws = new WebSocket.Client('ws://127.0.0.1:8080/echo')
    const msg = 'hello'

    ws.on('message', (event) => {
      const { data } = JSON.parse(event.data)
      expect(data).equals('hello')

      ws.close()
      done()
    })

    ws.send(msg)
  })

  it('should fail auth', (done) => {
    const ws = new WebSocket.Client('ws://127.0.0.1:8080/echo-auth?accessToken=2')
    ws.on('close', (event) => {
      done()
    })
  })

  it('should pass auth', (done) => {
    const ws = new WebSocket.Client('ws://127.0.0.1:8080/echo-auth?accessToken=12345')
    const msg = 'hello'

    ws.on('message', (event) => {
      const { data } = JSON.parse(event.data)
      expect(data).equals('hello')

      ws.close()
      done()
    })

    ws.send(msg)
  })

  it('should rewrite search params', (done) => {
    const ws = new WebSocket.Client('ws://127.0.0.1:8080/echo-params')
    const msg = 'hello'

    ws.on('message', (event) => {
      const { url } = JSON.parse(event.data)
      expect(url).contains('?x-token=abc')

      ws.close()
      done()
    })

    ws.send(msg)
  })

  it('shutdown', async () => {
    await gw.close()
    echoServer.close()
  })
})
