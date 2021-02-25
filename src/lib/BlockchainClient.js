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

  if (!!opts.BlockCypherKey) {
    const blockcypher = require('./blockcypher')
    var bc = blockcypher({
      inBrowser: opts.inBrowser,
      key: opts.BlockCypherKey,
      network: opts.network,
    })
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
    getInfo() {
      return new Promise((resolve, reject) => {
        this.get('/info', (err, data) => {
          if (err) return reject(err)
          return resolve(data)
        })
      })
    },
    getBlock(numberOrHash) {
      if (!this.cacheBlock) {
        this.cacheBlock = {}
      }
      return new Promise((resolve, reject) => {
        const block = this.cacheBlock[numberOrHash]
        if (!!block) {
          return resolve(block)
        }
        this.get(`/block/${numberOrHash}`, (err, block) => {
          if (err) return reject(err) // TODO: fallback to blockcypher here
          if (block.errorCode) return reject({...block, block: numberOrHash})
          this.cacheBlock[block.hash] = this.cacheBlock[block.height] = this.cacheBlock[numberOrHash] = block
          return resolve(block)
        })
      })
    },
    getTx(hash) {
      if (!this.cacheTx) {
        this.cacheTx = {}
      }
      return new Promise((resolve, reject) => {
        const tx = this.cacheTx[hash]
        if (!!tx) {
          return resolve(tx)
        }
        this.get(`/transaction/${hash}`, (err, tx) => {
          if (err) return reject(err) // TODO: fallback to blockcypher here
          this.cacheTx[tx.hash] = tx
          return resolve(tx)
        })
      })
    },
    getBalance(address) {
      return new Promise((resolve, reject) => {
        this.get(`/address/balance/${address}`, (err, data) => {
          if (err) return reject(err)
          const balance = data.incoming - data.outgoing
          return resolve(balance)
        })
      })
    },
    getUnspents(address) {
      return new Promise((resolve, reject) => {
        if (!!bc) {
          bc.get(`/addrs/${address}?unspentOnly=true`, (err, data) => {
            if (err) return reject(err)
            const unspents = data.txrefs || []
            unspents.balance = data.final_balance
            return resolve(unspents)
          })
        }
        this.get(`/transaction/address/${address}?pageSize=50`, (err, txs) => {
          if (err) return reject(err)
          const unspents = extractUnspents(txs)
          return resolve(unspents)
          function extractUnspents(txs) {
            const unspents = []
            for (const tx of txs) {
              const u = tx.outputs.reduce((u, o, index) => {
                if (o.address === address) {
                  const spent = txs.some(t => t.inputs.some(({prevout}) => prevout.hash === tx.hash && prevout.index === index))
                  if (!spent) {
                    u.push({...o, tx_hash: tx.hash, index})
                  }
                }
                return u
              }, [])
              unspents.push(...u)
            }
            return unspents
          }
        })
      })
    },
    getTxs(address, pageSize=50, offset=0) {
      return new Promise((resolve, reject) => {
        this.get(`/transaction/address/${address}?pageSize=${pageSize}&offset=${offset}`, (err, txs) => {
          if (err) return reject(err)
          return resolve(txs)
        })
      })
    },
    sendTx(txHex) {
      return new Promise((resolve, reject) => {
        if (!!bc) {
          bc.post('/txs/push', {tx: txHex}, (unknown, {error, tx}) => {
            if (error) return reject(error)
            return resolve(tx)
          })
        } else {
          this.post('/broadcast', { txData: txHex }, (err, res) => {
            if (err) return reject(err)
            return resolve(res)
          })
        }
      })
    },
  }
}

module.exports = BlockchainClient