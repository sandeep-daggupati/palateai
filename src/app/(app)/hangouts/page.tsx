'use client';

import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Coffee, Gem, MapPin, Moon, Sparkles, Star, Users } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { SearchControlFilterConfig, SearchControlsCard } from '@/components/controls/SearchControlsCard';
import { HangoutGrid } from '@/components/hangouts/HangoutGrid';
import { HangoutTimeline } from '@/components/hangouts/HangoutTimeline';
import { HangoutCardItem, HangoutCrewMember } from '@/components/hangouts/types';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { Photo, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { HANGOUT_VIBE_OPTIONS, HangoutVibeKey, hangoutVibeLabel, normalizeHangoutVibeTags } from '@/lib/hangouts/vibes';

const LIST_LIMIT = 80;

type RestaurantLookup = {
  id: string;
  name: string;
  address: string | null;
};

type ProfileLookup = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

type EnrichedHangout = HangoutCardItem & {
  crewSearch: string;
  dishSearch: string;
  rawVibeTags: string[];
};

type HangoutViewMode = 'grid' | 'timeline';

type HangoutFilterState = {
  search: string;
  hangoutType: 'all' | 'mine' | 'shared';
  placeType: string[];
  vibe: string[];
};

const HANGOUT_DRAFT_DISH_COUNT_KEY = 'palateai:hangout-draft-visible-dish-count';

const PLACE_TYPE_OPTIONS = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'bar', label: 'Bar' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'home', label: 'Home' },
  { value: 'food_truck', label: 'Food Truck' },
];

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function inferPlaceType(name: string): string {
  const token = normalizeToken(name);
  if (!token || token === 'unknown place') return 'home';
  if (/(truck)/.test(token)) return 'food_truck';
  if (/(dessert|ice cream|gelato|donut|bakery|boba|sweet|cake|froyo)/.test(token)) return 'dessert';
  if (/(bar|pub|tavern|brew|lounge)/.test(token)) return 'bar';
  if (/(cafe|coffee|espresso|tea)/.test(token)) return 'cafe';
  if (/(home|house|apt|apartment)/.test(token)) return 'home';
  return 'restaurant';
}

function vibeIcon(value: HangoutVibeKey) {
  switch (value) {
    case 'quick_bite':
      return <Coffee size={13} strokeWidth={1.5} />;
    case 'go_to_spot':
      return <Star size={13} strokeWidth={1.5} />;
    case 'celebration':
      return <Sparkles size={13} strokeWidth={1.5} />;
    case 'work_hangout':
      return <Briefcase size={13} strokeWidth={1.5} />;
    case 'with_friends':
      return <Users size={13} strokeWidth={1.5} />;
    case 'night_out':
      return <Moon size={13} strokeWidth={1.5} />;
    case 'hidden_gem':
      return <Gem size={13} strokeWidth={1.5} />;
    default:
      return <Sparkles size={13} strokeWidth={1.5} />;
  }
}

function toggleListValue(list: string[], value: string): string[] {
  if (list.includes(value)) return list.filter((entry) => entry !== value);
  return [...list, value];
}

