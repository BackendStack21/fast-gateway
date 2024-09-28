'use strict'

const fastProxy = require('fast-proxy-lite')

module.exports = ({ proxyType, opts, route }) => {
  let proxy

  if (proxyType === 'http') {
    proxy = fastProxy({
      base: opts.targetOverride || route.target,
      ...route.proxyConfig
    }).proxy
  } else if (proxyType === 'lambda') {
    proxy = require('http-lambda-proxy')({
      target: opts.targetOverride || route.target,
      region: 'eu-central-1',
      ...route.proxyConfig
    })
  } else if (proxyType === 'http-legacy') {
    proxy = require('fast-proxy')({
      base: opts.targetOverride || route.target,
      ...route.proxyConfig
    }).proxy
  } else {
    throw new Error(`Unsupported proxy type: ${proxyType}!`)
  }

  return proxy
}
