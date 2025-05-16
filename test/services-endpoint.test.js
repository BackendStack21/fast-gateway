'use strict'

/* global describe, it, afterEach */
const expect = require('chai').expect
const request = require('supertest')
const fastGateway = require('../index')
const config = require('./config')

describe('enableServicesEndpoint option', () => {
  let gateway

  afterEach(async () => {
    if (gateway && gateway.close) await gateway.close()
    gateway = null
  })

  it('should enable services endpoint by default', async () => {
    const customConfig = await config()
    gateway = await fastGateway(customConfig).start(8090)
    await request(gateway)
      .get('/services.json')
      .expect(200)
      .then((response) => {
        expect(response.body).to.be.an('array')
        /* eslint-disable-next-line no-unused-expressions */
        expect(response.body.find((service) => service.prefix === '/users') !== null).to.be.ok
      })
  })

  it('should enable services endpoint when enableServicesEndpoint=true', async () => {
    const customConfig = await config()
    gateway = await fastGateway(Object.assign({}, customConfig, { enableServicesEndpoint: true })).start(8091)
    await request(gateway)
      .get('/services.json')
      .expect(200)
      .then((response) => {
        expect(response.body).to.be.an('array')
        /* eslint-disable-next-line no-unused-expressions */
        expect(response.body.find((service) => service.prefix === '/users') !== null).to.be.ok
      })
  })

  it('should disable services endpoint when enableServicesEndpoint=false', async () => {
    const customConfig = await config()
    gateway = await fastGateway(Object.assign({}, customConfig, { enableServicesEndpoint: false })).start(8092)
    await request(gateway)
      .get('/services.json')
      .expect(404)
  })
})
