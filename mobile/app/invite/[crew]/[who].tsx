import { Redirect, useLocalSearchParams } from 'expo-router';
import { routeForSystemPath } from '../../../lib/links';

/**
 * A join code tapped outside the app (kumi://invite/<crew>/<address>, which iOS hands over as the path
 * /invite/<crew>/<address>) opens that crew with `/invite <address>` drafted for the crew to vote on.
 * Anything that is not a valid code goes to the chats list.
 */
export default function JoinCode() {
  const { crew, who } = useLocalSearchParams<{ crew: string; who: string }>();
  const to = routeForSystemPath(`/invite/${String(crew ?? '')}/${String(who ?? '')}`);
  return <Redirect href={(to ?? '/') as any} />;
}
