import { Redirect, useLocalSearchParams } from 'expo-router';

/** Deep link kumi://join/<chat> opens that chat (joining a public channel is one tap inside it). */
export default function JoinLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/chat/${String(id ?? '').toLowerCase()}`} />;
}
