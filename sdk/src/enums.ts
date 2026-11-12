/** Mirrors KumiCrew.Kind and KumiCrew.FeedKind. */
export const Kind = { Open: 0, Close: 1, SetCaptain: 2, AddMember: 3 } as const;
export const FeedKind = { Chat: 0, Pitch: 1, VoteYes: 2, VoteNo: 3, Executed: 4, ExecFailed: 5, Deposit: 6, Ragequit: 7, CaptainTrade: 8, MemberAdded: 9, Expired: 10 } as const;
export const CAPTAIN_REF = 0xffffffff;
