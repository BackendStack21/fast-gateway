'use strict'

const pump = require('pump')
const TRANSFER_ENCODING_HEADER_NAME = 'transfer-encoding'

// Maximum size in bytes for buffered chunked responses (Connection: close)
// Larger upstream response bodies are streamed instead, preventing memory exhaustion
const MAX_BUFFER_SIZE = 1 * 1024 * 1024 // 1MB

const NOOP = () => {}

const bufferResponse = (res, stream) =>
  new Promise((resolve) => {
    const chunks = []
    let totalSize = 0

    const cleanup = () => {
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
      res.removeListener('close', onClose)
    }

    const onData = (chunk) => {
      totalSize += chunk.length
      chunks.push(chunk)
      if (totalSize > MAX_BUFFER_SIZE) {
        // too large to be buffered, flush what we have and stream the rest
        stream.pause()
        cleanup()
        chunks.forEach((chunk) => res.write(chunk))
        pump(stream, res, () => resolve())
      }
    }

    const onEnd = () => {
      cleanup()
      const resBuffer = Buffer.concat(chunks)

      // add content-length header and send the merged response buffer
      res.setHeader('content-length', '' + Buffer.byteLength(resBuffer))
      res.end(resBuffer)
      resolve()
    }

    const onError = (err) => {
      cleanup()
      // upstream headers (e.g. content-encoding) don't describe the error body
      Object.keys(stream.headers).forEach((name) => res.removeHeader(name))
      res.statusCode = 500
      res.end(err.message)
      resolve()
    }

    const onClose = () => {
      // the client went away before the response was sent, release the upstream
      cleanup()
      stream.on('error', NOOP)
      stream.destroy()
      resolve()
    }

    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
    res.on('close', onClose)
  })

module.exports = {
  websocket: {
    onOpenNoOp (ws, searchParams) {}
  },
  lambda: {
    onRequestNoOp (req, res) {},
    onResponse (req, res, response) {
      const {
        statusCode = response.StatusCode || 200,
        body,
        isBase64Encoded
      } = JSON.parse(response.Payload) || {}

      res.statusCode = statusCode
      if (body === undefined || body === null) {
        res.end()
      } else if (isBase64Encoded) {
        res.end(Buffer.from(body, 'base64'))
      } else {
        res.end(typeof body === 'string' ? body : JSON.stringify(body))
      }
    }
  },
  http: {
    onRequestNoOp (req, res) {},
    async onResponse (req, res, stream) {
      const chunked = stream.headers[TRANSFER_ENCODING_HEADER_NAME]
        ? stream.headers[TRANSFER_ENCODING_HEADER_NAME].endsWith('chunked')
        : false

      if (req.headers.connection === 'close' && chunked) {
        // remove transfer-encoding header
        const transferEncoding = stream.headers[
          TRANSFER_ENCODING_HEADER_NAME
        ].replace(/(,( )?)?chunked/, '')
        if (transferEncoding) {
          // header format includes many encodings, example: gzip, chunked
          res.setHeader(TRANSFER_ENCODING_HEADER_NAME, transferEncoding)
        } else {
          res.removeHeader(TRANSFER_ENCODING_HEADER_NAME)
        }

        if (!stream.headers['content-length']) {
          return bufferResponse(res, stream)
        }
      } else {
        res.statusCode = stream.statusCode
        pump(stream, res)
      }
    }
  }
}

// fast-proxy (http-legacy) responses are handled as fast-proxy-lite ones
module.exports['http-legacy'] = module.exports.http
