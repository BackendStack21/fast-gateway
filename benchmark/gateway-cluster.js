'use strict'

const cluster = require('cluster')
const os = require('os')

if (cluster.isMaster) {
  const cpuCount = os.cpus().length
  for (let i = 0; i < cpuCount; i++) {
    cluster.fork()
  }
} else {
  const gateway = require('../index')

  const server = gateway({
    routes: [{
      prefix: '/service',
      target: 'http://127.0.0.1:3000'
    }]
  })

  server.start(8080)
}

cluster.on('exit', (worker) => {
  cluster.fork()
})
