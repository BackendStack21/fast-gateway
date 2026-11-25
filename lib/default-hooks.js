'use strict'

const pump = require('pump')
const TRANSFER_ENCODING_HEADER_NAME = 'transfer-encoding'
const NGHTTP2_INTERNAL_ERROR = 0x02

// Maximum size in bytes for buffered chunked responses (Connection: close)
// Larger upstream response bodies are streamed instead, preventing memory exhaustion
const MAX_BUFFER_SIZE = 1 * 1024 * 1024 // 1MB

// Destroying the response (what pump does) ends an HTTP/2 stream gracefully:
// the stream is reset instead when the upstream response fails midway, so
// the client can tell that the payload is incomplete.
const pipe = (stream, res, cb) => {
  const reset = () => {
    if (res.stream && !res.stream.destroyed) {
      res.stream.close(NGHTTP2_INTERNAL_ERROR)
    }
  }
  stream.once('aborted', reset)
  stream.once('error', reset)

  pump(stream, res, cb)
}

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
        pipe(stream, res, () => resolve())
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

      // HEAD, 204 and 304 responses have no body: buffering them would add a
      // "content-length: 0" header that does not describe the resource
      const hasBody = req.method !== 'HEAD' &&
        stream.statusCode !== 204 &&
        stream.statusCode !== 304

      if (req.headers.connection === 'close' && chunked && hasBody) {
        // the buffered response is sent with a content-length instead,
        // a transfer-encoding can't be combined with it
        res.removeHeader(TRANSFER_ENCODING_HEADER_NAME)

        return bufferResponse(res, stream)
      }

      res.statusCode = stream.statusCode
      pipe(stream, res)
    }
  }
}

// fast-proxy (http-legacy) responses are handled as fast-proxy-lite ones
module.exports['http-legacy'] = module.exports.http
