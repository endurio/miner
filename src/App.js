import './App.css';
import React from 'react'
import { Web3ReactProvider, useWeb3React } from '@web3-react/core'
import { Web3Provider } from '@ethersproject/providers'
import { Header } from './components/Header'
import { useLocalStorage } from '@rehooks/local-storage';
import { ethers } from 'ethers';

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

  const pk = pubkeys[account]

  return (
    <span className="ellipsis">PublicKey: {pk}</span>
  )
}

function App () {
  return (
    <div className="App">
      <Header />
      <div className="spacing-flex-container">
        <PublicKey />
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
