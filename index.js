'use strict'

var http = require('http')
var httpProxy = require('http-proxy')

var proxy = httpProxy.createProxyServer()
proxy.on('error', (err) => {
  // There has to be error handler.
  console.log('Proxy error:', err)
})
var pool = [
  {
    host: 'v03x.ipfs.io',
    port: 80
  },
  {
    host: 'v04x.ipfs.io',
    port: 80
  }
]
var allowedCodes = {
  200: true,
  302: true,
  304: true
}
var ttls = {
  'ipfs': 60 * 60,
  'ipns': 1 * 60
}

var cache = new (require('node-cache'))({
  useClones: false
})

function resolve (req, res, mainSeg) {
  var done = false
  var running = 0
  console.log('Got request.')
  for (var i = 0; i < pool.length; i++) {
    running++
    console.log('Checking', req.url, 'to:', pool[i].host)
    var head = http.request({
      host: pool[i].host,
      port: pool[i].port,
      path: req.url,
      headers: {
        host: req.headers.host,
        connection: 'keep-alive'
      },
      method: 'HEAD'
    }, ((server, r) => {
      running--
      if (done) {
        return
      }
      if (allowedCodes[r.statusCode]) {
        done = true
        console.log('Sucess', req.url, 'at', server.host)
        proxy.web(req, res, { target: server })
        cache.set(mainSeg, server, ttls[mainSeg.match(/\/(ip.s)\//)[1]])
      } else {
        console.log('Failed', req.url, 'at', server.host, r.statusCode)
        // Recheck `done` because of raceconditon
        if (!done && running === 0) {
          done = true
          res.write('Could not find it anywhere')
          res.statusCode = 400
          res.end()
        }
      }
    }).bind(null, pool[i]))
    head.on('error', ((server, e) => {
      // There has to be error handler.
      console.log('Error on: ', server.host, e.message)
    }).bind(null, pool[i]))
    head.end()
  }
}

http.createServer(function (req, res) {
  var mainSeg = req.url.match(/\/(ip(n|f)s)\/..*?\//)
  if (mainSeg !== null) {
    mainSeg = mainSeg[0]
  } else if (req.headers.host !== null) {
    mainSeg = '/ipns/' + req.headers.host + '/'
  } else {
    res.write('Invalid request.')
    res.statusCode = 400
    res.end()
    return
  }

  var target = cache.get(mainSeg)
  if (target !== undefined) {
    console.log('Cache hit', mainSeg)
    proxy.web(req, res, { target: target })
  } else {
    resolve(req, res, mainSeg)
  }
}).listen(8082)
