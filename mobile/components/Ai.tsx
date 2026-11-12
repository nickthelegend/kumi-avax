import { ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import type { AiAnswer, AiDraft } from '@kumi-avax/sdk';
import { Text } from './T';
import { Brand, Btn, Ic, TokenLogo, ago } from './ui';
import { C, F } from '../lib/theme';

const enter = FadeInDown.duration(260).reduceMotion(ReduceMotion.System);
const ICON: Record<string, string> = { order_book: 'book', chainlink_price: 'link', chat_activity: 'chat', caller_record: 'crews', top_callers: 'trophy', my_positions: 'wallet', draft_call: 'bolt' };

/** The asker's /ask line: their own bubble, in mono like a command, local to this phone. */
export function AskBubble({ q }: { q: string }) {
  return (
    <Animated.View entering={enter} style={{ alignSelf: 'flex-end', maxWidth: '84%', borderRadius: 22, borderBottomRightRadius: 8, backgroundColor: '#1f0e29', paddingBottom: 4 }}>
      <View style={{ paddingVertical: 10, paddingHorizontal: 15, borderRadius: 22, borderBottomRightRadius: 8, backgroundColor: C.plum }}>
        <Text style={{ fontSize: 15, lineHeight: 21, color: '#fff' }}><Text style={{ fontFamily: F.mono, color: C.butter }}>/ask </Text>{q}</Text>
      </View>
    </Animated.View>
  );
}

function Head({ at }: { at?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Brand size={24} label={false} />
      <Text style={{ fontWeight: '800', fontSize: 14.5, color: C.ink }}>Kumi AI</Text>
      <View style={{ paddingHorizontal: 6, height: 18, borderRadius: 6, backgroundColor: C.plumSoft, justifyContent: 'center' }}><Text style={{ fontSize: 10, fontWeight: '800', color: C.plum3 }}>AI</Text></View>
      {at ? <Text style={{ fontSize: 11.5, color: C.ink3 }}>{ago(at / 1000)}</Text> : null}
    </View>
  );
}

function Face({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View entering={enter} style={{ alignSelf: 'flex-start', width: '92%', borderRadius: 24, backgroundColor: C.edge, paddingBottom: 5 }}>
      <View style={{ borderRadius: 24, borderWidth: 3, borderColor: '#fff', backgroundColor: C.panel, padding: 13, gap: 9 }}>{children}</View>
    </Animated.View>
  );
}

export function AiPending() {
  return (
    <Face>
      <Head />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator size="small" color={C.plum} /><Text style={{ fontSize: 14, color: C.ink2 }}>Reading Fuji…</Text></View>
    </Face>
  );
}

/** Kumi AI's answer: which tools it called (chips), the answer, and a call it drafted for the asker to sign. */
export function AiCard({ a, isCrew, onDraft }: { a: AiAnswer; isCrew: boolean; onDraft: (d: AiDraft) => void }) {
  return (
    <Face>
      <Head at={a.at} />
      {a.tools.length > 0 && (
        <View testID="ai-tools" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {a.tools.map((t, i) => (
            <View key={`${t.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 9, borderRadius: 999, backgroundColor: C.butterSoft }}>
              <Ic name={ICON[t.name] ?? 'bolt'} size={12} color={C.butterInk} />
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: C.butterInk }}>{t.label}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={{ fontSize: 15, lineHeight: 21.5, color: C.ink }}>{a.answer}</Text>
      {a.draft && <DraftCard d={a.draft} isCrew={isCrew} onUse={() => onDraft(a.draft!)} />}
      <Text style={{ fontSize: 11, color: C.ink3 }}>Only you see this · {a.model}</Text>
    </Face>
  );
}

function DraftCard({ d, isCrew, onUse }: { d: AiDraft; isCrew: boolean; onUse: () => void }) {
  const long = d.side === 'long';
  return (
    <View style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: C.line }}>
      <LinearGradient colors={long ? ['#ff9a7e', C.coral, '#ff6a7f'] : ['#6a3a80', C.plum, C.plum]} locations={[0, 0.55, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11 }}>
        <TokenLogo sym={d.market} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.85)' }}>DRAFT · NOT SENT</Text>
          <Text style={{ fontFamily: F.display, fontSize: 20, lineHeight: 24, color: '#fff' }}>{long ? 'LONG' : 'SHORT'} {d.market} {d.leverage}X</Text>
          <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.92)' }}>{isCrew ? `${d.sizePct}% of the fund` : `${d.marginUsdc} tUSDC margin`}</Text>
        </View>
      </LinearGradient>
      <View style={{ padding: 10, gap: 8, backgroundColor: C.panel2 }}>
        {d.note ? <Text style={{ fontSize: 13.5, color: C.ink2 }}>"{d.note}"</Text> : null}
        <Btn testID="use-draft" title={isCrew ? 'Pitch it' : 'Review and post'} tone={long ? 'coral' : 'plum'} size="sm" icon="bolt" onPress={onUse} />
      </View>
    </View>
  );
}
