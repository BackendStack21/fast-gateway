
const service = require('restana')({
  disableResponseEvent: true
})
service.get('/get', (req, res) => res.send('Hello World!'))

service.start(3000)