export default function HangoutsPage() {
  const searchParams = useSearchParams();
  const restaurantParam = (searchParams.get('restaurant_id') ?? '').trim();
  const queryParam = (searchParams.get('q') ?? '').trim();

  const [allItems, setAllItems] = useState<EnrichedHangout[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<HangoutViewMode>('grid');
  const [draftDishCountByHangoutId, setDraftDishCountByHangoutId] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<HangoutFilterState>({
    search: queryParam,
    hangoutType: 'all',
    placeType: [],
    vibe: [],
  });

  useEffect(() => {
    setFilters((current) => ({ ...current, search: queryParam }));
  }, [queryParam]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hydrate = () => {
      try {
        const raw = window.localStorage.getItem(HANGOUT_DRAFT_DISH_COUNT_KEY);
        if (!raw) {
          setDraftDishCountByHangoutId({});
          return;
        }
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const next: Record<string, number> = {};
        Object.entries(parsed).forEach(([key, value]) => {
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            next[key] = Math.floor(value);
          }
        });
        setDraftDishCountByHangoutId(next);
      } catch {
        setDraftDishCountByHangoutId({});
      }
    };

    hydrate();
    const onStorage = () => hydrate();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const supabase = getBrowserSupabaseClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setAllItems([]);
        setLoading(false);
        return;
      }

      let ownVisitQuery = supabase
        .from('receipt_uploads')
        .select('id,user_id,restaurant_id,status,is_shared,visited_at,created_at,visit_note,vibe_tags')
        .eq('user_id', user.id)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      if (restaurantParam) ownVisitQuery = ownVisitQuery.eq('restaurant_id', restaurantParam);

      const [{ data: ownVisitRows }, { data: participantRows }] = await Promise.all([
        ownVisitQuery,
        supabase
          .from('visit_participants')
          .select('visit_id,status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .limit(400),
      ]);

      const sharedVisitIds = ((participantRows ?? []) as Array<Pick<VisitParticipant, 'visit_id'>>)
        .map((row) => row.visit_id)
        .filter((value, index, self) => self.indexOf(value) === index);

      let sharedVisitRows: ReceiptUpload[] = [];
      if (sharedVisitIds.length > 0) {
        let sharedQuery = supabase
          .from('receipt_uploads')
          .select('id,user_id,restaurant_id,status,is_shared,visited_at,created_at,visit_note,vibe_tags')
          .in('id', sharedVisitIds)
          .order('visited_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(LIST_LIMIT);

        if (restaurantParam) sharedQuery = sharedQuery.eq('restaurant_id', restaurantParam);

        const { data } = await sharedQuery;
        sharedVisitRows = (data ?? []) as ReceiptUpload[];
      }

      const mergedVisits = [...((ownVisitRows ?? []) as ReceiptUpload[]), ...sharedVisitRows]
        .filter((row, index, self) => self.findIndex((entry) => entry.id === row.id) === index)
        .sort((a, b) => {
          const aDate = new Date(a.visited_at ?? a.created_at).getTime();
          const bDate = new Date(b.visited_at ?? b.created_at).getTime();
          return bDate - aDate;
        });

      if (mergedVisits.length === 0) {
        setAllItems([]);
        setLoading(false);
        return;
      }

      const visitIds = mergedVisits.map((visit) => visit.id);
      const restaurantIds = Array.from(new Set(mergedVisits.map((visit) => visit.restaurant_id).filter((id): id is string => Boolean(id))));

      const [restaurantResult, participantResult, dishResult, photoResult] = await Promise.all([
        restaurantIds.length > 0
          ? supabase.from('restaurants').select('id,name,address').in('id', restaurantIds)
          : Promise.resolve({ data: [] as Pick<Restaurant, 'id' | 'name' | 'address'>[] }),
        supabase
          .from('visit_participants')
          .select('id,visit_id,user_id,invited_email,status')
          .in('visit_id', visitIds)
          .neq('status', 'removed'),
        supabase.from('dish_entries').select('id,hangout_id,source_upload_id,dish_name').in('hangout_id', visitIds),
        supabase
          .from('photos')
          .select('id,hangout_id,storage_thumb,created_at')
          .eq('kind', 'hangout')
          .in('hangout_id', visitIds)
          .order('created_at', { ascending: false }),
      ]);

      const restaurantsById = ((restaurantResult.data ?? []) as Pick<Restaurant, 'id' | 'name' | 'address'>[]).reduce(
        (acc, row) => {
          acc[row.id] = { id: row.id, name: row.name, address: row.address };
          return acc;
        },
        {} as Record<string, RestaurantLookup>,
      );

      const participantRowsFull = (participantResult.data ?? []) as Array<
        Pick<VisitParticipant, 'id' | 'visit_id' | 'user_id' | 'invited_email' | 'status'>
      >;

      const profileIds = Array.from(
        new Set(
          [...participantRowsFull.map((row) => row.user_id), ...mergedVisits.map((visit) => visit.user_id)].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      );

      const profileLookup: Record<string, ProfileLookup> = {};
      if (profileIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id,display_name,avatar_url,email')
          .in('id', profileIds);

        for (const row of (profileRows ?? []) as ProfileLookup[]) {
          profileLookup[row.id] = row;
        }
      }

      const dishRows = ((dishResult.data ?? []) as Array<{ id: string; hangout_id: string | null; source_upload_id: string | null; dish_name?: string | null }>);

      const dishEntryIds = dishRows.map((row) => row.id).filter(Boolean);
      const { data: dishPhotoRowsRaw } =
        dishEntryIds.length > 0
          ? await supabase
              .from('photos')
              .select('id,dish_entry_id,storage_thumb,created_at')
              .eq('kind', 'dish')
              .in('dish_entry_id', dishEntryIds)
              .order('created_at', { ascending: false })
          : { data: [] as Array<Pick<Photo, 'id' | 'dish_entry_id' | 'storage_thumb' | 'created_at'>> };
      const dishPhotoRows = (dishPhotoRowsRaw ?? []) as Array<Pick<Photo, 'id' | 'dish_entry_id' | 'storage_thumb' | 'created_at'>>;

      const dishCountByHangout = dishRows.reduce(
        (acc, row) => {
          if (!row.hangout_id) return acc;
          acc[row.hangout_id] = (acc[row.hangout_id] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const photoRows = (photoResult.data ?? []) as Array<Pick<Photo, 'id' | 'hangout_id' | 'storage_thumb' | 'created_at'>>;
      const photoCountByHangout = photoRows.reduce((acc, row) => {
        if (!row.hangout_id) return acc;
        acc[row.hangout_id] = (acc[row.hangout_id] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const firstPhotoPathByHangout: Record<string, string> = {};
      for (const row of photoRows) {
        if (!row.hangout_id) continue;
        if (!firstPhotoPathByHangout[row.hangout_id]) {
          firstPhotoPathByHangout[row.hangout_id] = row.storage_thumb;
        }
      }

      const hangoutIdByDishEntryId = dishRows.reduce((acc, row) => {
        const hangoutId = row.source_upload_id ?? row.hangout_id;
        if (!hangoutId) return acc;
        acc[row.id] = hangoutId;
        return acc;
      }, {} as Record<string, string>);

      const firstDishPhotoPathByHangout: Record<string, string> = {};
      for (const row of dishPhotoRows) {
        if (!row.dish_entry_id) continue;
        const hangoutId = hangoutIdByDishEntryId[row.dish_entry_id];
        if (!hangoutId) continue;
        if (!firstDishPhotoPathByHangout[hangoutId]) {
          firstDishPhotoPathByHangout[hangoutId] = row.storage_thumb;
        }
      }

      const paths = Array.from(new Set([...Object.values(firstPhotoPathByHangout), ...Object.values(firstDishPhotoPathByHangout)]));
      const signedByPath: Record<string, string> = {};
      if (paths.length > 0) {
        const { data: signedUrls } = await supabase.storage.from('uploads').createSignedUrls(paths, 60 * 20);
        for (let index = 0; index < paths.length; index += 1) {
          const signedUrl = signedUrls?.[index]?.signedUrl;
          if (signedUrl) signedByPath[paths[index]] = signedUrl;
        }
      }

      const crewByVisitId = participantRowsFull.reduce((acc, row) => {
        const key = row.visit_id;
        if (!acc[key]) acc[key] = [];

        const profile = row.user_id ? profileLookup[row.user_id] : null;
        const fallbackFromEmail = row.invited_email?.split('@')[0] ?? profile?.email?.split('@')[0] ?? null;
        const displayName = profile?.display_name || fallbackFromEmail || (row.status === 'invited' ? 'Invite pending' : 'Buddy');

        const member: HangoutCrewMember = {
          id: row.id,
          displayName,
          avatarUrl: profile?.avatar_url ?? null,
          isPending: row.status === 'invited' && !row.user_id,
        };

        acc[key].push(member);
        return acc;
      }, {} as Record<string, HangoutCrewMember[]>);

      const participantCountByVisitId = participantRowsFull.reduce((acc, row) => {
        if (row.status !== 'active') return acc;
        const key = row.visit_id;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const visit of mergedVisits) {
        const hostProfile = profileLookup[visit.user_id];
        const hostFallback = hostProfile?.email?.split('@')[0] ?? 'Organizer';
        const hostName = hostProfile?.display_name || hostFallback;

        if (!crewByVisitId[visit.id]) crewByVisitId[visit.id] = [];
        const alreadyHasHost = crewByVisitId[visit.id].some((member) => normalizeToken(member.displayName) === normalizeToken(hostName));

        if (!alreadyHasHost) {
          crewByVisitId[visit.id].unshift({
            id: `host-${visit.id}`,
            displayName: hostName,
            avatarUrl: hostProfile?.avatar_url ?? null,
            isPending: false,
          });
        }

        // Some rows can miss host participation entries; ensure count includes organizer.
        if (!participantCountByVisitId[visit.id] || participantCountByVisitId[visit.id] < 1) {
          participantCountByVisitId[visit.id] = 1;
        }
      }

      const nextItems = mergedVisits.map((visit) => {
        const restaurant = visit.restaurant_id ? restaurantsById[visit.restaurant_id] : null;
        const restaurantName = restaurant?.name ?? 'Unknown place';
        const address = restaurant?.address ?? null;
        const timestamp = new Date(visit.visited_at ?? visit.created_at).getTime();
        const normalizedTimestamp = Number.isNaN(timestamp) ? 0 : timestamp;
        const vibeKeys = normalizeHangoutVibeTags(visit.vibe_tags);
        const crew = crewByVisitId[visit.id] ?? [];

        return {
          id: visit.id,
          restaurantName,
          address,
          dateLabel: formatDate(visit.visited_at ?? visit.created_at),
          ownershipLabel:
            visit.user_id === user.id
              ? 'Yours'
              : 'Shared',
          isOwnedByCurrentUser: visit.user_id === user.id,
          timestamp: normalizedTimestamp,
          href: `/uploads/${visit.id}`,
          coverPhotoUrl: (() => {
            const bestPath = firstPhotoPathByHangout[visit.id] ?? firstDishPhotoPathByHangout[visit.id] ?? null;
            if (!bestPath) return null;
            return signedByPath[bestPath] ?? null;
          })(),
          participantCount: participantCountByVisitId[visit.id] ?? 1,
          crew,
          vibeKeys,
          vibeBadges: vibeKeys.map(hangoutVibeLabel),
          placeType: inferPlaceType(restaurantName),
          photoCount: photoCountByHangout[visit.id] ?? 0,
          dishCount: dishCountByHangout[visit.id] ?? 0,
          crewSearch: crew.map((member) => normalizeToken(member.displayName)).join(' '),
          dishSearch: dishRows.filter((entry) => entry.hangout_id === visit.id).map((entry) => normalizeToken(entry.dish_name ?? '')).join(' '),
          rawVibeTags: Array.isArray(visit.vibe_tags) ? visit.vibe_tags.filter((value): value is string => typeof value === 'string') : [],
        } satisfies EnrichedHangout;
      });

      setAllItems(nextItems);
      setLoading(false);
    };

    void load();
  }, [restaurantParam]);

  const filterConfigs = useMemo<SearchControlFilterConfig[]>(() => {
    return [
      {
        key: 'hangout-type',
        label: 'Hangout Type',
        icon: <Users size={12} className="text-app-muted" />,
        options: [
          { value: 'all', label: 'All' },
          { value: 'mine', label: 'Mine' },
          { value: 'shared', label: 'Shared with me' },
        ],
        selectedValues: [filters.hangoutType],
        onToggle: (value) =>
          setFilters((current) => ({
            ...current,
            hangoutType: value === 'mine' || value === 'shared' ? value : 'all',
          })),
      },
      {
        key: 'place',
        label: 'Place',
        icon: <MapPin size={12} className="text-app-muted" />,
        options: PLACE_TYPE_OPTIONS,
        selectedValues: filters.placeType,
        onToggle: (value) => setFilters((current) => ({ ...current, placeType: toggleListValue(current.placeType, value) })),
      },
      {
        key: 'vibe',
        label: 'Vibe',
        icon: <Sparkles size={12} className="text-app-muted" />,
        options: HANGOUT_VIBE_OPTIONS.map((option) => ({ value: option.key, label: option.label, icon: vibeIcon(option.key) })),
        selectedValues: filters.vibe,
        onToggle: (value) => setFilters((current) => ({ ...current, vibe: toggleListValue(current.vibe, value) })),
      },
    ];
  }, [filters.hangoutType, filters.placeType, filters.vibe]);

  const itemsWithDraftCounts = useMemo(
    () =>
      allItems.map((item) => ({
        ...item,
        dishCount: Math.max(item.dishCount, draftDishCountByHangoutId[item.id] ?? 0),
      })),
    [allItems, draftDishCountByHangoutId],
  );

  const filteredItems = useMemo(() => {
    const textQuery = normalizeToken(filters.search);

    return itemsWithDraftCounts
      .filter((item) => {
        const searchMatch =
          !textQuery ||
          normalizeToken(item.restaurantName).includes(textQuery) ||
          normalizeToken(item.address).includes(textQuery) ||
          item.crewSearch.includes(textQuery) ||
          item.dishSearch.includes(textQuery);

        const placeTypeMatch = filters.placeType.length === 0 || filters.placeType.includes(item.placeType);
        const vibeMatch = filters.vibe.length === 0 || filters.vibe.some((value) => item.vibeKeys.includes(value as HangoutVibeKey));
        const hangoutTypeMatch =
          filters.hangoutType === 'all' ||
          (filters.hangoutType === 'mine' && item.isOwnedByCurrentUser) ||
          (filters.hangoutType === 'shared' && !item.isOwnedByCurrentUser);

        return searchMatch && placeTypeMatch && vibeMatch && hangoutTypeMatch;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [filters, itemsWithDraftCounts]);

  const hasActiveFilters =
    Boolean(filters.search.trim()) || filters.placeType.length > 0 || filters.vibe.length > 0 || filters.hangoutType !== 'all';

  return (
    <div className="space-y-3 pb-5">
      <SearchControlsCard
        view={view}
        onViewChange={(next) => setView(next as HangoutViewMode)}
        searchValue={filters.search}
        onSearchChange={(next) => setFilters((current) => ({ ...current, search: next }))}
        searchPlaceholder="Search places, people, or dishes"
        filters={filterConfigs}
        hasActiveFilters={hasActiveFilters}
        onClearAll={() =>
          setFilters({
            search: '',
            hangoutType: 'all',
            placeType: [],
            vibe: [],
          })
        }
      />

      {loading ? (
        <p className="empty-surface">Loading hangouts...</p>
      ) : view === 'grid' ? (
        <HangoutGrid items={filteredItems} />
      ) : (
        <HangoutTimeline items={filteredItems} />
      )}
    </div>
  );
}
