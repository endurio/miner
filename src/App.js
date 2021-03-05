/* global BigInt */

import './App.css'
import './components/lds.css'
import React from 'react'
import Dropdown from 'react-dropdown'
import { useLocalStorage } from '@rehooks/local-storage'
import { ethers, utils } from 'ethers'
import ci from 'coininfo'
import { ECPair, payments, TransactionBuilder, address, script } from 'bitcoinjs-lib'
import BlockchainClient from './lib/BlockchainClient'
import { decShift } from './lib/big'
import { strip0x, summary, extractReason } from './lib/utils'
import { prepareClaimParams, prepareSubmitTx, isHit } from './lib/por'
import { Alert, Prompt, Confirm, CustomDialog } from 'react-st-modal'
import { isMobile } from 'react-device-detect'
const { keccak256, computeAddress } = ethers.utils

const IMPLEMENTATIONS = ['Endurio', 'PoR', 'RefNetwork', 'BrandMarket']
const CONTRACT_ABI = IMPLEMENTATIONS.reduce((abi, i) => abi.concat(require(`./abis/${i}.json`).abi), [])
const CONTRACT_ADDRESS = {
  Ropsten: '0x0252d8DFd20938f5bd314dEd7f03Cd82070Dc1cc',
}

function getRank(blockHash, txid) {
  const txidLE = Buffer.from(txid, 'hex').reverse()
  const blockHashBE = Buffer.from(blockHash, 'hex')
  const hash = keccak256(Buffer.concat([blockHashBE, txidLE]))
  return BigInt(hash) >> 224n
}

