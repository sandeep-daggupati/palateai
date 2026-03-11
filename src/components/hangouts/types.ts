export type HangoutVibeKey =
  | 'quick_bite'
  | 'go_to_spot'
  | 'celebration'
  | 'work_hangout'
  | 'mixer'
  | 'with_friends'
  | 'night_out'
  | 'hidden_gem';

export type HangoutCrewMember = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isPending: boolean;
};

export type HangoutCardItem = {
  id: string;
  restaurantName: string;
  address: string | null;
  dateLabel: string;
  ownershipLabel: string;
  isOwnedByCurrentUser: boolean;
  timestamp: number;
  href: string;
  coverPhotoUrl: string | null;
  participantCount: number;
  crew: HangoutCrewMember[];
  vibeKeys: HangoutVibeKey[];
  vibeBadges: string[];
  placeType: string;
  photoCount: number;
  dishCount: number;
};
