/* global BigInt */

import './App.css'
import './components/lds.css'
import React from 'react'
import Dropdown from 'react-dropdown'
import { Web3ReactProvider, useWeb3React } from '@web3-react/core'
import { Web3Provider } from '@ethersproject/providers'
import { Header } from './components/Header'
import { useLocalStorage } from '@rehooks/local-storage'
import { ethers } from 'ethers'
import ci from 'coininfo'
import { ECPair, payments } from 'bitcoinjs-lib'
import blockcypher from './lib/blockcypher'
import { decShift } from './lib/big'

const { keccak256 } = ethers.utils

function getParameterByName(name, url = window.location.href) {
  name = name.replace(/[\[\]]/g, '\\$&');
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

function usePersistent(key, defaulValue) {
  function save(o) {
    return typeof o === 'object' ? JSON.stringify(o) : o
  }
  function load(o) {
    try {
      return JSON.parse(o)
    } catch(err) {
    }
    return o
  }
  const [_value, _setValue] = useLocalStorage(key, save(defaulValue))
  const [value, setValue] = React.useState(load(_value))
  return [value, v => {
    setValue(v)
    _setValue(save(v))
  }]
}

function App () {
  const { account, library } = useWeb3React()
  const [apiKeys, setApiKeys] = usePersistent('apiKeys', {})
  const [pubkeys, setPubkeys] = usePersistent('pubkeys', {})
  const options = ['BTC', 'BTC-TEST']
  const defaultOption = options[1]
  const [coinType, setCoinType] = usePersistent('cointype', defaultOption)
  const [sender, setSender] = React.useState()
  const [maxBounty, setMaxBounty] = usePersistent('maxBounty', 8)
  const [fee, setFee] = usePersistent('fee', {'BTC': 1306, 'BTC-TEST': 999})
  const [client, setClient] = React.useState()
  const [accData, setAccData] = React.useState()
  const [chainData, setChainData] = React.useState()
  const [input, setInput] = React.useState()

  React.useEffect(() => {
    const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
    const client = blockcypher({
      inBrowser: true,
      key: apiKeys.BlockCypher,
      network,
    })
    setClient(client)
  }, [coinType, apiKeys])

  // public key
  React.useEffect(() => {
    if (!!account && !!library) {
      if (pubkeys[account]) {
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
            pubkeys[address] = pk
            setPubkeys(pubkeys)
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
    const pubkey = pubkeys[account]
    if (pubkey && coinType) {
      try {
        setSender(getSender(pubkey, coinType))
      } catch(err) {
        console.error(err)
        delete pubkeys[account]
        setPubkeys(pubkeys)
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
  React.useEffect(fetchData, [sender, client]) // ensures refresh if referential identity of library doesn't change across chainIds

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
            if (block.bits == 0x1d00ffff) {
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
                if (tx.block_index == 0) {
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
      console.log(`use the best UTXO found`)
      const utxoWithMostRecipient = utxos.reduce((prev, current) => prev.recipients.length > current.recipients.length ? prev : current)
      return utxoWithMostRecipient

      function isHit(txid, recipient) {
        // use (recipient+txid).reverse() for LE(txid)+LE(recipient)
        const hash = keccak256(Buffer.from(recipient+txid, 'hex').reverse())
        return BigInt(hash) % 32n == 0
      }
    }
  }, [client, accData, chainData])

  React.useEffect(() => {
    console.error(input)
  }, [input])

  function promptForKey(key) {
    const value = window.prompt(`API key for ${key}:`, apiKeys[key])
    if (value != null) {
      apiKeys[key] = value
      setApiKeys(apiKeys)
    }
  }

  // statuses
  const isLoading = !accData
  const hasError = accData && accData.err
  const hasSummary = accData && !accData.err

  return (
    <div className="App">
      <Header />
      <div className="spacing flex-container">
        <div className="flex-container">
          <span>API Keys:</span>
          <span>&nbsp;{apiKeys.BlockCypher ? '✅' : '❌'}<button onClick={() => promptForKey('BlockCypher')}>BlockCypher</button></span>
          {/* <span>&nbsp;{apiKeys.CryptoAPIs ? '✅' : '❌'}<button onClick={() => promptForKey('CryptoAPIs')}>CryptoAPIs</button></span> */}
        </div>
      </div>
      <div className="spacing flex-container">
        {!!pubkeys[account] && <span className="ellipsis">PublicKey: {pubkeys[account]}</span>}
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
            value={fee[coinType]} onChange={event=>{
              const value = parseInt(event.target.value)
              if (value > 0) {
                fee[coinType] = value
                setFee(fee)
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default function() {
  return (
    <Web3ReactProvider getLibrary={getLibrary}>
      <App />
    </Web3ReactProvider>
  )
}
