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

// Returns the connection
function check (target, req, cb) {
  console.log('Checking', req.url, 'to:', target.host)
  var request = http.request({
    host: target.host,
    port: target.port,
    path: req.url,
    headers: {
      host: req.headers.host,
      connection: 'keep-alive'
    },
    method: 'HEAD'
  }, (res) => {
    cb(null, res, request, target)
  })
  request.on('error', cb)
  request.end()
  return request
}

function resolve (req, res, mainSeg) {
  var done = false
  var running = []
  console.log('Got request.')
  for (var i = 0; i < pool.length; i++) {
    var headReq = check(pool[i], req, (err, r, request, target) => {
      var index = running.indexOf(request)
      if (index > -1) {
        running.splice(index, 1)
      }
      if (done) {
        return
      }
      if (err) {
        console.log('Error in', target, err)
        return
      }
      if (allowedCodes[r.statusCode]) {
        done = true
        console.log('Sucess', req.url, 'at', target.host)
        proxy.web(req, res, { target: target })
        cache.set(mainSeg, target, ttls[mainSeg.match(/\/(ip.s)\//)[1]])
        if (running.length > 0) {
          console.log('Closing', running.length, 'still open requests.')
        }
        for (var j = 0; j < running.length; j++) {
          running[j].abort()
        };
      } else {
        console.log('Failed', req.url, 'at', target.host, r.statusCode)
        // Recheck `done` because of race conditon
        if (!done && running.length === 0) {
          done = true
          res.write('Could not find it anywhere')
          res.statusCode = 400
          res.end()
        }
      }
    })
    running.push(headReq)
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
