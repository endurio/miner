/* global BigInt */

import './App.css'
import './components/lds.css'
import React from 'react'
import Dropdown from 'react-dropdown'
import { Web3ReactProvider, useWeb3React } from '@web3-react/core'
import { Web3Provider } from '@ethersproject/providers'
import { Header } from './components/Header'
import { useLocalStorage } from '@rehooks/local-storage'
import { ethers, utils } from 'ethers'
import ci from 'coininfo'
import { ECPair, payments, Psbt, address, script } from 'bitcoinjs-lib'
import blockcypher from './lib/blockcypher'
import { decShift } from './lib/big'

const { keccak256 } = ethers.utils

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

function getLibrary(provider) {
  const library = new Web3Provider(provider)
  library.pollingInterval = 12000
  return library
}

function getSender(pubkey, coinType) {
  const coinInfo = ci(coinType)
  const network = {
    messagePrefix: coinInfo.messagePrefix,
    bech32: coinInfo.bech32,
    bip32: coinInfo.versions.bip32,
    pubKeyHash: coinInfo.versions.public,
    scriptHash: coinInfo.versions.scripthash,
    wif: coinInfo.versions.private,
  }
  const keyPair = ECPair.fromPublicKey(Buffer.from(pubkey.substring(2), 'hex'))
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
  const { account, library } = useWeb3React()
  const [apiKeys, setApiKey] = usePersistentMap('apiKeys')
  const [pubkeys, setPubkey] = usePersistentMap('pubkeys')
  const options = ['BTC', 'BTC-TEST']
  const defaultOption = options[1]
  const [coinType, setCoinType] = usePersistent('cointype', defaultOption)
  const [network, setNetwork] = React.useState(getNetwork(coinType))
  const [sender, setSender] = React.useState()
  const [maxBounty, setMaxBounty] = usePersistent('maxBounty', 8)
  const [fee, setFee] = usePersistentMap('fee', {'BTC': 1306, 'BTC-TEST': 999})
  const [client, setClient] = React.useState()
  const [accData, setAccData] = React.useState()
  const [chainData, setChainData] = React.useState()
  const [input, setInput] = React.useState()
  const [btx, setBtx] = React.useState()
  const [xmine, setXmine] = usePersistentMap('xmine', {'BTC': 1, 'BTC-TEST': 4})

  React.useEffect(() => setNetwork(getNetwork(coinType)), [coinType])

  React.useEffect(() => {
    const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
    const client = blockcypher({
      inBrowser: true,
      key: apiKeys.get('BlockCypher'),
      network,
    })
    setClient(client)
  }, [coinType, apiKeys])

  // public key
  React.useEffect(() => {
    if (!!account && !!library) {
      if (pubkeys.get(account)) {
        return () => {}
      }
      let stale = false

      const message = 'Please sign this message to provide the public key of your miner account.'
      const messageHash = ethers.utils.hashMessage(message)

      library
        .getSigner(account)
        .signMessage(message)
        .then(signature => {
          if (!stale) {
            const pk = ethers.utils.recoverPublicKey(messageHash, signature)
            const address = ethers.utils.computeAddress(pk)
            setPubkey(address, pk)
          }
        })
        .catch(error => {
          window.alert('Failure!' + (error && error.message ? `\n\n${error.message}` : ''))
        })

      return () => {
        stale = true
      }
    }
  }, [account, library]) // ensures refresh if referential identity of library doesn't change across chainIds

  // sender
  React.useEffect(() => {
    if (!account || !pubkeys) {
      return
    }
    const pubkey = pubkeys.get(account)
    if (pubkey && coinType) {
      try {
        setSender(getSender(pubkey, coinType))
      } catch(err) {
        console.error(err)
        setPubkey(account) // set it's to undefineds
      }
    }
  }, [account, pubkeys, coinType])

  function fetchData() {
    if (!apiKeys || !client) {
      return
    }
    if (!!sender) {
      setAccData(undefined)
      client.get(`/addrs/${sender.address}?unspentOnly=true`, (err, data) => {
        if (err) return console.error(err)
        setAccData(data)
      })
    }
    setChainData(undefined)
    client.get('', (err, data) => {
      if (err) return console.error(err)
      setChainData(data)
    })
  }
  React.useEffect(fetchData, [sender, client, maxBounty]) // ensures refresh if referential identity of library doesn't change across chainIds

  React.useEffect(() => {
    if (!client || !chainData || !accData || !accData.txrefs) {
      return
    }

    // cache for re-iterate
    const blocks = {}

    searchForBountyInput(accData.txrefs).then(setInput)

    async function searchForBountyInput(utxos, maxBlocks = 6) {
      for (const utxo of utxos) {
        utxo.recipients = []
        for (let n = chainData.height; n > chainData.height-maxBlocks; --n) {
          try {
            if (!blocks[n]) {
              const block = await new Promise((resolve, reject) => {
                // blockcypher limits 500 tx per block results, we only use the first 500 txs of the block for simplicity
                // ?txstart=0&limit=500
                client.get(`/blocks/${n}`, (err, data) => {
                  if (err) return reject(err)
                  resolve (data)
                })
              })
              blocks[n] = block
            }
            const block = blocks[n]
            if (block.bits === 0x1d00ffff) {
              continue    // skip testnet minimum difficulty blocks
            }
            for (const recipient of block.txids) {
              if (!isHit(utxo.tx_hash, recipient)) {
                continue
              }
              try {
                const tx = await new Promise((resolve, reject) => {
                  client.get(`/txs/${recipient}`, (err, data) => {
                    if (err) return reject(err)
                    resolve (data)
                  })
                })
                if (tx.block_index === 0) {
                  continue    // skip the coinbase tx
                }
                // check for OP_RET in recipient tx
                const hasOpRet = tx.outputs.some(o => o.script.startsWith('6a'))   // OP_RET = 0x6a
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
      const utxoWithMostRecipient = utxos.reduce((prev, current) => (prev.recipients||[]).length > (current.recipients||[]).length ? prev : current)
      console.log('use the best UTXO found', utxoWithMostRecipient)
      return utxoWithMostRecipient

      function isHit(txid, recipient) {
        // use (recipient+txid).reverse() for LE(txid)+LE(recipient)
        const hash = keccak256(Buffer.from(recipient+txid, 'hex').reverse())
        return BigInt(hash) % 32n === 0n
      }
    }
  }, [client, accData, chainData, maxBounty])

  React.useEffect(() => {
    if (!input || !accData || !input.recipients) {
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
    accData.txrefs.forEach(o => {
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
      const psbt = new Psbt({network});

      console.log('add the memo output')
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
      console.log('build the mining outputs and required inputs')
  
      await buildWithoutChange()

      console.log('size before adding change output', psbt.toBuffer().length)
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
          const tx = await new Promise((resolve, reject) => {
            client.get(`/txs/${input.tx_hash}?includeHex=true`, (err, data) => {
              if (err) return reject(err)
              resolve (data)
            })
          })

          psbt.addInput({
            hash: input.tx_hash,
            index: input.tx_output_n,
            // non-segwit inputs now require passing the whole previous tx as Buffer
            nonWitnessUtxo: Buffer.from(tx.hex, 'hex'),
          })
          // psbt.signInput(psbt.txInputs.length-1, ECPairs[sender])
          inValue += parseInt(input.value)

          while (recIdx < recipients.length) {
            // const rec = recipients[recIdx % (recipients.length>>1)]     // duplicate recipient
            const rec = recipients[recIdx]
            const output = rec.outputs[rec.outputs.length-1]
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
              console.log('recipients list exhausted')
              return
            }
          }
        }
        console.log('utxo list exhausted')
      }
    }
  }, [sender, accData, input, fee, coinType, network, client, xmine])

  function promptForKey(key) {
    const value = window.prompt(`API key for ${key}:`, apiKeys[key])
    if (value != null) {
      setApiKey(key, value)
    }
  }

  function signAndSend() {
    if (!!btx.data.inputs[0].finalScriptSig) {
      return doSend()
    }

    console.error('size after adding change output', btx.toBuffer().length)
    const publicKey = Buffer.from(pubkeys.get(account).substring(2), 'hex')
    const signer = ECPair.fromPublicKey(publicKey, {compressed: true})
    signer.sign = hash => {
      return new Promise((resolve, reject) => {
        return library
          .getSigner(account)
          .signMessage(hash)
          .then(signature => resolve(Buffer.from(signature.substr(2, 128), 'hex')))
          .catch(reject)
      })
    }
    return btx.signAllInputsAsync(signer).then(() => {
      console.error('size after finalize all inputs', btx.toBuffer().length)
      btx.finalizeAllInputs()
      setBtx(btx)
      return doSend()
    })

    function doSend() {
      const tx = btx.extractTransaction()
      console.error(tx)
    }
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
  const isLoading = !accData
  const hasError = accData && accData.err
  const hasSummary = accData && !accData.err

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
        const adr = address.fromOutputScript(s, network)
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
      <Header />
      <div className="spacing flex-container">
        <div className="flex-container">
          <span>API Keys:</span>
          <span>&nbsp;{apiKeys.get('BlockCypher') ? '✅' : '❌'}<button onClick={() => promptForKey('BlockCypher')}>BlockCypher</button></span>
          {/* <span>&nbsp;{apiKeys.CryptoAPIs ? '✅' : '❌'}<button onClick={() => promptForKey('CryptoAPIs')}>CryptoAPIs</button></span> */}
        </div>
      </div>
      <div className="spacing flex-container">
        {!!pubkeys.get(account) && <span className="ellipsis">PublicKey: {pubkeys.get(account)}</span>}
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">
          Network:&nbsp;<Dropdown options={options} onChange={item=>setCoinType(item.value)} value={coinType} placeholder="Mining coin" />
        </div>
        {!!sender && <span className="ellipsis">Sender: {sender.address}</span>}
        <div>
          {isLoading ? <div className="lds-dual-ring"></div> : <button onClick={fetchData}>Fetch</button>}
        </div>
        {hasError && <span className="error">{accData.err.toString()}</span>}
        {hasSummary && <span>Sender Balance: {decShift(accData.balance, -8)}</span>}
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
        {btxDisplay && <div className="flex-container">
          <span><button onClick={() => signAndSend()}>Sign & Send</button></span>
        </div>}
      </div>
      {btxError && <div className='spacing flex-container'><span className="error">{btxError}</span></div>}
      {btxDisplay && <div className='spacing flex-container'><pre>{btxDisplay}</pre></div>}
    </div>
  )
}

export default function InjectedApp() {
  return (
    <Web3ReactProvider getLibrary={getLibrary}>
      <App />
    </Web3ReactProvider>
  )
}
