//config variables for the module. (only network for now)
//"testnet" for testnet and anything else for mainnet

function BlockchainClient(opts) {
  if (!(this instanceof BlockchainClient)) return new BlockchainClient(opts);

  if (opts.inBrowser) {
    var request = require('browser-request');
  } else {
    var request = require('request');
  }

  if (!opts.chain) {
    throw '!chain'
  }

  if (!opts.key) {
    throw '!key'
  }

  function _getBaseUrl() {
    return `https://api.tatum.io/v3/${opts.chain}`
  }

  function _constructUrl(path) {
    return _getBaseUrl() + path
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
    get(path, callback, version) {
      const options = {
        method: "GET",
        uri: _constructUrl(path),
        headers: { 'x-api-key': opts.key }
      }
      request(options, (err, res) => {
        if (err) {
          return callback(err, res)
        }
        let body = res.body
        try {
          body = JSON.parse(body)
        } catch(e) {
          console.error('error parsing data', e, body)
        }
        return callback(err, body)
      })
    },
    post(path, body, callback) {
      const options = {
        method: "POST",
        uri: _constructUrl(path),
        body: JSON.stringify(body),
        headers: {
          'x-api-key': opts.key,
          'content-type': 'application/json',
        }
      }
      request(options, (err, res) => {
        if (err) {
          return callback(err, res)
        }
        let body = res.body
        try {
          body = JSON.parse(body)
        } catch(e) {
          console.error('error parsing data', e, body)
        }
        return callback(err, body)
      })
    },
  }
}

module.exports = BlockchainClient