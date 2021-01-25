import './App.css'
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

function App () {
  const { account, library } = useWeb3React()
  const [_pubkeys, _setPubkeys] = useLocalStorage('pubkeys', {})
  const [pubkeys, setPubkeys] = React.useState(_pubkeys)
  const options = ['BTC', 'BTC-TEST']
  const defaultOption = options[1]
  const [_coinType, _setCoinType] = useLocalStorage('cointype', defaultOption)
  const [coinType, setCoinType] = React.useState(_coinType)
  const [sender, setSender] = React.useState()
  const [apiKeys] = useLocalStorage('apiKeys')
  const [summary, setSummary] = React.useState()

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
            _setPubkeys(pubkeys)
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

  React.useEffect(() => {
    if (!!sender && !!apiKeys.BlockCypher) {
      const network = coinType === 'BTC' ? 'mainnet' : 'testnet'
      let stale = false
      const client = blockcypher({
        key: apiKeys.BlockCypher,
        network,
      })
      setSummary({})
      client.Addresses.Summary([sender.address], (err, data) => {
        if (stale) {
          return
        }
        if (err) {
          console.error(err)
          return
        }
        setSummary(data[0])
      })
      return () => {
        stale = true
      }
    }
  }, [sender]) // ensures refresh if referential identity of library doesn't change across chainIds

  return (
    <div className="App">
      <Header />
      <div className="spacing flex-container">
        {!!pubkeys[account] && <span className="ellipsis">PublicKey: {pubkeys[account]}</span>}
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">
          Network:&nbsp;<Dropdown options={options} onChange={item=>{
            setCoinType(item.value)
            _setCoinType(item.value)
          }} value={coinType} placeholder="Mining coin" />
        </div>
        {!!sender && <span className="ellipsis">Sender: {sender.address}</span>}
        {!!summary && <span>Sender Balance: {decShift(summary.balance, -8)}</span>}
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
