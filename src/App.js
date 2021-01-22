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

function getLibrary(provider) {
  const library = new Web3Provider(provider)
  library.pollingInterval = 12000
  return library
}

function PublicKey() {
  const { account, library } = useWeb3React()

  const [pubkeys, setPubkeys] = useLocalStorage('pubkeys', {})

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
  }, [account, library, pubkeys, setPubkeys]) // ensures refresh if referential identity of library doesn't change across chainIds

  if (!account || !pubkeys[account]) {
    return <></>
  }

  return (
    <span className="ellipsis">PublicKey: {pubkeys[account]}</span>
  )
}

function CoinType() {
  const options = ['BTC', 'BTC-TEST']
  const defaultOption = options[1]

  const [coinType, setCoinType] = useLocalStorage('cointype', defaultOption)
  
  return (
    <Dropdown options={options} onChange={item=>setCoinType(item.value)} value={coinType} placeholder="Mining coin" />
  )
}

function Sender() {
  const { account, library } = useWeb3React()
  const [pubkeys, setPubkeys] = useLocalStorage('pubkeys')
  const [coinType] = useLocalStorage('cointype')
  if (!account || !pubkeys[account] || !coinType) {
    return <></>
  }

  try {
    const coinInfo = ci(coinType)
    const network = {
      messagePrefix: coinInfo.messagePrefix,
      bech32: coinInfo.bech32,
      bip32: coinInfo.versions.bip32,
      pubKeyHash: coinInfo.versions.public,
      scriptHash: coinInfo.versions.scripthash,
      wif: coinInfo.versions.private,
    }
    const keyPair = ECPair.fromPublicKey(Buffer.from(pubkeys[account].substring(2), 'hex'))
    const sender = payments.p2pkh({pubkey: keyPair.publicKey, network})
    return (
      <span className="ellipsis">Sender: {sender.address}</span>
    )
  } catch(err) {
    console.error(err)
    delete pubkeys[account]
    setPubkeys(pubkeys)
  }
}

function App () {
  return (
    <div className="App">
      <Header />
      <div className="spacing flex-container">
        <PublicKey />
      </div>
      <div className="spacing flex-container">
        <div className="flex-container">
          Network:&nbsp;<CoinType />
        </div>
        <Sender />
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
