'use strict'

// http-lambda-proxy processes the Lambda response in the invocation callback,
// an error thrown there (invalid status code or header values, unexpected
// payloads...) would be an uncaught exception.
// aws-sdk is a dependency of http-lambda-proxy, it is not always hoisted
const requireAwsSdk = () => {
  try {
    return require('aws-sdk')
  } catch (_) /* istanbul ignore next */ {
    return require(require.resolve('aws-sdk', {
      paths: [require.resolve('http-lambda-proxy')]
    }))
  }
}

const guardedLambdaProxy = (httpLambdaProxy, config) => {
  let { lambdaProxy, target, logType, qualifier, clientContext, ...awsConfig } = config
  if (!lambdaProxy) {
    // same as the http-lambda-proxy default
    const AWS = requireAwsSdk()
    const lambda = new AWS.Lambda(awsConfig)
    lambdaProxy = (params, cb) => lambda.invoke(params, cb)
  }

  // the function is invoked synchronously by the proxy
  let current
  const proxy = httpLambdaProxy({
    ...config,
    lambdaProxy: (params, cb) => {
      const { res, headerNames } = current

      lambdaProxy(params, (err, response) => {
        try {
          cb(err, response)
        } catch (_) {
          try {
            // headers of the lambda response don't describe the error
            res.getHeaderNames().forEach((name) => {
              if (!headerNames.includes(name)) res.removeHeader(name)
            })
            res.statusCode = 502
            res.end('Bad Gateway')
          } catch (_) {
            // the response was already partially sent
            res.destroy()
          }
        }
      })
    }
  })

  return (req, res, url, opts) => {
    current = { res, headerNames: res.getHeaderNames() }
    try {
      return proxy(req, res, url, opts)
    } finally {
      current = undefined
    }
  }
}

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
        return guardedLambdaProxy(httpLambdaProxy, {
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
