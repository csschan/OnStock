import { PublicKey, Connection } from '@solana/web3.js';
const RPC = 'https://solana-devnet.g.alchemy.com/v2/0Iqo_XuuVPXQzj87HCEWlW3JHs_zmgLR';
const conn = new Connection(RPC, 'confirmed');
const programId = new PublicKey('Dp5XeudXm3dfSNnLLC6M8dPhDXd6nFmMX9SGNCTtGmKx');
const mints = {
  TSLA: '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
  NVDA: 'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
  SPY:  'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
};
for (const [t, m] of Object.entries(mints)) {
  const mint = new PublicKey(m);
  const [v] = PublicKey.findProgramAddressSync([Buffer.from('vault'), mint.toBuffer()], programId);
  const [r] = PublicKey.findProgramAddressSync([Buffer.from('receipt'), mint.toBuffer()], programId);
  const vaultInfo = await conn.getAccountInfo(v);
  const receiptInfo = await conn.getAccountInfo(r);
  console.log(t, '| vault:', v.toBase58(), 'exists:', !!vaultInfo, '| receipt:', r.toBase58(), 'exists:', !!receiptInfo);
}
