export type SignedPhoto = {
  id: string;
  kind: 'hangout' | 'dish';
  hangout_id: string | null;
  dish_entry_id: string | null;
  created_at: string;
  signedUrls: {
    thumb: string | null;
    medium: string | null;
    original: string | null;
  };
};
