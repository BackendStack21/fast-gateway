'use strict'

let micromatch
try {
  micromatch = require('micromatch')
} catch (e) {
  micromatch = {
    isMatch (value, pattern) {
      return value === pattern
    }
  }
}

module.exports = (hostname2prefix) => {
  const matches = {}

  return (req, res, cb) => {
    if (req.headers.host) {
      const hostHeader = req.headers.host.split(':')[0]
      let prefix = matches[hostHeader]

      if (!prefix) {
        for (const e of hostname2prefix) {
          if (micromatch.isMatch(hostHeader, e.hostname)) {
            prefix = e.prefix
            matches[hostHeader] = prefix

            break
          }
        }
      }

      if (prefix) {
        req.url = prefix + req.url
      }
    }

    return cb()
  }
}