function getParameterByName(name, url = window.location.href) {
  name = name.replace(/[[]]/g, '\\$&');
  var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
      results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

const clearMode = getParameterByName('clear')
if (clearMode != null) {
  const toSave = {}
  if (!['all', 'full'].includes(clearMode)) { // keep the configs
    const keys = ['privateKey', 'config-api']
    for (const key of keys) {
      toSave[key] = localStorage.getItem(key)
    }
  }
  localStorage.clear()
  Object.entries(toSave).forEach(([key, value]) => localStorage.setItem(key, value))
  window.location.replace(window.location.href.replace(/[?&]clear[^?&]*/, ''))
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

function useMap() {
  const [value, setValue] = React.useState(new Map())
  return [value, (k, v) =>
    setValue(prev => {
      const map = new Map(prev)
      if (typeof v === 'undefined') {
        map.delete(k)
      } else {
        map.set(k, v)
      }
      return map
    })
  ]
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
  const [privateKey, setPrivateKey] = usePersistent('privateKey')
  const [apiKeys, setApiKey] = usePersistentMap('config-api', {
    'Infura': '',
    'BlockCypher': '',
    'Tatum.io': '',
    'Tatum.io Testnet': '',
  })
  const coinTypes = ['BTC', 'BTC-TEST']
  const [coinType, setCoinType] = usePersistent('cointype', coinTypes[coinTypes.length-1])
  const networks = [/*'Ethereum',*/ 'Ropsten']
  const [network, setNetwork] = usePersistent('network', networks[networks.length-1])
  const [miner, setMiner] = React.useState()
  const [sender, setSender] = React.useState()
  const [maxBounty, setMaxBounty] = usePersistent('maxBounty', 8)
  const [fee, setFee] = usePersistentMap('fee', {'BTC': 1306, 'BTC-TEST': 999})
  const [client, setClient] = React.useState()
  const clientRef = React.useRef(client)
  clientRef.current = client
  const [input, setInput] = React.useState()
  const [btx, setBtx] = React.useState()
  const [xmine, setXmine] = usePersistentMap('xmine', {'BTC': 1, 'BTC-TEST': 1})
  const [chainHead, setChainHead] = React.useState()
  const chainHeadRef = React.useRef(chainHead)
  chainHeadRef.current = chainHead
  const [senderBalance, setSenderBalance] = React.useState()
  const [utxos, setUTXOs] = React.useState()
  const [provider, setProvider] = React.useState()
  const [wallet, setWallet] = React.useState()
  const [minerBalance, setMinerBalance] = React.useState()
  const [contract, setContract] = React.useState()
  const [tokenBalance, setTokenBalance] = React.useState()
  const [mapSentTx, setSentTx] = usePersistentMap('sent')                 // miningTx.hash => miningTx
  const [listConfirmedTx, setConfirmedTx] = React.useState()
  const [isSubmitting, setSubmitting] = useMap()
  const [mapSubmittedTx, setSubmittedTx] = usePersistentMap('submitted')  // miningTx.hash => submitTx.hash
  const [listClaimableTx, setClaimableTx] = React.useState()
  const [isClaiming, setClaiming] = useMap()
  const [mapClaimedTx, setClaimedTx] = usePersistentMap('claimed')        // submitTx.hash => claimTx.res
  const [minAutoBounty, setMinAutoBounty] = usePersistent('minAutoBounty', 3)
  const [autoMining, setAutoMining] = React.useState(false)

  // ethereum provider
  React.useEffect(() => {
    if (!apiKeys.get('Infura')) {
      return
    }
    const subnet = network == 'Ethereum' ? 'mainet' : network.toLowerCase()
    const provider = new ethers.providers.JsonRpcProvider(`https://${subnet}.infura.io/v3/${apiKeys.get('Infura')}`);
    setProvider(provider)
  }, [network, apiKeys])

  // ethereum wallet
  React.useEffect(() => {
    if (!provider || !privateKey) {
      return
    }
    setWallet(new ethers.Wallet(privateKey, provider))
  }, [provider, privateKey])

  // contract
  React.useEffect(() => {
    if (!wallet) {
      return
    }
    // create the contract instance
    const contract = new ethers.Contract(CONTRACT_ADDRESS[network], CONTRACT_ABI, wallet)
    contract.balanceOf(wallet.address)
      .then(tokenBalance => {
        setContract(contract)
        setTokenBalance(tokenBalance)
      })
      .catch(err => {
        console.error(err)
        setContract(undefined)
        setTokenBalance(undefined)
      })
  }, [wallet])

  // bitcoin client
  React.useEffect(() => {
    const keyType = coinType === 'BTC' ? 'Tatum.io' : 'Tatum.io Testnet'
    const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
    const key = apiKeys.get(keyType)
    if (!key) {
      return console.error('no API key provided')
    }
    const client = BlockchainClient({
      inBrowser: true,
      chain: 'bitcoin',
      key,
      BlockCypherKey: apiKeys.get('BlockCypher'),
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
      setMiner(undefined)
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
      provider.getBalance(miner)
        .then(setMinerBalance)
        .catch(err => {
          console.error(err)
          setMinerBalance(undefined)
        })
    }
  }, [provider, miner])

  function pollChainhead() {
    const client = clientRef.current
    if (!client) {
      console.warn('!client: schedule for the next second')
      setTimeout(pollChainhead, 1000)
      return
    }
    client.getInfo()
      .then(data => {
        let nextPoll = 10; // default after 10s
        const chainHead = chainHeadRef.current
        if (!chainHead || chainHead.bestblockhash !== data.bestblockhash) {
          if (chainHead && !isMobile) {  // not the first poll
            nextPoll = 9*60
          }
          setChainHead(data)
        }
        console.log(`schedule for the next ${nextPoll}s`)
        setTimeout(pollChainhead, nextPoll*1000)
      })
      .catch(err => {
        console.error(err)
        setChainHead(undefined)
        console.log(`schedule for the next minute`)
        setTimeout(pollChainhead, 60*1000) // retry after 1 min
      })
  }
  React.useEffect(pollChainhead, [])  // call it only once

  React.useEffect(() => {
    if (!chainHead) {
      return
    }
    console.error('new block', chainHead)
    if (autoMining) {
      fetchUnspent()  // to trigger auto mine
      fetchRecent()   // to trigger auto submit
    }
  }, [chainHead])

  function fetchData(unspent) {
    if (!client) {
      return
    }
    if (!!sender) {
      setSenderBalance(undefined)
      client.getBalance(sender.address)
        .then(balance => setSenderBalance(Number(decShift(balance, 8))))
        .catch(console.error)
    }
    client.getInfo()
      .then(data => {
        if (!chainHead || chainHead.bestblockhash !== data.bestblockhash) {
          setChainHead(data)
        }
      })
      .catch(err => {
        console.error(err)
        setChainHead(undefined)
      })
    if (!!unspent) {
      fetchUnspent()
    }
  }
  React.useEffect(fetchData, [sender, client]) // ensures refresh if referential identity of library doesn't change across chainIds

  function fetchUnspent(force) {
    if (!sender || !client) {
      return
    }
    if (force) {
      setUTXOs(undefined)
    }
    client.getUnspents(sender.address)
      .catch(console.error)
      .then((unspents) => {
        setUTXOs(unspents)
        if (unspents && unspents.hasOwnProperty('balance')) {
          setSenderBalance(unspents.balance)
        }
      })
  }
  React.useEffect(() => {
    if (!!chainHead) {
      fetchUnspent()
    }
  }, [sender, chainHead])

  React.useEffect(() => {
    if (!client || !chainHead || !utxos) {
      return
    }

    setInput(undefined)
    setBtx(undefined)
    if (utxos.length) {
      searchForBountyInput(utxos).then(setInput)
    }

    async function searchForBountyInput(utxos) {
      const now = Math.floor(Date.now() / 1000)
      // utxos = [(utxos||[])[0]]  // only use the first UTXO for the blockcypher limit
      for (const utxo of utxos) {
        utxo.recipients = []
        for (let i = 0; i < 10; ++i) {
          const number = chainHead.blocks-i
          try {
            const block = await client.getBlock(number)
            if (!block) {
              continue  // skip the missing block
            }
            if (block.bits === 0x1d00ffff) {
              continue    // skip testnet minimum difficulty blocks
            }
            if (now - block.time >= 60*60) {
              break       // bounty: block too old
            }
            for (const tx of block.txs) {
              if (!isHit(utxo.tx_hash, tx.hash)) {
                continue
              }
              try {
                // check for OP_RET in recipient tx
                const hasOpRet = tx.outputs.some(o => o.script.startsWith('6a'))   // OP_RET = 0x6a
                if (hasOpRet) {
                  continue
                }
                const recipient = tx.outputs[tx.outputs.length-1].address
                if (utxo.recipients.some(t => recipient == t.outputs[t.outputs.length-1].address)) {
                  // duplicate recipient
                  continue
                }
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
      const utxoWithMostRecipient = utxos.reduce((prev, current) => (prev.recipients||[]).length > (current.recipients||[]).length ? prev : current, {})
      console.log('use the best UTXO found', utxoWithMostRecipient)
      return utxoWithMostRecipient
    }
  }, [utxos, maxBounty])

  // build btx on new input
  React.useEffect(() => {
    if (!input || !input.recipients || !utxos) {
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

    const btx = search(1, txFee)
    setBtx(btx)

    // binary search
    function search(start, end, last) {
      if (start > end) return last || build(end)
      const mid = Math.floor((start + end)/2)
      const tb = build(mid)
      if (isValid(tb)) {
        return search(start, mid-1, tb)
      } else {
        return search(mid+1, end, last)
      }

      function isValid(tb) {
        if (!tb) {
          return false
        }
        const tx = tb.buildIncomplete()
        const txSize = tx.toBuffer().length + 1+106 // minimum 106 bytes redeem script
        const inputSize = 32 + 4 + 1+108 + 4        // give redeem script some extra bytes for tolerancy
        // assume that the first output is OP_RET and the last is the coin change
        for (let i = 1; i < tx.outs.length-1; ++i) {
          const out = tx.outs[i]
          const outputSize = 8 + 1 + out.script.length
          const minTxSize = 10 + inputSize + outputSize
          if (txFee * minTxSize > out.value * txSize) {
            return false
          }
        }
        return true
      }
    }

    function build(bountyAmount, outValue = 0) {
      const tb = new TransactionBuilder(getNetwork(coinType))

      // add the memo output
      let memo = 'endur.io'
      if (xmine.get(coinType) > 1) {
        memo += ' x' + xmine.get(coinType)
      }
      const dataScript = payments.embed({data: [Buffer.from(memo, 'utf8')]})
      tb.addOutput(dataScript.output, 0)

      let inValue = 0
      // build the mining outputs and required inputs
  
      buildWithoutChange()

      const changeValue = inValue - outValue - txFee
      if (changeValue <= 0) {
        return 'insufficient fund'
      }
      tb.addOutput(sender.address, changeValue)

      return tb

      function buildWithoutChange() {
        let recIdx = 0
        for (const input of inputs) {
          const index = input.hasOwnProperty('tx_output_n') ? input.tx_output_n : input.index
          tb.addInput(input.tx_hash, index)
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
            tb.addOutput(Buffer.from(output.script, 'hex'), amount)
            if (++recIdx >= recipients.length) {
              // recipients list exhausted
              return
            }
          }
        }
        // utxo list exhausted
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
    }
  }, [input, fee, xmine])

  // auto submit tx
  React.useEffect(() => {
    autoSubmitAll()
    async function autoSubmitAll() {
      if (!listConfirmedTx) {
        return
      }
      for (const tx of listConfirmedTx) {
        const pending = mapSentTx.get(tx.hash)
        if (!pending) {
          continue  // ignore tx sent by other client
        }
        if (tx.lostTo) {
          setSentTx(tx.hash, undefined)
          continue  // ignore losing tx
        }
        if (tx.minimumReward) {
          setSentTx(tx.hash, undefined)
          continue  // ignore tx with minimum reward
        }
        console.log('transaction confirmed', tx)
        try {
          const res = await doSubmit(tx, false)
          if (res) {
            console.log('auto submitted', tx)
            setSentTx(tx.hash, undefined)
          }
        } catch(err) {
          console.warn('auto submit failed', err, tx)
        }
      }
    }
  }, [listConfirmedTx])

  function fetchRecent(manual) {
    if (!client || !contract) {
      return
    }
    if (manual) {
      setConfirmedTx(undefined)
    }
    client.getTxs(sender.address)
      .catch(console.error)
      .then(data => {
        const now = Math.floor(Date.now() / 1000)
        const txs = data.filter(tx => {
          if (now-Number(tx.time) >= 60*60) { // too old
            const pending = mapSentTx.get(tx.hash)
            if (!!pending) {
              // clear the pending tx too
              console.warn('obsoleted transaction', pending)
              setSentTx(tx.hash, undefined)
            }
            return false 
          }
          return tx.outputs.some(out => out.script.startsWith('6a'))
        })
        scanTxs(txs).then(setConfirmedTx)
        async function scanTxs(txs) {
          for (const tx of txs) {
            const memoScript = tx.outputs.find(o => o.script.startsWith('6a')).script
            const block = await client.getBlock(tx.blockNumber)
            const others = block.txs.filter(t => {
              if (t.hash === tx.hash) {
                return false
              }
              const opret = t.outputs.find(o => o.script.startsWith('6a'))
              if (!opret) {
                return false
              }
              // TODO: properly check the same memo instead of this lazy check
              return opret.script.substring(0, 10) == memoScript.substring(0, 10)
            })

            if (others && others.length) {
              // there's competitor
              tx.rank = getRank(block.hash, tx.hash)
              let bestTx = tx
              others.forEach(t => {
                t.rank = getRank(block.hash, t.hash)
                if (t.rank < bestTx.rank) {
                  bestTx = t
                }
              })
              if (bestTx.hash !== tx.hash) {
                tx.lostTo = bestTx.hash
                continue
              }
            }

            if (block.bits === 0x1d00ffff) {
              tx.minimumReward = true
            }

            // try to submit to contract
            try {
              const {params, outpoint, bounty} = await prepareSubmitTx(client, {tx})
              await contract.callStatic.submit(params, outpoint, bounty)
                .catch(res => {
                  tx.submitError = extractReason(res)
                })
            } catch (err) {
              console.error(err)
              tx.submitError = err
            }
          }
          return txs
        }
      })
  }
  React.useEffect(fetchRecent, [chainHead, client, contract])

  async function fetchClaimables(manual) {
    // check whether the tx is already submitted
    if (!wallet || !contract) {
      return
    }

    if (manual) {
      setClaimableTx(undefined)
    }

    const latest = await wallet.provider.getBlockNumber()

    // wallet exists ensure that both privateKey and provider exists
    const pubX = '0x' + strip0x(wallet.publicKey).substr(2, 64)
    const pubY = '0x' + strip0x(wallet.publicKey).substr(64+2)
    const fromBlock = latest - 60000

    let submitLogs = wallet.provider.getLogs({
      ...contract.filters.Submit(null, null, pubX),
      fromBlock,
    })
    const claimLogs = await wallet.provider.getLogs({
      ...contract.filters.Claim(null, null, wallet.address),
      fromBlock,
    })

    // topics[1] is the blockHash
    const claimed = {}
    claimLogs.forEach(({topics}) => claimed[topics[1]] = true)

    submitLogs = (await submitLogs)
      .filter(({topics}) => !claimed[topics[1]])
      .map(log => {
        const desc = contract.interface.parseLog(log)
        const params = prepareClaimParams(desc.args, pubX, pubY)
        return {...log, desc, params}
      })
    const claimableLogs = []
    for (const log of submitLogs) {
      try {
        await contract.callStatic.claim(log.params)
        claimableLogs.push(log)
      } catch (err) {
        console.log('unclaimable:', extractReason(err), log)
      }
    }
    setClaimableTx(claimableLogs)
  }
  React.useEffect(() => fetchClaimables(), [wallet, contract])

  async function doClaim(log) {
    // check whether the tx is already submitted
    if (!wallet || !contract) {
      return Alert('!wallet || !contract', 'Claim Error')
    }

    const amount = decShift(log.desc.args.value.toString(), -18)
    if (!await Confirm(`Claim ${amount} END on ${network} network?`, 'Claim Reward')) {
      return
    }

    setClaiming(log.transactionHash, true)
    try {
      await contract.callStatic.claim(log.params)
      const res = await contract.claim(log.params)
      setClaimedTx(log.transactionHash, res)
      // remove the tx from the submitted map
      const found = Array.from(mapSubmittedTx.entries()).find(([,value]) => value == log.transactionHash)
      if (found) {
        setSubmittedTx(found[0], undefined)
      }
    } catch(err) {
      console.error(err)
      Alert(extractReason(err), 'Claim Error')
    } finally {
      setClaiming(log.transactionHash, undefined)
    }
  }

  function promptForPrivateKey(exists) {
    const defaultValue = '***'
    Prompt(`Input your private key here (in hex format without 0x prefix). It stays only in your browser.`, {
      defaultValue: exists ? defaultValue : '',
    }).then(privateKey => {
      if (privateKey != null && privateKey != defaultValue) {
        if (!privateKey) {
          setMiner(undefined)
          setPrivateKey(undefined)
          return
        }
        try {
          computeAddress(Buffer.from(privateKey, 'hex'))
          setPrivateKey(privateKey)
        } catch(err) {
          Alert(err.toString(), 'Private Key Input Error')
        }
      }
    }, err => Alert(err.toString(), 'Private Key Input Error'))
  }

  function exportConfigJSON() {
    const config = {}
    for (const key of apiKeys.keys()) {
      config[key] = apiKeys.get(key) || ''
    }
    return JSON.stringify(config, undefined, 2)
  }

  const [configJSON, setConfigJSON] = React.useState(exportConfigJSON())
  React.useEffect(() => {
    if (!configJSON) {
      return
    }
    const config = JSON.parse(configJSON)
    for (const key of apiKeys.keys()) {
      const value = config[key]
      if (value != apiKeys.get(key)) {
        setApiKey(key, value)
      }
    }
  }, [configJSON])

  function promptForConfig() {
    CustomDialog(<div className='config'>
      <textarea
        defaultValue={configJSON}
        onChange={event => {
          try {
            JSON.parse(event.target.value)
            setConfigJSON(event.target.value)
          } catch(err) {
            console.warn(err)
            event.target.value = exportConfigJSON()
          }
        }}
      ></textarea>
    </div>,{
      title: 'Configuration',
      showCloseIcon: true,
    })
  }

  async function doSend(interactive=true) {
    if (!client) {
      throw '!client'
    }
    if (!btx) {
      throw '!btx'
    }

    if (interactive && !await Confirm(`Send the bounty transaction using ${coinType}?`, 'Send Transaction')) {
      return
    }

    let tx = btx.buildIncomplete()
    const signed = !tx.ins.some(({script}) => !script || !script.length)
    if (!signed) {
      const signer = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), {network: btx.network})
      for (let i = 0; i < tx.ins.length; ++i) {
        btx.sign(i, signer)
      }
      console.log('transaction signed')
      setBtx(btx)
    }

    const txHex = btx.build().toHex()
    console.log('sending signed tx', txHex)

    // clear the last built tx
    setBtx(undefined)   // clear the about-to-send tx
    setUTXOs(undefined)
    setInput(undefined)

    try {
      const tx = await client.sendTx(txHex)
        console.log('tx successfully sent', tx)
        if (chainHead) {
          tx.targetBlock = chainHead.blocks
        }
        setSentTx(tx.hash, tx)
        // fetchRecent and auto-submit after 40 mins
        setTimeout(fetchRecent, 1000*60*40);
    } catch (err) {
      if (interactive) {
        Alert(err.toString(), 'Transaction Sending Error')
      } else {
        throw err
      }
    }
  }

  function exploreTx(hash) {
    const coinPath = coinType === 'BTC' ? 'btc' : 'btc-testnet'
    const url = `https://live.blockcypher.com/${coinPath}/tx/${hash}/`
    window.open(url, '_blank')
  }

  function exploreTxEth(hash) {
    const url = `https://${network.toLowerCase()}.etherscan.io/tx/${hash}`
    window.open(url, '_blank')
  }

  async function doSubmit(tx, interactive=true) {
    if (isSubmitting.get(tx.hash)) throw 'tx is already sending'
    if (!client) throw '!client'
    if (!contract) throw '!contract'

    if (interactive && !await Confirm(`Submit the transaction to ${network} network?`, 'Submit Transaction')) {
      return
    }

    setSubmitting(tx.hash, true)
    try {
      const {params, outpoint, bounty} = await prepareSubmitTx(client, {tx})
      // emulate call
      let res = await contract.callStatic.submit(params, outpoint, bounty)
        .catch(res => {
          if (interactive) {
            Alert(extractReason(res), 'Transaction Verification Error')
          } else {
            throw res
          }
        } )
      if (!res) {
        return
      }
      // actuall transaction
      res = await contract.submit(params, outpoint, bounty)
        .catch(res => {
          if (interactive) {
            Alert(extractReason(res), 'Transaction Submitting Error')
          } else {
            throw res
          }
        })
      if (res) {
        console.log('success', res)
        setSubmittedTx(tx.hash, res.hash)
        const found = Array.from(mapSentTx.values()).find(t => t.hash == tx.hash)
        if (found) {
          setSentTx(found.hash, undefined)
        }
        return res
      }
    } catch (err) {
      if (interactive) {
        Alert(err.toString(), 'Transaction Submitting Error')
      } else {
        throw err
      }
    } finally {
      setSubmitting(tx.hash, undefined)
    }
  }

  // statuses
  const isLoading = !chainHead || isNaN(senderBalance)

  if (typeof btx === 'string') {
    var btxError = btx
  } else if (btx) {
    var btxDisplay = decodeTx(btx)
  }

  function decodeTx(btx) {
    const tx = btx.buildIncomplete()
    let btxDisplay = ''
    for (const {script: s, value: v} of tx.outs) {
      const asm = script.toASM(s)
      if (asm.startsWith('OP_RETURN ')) {
        btxDisplay += 'OP_RETURN ' + utils.toUtf8String(Buffer.from(asm.substring(10), 'hex'))
        btxDisplay += (v ? ` with ${decShift(v, -8)}\n` : '\n')
      } else {
        const adr = address.fromOutputScript(s, btx.network)
        if (adr !== sender.address) {
          btxDisplay += `${decShift(v, -8)} → ${adr}\n`
        } else {
          btxDisplay += `${decShift(v, -8)} → (change)`
        }
      }
    }
    return btxDisplay
  }

  // auto mining on btx rebuilt
  React.useEffect(() => {
    if (!btx || !autoMining) {
      return
    }
    const tx = btx.buildIncomplete()
    if (tx.outs.length < 2+minAutoBounty) {
      // only send when there's at least a number of bounty outputs
      console.warn('auto mining: too few bounty outputs', tx)
      // try again after half an interval, if the interval > 5 min
      setTimeout(fetchUnspent, 5*60*1000)
      return
    }
    if (mapSentTx && mapSentTx.size && chainHead) {
      const alreadySent = Array.from(mapSentTx.values()).some(tx => tx.targetBlock == chainHead.blocks)
      if (alreadySent) {
        console.warn('auto mining: already mine this block')
        return
      }
    }
    doSend(false)
  }, [btx, autoMining, minAutoBounty])

  function toggleMining() {
    if (!!autoMining) {
      console.log('stop mining')
      setAutoMining(false)
      return
    }
    console.log('start mining')
    setAutoMining(true)
    fetchUnspent()  // trigger the first fetchUnspent
  }

  return (
    <div className="App">
      <div className="spacing flex-container header">
        <span>&nbsp;{Array.from(apiKeys.values()).some(value => !value) ? '❌' : '✅'}<button onClick={() => promptForConfig(!!privateKey)}>API Keys</button></span>
        <span>&nbsp;{privateKey ? '✅' : '❌'}<button onClick={() => promptForPrivateKey(!!privateKey)}>Private Key</button></span>
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">
          Network:&nbsp;<Dropdown options={networks} onChange={item=>setNetwork(item.value)} value={network} placeholder="Network" />
        </div>
        {!!miner && <span className="ellipsis">Miner: {miner}</span>}
        {!minerBalance && <div><div className="lds-dual-ring"></div></div>}
      </div>
      {minerBalance && <div className="spacing flex-container indent"><span>{decShift(minerBalance, -18)} <a target='blank' href={`https://${network.toLowerCase()}.etherscan.io/address/${miner}`}>ETH</a></span></div>}
      {tokenBalance && <div className="spacing flex-container indent"><span>{decShift(tokenBalance, -18)} <a target='blank' href={`https://${network.toLowerCase()}.etherscan.io/token/${CONTRACT_ADDRESS[network]}?a=${miner}`}>END</a></span></div>}
      <div className="spacing flex-container">
        <div className="flex-container">
          Coin:&nbsp;<Dropdown options={coinTypes} onChange={item=>setCoinType(item.value)} value={coinType} placeholder="Mining coin" />
        </div>
        {!!sender && <span className="ellipsis">Sender: {sender.address}</span>}
      </div>
      {!isLoading && <div className="spacing flex-container indent"><span>{decShift(senderBalance, -8)} {coinType}</span></div>}
      <div className="spacing flex-container">
        <div>Claimable Reward</div>
        <div>{listClaimableTx ? <button onClick={()=>fetchClaimables(true)}>Reload</button> : <div className="lds-dual-ring"></div>}</div>
      </div>
      {listClaimableTx && listClaimableTx.map(log => ((!mapClaimedTx || !mapClaimedTx.get(log.transactionHash)) &&
        <div className="spacing flex-container indent" key={log.transactionHash}>
          <div className="flex-container">
            <button style={{fontFamily: 'monospace'}} onClick={()=>exploreTxEth(log.transactionHash)}>{summary(strip0x(log.transactionHash))}</button>
          </div>
          <div>{decShift(log.desc.args.value.toString(), -18)} <a target='blank' href={`https://${network.toLowerCase()}.etherscan.io/token/${CONTRACT_ADDRESS[network]}?a=${miner}`}>END</a></div>
          <div>{isClaiming.get(log.transactionHash) ?
            <div className="lds-dual-ring"></div> :
            <button onClick={()=>doClaim(log)}>Claim</button>
          }</div>
        </div>
      ))}
      <div className="spacing flex-container">
        <div>Confirmed Transactions</div>
        <div>{listConfirmedTx ? <button onClick={()=>fetchRecent(true)}>Reload</button> : <div className="lds-dual-ring"></div>}</div>
      </div>
      {listConfirmedTx && listConfirmedTx.map(tx => (!mapSubmittedTx.get(tx.hash) &&
        <div className="spacing flex-container indent" key={tx.hash}>
          <div className="flex-container">
            <button style={{fontFamily: 'monospace'}} onClick={()=>exploreTx(tx.hash)}>{summary(tx.hash)}</button>
          </div>
          {tx.submitError && <div>&nbsp;❌&nbsp;{tx.submitError}</div>}
          {(!tx.submitError && tx.lostTo) && <div>&nbsp;❌&nbsp;<button style={{fontFamily: 'monospace'}} onClick={()=>exploreTx(tx.lostTo)}>{summary(tx.lostTo)}</button></div>}
          {(!tx.submitError && !!tx.minimumReward) && <div><a target='_blank' rel='noreferrer'
            href='https://en.bitcoin.it/wiki/Testnet#:~:text=if%20no%20block%20has%20been%20found%20in%2020%20minutes,%20the%20difficulty%20automatically%20resets%20back%20to%20the%20minimum%20for%20a%20single%20block'
            >minimum reward</a>
          </div>}
          {(contract && !tx.lostTo && !tx.submitError) && <div>&nbsp;✔️&nbsp;{
            isSubmitting.get(tx.hash) ?
              <div className="lds-dual-ring"></div> :
              <button onClick={()=>doSubmit(tx)}>Submit</button>
          }</div>}
        </div>
      ))}
      <div className="spacing flex-container">
        <div>Pending Transactions</div>
      </div>
      {(mapSentTx && mapSentTx.size > 0) &&
        Array.from(mapSentTx.values()).map(tx => ((!listConfirmedTx || !listConfirmedTx.some(t => t.hash == tx.hash)) &&
          <div className="spacing flex-container indent" key={tx.hash}>
            <div><button style={{fontFamily: 'monospace'}} onClick={()=>exploreTx(tx.hash)}>{summary(tx.hash)}</button></div>
            {tx.received && <div>{new Date(tx.received).toLocaleTimeString('en-GB')}</div>}
          </div>
        ))
      }
      <div className='spacing flex-container'>
        <div className="flex-container">Min Bounty:&nbsp;
          <input maxLength={1} style={{width: 30}}
            value={minAutoBounty} onChange={event=>{
              const value = parseInt(event.target.value)
              if (value > 0 && value <= 8) {
                setMinAutoBounty(value)
              }
            }}
          />
        </div>
        {<div>{!!autoMining ?
          <button onClick={()=>toggleMining()}>⛔ Stop</button> :
          <button onClick={()=>toggleMining()}>▶️ Start</button>
        }</div>}
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
          <input maxLength={1} style={{width: 30}}
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
        <div>{isLoading ? <div className="lds-dual-ring"></div> : <button onClick={()=>fetchData(true)}>Rebuild</button>}</div>
        {(utxos && utxos.length) && <div>
          {(!btxError&&!btxDisplay) && <div className="lds-dual-ring"></div>}
          {((client || apiKeys.get('BlockCypher')) && !!btxDisplay) && <button onClick={() => doSend()}>Send</button>}
        </div>}
      </div>
      <div className='spacing flex-container indent'>
        {btxError && <span className="error">{btxError}</span>}
        {btxDisplay && <pre>{btxDisplay}</pre>}
      </div>
      <div className='spacing flex-container footer'>
        <div><a href='/'>Home</a></div>
        <div><a href='/doc'>Documentation</a></div>
        <div><a target='_blank' rel='noreferrer' href='https://opensource.org/licenses/MIT'>License</a></div>
        <div><a target='_blank' rel='noreferrer' href='https://github.com/endurio/miner'>Source</a></div>
        <div><a target='_blank' rel='noreferrer' href='https://github.com/endurio/miner/issues'>Bug Report</a></div>
        <div><a target='_blank' rel='noreferrer' href='mailto:zergity@endur.io'>Contact Developer</a></div>
      </div>
    </div>
  )
}

export default App