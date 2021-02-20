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

  //abstracted json get request caller method.
  function _getFromURL(url, callback) {
    return request.get(url, (err, response, body) => {
      if (err) {
        console.log("error getting data", err);
        return callback(err, body);
      }
      try {
        body = JSON.parse(body)
      }
      catch (e) {
        console.log("error parsing response body", e, body);
      }
      return callback(err, body);
    })
  }

  function _postToURL(url, body, callback) {
    return request({
      url: url, //URL to hit
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, function (err, response, body) {
      if (err) {
        console.log("error getting response data", err);
        return callback(err, body);
      }
      try {
        body = JSON.parse(body)
      }
      catch (e) {
        console.log("error parsing response body", e, body);
      }
      callback(err, body);
    });
  }

  return {
    get(path, callback) {
      const url = _constructUrl(path)
      return _getFromURL(url, callback)
    },
    post(path, body, callback) {
      const url = _constructUrl(path)
      return _postToURL(url, body, callback)
    }
  }
}

module.exports = BlockCypher;