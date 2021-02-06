//config variables for the module. (only network for now)
//"testnet" for testnet and anything else for mainnet

function BlockCypher(opts) {
    if (!(this instanceof BlockCypher)) return new BlockCypher(opts);
  
    if(!opts.network){
      console.log("please specify a blockchain. (defaults to mainnet)");
    }
  
    if(!opts.key){
      console.log("no key specified, your requests will be limited by blockcypher");
    }

    const utility = require('./lib/utility.js')(opts.inBrowser);

    function constructUrl(path) {
      if (opts.key) {
        if (path.indexOf('?') >= 0) {
          path += '&token=' + opts.key
        } else {
          path += '?token=' + opts.key
        }
      }
      const baseUrl = utility.getBaseURL(opts.network);
      return baseUrl + path
    }

    return {
      get(path, callback) {
        const url = constructUrl(path)
        utility.getFromURL(url, callback)
      },
      post(path, body, callback) {
        const url = constructUrl(path)
        utility.postToURL(url, body, callback)
      }
    }
  }
  
  module.exports = BlockCypher;