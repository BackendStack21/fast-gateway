'use strict'

module.exports = (() => {
  let fastProxyLite, lambdaProxyFactory, legacyProxyFactory

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
        lambdaProxyFactory = lambdaProxyFactory || require('http-lambda-proxy')
        return lambdaProxyFactory({
          target: base,
          region: 'eu-central-1',
          ...config
        })

      case 'http-legacy':
        legacyProxyFactory = legacyProxyFactory || require('fast-proxy')
        return legacyProxyFactory({
          base,
          ...config
        }).proxy

      default:
        throw new Error(`Unsupported proxy type: ${proxyType}!`)
    }
  }
})()