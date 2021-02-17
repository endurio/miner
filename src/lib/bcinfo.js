//config variables for the module. (only network for now)
//"testnet" for testnet and anything else for mainnet

function BcInfo(opts) {
  if (!(this instanceof BcInfo)) return new BcInfo(opts);

  if (opts.inBrowser) {
    var request = require('browser-request');
  } else {
    var request = require('request');
  }

  if (!opts.network) {
    console.log("please specify a blockchain. (defaults to mainnet)");
  }

  if (!opts.key) {
    console.log("no key specified, your requests will be limited by blockcypher");
  }

  function _getBaseUrl() {
    if (opts.network === 'testnet') {
      return 'https://testnet.blockchain.info'
    }
    return 'https://blockchain.info'
  }

  function _constructUrl(path) {
    let url = _getBaseUrl() + path
    if (url.indexOf('?') < 0) {
      url += '?cors=true'
    } else {
      url += '&cors=true'
    }
    return url
  }

  function _getFromURL(url, callback) {
    request.get(url, (err, response, body) => {
      if (err) {
        return callback(err, undefined)
      }
      return callback(undefined, body)
    })
  }

  function _hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash >>> 0;  // convert int32 to uint32
  }

  return {
    queryLatestHash(callback) {
      return this.query('/latesthash', (err, data) => {
        if (!err) {
          this.latestHash = data
        }
        return callback(err, data)
      })
    },
    query(path, callback) {
      if (!path.startsWith('/q/')) {
        path = '/q' + path
      }
      const url = _constructUrl(path)
      _getFromURL(url, callback)
    },
    get(path, callback, force) {
      if (!this.latestHash) {
        return this.queryLatestHash((err, latestHash) => doFetch(latestHash))
      }
      return doFetch(this.latestHash)
      
      function doFetch(latestHash) {
        if (!latestHash) {
          console.error('chain head unavailable')
          return callback('chain head unavailable', undefined)
        }
        const url = _constructUrl(path)

        const STORAGE_KEY = 'bcinfo-cache'
        const ITEM_STORAGE_KEY = `${STORAGE_KEY}-${_hashCode(url)}`
        const ITEM_HASH_STORAGE_KEY = `${ITEM_STORAGE_KEY}-hashstamp`

        if (!force) {
          const body = localStorage.getItem(ITEM_STORAGE_KEY)
          if (body) {
            const hashstamp = localStorage.getItem(ITEM_HASH_STORAGE_KEY)
            if (hashstamp && hashstamp == latestHash) {
              let res = body
              try {
                res = JSON.parse(body)
                console.log("cache.return", url)
              } catch(err) {
                console.log("error parsing data from cache");
              }
              return callback(undefined, res);
            }
          }
        }
        return _getFromURL(url, (err, body) => {
          if (err) {
            console.error("error getting from blockchain.info", err);
            return callback(err, body)
          }
          console.log("cache.set", url)
          localStorage.setItem(ITEM_HASH_STORAGE_KEY, latestHash)
          localStorage.setItem(ITEM_STORAGE_KEY, body)

          let res = body
          try {
            res = JSON.parse(body)
          } catch (err) {
            console.log("error parsing data from blockchain.info");
          }
          return callback(undefined, res)
        })
      }
    },
  }
}

module.exports = BcInfo;