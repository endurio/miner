//config variables for the module. (only network for now)
//"testnet" for testnet and anything else for mainnet

function BlockCypher(opts) {
  if (!(this instanceof BlockCypher)) return new BlockCypher(opts);

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

  //returns the correct url endpoint based on network that is being used
  function _getBaseURL(network) {
    var baseURL;
    if (network === "testnet") {
      baseURL = "https://api.blockcypher.com/v1/btc/test3";
    }
    else if (network === "blockcypher-testnet") {
      baseURL = "https://api.blockcypher.com/v1/bcy/test";
    }
    else {
      baseURL = "https://api.blockcypher.com/v1/btc/main";
    }
    return baseURL;
  }

  function _constructUrl(path) {
    if (opts.key) {
      if (path.indexOf('?') >= 0) {
        path += '&token=' + opts.key
      } else {
        path += '?token=' + opts.key
      }
    }
    const baseUrl = _getBaseURL(opts.network);
    return baseUrl + path
  }

  const STORAGE_KEY = 'blockcypher-cache'

  function _getChainInfo(callback) {
    let chainInfo = localStorage.getItem(STORAGE_KEY)
    if (chainInfo) {
      chainInfo = JSON.parse(chainInfo)
    }
    if (chainInfo) {
      const blockTimestamp = new Date(chainInfo.time)
      const duration = new Date() - blockTimestamp
      const seconds = Math.floor(duration / 1000)
      if (seconds < 120) {
        return callback(undefined, chainInfo)
      }
    }
    const url = _constructUrl('')
    request.get(url, (err, response, body) => {
      if (err) {
        callback(err, undefined);
      }
      else {
        try {
          const res = JSON.parse(body)
          localStorage.setItem(STORAGE_KEY, body)
          callback(false, res);
        }
        catch (err) {
          callback(err, undefined);
        }
      }
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

  //abstracted json get request caller method.
  function _getFromURL(url, callback) {
    _getChainInfo((err, chainInfo) => {
      if (!chainInfo) {
        throw '!chainInfo'
      }
      const ITEM_STORAGE_KEY = `${STORAGE_KEY}-${_hashCode(url)}`
      const ITEM_HASH_STORAGE_KEY = `${ITEM_STORAGE_KEY}-hash`
      const body = localStorage.getItem(ITEM_STORAGE_KEY)
      if (body) {
        const itemHash = localStorage.getItem(ITEM_HASH_STORAGE_KEY)
        if (itemHash && itemHash == chainInfo.hash) {
          const res = JSON.parse(body)
          console.log("cache.return", url)
          return callback(false, res);
        }
      }
      request.get(url, (err, response, body) => {
        if (err) {
          console.log("error fetching info from blockcypher " + err);
          return callback(err, null);
        }
        try {
          const res = JSON.parse(body)
          console.log("cache.set", url)
          localStorage.setItem(ITEM_STORAGE_KEY, body)
          localStorage.setItem(ITEM_HASH_STORAGE_KEY, chainInfo.hash)
          return callback(false, res);
        }
        catch (err) {
          console.log("error parsing data recieved from blockcypher");
          return callback(err, null);
        }
      });
    })
  }

  function _postToURL(url, body, callback) {
    request({
      url: url, //URL to hit
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, function (err, response, body) {
      if (err) {
        callback(err, null);
      } else {
        try {
          callback(false, JSON.parse(body));
        }
        catch (err) {
          callback(err, null);
        }
      }
    });
  }

  return {
    getChainInfo: _getChainInfo,
    get(path, callback) {
      const url = _constructUrl(path)
      _getFromURL(url, callback)
    },
    post(path, body, callback) {
      const url = _constructUrl(path)
      _postToURL(url, body, callback)
    }
  }
}

module.exports = BlockCypher;