/**
 * Kumi on the phone: the approved Kumi web look, unchanged. Cream app, plum hero cards, colour-coded crews and
 * message cards. Coral = trade calls and the main action, butter = votes and money, mint = gains and copies,
 * pink = ragequit and losses, plum = the fund. Baloo 2 display, Urbanist body, Space Mono numbers.
 * Values are the web's CSS tokens (web/src/styles.css).
 */
export const C = {
  plum: '#3b1f4a', plum2: '#2a1436', plum3: '#52305f', plumSoft: '#efe6f5', plumEdge: '#1f0e29',
  coral: '#ff6f59', coralHi: '#ff8470', coralTop: '#ff8a72', coralSoft: '#ffe6df', coralInk: '#c0402b', coralEdge: '#d4472f',
  butter: '#ffd166', butterHi: '#ffdb85', butterTop: '#ffe08f', butterSoft: '#fff1cc', butterInk: '#855700', butterEdge: '#e0a92f',
  mint: '#3ddc97', mintHi: '#5ae3a8', mintTop: '#6fe8b4', mintSoft: '#d9f7e9', mintInk: '#0e7348', mintEdge: '#1fa46b',
  pink: '#ff8fc7', pinkHi: '#ffa6d3', pinkSoft: '#ffe3f1', pinkInk: '#b02f73', pinkEdge: '#f3b5d6',
  cream: '#fff4e6', cream2: '#fbe9d4', sun: '#ffe3a3', sun2: '#fff0cf',
  bg: '#fff4e6', panel: '#ffffff', panel2: '#fff9f1', panel3: '#f6ece0',
  ink: '#2b1630', ink2: '#5d4a62', ink3: '#8b7a8c',
  line: 'rgba(59,31,74,0.09)', line2: 'rgba(59,31,74,0.16)',
  edge: '#ecd9c3',
};
export const F = { display: 'Baloo2_800ExtraBold', displayBold: 'Baloo2_700Bold', mono: 'SpaceMono_400Regular', monoBold: 'SpaceMono_700Bold' };

export type Tone = 'coral' | 'butter' | 'mint' | 'pink' | 'plum';
export const TONE: Record<Tone, { base: string; soft: string; ink: string; edge: string }> = {
  coral: { base: C.coral, soft: C.coralSoft, ink: C.coralInk, edge: C.coralEdge },
  butter: { base: C.butter, soft: C.butterSoft, ink: C.butterInk, edge: C.butterEdge },
  mint: { base: C.mint, soft: C.mintSoft, ink: C.mintInk, edge: C.mintEdge },
  pink: { base: C.pink, soft: C.pinkSoft, ink: C.pinkInk, edge: C.pinkEdge },
  plum: { base: C.plum, soft: C.plumSoft, ink: C.plum, edge: C.plumEdge },
};

export const art = {
  hero: require('../assets/art/kumi3-hero.webp'),
  empty: require('../assets/art/kumi3-empty.webp'),
  pool: require('../assets/art/kumi3-pool.webp'),
  vote: require('../assets/art/kumi3-vote.webp'),
  leave: require('../assets/art/kumi3-leave.webp'),
  chat: require('../assets/art/kumi-feature-chat.webp'),
  animals: {
    owl: require('../assets/art/kumi3-av-owl.webp'),
    fox: require('../assets/art/kumi3-av-fox.webp'),
    bear: require('../assets/art/kumi3-av-bear.webp'),
    frog: require('../assets/art/kumi3-av-frog.webp'),
  },
  obj: {
    captain: require('../assets/art/3d/kumi-3d-captain.webp'),
    chat: require('../assets/art/3d/kumi-3d-chat.webp'),
    coins: require('../assets/art/3d/kumi-3d-coins.webp'),
    crown: require('../assets/art/3d/kumi-3d-crown.webp'),
    door: require('../assets/art/3d/kumi-3d-door.webp'),
    empty: require('../assets/art/3d/kumi-3d-empty.webp'),
    hourglass: require('../assets/art/3d/kumi-3d-hourglass.webp'),
    jar: require('../assets/art/3d/kumi-3d-jar.webp'),
    mark: require('../assets/art/3d/kumi-3d-mark.webp'),
    rocket: require('../assets/art/3d/kumi-3d-rocket.webp'),
    shield: require('../assets/art/3d/kumi-3d-shield.webp'),
    success: require('../assets/art/3d/kumi-3d-success.webp'),
    vote: require('../assets/art/3d/kumi-3d-vote.webp'),
    warning: require('../assets/art/3d/kumi-3d-warning.webp'),
  },
};
export type ObjName = keyof typeof art.obj;

const TONES: Tone[] = ['coral', 'butter', 'mint', 'pink'];
const ANIMALS = ['owl', 'fox', 'bear', 'frog'] as const;
const HUES = ['#ff6f59', '#ffd166', '#3ddc97', '#ff8fc7', '#ffb38a', '#c8e66b'];
export const hashOf = (id: string) => { let h = 0; for (const ch of id.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
/** Same picks as the web (web/src/ui/bits.tsx), so a crew or a member looks the same on both. */
export const crewTone = (addr: string): Tone => TONES[hashOf(addr) % TONES.length]!;
export const crewAnimal = (addr: string) => ANIMALS[hashOf(addr) % ANIMALS.length]!;
export const memberHue = (a: string) => HUES[hashOf(a) % HUES.length]!;
const MEMBER_MASCOT: Record<string, (typeof ANIMALS)[number]> = { mika: 'owl', bo: 'bear', ren: 'fox' };
export const mascotOf = (a: string, name: string) => MEMBER_MASCOT[name] ?? ANIMALS[hashOf(a) % ANIMALS.length]!;
