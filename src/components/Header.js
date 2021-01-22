import React from 'react'
import { useWeb3React, UnsupportedChainIdError } from '@web3-react/core'
import { useEagerConnect, useInactiveListener } from '../hooks'
import { Spinner } from './Spinner'
import { decShift } from '../lib/big'
import {
  NoEthereumProviderError,
  UserRejectedRequestError as UserRejectedRequestErrorInjected
} from '@web3-react/injected-connector'
import {
  injected,
} from '../connectors'
import { useLocalStorage } from '@rehooks/local-storage'

function getErrorMessage(error) {
  if (error instanceof NoEthereumProviderError) {
    return 'No Ethereum browser extension detected, install MetaMask on desktop or visit from a dApp browser on mobile.'
  } else if (error instanceof UnsupportedChainIdError) {
    return "You're connected to an unsupported network."
  } else if (
    error instanceof UserRejectedRequestErrorInjected
    // || error instanceof UserRejectedRequestErrorWalletConnect
    // || error instanceof UserRejectedRequestErrorFrame
  ) {
    return 'Please authorize this website to access your Ethereum account.'
  } else {
    console.error(error)
    return 'An unknown error occurred. Check the console for more details.'
  }
}

export function Connection() {
  const { connector, activate, deactivate, active, error } = useWeb3React()

  // handle logic to recognize the connector currently being activated
  const [activatingConnector, setActivatingConnector] = React.useState()
  React.useEffect(() => {
    if (activatingConnector && activatingConnector === connector) {
      setActivatingConnector(undefined)
    }
  }, [activatingConnector, connector])

  // handle logic to eagerly connect to the injected ethereum provider, if it exists and has granted access already
  const triedEager = useEagerConnect()

  // handle logic to connect in reaction to certain events on the injected ethereum provider, if it exists
  useInactiveListener(!triedEager || !!activatingConnector)

  const currentConnector = injected
  const activating = currentConnector === activatingConnector
  const connected = currentConnector === connector
  const disabled = !triedEager || !!activatingConnector || connected || !!error

  return (
    <div style={{ display: 'flex-wrap' }}>
      <span>
        Status: {active ? '✅' : error ? ('🔴' + getErrorMessage(error)) : '❌'}
      </span>
      {!!active ||
        <button
          disabled={disabled}
          onClick={() => {
            setActivatingConnector(currentConnector)
            activate(currentConnector)
          }}
        >
          {activating ? <Spinner color={'black'}/> : 'Connect'}
        </button>
      }
      {(active || error) && (
        <button
          onClick={() => {
            deactivate()
          }}
        >
          Disconnect
        </button>
      )}
    </div>
  )
}

export function ChainId() {
  const { chainId } = useWeb3React()

  if (!chainId) {
    return <></>
  }

  return (
    <span>Chain Id: {chainId}</span>
  )
}

export function BlockNumber() {
  const { chainId, library } = useWeb3React()

  const [blockNumber, setBlockNumber] = React.useState()
  React.useEffect(() => {
    if (!!library) {
      let stale = false

      library
        .getBlockNumber()
        .then((blockNumber) => {
          if (!stale) {
            setBlockNumber(blockNumber)
          }
        })
        .catch(() => {
          if (!stale) {
            setBlockNumber(null)
          }
        })

      const updateBlockNumber = (blockNumber) => {
        setBlockNumber(blockNumber)
      }
      library.on('block', updateBlockNumber)

      return () => {
        stale = true
        library.removeListener('block', updateBlockNumber)
        setBlockNumber(undefined)
      }
    }
  }, [library, chainId]) // ensures refresh if referential identity of library doesn't change across chainIds

  if (isNaN(blockNumber)) {
    return <></>
  }

  return (
    <span>Block Number: {blockNumber}</span>
  )
}

export function Account() {
  const { account } = useWeb3React()

  if (!account) {
    return <></>
  }

  return (
    <span>Account: {account.substring(0, 8)}...{account.substring(account.length-6)}</span>
  )
}

export function Balance() {
  const { account, library, chainId } = useWeb3React()

  const [balance, setBalance] = React.useState()
  React.useEffect(() => {
    if (!!account && !!library) {
      let stale = false

      library
        .getBalance(account)
        .then((balance) => {
          if (!stale) {
            setBalance(decShift(balance, -18))
          }
        })
        .catch(() => {
          if (!stale) {
            setBalance(null)
          }
        })

      return () => {
        stale = true
        setBalance(undefined)
      }
    }
  }, [account, library, chainId]) // ensures refresh if referential identity of library doesn't change across chainIds

  if (isNaN(balance)) {
    return <></>
  }

  return (
    <span>Balance: {balance}</span>
  )
}

export function ApiKeys() {
  const [_apiKeys, _setApiKeys] = useLocalStorage('apiKeys', {})
  const [apiKeys, setApiKeys] = React.useState(_apiKeys)

  function promptForKey(key) {
    const value = window.prompt(`API key for ${key}:`, apiKeys[key])
    if (value != null) {
      apiKeys[key] = value
      setApiKeys(apiKeys)
      _setApiKeys(apiKeys)
    }
  }

  return (
    <div className="flex-container">
      <span>API Keys:</span>
      <span>&nbsp;{apiKeys.BlockCypher ? '✅' : '❌'}<button onClick={() => promptForKey('BlockCypher')}>BlockCypher</button></span>
      <span>&nbsp;{apiKeys.CryptoAPIs ? '✅' : '❌'}<button onClick={() => promptForKey('CryptoAPIs')}>CryptoAPIs</button></span>
    </div>
  )
}

export function Header() {
  const { connector } = useWeb3React()

  // handle logic to recognize the connector currently being activated
  const [activatingConnector, setActivatingConnector] = React.useState()
  React.useEffect(() => {
    if (activatingConnector && activatingConnector === connector) {
      setActivatingConnector(undefined)
    }
  }, [activatingConnector, connector])

  // handle logic to eagerly connect to the injected ethereum provider, if it exists and has granted access already
  const triedEager = useEagerConnect()

  // handle logic to connect in reaction to certain events on the injected ethereum provider, if it exists
  useInactiveListener(!triedEager || !!activatingConnector)

  return (
    <>
      <div className='spacing flex-container'>
        <Connection />
        <ChainId />
        <BlockNumber />
        <Account />
        <Balance />
        <ApiKeys />
      </div>
    </>
  )
}
