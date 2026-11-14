// Token and network logos, bundled from @web3icons/core (MIT, https://github.com/0xa3k5/web3icons).
import AVAX from '@web3icons/core/svgs/tokens/branded/AVAX.svg.js';
import BTC from '@web3icons/core/svgs/tokens/branded/BTC.svg.js';
import USDC from '@web3icons/core/svgs/tokens/branded/USDC.svg.js';
import ETH from '@web3icons/core/svgs/tokens/branded/ETH.svg.js';
import LINK from '@web3icons/core/svgs/tokens/branded/LINK.svg.js';
import SOL from '@web3icons/core/svgs/tokens/branded/SOL.svg.js';
import DOGE from '@web3icons/core/svgs/tokens/branded/DOGE.svg.js';
import SUI from '@web3icons/core/svgs/tokens/branded/SUI.svg.js';
import avalanche from '@web3icons/core/svgs/networks/branded/avalanche.svg.js';

const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const TOKENS: Record<string, string> = { AVAX: uri(AVAX), BTC: uri(BTC), USDC: uri(USDC), ETH: uri(ETH), LINK: uri(LINK), SOL: uri(SOL), DOGE: uri(DOGE), SUI: uri(SUI) };

/** A token logo in a round white chip. `test` marks Kumi's test dollar (tUSDC), not Circle's USDC. */
export function TokenLogo({ sym, size = 28, test }: { sym: string; size?: number; test?: boolean }) {
  const s = sym.replace(/^t(?=[A-Z])/, '').toUpperCase();
  const src = TOKENS[s];
  const label = test ? `Test ${s} (Kumi's Fuji test dollar)` : s;
  return <span className={`tlogo ${test ? 'tlogo-test' : ''} ${size < 22 ? 'tlogo-sm' : ''}`} style={{ width: size, height: size }} title={label} role="img" aria-label={label}>
    {src ? <img src={src} alt="" /> : <b style={{ fontSize: size * 0.32 }}>{s.slice(0, 4)}</b>}
    {test && <i>test</i>}
  </span>;
}

export const AvaxMark = ({ size = 18 }: { size?: number }) => <img className="clogo" src={uri(avalanche)} alt="Avalanche" width={size} height={size} />;
