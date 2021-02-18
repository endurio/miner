/* global BigInt */

import './App.css'
import './components/lds.css'
import React from 'react'
import Dropdown from 'react-dropdown'
import { useLocalStorage } from '@rehooks/local-storage'
import { ethers, utils } from 'ethers'
import ci from 'coininfo'
import { ECPair, payments, Psbt, address, script } from 'bitcoinjs-lib'
import blockcypher from './lib/blockcypher'
import bcinfo from './lib/bcinfo'
import { decShift } from './lib/big'

const { keccak256, computeAddress } = ethers.utils

function getParameterByName(name, url = window.location.href) {
  name = name.replace(/[[]]/g, '\\$&');
  var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
      results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

if (getParameterByName('clear') != null) {
  localStorage.clear()
  window.location.replace('/')
}

function getSender(privateKey, coinType) {
  const coinInfo = ci(coinType)
  const network = {
    messagePrefix: coinInfo.messagePrefix,
    bech32: coinInfo.bech32,
    bip32: coinInfo.versions.bip32,
    pubKeyHash: coinInfo.versions.public,
    scriptHash: coinInfo.versions.scripthash,
    wif: coinInfo.versions.private,
  }
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'))
  return payments.p2pkh({pubkey: keyPair.publicKey, network})
}

function usePersistentMap(key, defaultMap) {
  const serialize = map => JSON.stringify(Array.from(map.entries()))
  const deserialize = map => {
    if (typeof map === 'string') {
      map = JSON.parse(map)
    }
    return new Map(map)
  }
  const [_value, _setValue] = useLocalStorage(key, serialize(new Map(Object.entries(defaultMap||{}))))
  const [value, setValue] = React.useState(deserialize(_value))
  return [value, (k, v) => {
    setValue(prev => {
      const map = new Map(prev)
      if (typeof v === 'undefined') {
        map.delete(k)
      } else {
        map.set(k, v)
      }
      _setValue(serialize(map))
      return map
    })
  }]
}

function usePersistent(key, defaultValue) {
  const [_value, _setValue] = useLocalStorage(key, defaultValue)
  const [value, setValue] = React.useState(_value)
  return [value, v => {
    setValue(v)
    _setValue(v)
  }]
}

function App () {
  // cache for re-iterate
  const cacheBlock = {}
  const cacheTxHex = {}

  const [privateKey, setPrivateKey] = usePersistent('privateKey')
  const [apiKeys, setApiKey] = usePersistentMap('apiKeys')
  const coinTypes = ['BTC', 'BTC-TEST']
  const [coinType, setCoinType] = usePersistent('cointype', coinTypes[1])
  const networks = ['Ethereum', 'Rinkeby']
  const [network, setNetwork] = usePersistent('network', networks[1])
  const [miner, setMiner] = React.useState()
  const [sender, setSender] = React.useState()
  const [maxBounty, setMaxBounty] = usePersistent('maxBounty', 8)
  const [fee, setFee] = usePersistentMap('fee', {'BTC': 1306, 'BTC-TEST': 999})
  const [client, setClient] = React.useState()
  const [input, setInput] = React.useState()
  const [btx, setBtx] = React.useState()
  const [xmine, setXmine] = usePersistentMap('xmine', {'BTC': 1, 'BTC-TEST': 4})
  const [chainHead, setChainHead] = React.useState()
  const [senderBalance, setSenderBalance] = React.useState()
  const [utxos, setUTXOs] = React.useState()
  const [provider, setProvider] = React.useState()
  const [minerBalance, setMinerBalance] = React.useState()

  // ethereum provider
  React.useEffect(() => {
    if (!apiKeys.get('infura')) {
      return
    }
    const subnet = network == 'Ethereum' ? 'mainet' : 'rinkeby'
    const provider = new ethers.providers.JsonRpcProvider(`https://${subnet}.infura.io/v3/${apiKeys.get('infura')}`);
    setProvider(provider)
  }, [network, apiKeys])

  // bitcoin client
  React.useEffect(() => {
    const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
    const client = bcinfo({
      inBrowser: true,
      network,
    })
    setClient(client)
  }, [coinType, apiKeys])

  // account (a.k.a miner)
  React.useEffect(() => {
    if (!privateKey) {
      return
    }
    try {
      const account = computeAddress(Buffer.from(privateKey, 'hex'))
      setMiner(account)
    } catch(err) {
      console.error(err)
    }
  }, [privateKey])
  
  // sender
  React.useEffect(() => {
    if (!privateKey || !coinType) {
      return
    }
    try {
      setSender(getSender(privateKey, coinType))
    } catch(err) {
      console.error(err)
    }
  }, [privateKey, coinType])

  // miner balance
  React.useEffect(() => {
    if (miner && provider) {
      provider.getBalance(miner).then(setMinerBalance)
    }
  }, [provider, miner])

  function fetchData() {
    if (!client) {
      return
    }
    if (!!sender) {
      setSenderBalance(undefined)
      client.query(`/addressbalance/${sender.address}?confirmations=0`, (err, data) => {
        if (err) return console.error(err)
        setSenderBalance(Number(data))
      })
    }
    client.get('/latestblock', (err, data) => {
      if (err) {
        console.error(err)
        return setChainHead(undefined)
      }
      setChainHead(data)
    })
  }
  React.useEffect(fetchData, [sender, client]) // ensures refresh if referential identity of library doesn't change across chainIds

  function fetchUnspent(force) {
    if (!sender) {
      return
    }
    client.get(`/unspent?active=${sender.address}`, (err, data) => {
      if (err) {
        return console.error(err)
      }
      function shouldUpdate(data) {
        if (!data || !data.unspent_outputs) {
          return false
        }
        if (!utxos) {
          return true
        }
        const newLen = data.unspent_outputs.length
        if (newLen == utxos.length) {
          if (newLen == 0) {
            return false  // empty
          }
          if (data.unspent_outputs[newLen-1].tx_hash == utxos[utxos.length-1].tx_hash) {
            return false  // no change
          }
        }
        return true
      }
      if (shouldUpdate(data)) {
      setUTXOs(data.unspent_outputs)
      }
    }, force)
  }
  React.useEffect(() => {
    if (!!chainHead) {
      fetchUnspent()
    }
  }, [chainHead, sender, client])

  React.useEffect(() => {
    if (!client || !chainHead || !utxos) {
      return
    }

    searchForBountyInput(utxos).then(setInput)

    async function searchForBountyInput(utxos, maxBlocks = 6) {
      // utxos = [(utxos||[])[0]]  // only use the first UTXO for the blockcypher limit
      for (const utxo of utxos) {
        utxo.recipients = []
        let n = chainHead.hash
        for (let i = 0; i < maxBlocks; ++i) {
        // for (let n = chainHead.height; n > chainHead.height-maxBlocks; --n) {
          try {
            if (!cacheBlock[n]) {
              const block = await new Promise((resolve, reject) => {
                client.get(`/rawblock/${n}`, (err, data) => {
                  if (err) return reject(err)
                  resolve (data)
                })
              })
              block.tx.shift()  // remove the coinbase tx
              cacheBlock[n] = block
            }
            const block = cacheBlock[n]
            n = block.prev_block
            if (block.bits === 0x1d00ffff) {
              continue    // skip testnet minimum difficulty blocks
            }
            for (const tx of block.tx) {
              if (!isHit(utxo.tx_hash_big_endian, tx.hash)) {
                continue
              }
              try {
                // check for OP_RET in recipient tx
                const hasOpRet = tx.out.some(o => o.script.startsWith('6a'))   // OP_RET = 0x6a
                if (hasOpRet) {
                  continue
                }
                // TODO: check and skip existing address/script
                utxo.recipients.push(tx)
                if (utxo.recipients.length >= maxBounty) {
                  console.log(`found the first UTXO with enough ${maxBounty} bounty outputs`)
                  return utxo
                }
              } catch (err) {
                console.error(err)
              }
            }
          } catch(err) {
            console.error(err)
          }
        }
      }
      const utxoWithMostRecipient = utxos.reduce((prev, current) => (prev.recipients||[]).length > (current.recipients||[]).length ? prev : current, [])
      console.log('use the best UTXO found', utxoWithMostRecipient)
      return utxoWithMostRecipient

      function isHit(txid, recipient) {
        // use (recipient+txid).reverse() for LE(txid)+LE(recipient)
        const hash = keccak256(Buffer.from(recipient+txid, 'hex').reverse())
        return BigInt(hash) % 32n === 0n
      }
    }
  }, [utxos, maxBounty])

  React.useEffect(() => {
    if (!input || !input.recipients) {
      return
    }

    const txFee = parseInt(fee.get(coinType))
    if (isNaN(txFee)) {
      setBtx('invalid fee')
      return
    }

    // construct the inputs list with the bounty input at the first
    const recipients = input.recipients
    const inputs = [input]
    utxos.forEach(o => {
      if (o.txid !== input.txid || o.vout !== input.vout) {
        inputs.push(o)
      }
    })

    search(1, txFee).then(setBtx)

    // binary search
    async function search(start, end) {
      if (start > end) return
      const mid = Math.floor((start + end)/2)
      const psbt = await build(mid)
      if (isValid(psbt)) {
        return await search(start, mid-1) || psbt
      } else {
        return await search(mid+1, end)
      }

      function isValid(psbt) {
        if (!psbt || !psbt.data) {
          return false
        }
        const tx = psbt.data.globalMap.unsignedTx.tx
        const txSize = tx.toBuffer().length + 107 // at least 107 bytes signature
        const inputSize = 32 + 4 + 107 + 4
        // assume that the first output is OP_RET and the last is the coin change
        for (let i = 1; i < tx.outs.length-1; ++i) {
          const out = tx.outs[i]
          const outputSize = out.script.length + 9
          const minTxSize = 10 + inputSize + outputSize
          const minAmount = Math.floor(minTxSize * txFee / txSize)
          if (out.value < minAmount) {
            return false
          }
        }
        return true
      }
    }

    async function build(bountyAmount, outValue = 0) {
      const psbt = new Psbt({network: getNetwork(coinType)});

      // add the memo output
      let memo = 'endur.io'
      if (xmine.get(coinType) > 1) {
        memo += ' x' + xmine.get(coinType)
      }
      const dataScript = payments.embed({data: [Buffer.from(memo, 'utf8')]})
      psbt.addOutput({
        script: dataScript.output,
        value: 0,
      })

      let inValue = 0
      // build the mining outputs and required inputs
  
      await buildWithoutChange()

      const changeValue = inValue - outValue - txFee
      if (changeValue <= 0) {
        return 'insufficient fund'
      }
      psbt.addOutput({
        address: sender.address,
        value: changeValue,
      })

      return psbt

      async function buildWithoutChange() {
        let recIdx = 0
        for (const input of inputs) {
          const txHash = input.tx_hash_big_endian
          if (!cacheTxHex[txHash]) {
            cacheTxHex[txHash] = await new Promise((resolve, reject) => {
              client.get(`/rawtx/${txHash}?format=hex`, (err, data) => {
                if (err) return reject(err)
                resolve (data)
              })
            })
          }
          const txHex = cacheTxHex[txHash]

          psbt.addInput({
            hash: txHash,
            index: input.tx_output_n,
            // non-segwit inputs now require passing the whole previous tx as Buffer
            nonWitnessUtxo: Buffer.from(txHex, 'hex'),
          })
          // psbt.signInput(psbt.txInputs.length-1, ECPairs[sender])
          inValue += parseInt(input.value)

          while (recIdx < recipients.length) {
            // const rec = recipients[recIdx % (recipients.length>>1)]     // duplicate recipient
            const rec = recipients[recIdx]
            const output = rec.out[rec.out.length-1]
            const amount = bountyAmount
            if (outValue + amount > inValue) {
              break;  // need more input
            }
            outValue += amount
            psbt.addOutput({
              script: Buffer.from(output.script, 'hex'),
              value: amount,
            })
            if (++recIdx >= recipients.length) {
              // recipients list exhausted
              return
            }
          }
        }
        // utxo list exhausted
      }
    }
  }, [input, fee, xmine])

  function promptForKey(key) {
    const value = window.prompt(`API key for ${key}:`, apiKeys.get(key))
    if (value != null) {
      setApiKey(key, value)
    }
  }

  function promptForPrivateKey(exists) {
    const defaultValue = '***'
    const value = window.prompt(`Input your private key in hex here. (Your private key never leaves your browser)`, exists ? defaultValue : '')
    if (value != null && value != defaultValue) {
      setPrivateKey(value)
    }
  }

  function sendTx() {
    if (!btx.data.inputs[0].finalScriptSig) {
      const signer = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {network: getNetwork(coinType)})
      btx.signAllInputs(signer)
      btx.finalizeAllInputs()
      setBtx(btx)
    }

    const tx = btx.extractTransaction()
    console.log('sending signed tx', tx)
    const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
    const wallet = blockcypher({
      inBrowser: true,
      key: apiKeys.get('BlockCypher'),
      network,
    })
    wallet.post('/txs/push', {tx: tx.toHex()}, (unknown, res) => {
      console.error(unknown, res)
      if (res.error) {
        console.error(res.error)
      } else {
        console.log('tx successfully sent', res.tx)
        const coinPath = coinType === 'BTC' ? 'btc' : 'btc-testnet'
        const url = `https://live.blockcypher.com/${coinPath}/tx/${res.tx.hash}/`
        window.open(url, '_blank')
      }
      fetchUnspent(true)
    })
  }

  function getNetwork (coinType) {
    const coinInfo = ci(coinType);
    return {
        messagePrefix: coinInfo.messagePrefix ? coinInfo.messagePrefix : '',
        bech32: coinInfo.bech32,
        bip32: coinInfo.versions.bip32,
        pubKeyHash: coinInfo.versions.public,
        scriptHash: coinInfo.versions.scripthash,
        wif: coinInfo.versions.private,
    };
  }

  // statuses
  const isLoading = !chainHead || isNaN(senderBalance)

  if (typeof btx === 'string') {
    var btxError = btx
  } else if (btx) {
    var btxDisplay = decodeTx(btx.data.globalMap.unsignedTx.tx)
  }

  function decodeTx(tx) {
    let btxDisplay = ''
    for (const {script: s, value: v} of tx.outs) {
      const asm = script.toASM(s)
      if (asm.startsWith('OP_RETURN ')) {
        btxDisplay += 'OP_RETURN ' + utils.toUtf8String(Buffer.from(asm.substring(10), 'hex'))
        btxDisplay += (v ? ` with ${decShift(v, -8)}\n` : '\n')
      } else {
        const adr = address.fromOutputScript(s, getNetwork(coinType))
        if (adr !== sender.address) {
          btxDisplay += `${decShift(v, -8)} → ${adr}\n`
        } else {
          btxDisplay += `${adr} ← ${decShift(v, -8)}`
        }
      }
    }
    return btxDisplay
  }

  return (
    <div className="App">
      <div className="spacing flex-container">
        <div className="flex-container">
          <span>&nbsp;{privateKey ? '✅' : '❌'}<button onClick={() => promptForPrivateKey(!!privateKey)}>Private Key</button></span>
        </div>
        <div className="flex-container">
          <span>API Keys:</span>
          <span>&nbsp;{apiKeys.get('infura') ? '✅' : '❌'}<button onClick={() => promptForKey('infura')}>Infura</button></span>
          <span>&nbsp;{apiKeys.get('BlockCypher') ? '✅' : '❌'}<button onClick={() => promptForKey('BlockCypher')}>BlockCypher</button></span>
          {/* <span>&nbsp;{apiKeys.CryptoAPIs ? '✅' : '❌'}<button onClick={() => promptForKey('CryptoAPIs')}>CryptoAPIs</button></span> */}
        </div>
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">
          Network:&nbsp;<Dropdown options={networks} onChange={item=>setNetwork(item.value)} value={network} placeholder="Network" />
        </div>
        {!!miner && <span className="ellipsis">Miner: {miner}</span>}
        {minerBalance && <span>Balance: {decShift(minerBalance, -18)}</span>}
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">
          Coin:&nbsp;<Dropdown options={coinTypes} onChange={item=>setCoinType(item.value)} value={coinType} placeholder="Mining coin" />
        </div>
        {!!sender && <span className="ellipsis">Sender: {sender.address}</span>}
        <div>
          {isLoading ? <div className="lds-dual-ring"></div> : <button onClick={fetchData}>Fetch</button>}
        </div>
        {!isLoading && <span>Balance: {decShift(senderBalance, -8)}</span>}
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">X-Mine:&nbsp;
          <input maxLength={3} style={{width: 30}}
            value={xmine.get(coinType)} onChange={event=>{
              const value = parseInt(event.target.value)
              if (isNaN(value) || value <= 0) {
                setXmine(coinType, 1)
              } else {
                setXmine(coinType, event.target.value)
              }
            }}
          />
        </div>
        <div className="flex-container">Max Bounty:&nbsp;
          <input maxLength={1} style={{width: 10}}
            value={maxBounty} onChange={event=>{
              const value = parseInt(event.target.value)
              if (value >= 0 && value <= 8) {
                setMaxBounty(event.target.value)
              }
            }}
          />
        </div>
        <div className="flex-container">Fee:&nbsp;
          <input style={{width: 60}}
            value={fee.get(coinType)} onChange={event=>{
              const value = parseInt(event.target.value)
              if (value > 0) {
                setFee(coinType, value)
              }
            }}
          />
        </div>
        {(!!apiKeys.get('BlockCypher') && !!btxDisplay) && <div className="flex-container">
          <span><button onClick={() => sendTx()}>Send</button></span>
        </div>}
      </div>
      {btxError && <div className='spacing flex-container'><span className="error">{btxError}</span></div>}
      {btxDisplay && <div className='spacing flex-container'><pre>{btxDisplay}</pre></div>}
    </div>
  )
}

export default App