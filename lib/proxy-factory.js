'use strict'
const fastProxy = require('fast-proxy')
const lambdaProxy = require('http-lambda-proxy')

module.exports = ({ proxyType, opts, route }) => {
  let proxy
  if (proxyType === 'http') {
    proxy = fastProxy({
      base: opts.targetOverride || route.target,
      http2: !!route.http2,
      ...(opts.fastProxy)
    }).proxy
  } else if (proxyType === 'lambda') {
    proxy = lambdaProxy({
      target: opts.targetOverride || route.target,
      ...(route.lambdaProxy || {
        region: 'eu-central-1'
      })
    })
  }

  return proxy
}
