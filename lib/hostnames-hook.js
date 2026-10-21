'use strict'

let micromatch
try {
  micromatch = require('micromatch')
} catch (e) {
  micromatch = {
    matcher (pattern) {
      pattern = pattern.toLowerCase()

      return (value) => value === pattern
    }
  }
}

module.exports = (hostname2prefix) => {
  // matchers are compiled once, caching results per host would grow without bound
  const matchers = hostname2prefix.map((e) => ({
    isMatch: micromatch.matcher(e.hostname, { nocase: true }),
    prefix: e.prefix
  }))

  return (req, res, cb) => {
    if (req.headers.host) {
      // host names are case-insensitive
      const hostHeader = req.headers.host.split(':')[0].toLowerCase()
      const match = matchers.find((e) => e.isMatch(hostHeader))

      if (match && match.prefix) {
        req.url = match.prefix + req.url
      }
    }

    return cb()
  }
}
