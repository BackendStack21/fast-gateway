'use strict'

import { IncomingMessage } from 'http'
import gateway from '../index'
import { http } from '../lib/default-hooks'
import { ServerResponse } from 'http'

gateway({
  routes: [
    {
      prefix: '/httpbin',
      target: 'https://httpbin.org',
      hooks: {
        onRequest: (req: IncomingMessage, res: ServerResponse) => {
          console.log('Request to httpbin.org')

          return false
        },
        onResponse: (
          req: IncomingMessage,
          res: ServerResponse,
          proxyRequest: IncomingMessage,
        ) => {
          console.log('POST request to httpbin.org')

          // continue forwarding the response
          http.onResponse(req, res, proxyRequest)
        },
      },
    },
  ],
}).start(8080)
