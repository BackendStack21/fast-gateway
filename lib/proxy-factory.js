'use strict'

module.exports = (() => {
  let fastProxyLite, httpLambdaProxy, fastProxyLegacy

  return ({ proxyType, opts, route }) => {
    const base = opts.targetOverride || route.target
    const config = route.proxyConfig || {}

    switch (proxyType) {
      case 'http':
        fastProxyLite = fastProxyLite || require('fast-proxy-lite')
        return fastProxyLite({
          base,
          ...config
        }).proxy

      case 'lambda':
        httpLambdaProxy = httpLambdaProxy || require('http-lambda-proxy')
        return httpLambdaProxy({
          target: base,
          region: 'eu-central-1',
          ...config
        })

      case 'http-legacy':
        fastProxyLegacy = fastProxyLegacy || require('fast-proxy')
        return fastProxyLegacy({
          base,
          ...config
        }).proxy

      default:
        throw new Error(`Unsupported proxy type: ${proxyType}!`)
    }
  }
})()
