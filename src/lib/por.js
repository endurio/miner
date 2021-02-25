/* global BigInt */

const { merkle, Hash256 } = require('bcrypto')
const { Transaction } = require('bitcoinjs-lib')
const { keccak256 } = require('ethers').ethers.utils

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export function isHit(txid, recipient) {
  // use (recipient+txid).reverse() for LE(txid)+LE(recipient)
  const hash = keccak256(Buffer.from(recipient+txid, 'hex').reverse())
  return BigInt(hash) % 32n === 0n
}

export function prepareClaimParams(args, pubX, pubY) {
  const { blockHash, memoHash, payer, amount, timestamp } = args;
  const isPKH = args.pubkey.substring(2+40) == '000000000000000000000000'
  const params = {
    blockHash, memoHash, payer,
    amount: amount.toString(),
    timestamp: timestamp.toString(),
    isPKH,
    pubX,
    pubY,
    skipCommission: false,
  }
  return params;
}

export async function prepareSubmitTx(client, txParams, outpointParams, bountyParams) {
  const params = await _prepareSubmitParams(txParams)
  if (params.pubkeyPos) {
    var outpoint = []
  } else {
    var outpoint = await _prepareOutpointParams({ ...outpointParams, tx: txParams.tx })
  }
  if (bountyParams && bountyParams.noBounty) {
    var bounty = []
  } else {
    var bounty = await _prepareBountyParams(txParams)
    if (bounty.length > 0) {
      const inputs = bounty[0].inputs.map(i => ({ ...i, pkhPos: 0 }))
      if (outpoint.length > 0) {
        inputs[params.inputIndex].pkhPos = outpoint[0].pkhPos
      }
      outpoint = inputs
      delete bounty[0].inputs
    }
  }
  return { params, outpoint, bounty }

  async function _prepareSubmitParams({ tx, brand, payer = ZERO_ADDRESS, inputIndex = 0, pubkeyPos }) {
    const block = await client.getBlock(tx.blockNumber)
    const merkleProof = _extractMerkleProof(block, tx.index);
    const [version, vin, vout, locktime] = _extractTxParams(tx)
  
    if (!brand) {
      brand = _guessMemo(tx)
    }
    const memoLength = brand.length
  
    if (pubkeyPos == null) {
      const script = Buffer.from(tx.inputs[inputIndex].script, 'hex')
      pubkeyPos = findPubKeyPos(script)
  
      function findPubKeyPos(script) {
        const sigLen = script[0];
        if (script[sigLen + 1] != 33) {
          return 0 // not a pubkey
        }
        // expect(script[sigLen+1]).to.equal(33, 'should pubkey length prefix byte is 33');
        return sigLen + 2;
      }
    }
  
    return {
      header: '0x' + _extractHeader(block),
      merkleIndex: tx.index,
      merkleProof,
      version: parseInt(version.toString(16).padStart(8, '0').reverseHex(), 16),
      locktime: parseInt(locktime.toString(16).padStart(8, '0').reverseHex(), 16),
      vin, vout,
      memoLength,
      inputIndex,
      pubkeyPos,
      payer,
    }
  }
  
  async function _prepareOutpointParams({ tx, inputIdx = 0, pkhPos = 0 }) {
    const script = Buffer.from(tx.inputs[inputIdx].script, 'hex')
    if (script && script.length > 0) {
      if (script.length == 23 && script.slice(0, 3).toString('hex') == '160014') {
        // redeem script for P2SH-P2WPKH
        return []
      }
      if (script.length >= 33 + 4 && script[script.length - 33 - 4 - 1] === 0x21) {
        // redeem script for P2PKH
        return []
      }
      console.error(script.length)
      console.error(script.toString('hex'))
    }
  
    const input = tx.inputs[inputIdx]
    const dxHash = input.prevout.hash
    // dependency tx
    const dx = await client.getTx(dxHash)
    if (!dx) {
      return [] // there's no data for dx here
    }
    const [version, vin, vout, locktime] = _extractTxParams(dx);
  
    return [{
      version: parseInt(version.toString(16).padStart(8, '0').reverseHex(), 16),
      locktime: parseInt(locktime.toString(16).padStart(8, '0').reverseHex(), 16),
      vin, vout,
      pkhPos,
    }]
  }
  
  async function _prepareBountyParams({ tx }) {
    const block = await client.getBlock(tx.blockNumber)
    const samplingIndex = 1 + Number(BigInt('0x'+block.hash) % BigInt(tx.outputs.length-2))
    const samplingOutput = tx.outputs[samplingIndex]
    const recipient = samplingOutput.address
    let recipientTx
    for (let offset = 0; !recipientTx; offset+= 50) {
      const recipientTxs = await client.getTxs(recipient, 50, offset)
      // TODO: properly find the correct bounty referenced tx instead of blindly pick the last one with no OP_RET
      if (!recipientTxs || recipientTxs.length == 0) {
        break // no more history to scan
      }
      recipientTx = recipientTxs.find(t => {
        const hasOpRet = t.outputs.some(o => o.script.startsWith('6a'))
        return !hasOpRet && isHit(tx.inputs[0].prevout.hash, t.hash)
      })
    }
    if (!recipientTx) {
      throw '!recipientTx'
    }
    const recipientBlock = await client.getBlock(recipientTx.blockNumber)

    const merkleProof = _extractMerkleProof(recipientBlock, recipientTx.index);
    const [version, vin, vout, locktime] = _extractTxParams(recipientTx);
    const bounty = {
      header: '0x' + _extractHeader(recipientBlock),
      merkleProof,
      merkleIndex: recipientTx.index,
      version: parseInt(version.toString(16).padStart(8, '0').reverseHex(), 16),
      locktime: parseInt(locktime.toString(16).padStart(8, '0').reverseHex(), 16),
      vin, vout,
      inputs: [],
    }

    for (const input of tx.inputs) {
      const prevTx = await client.getTx(input.prevout.hash)
      const [version, vin, vout, locktime] = _extractTxParams(prevTx)
      bounty.inputs.push({
        version: parseInt(version.toString(16).padStart(8, '0').reverseHex(), 16),
        locktime: parseInt(locktime.toString(16).padStart(8, '0').reverseHex(), 16),
        vin, vout,
      })
    }
  
    return [bounty]
  }
}

