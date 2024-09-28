'use strict'

const pump = require('pump')
const toArray = require('stream-to-array')
const TRANSFER_ENCODING_HEADER_NAME = 'transfer-encoding'

module.exports = {
  websocket: {
    onOpenNoOp (ws, searchParams) {}
  },
  lambda: {
    onRequestNoOp (req, res) {},
    onResponse (req, res, response) {
      const { statusCode, body } = JSON.parse(response.Payload)

      res.statusCode = statusCode
      res.end(body)
    }
  },
  http: {
    onRequestNoOp (req, res) {},
    async onResponse (req, res, stream) {
      const chunked = stream.headers[TRANSFER_ENCODING_HEADER_NAME]
        ? stream.headers[TRANSFER_ENCODING_HEADER_NAME].endsWith('chunked')
        : false

      if (req.headers.connection === 'close' && chunked) {
        try {
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
            // pack all pieces into 1 buffer to calculate content length
            const resBuffer = Buffer.concat(await toArray(stream))

            // add content-length header and send the merged response buffer
            res.setHeader('content-length', '' + Buffer.byteLength(resBuffer))
            res.end(resBuffer)
          }
        } catch (err) {
          res.statusCode = 500
          res.end(err.message)
        }
      } else {
        res.statusCode = stream.statusCode
        pump(stream, res)
      }
    }
  }
}
