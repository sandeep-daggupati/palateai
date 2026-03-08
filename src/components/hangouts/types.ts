export type HangoutVibeKey = 'hidden_gem' | 'go_to' | 'celebration' | 'casual' | 'fancy' | 'late_night';

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
  timestamp: number;
  href: string;
  coverPhotoUrl: string | null;
  crew: HangoutCrewMember[];
  vibeKeys: HangoutVibeKey[];
  vibeBadges: string[];
  placeType: string;
  photoCount: number;
  dishCount: number;
};