function _extractMerkleProof(block, index) {
  const txs = block.txs
    .sort((a,b) => a.index-b.index) // confident that subtraction never overflows here
    .map(({hash}) => Buffer.from(hash, 'hex').reverse())
  
  // assertion: merkle root
  const [root] = merkle.createRoot(Hash256, txs.slice())
  if (Buffer.compare(Buffer.from(block.merkleRoot, 'hex').reverse(), root) !== 0) {
    console.error(root.toString('hex'), block)
    throw 'merkle root mismatch'
  }

  const branch = merkle.createBranch(Hash256, index, txs)
  return Buffer.concat(branch)
}

function _guessMemo(tx) {
  const memo = _findMemo(tx.outputs);
  if (memo.indexOf(' ') > 0) {
    return memo.substring(0, memo.indexOf(' '))
  }
  return memo
}

function _findMemo(outputs) {
  const i = _findMemoIndex(outputs)
  if (i < 0) {
    return
  }
  const script = Buffer.from(outputs[i].script, 'hex')
  const len = script[1]
  return script.slice(2, 2 + len).toString()
}

function _findMemoIndex(outputs) {
  for (let i = 0; i < outputs.length; ++i) {
    if (outputs[i].script.startsWith('6a')) { // OP_RET
      return i
    }
  }
  return -1
}

function _extractTxParams(tx) {
  const tt = stripTxWitness(importTx(tx))
  const hex = tt.toHex()
  // expect(Transaction.fromHex(hex).getId()).to.equal(tx.getId(), 'bad code: stripTxWitness')

  // lazily assume that the each input sequence hex is searchable
  let pos = 0;
  for (const input of tx.inputs) {
    const sequence = input.sequence.toString(16).padStart(8, '0').reverseHex()
    pos = hex.indexOf(sequence, pos)
    //   expect(pos).to.be.at.least(0, `input sequence not found: ${sequence}`);
    pos += 8;
  }

  const vinStart = 8; // 2 more bytes for witness flag
  const vin = '0x' + hex.substring(vinStart, pos);
  const vout = '0x' + hex.substring(pos, hex.length - 8); // the last 8 bytes is lock time
  return [tx.version, vin, vout, tx.locktime];

  function stripTxWitness(tt) {
    if (tt.hasWitnesses()) {
      for (let i = 0; i < tt.inputs.length; ++i) {
        tt.setWitness(i, []);
      }
    }
    return tt
  }

  function importTx(tx) {
    const tt = new Transaction()
    tt.version = tx.version
    tt.locktime = tx.locktime
    tx.inputs.forEach(({ prevout: { hash, index }, sequence, script }) =>
      tt.addInput(Buffer.from(hash, 'hex').reverse(), index, sequence, Buffer.from(script, 'hex'))
    )
    tx.outputs.forEach(({ script, value }) => tt.addOutput(Buffer.from(script, 'hex'), value))
    return tt
  }
}

function _extractHeader(block) {
  const { version, prevBlock, merkleRoot, time, bits, nonce } = block
  return ''.concat(
    nonce.toString(16).padStart(8, '0'),
    bits.toString(16).padStart(8, '0'),
    time.toString(16).padStart(8, '0'),
    merkleRoot,
    prevBlock,
    version.toString(16).padStart(8, '0'),
  ).reverseHex()
}

if (!String.prototype.reverseHex) {
  Object.defineProperty(String.prototype, 'reverseHex', {
    enumerable: false,
    value: function () {
      const s = this.replace(/^(.(..)*)$/, "0$1");  // add a leading zero if needed
      const a = s.match(/../g);                     // split number in groups of two
      a.reverse();                                  // reverse the groups
      return a.join('');                            // join the groups back together
    },
  });
}
