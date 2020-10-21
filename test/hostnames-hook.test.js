'use strict'

/* global describe, it */
const expect = require('chai').expect

describe('hostnames-hook', () => {
  let hostnamesHook = null

  it('initialize', async () => {
    hostnamesHook = require('./../lib/hostnames-hook')([{
      prefix: '/nodejs',
      hostname: 'nodejs.org'
    }, {
      prefix: '/github',
      hostname: 'github.com'
    }, {
      prefix: '/users',
      hostname: '*.company.tld'
    }])
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
})
