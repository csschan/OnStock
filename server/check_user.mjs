import { PublicKey, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
const RPC = 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR';
const conn = new Connection(RPC, 'confirmed');

// User wallet from faucet logs
const userPk = new PublicKey('46jsDyqoujjcswNZKtejmi9oRtsq86Kxe77XbBg3vcD1');

const mints = {
  TSLA: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
  NVDA: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
  SPY:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
};

const sol = await conn.getBalance(userPk);
console.log('SOL balance:', sol / 1e9);

for (const [t, m] of Object.entries(mints)) {
  const mint = new PublicKey(m);
  const ata = getAssociatedTokenAddressSync(mint, userPk);
  try {
    const acct = await getAccount(conn, ata);
    console.log(t, 'xStock balance:', Number(acct.amount) / 1e6);
  } catch {
    console.log(t, 'xStock ATA: does not exist');
  }
}
