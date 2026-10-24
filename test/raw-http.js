'use strict'

const net = require('net')

// sends a raw HTTP/1.1 request so the request target is not normalized by the client
module.exports = (port, path, { method = 'GET', headers = {}, timeout = 2000 } = {}) =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    const chunks = []
    const lines = Object.entries({ Host: '127.0.0.1:' + port, Connection: 'close', ...headers })
      .map(([name, value]) => `${name}: ${value}`)

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('raw request timed out'))
    }, timeout)

    socket.on('connect', () => socket.write(`${method} ${path} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`))
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      const data = Buffer.concat(chunks).toString()
      const index = data.indexOf('\r\n\r\n')
      const head = data.slice(0, index).split('\r\n')
      const headers = {}
      head.slice(1).forEach((line) => {
        const separator = line.indexOf(':')
        headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
      })

      resolve({
        statusCode: parseInt(head[0].split(' ')[1], 10),
        headers,
        body: data.slice(index + 4)
      })
    })
  })
