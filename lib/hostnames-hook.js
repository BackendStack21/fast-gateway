'use strict'

const micromatch = require('micromatch')

// maximum length of a DNS name
const MAX_HOSTNAME_LENGTH = 253

module.exports = (hostname2prefix) => {
  // matchers are compiled once, caching results per host would grow without bound
  const matchers = hostname2prefix.map((e) => ({
    isMatch: micromatch.matcher(e.hostname, { nocase: true }),
    prefix: e.prefix
  }))

  return (req, res, cb) => {
    // HTTP/2 requests carry the host in the ":authority" pseudo-header
    const host = req.headers.host || req.headers[':authority']
    if (host) {
      // host names are case-insensitive
      const hostHeader = host.split(':')[0].toLowerCase()
      // matching a glob pattern against a huge value can block the event loop
      const match = hostHeader.length <= MAX_HOSTNAME_LENGTH
        ? matchers.find((e) => e.isMatch(hostHeader))
        : undefined

      if (match && match.prefix) {
        req.url = match.prefix + req.url
      }
    }

    return cb()
  }
}
