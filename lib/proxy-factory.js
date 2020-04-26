'use strict'

const fastProxy = require('fast-proxy')

module.exports = ({ proxyType, opts, route }) => {
  let proxy
  if (proxyType === 'http') {
    proxy = fastProxy({
      base: opts.targetOverride || route.target,
      http2: !!route.http2,
      ...(route.fastProxy)
    }).proxy
  } else if (proxyType === 'lambda') {
    proxy = require('http-lambda-proxy')({
      target: opts.targetOverride || route.target,
      region: 'eu-central-1',
      ...(route.lambdaProxy || {})
    })
  }

  return proxy
}
