'use strict'

/* global describe, it, before, after */
const expect = require('chai').expect
const gateway = require('../index')
const WebSocket = require('faye-websocket')
const http = require('http')
const net = require('net')
const crypto = require('crypto')

const GW_PORT = 9300
const UPSTREAM_PORT = 9301
const SHARED_GW_PORT = 9302
const CONFIG_GW_PORT = 9303
const MULTI_LISTENER_GW_PORT = 9304
const DEAD_PORT = 9399

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate, timeout = 1000) => {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await sleep(10)
  }
  return true
}

const trackSockets = (server) => {
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return sockets
}

const closeServer = async (server, sockets) => {
  sockets.forEach((socket) => socket.destroy())
  await Promise.race([new Promise((resolve) => server.close(resolve)), sleep(500)])
}

const nextClose = (ws) => new Promise((resolve) => ws.on('close', resolve))

const nextMessage = (ws) => new Promise((resolve) => {
  ws.on('message', (event) => resolve(JSON.parse(event.data)))
})

const rawUpgrade = (path, headers) => new Promise((resolve) => {
  const socket = net.connect(GW_PORT, '127.0.0.1', () => {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${GW_PORT}\r\n${headers}\r\n`)
  })
  socket.on('error', () => {})
  resolve(socket)
})

const wsUpgradeHeaders = (version = 13) =>
  'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
  `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n` +
  `Sec-WebSocket-Version: ${version}\r\n`

const failingHook = (code, message) => () => {
  const err = new Error(message)
  err.closeEventCode = code

  throw err
}

describe('ws-proxy regressions', function () {
  this.timeout(5000)

  let gw, upstream, upstreamSockets, gwSockets
  const state = { upgrades: 0, open: new Set(), closes: [] }

  before(async () => {
    upstream = http.createServer()
    upstreamSockets = trackSockets(upstream)
    upstream.on('upgrade', (req, socket, body) => {
      state.upgrades++
      state.open.add(socket)
      socket.on('close', () => state.open.delete(socket))

      const ws = new WebSocket(req, socket, body, ['graphql-ws', 'graphql-transport-ws'])
      ws.on('message', (event) => {
        if (event.data === 'kick') return ws.close(4001, 'kicked')
        if (event.data === 'crash') return socket.destroy()
        ws.send(JSON.stringify({ data: event.data, url: req.url, protocol: ws.protocol }))
      })
      ws.on('close', (event) => state.closes.push({ code: event.code, reason: event.reason }))
    })
    await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

    const target = `ws://127.0.0.1:${UPSTREAM_PORT}`
    gw = gateway({
      routes: [
        { proxyType: 'websocket', prefix: '/echo', target },
        { proxyType: 'websocket', prefix: '/down', target: `ws://127.0.0.1:${DEAD_PORT}` },
        {
          proxyType: 'websocket',
          prefix: '/slow',
          target,
          hooks: { onOpen: () => sleep(150) }
        },
        {
          proxyType: 'websocket',
          prefix: '/sync-auth',
          target,
          hooks: { onOpen: failingHook(4401, 'Unauthorized') }
        },
        {
          proxyType: 'websocket',
          prefix: '/long-reason',
          target,
          hooks: { onOpen: failingHook(4401, 'Unauthorized: ' + 'x'.repeat(200)) }
        },
        {
          proxyType: 'websocket',
          prefix: '/emoji-reason',
          target,
          hooks: { onOpen: failingHook(4401, 'a'.repeat(120) + '\u{1F600}') }
        },
        {
          proxyType: 'websocket',
          prefix: '/invalid-code',
          target,
          hooks: { onOpen: failingHook(1008, 'Policy violation') }
        },
        {
          proxyType: 'websocket',
          prefix: '/reject-undefined',
          target,
          hooks: { onOpen: () => Promise.reject() } // eslint-disable-line prefer-promise-reject-errors
        },
        {
          proxyType: 'websocket',
          prefix: '/graphql',
          target,
          subProtocols: ['graphql-ws', 'graphql-transport-ws']
        }
      ]
    })
    gwSockets = trackSockets(gw.getServer())
    await gw.start(GW_PORT)
  })

  after(async () => {
    await closeServer(gw.getServer(), gwSockets)
    await closeServer(upstream, upstreamSockets)
  })

  it('closes the client when the upstream is unreachable', async () => {
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/down`)
    const closed = await Promise.race([nextClose(ws), sleep(1500)])

    expect(closed, 'client socket left open').to.not.equal(undefined)
  })

  it('closes the upstream when the client connection is reset', async () => {
    const before = state.upgrades
    const socket = await rawUpgrade('/echo', wsUpgradeHeaders())
    expect(await waitFor(() => state.upgrades === before + 1 && state.open.size === 1)).to.equal(true)

    socket.resetAndDestroy()

    expect(await waitFor(() => state.open.size === 0), 'upstream connection leaked').to.equal(true)
  })

  it('propagates close codes and reasons in both directions', async () => {
    const kicked = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/echo`)
    kicked.on('open', () => kicked.send('kick'))
    const event = await nextClose(kicked)
    expect([event.code, event.reason]).to.deep.equal([4001, 'kicked'])

    const leaving = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/echo`)
    await new Promise((resolve) => leaving.on('open', resolve))
    await waitFor(() => state.open.size === 1)
    state.closes.length = 0
    leaving.close(4000, 'bye')

    expect(await waitFor(() => state.closes.length === 1)).to.equal(true)
    expect(state.closes[0]).to.deep.equal({ code: 4000, reason: 'bye' })
  })

  it('reports an abnormal upstream close to the client as abnormal', async () => {
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/echo`)
    ws.on('open', () => ws.send('crash'))
    const event = await nextClose(ws)

    expect(event.code).to.equal(1006)
  })

  it('truncates long close reasons on a character boundary', async () => {
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/emoji-reason`)
    const event = await nextClose(ws)

    expect(event.code).to.equal(4401)
    expect(event.reason).to.equal('a'.repeat(120))
  })

  it('ends upgrades no listener handles when the server has other upgrade listeners', async () => {
    const multi = gateway({
      enableServicesEndpoint: false,
      routes: [{ proxyType: 'websocket', prefix: '/proxied', target: `ws://127.0.0.1:${UPSTREAM_PORT}` }]
    })
    const server = multi.getServer()
    const sockets = trackSockets(server)
    server.on('upgrade', () => {}) // e.g. another library ignoring paths it doesn't own
    await multi.start(MULTI_LISTENER_GW_PORT)

    try {
      const socket = net.connect(MULTI_LISTENER_GW_PORT, '127.0.0.1', () => {
        socket.write(`GET /unknown HTTP/1.1\r\nHost: 127.0.0.1:${MULTI_LISTENER_GW_PORT}\r\n${wsUpgradeHeaders()}\r\n`)
      })
      socket.on('error', () => {})
      const closed = await Promise.race([
        new Promise((resolve) => socket.on('close', () => resolve(true))),
        sleep(2000)
      ])
      socket.destroy()

      expect(closed, 'unhandled upgrade socket left open').to.equal(true)
    } finally {
      await closeServer(server, sockets)
    }
  })

  it('does not lose messages sent while an async onOpen hook is pending', async () => {
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/slow`)
    ws.on('open', () => ws.send('first'))
    const reply = await Promise.race([nextMessage(ws), sleep(1000)])
    ws.close()

    expect(reply, 'message lost').to.not.equal(undefined)
    expect(reply.data).to.equal('first')
  })

  it('bounds the messages queued while an async onOpen hook is pending', async () => {
    const before = state.upgrades
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/slow`)
    ws.on('open', () => {
      for (let i = 0; i < 3; i++) ws.send(Buffer.alloc(512 * 1024))
    })
    const closed = await Promise.race([nextClose(ws), sleep(1000)])

    expect(closed, 'client socket left open').to.not.equal(undefined)
    expect(closed.code).to.equal(4413)
    await sleep(200)
    expect(state.upgrades).to.equal(before)
  })

  it('does not mutate websocket route configs', async () => {
    const route = { proxyType: 'websocket', prefix: '/echo', target: `ws://127.0.0.1:${UPSTREAM_PORT}` }
    const configGw = gateway({ routes: [route] })
    const configGwSockets = trackSockets(configGw.getServer())
    await configGw.start(CONFIG_GW_PORT)

    const ws = new WebSocket.Client(`ws://127.0.0.1:${CONFIG_GW_PORT}/echo`)
    await new Promise((resolve) => ws.on('open', resolve))
    ws.close()
    await nextClose(ws)
    await closeServer(configGw.getServer(), configGwSockets)

    expect(route).to.deep.equal({
      proxyType: 'websocket',
      prefix: '/echo',
      target: `ws://127.0.0.1:${UPSTREAM_PORT}`
    })
  })

  it('does not open an upstream connection when the client left during onOpen', async () => {
    const before = state.upgrades
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/slow`)
    ws.on('open', () => ws.close())
    await nextClose(ws)
    await sleep(300)

    expect(state.upgrades).to.equal(before)
  })

  it('does not open an upstream connection for a rejected client handshake', async () => {
    const before = state.upgrades
    const socket = await rawUpgrade('/echo', wsUpgradeHeaders(99))
    let response = ''
    socket.on('data', (chunk) => { response += chunk })
    await new Promise((resolve) => socket.on('close', resolve))
    await sleep(200)

    expect(response).to.match(/^HTTP\/1\.1 400/)
    expect(state.upgrades).to.equal(before)
  })

  it('survives onOpen errors with invalid close codes or non-Error rejections', async () => {
    const rejections = []
    const onRejection = (reason) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)

    try {
      for (const path of ['/invalid-code', '/reject-undefined']) {
        const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}${path}`)
        const event = await Promise.race([nextClose(ws), sleep(1000)])

        expect(event, `${path}: client socket left open`).to.not.equal(undefined)
        expect(event.code).to.equal(4500)
      }
      expect(rejections).to.have.lengthOf(0)
    } finally {
      process.removeListener('unhandledRejection', onRejection)
    }
  })

  it('delivers the onOpen close code when the hook throws synchronously', async () => {
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/sync-auth`)
    const event = await nextClose(ws)
    expect([event.code, event.reason]).to.deep.equal([4401, 'Unauthorized'])

    const long = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/long-reason`)
    const longEvent = await nextClose(long)
    expect(longEvent.code).to.equal(4401)
    expect(longEvent.reason.startsWith('Unauthorized: xxx')).to.equal(true)
  })

  it('does not hang non-WebSocket upgrade requests', async () => {
    const socket = await rawUpgrade(
      '/svc/hello',
      'Connection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABkAAQAoAAAAAIAAAAA\r\n'
    )
    const closed = await Promise.race([
      new Promise((resolve) => socket.on('close', () => resolve(true))),
      sleep(1000)
    ])
    socket.destroy()

    expect(closed, 'socket left hanging').to.equal(true)
  })

  it('leaves unmatched upgrades to other upgrade listeners on the same server', async () => {
    const shared = gateway({
      enableServicesEndpoint: false,
      routes: [{ proxyType: 'websocket', prefix: '/proxied', target: `ws://127.0.0.1:${UPSTREAM_PORT}` }]
    })
    const server = shared.getServer()
    const sockets = trackSockets(server)
    server.on('upgrade', (req, socket, body) => {
      if (req.url === '/local') {
        const ws = new WebSocket(req, socket, body)
        ws.on('message', (event) => ws.send(JSON.stringify({ data: 'local:' + event.data })))
      }
    })
    await shared.start(SHARED_GW_PORT)

    try {
      for (const [path, expected] of [['/local', 'local:ping'], ['/proxied', 'ping']]) {
        const ws = new WebSocket.Client(`ws://127.0.0.1:${SHARED_GW_PORT}${path}`)
        ws.on('open', () => ws.send('ping'))
        const reply = await Promise.race([nextMessage(ws), nextClose(ws), sleep(1000)])
        ws.close()

        expect(reply && reply.data, path).to.equal(expected)
      }
    } finally {
      await closeServer(server, sockets)
    }
  })

  it('offers upstream only the subprotocol negotiated with the client', async () => {
    const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}/graphql`, ['graphql-transport-ws'])
    ws.on('open', () => ws.send('init'))
    const reply = await nextMessage(ws)
    ws.close()

    expect(ws.protocol).to.equal('graphql-transport-ws')
    expect(reply.protocol).to.equal('graphql-transport-ws')
  })

  it('forwards the query string unchanged', async () => {
    for (const path of ['/echo', '/echo?q=a%20b&path=a/b&sig=x~y']) {
      const ws = new WebSocket.Client(`ws://127.0.0.1:${GW_PORT}${path}`)
      ws.on('open', () => ws.send('x'))
      const reply = await nextMessage(ws)
      ws.close()

      expect(reply.url).to.equal(path)
    }
  })
})
