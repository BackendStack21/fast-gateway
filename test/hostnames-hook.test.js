'use strict'

/* global describe, it */
const expect = require('chai').expect

describe('hostnames-hook', () => {
  let hostnamesHook = null

  it('initialize', async () => {
    hostnamesHook = require('./../lib/hostnames-hook')([
      {
        prefix: '/nodejs',
        hostname: 'nodejs.org'
      },
      {
        prefix: '/github',
        hostname: 'github.com'
      },
      {
        prefix: '/users',
        hostname: '*.company.tld'
      }
    ])
  })

  it('is match - nodejs.org', (cb) => {
    const req = {
      headers: {
        host: 'nodejs.org:443'
      },
      url: '/about'
    }

    hostnamesHook(req, null, () => {
      expect(req.url).to.equal('/nodejs/about')
      cb()
    })
  })

  it('is match - github.com', (cb) => {
    const req = {
      headers: {
        host: 'github.com:443'
      },
      url: '/about'
    }

    hostnamesHook(req, null, () => {
      expect(req.url).to.equal('/github/about')
      cb()
    })
  })

  it('is match - wildcard', (cb) => {
    const req = {
      headers: {
        host: 'kyberneees.company.tld:443'
      },
      url: '/about'
    }

    hostnamesHook(req, null, () => {
      expect(req.url).to.equal('/users/about')
      cb()
    })
  })

  it('is not match - 404', (cb) => {
    const req = {
      headers: {
        host: 'facebook.com:443'
      },
      url: '/about'
    }

    hostnamesHook(req, null, () => {
      expect(req.url).to.equal('/about')
      cb()
    })
  })

  it('is not match - missing host header', (cb) => {
    const req = {
      headers: {},
      url: '/about'
    }

    hostnamesHook(req, null, () => {
      expect(req.url).to.equal('/about')
      cb()
    })
  })

  it('is match - host header is case-insensitive', (cb) => {
    const req = {
      headers: {
        host: 'NodeJS.ORG:443'
      },
      url: '/about'
    }

    hostnamesHook(req, null, () => {
      expect(req.url).to.equal('/nodejs/about')
      cb()
    })
  })

  it('is not match - host named like an object property', () => {
    for (const host of ['constructor', '__proto__', 'toString']) {
      const req = {
        headers: { host },
        url: '/about'
      }

      hostnamesHook(req, null, () => {})
      expect(req.url).to.equal('/about')
    }
  })

  it('does not retain memory for each distinct matching host', () => {
    const v8 = require('v8')
    const vm = require('vm')
    v8.setFlagsFromString('--expose-gc')
    const gc = vm.runInNewContext('gc')

    const hook = require('./../lib/hostnames-hook')([
      {
        prefix: '/users',
        hostname: '*.company.tld'
      }
    ])
    const label = 'x'.repeat(1000)

    gc()
    const heapBefore = process.memoryUsage().heapUsed
    for (let i = 0; i < 20000; i++) {
      hook({ headers: { host: `${label}${i}.company.tld` }, url: '/' }, null, () => {})
    }
    gc()
    const retained = process.memoryUsage().heapUsed - heapBefore

    // keep the hook (and anything it holds) reachable until after the measurement
    hook({ headers: { host: 'api.company.tld' }, url: '/' }, null, () => {})
    expect(retained).to.be.below(5 * 1024 * 1024)
  })
})
