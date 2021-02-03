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
import blockcypher from 'blockcypher-unofficial'
import { decShift } from './lib/big'

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
  const [_value, _setValue] = useLocalStorage(key, defaulValue)
  const [value, setValue] = React.useState(_value)
  React.useEffect(() => _setValue(value), [value])
  return [value, setValue]
}

function App () {
  const { account, library } = useWeb3React()
  const [pubkeys, setPubkeys] = usePersistent('pubkeys', {})
  const options = ['BTC', 'BTC-TEST']
  const defaultOption = options[1]
  const [coinType, setCoinType] = usePersistent('cointype', defaultOption)
  const [sender, setSender] = React.useState()
  const [apiKeys] = useLocalStorage('apiKeys')
  const [summary, setSummary] = React.useState()
  const [unspents, setUnspents] = React.useState()
  const [maxBounty, setMaxBounty] = usePersistent('maxBounty', 8)
  const [fee, setFee] = usePersistent('fee', 1306)

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
    if (!!sender && !!apiKeys.BlockCypher) {
      const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
      const client = blockcypher({
        key: apiKeys.BlockCypher,
        network,
      })
      setSummary(undefined)
      client.Addresses.Summary([sender.address], (err, data) => {
        if (err) {
          return console.error(err)
        }
        setSummary(data[0])
      })
      setUnspents(undefined)
      client.Addresses.Unspents([sender.address], (err, data) => {
        if (err) {
          return console.error(err)
        }
        console.error(data[0])
        setUnspents(data[0])
      })
    }
  }

  React.useEffect(fetchData, [sender]) // ensures refresh if referential identity of library doesn't change across chainIds

  // statuses
  const isLoading = !summary
  const hasError = summary && summary.err
  const hasSummary = summary && !summary.err

  return (
    <div className="App">
      <Header />
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
        {hasError && <span className="error">{summary.err.toString()}</span>}
        {hasSummary && <span>Sender Balance: {decShift(summary.balance, -8)}</span>}
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
        <div className="flex-container">Fee:&nbsp;{fee[coinType]}
          <input style={{width: 60}}
            value={fee} onChange={event=>{
              const value = parseInt(event.target.value)
              if (value > 0) {
                setFee(value)
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
