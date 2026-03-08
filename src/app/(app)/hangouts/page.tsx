'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { HangoutFilters, HangoutFilterState } from '@/components/hangouts/HangoutFilters';
import { HangoutGrid } from '@/components/hangouts/HangoutGrid';
import { HangoutTimeline } from '@/components/hangouts/HangoutTimeline';
import { HangoutCardItem, HangoutCrewMember } from '@/components/hangouts/types';
import { HangoutViewMode, HangoutViewToggle } from '@/components/hangouts/HangoutViewToggle';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { Photo, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';

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
};

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
    year: 'numeric',
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

function normalizeVibes(raw: string[] | null): string[] {
  const source = (raw ?? []).map((value) => normalizeToken(value));
  const mapped = new Set<string>();

  for (const tag of source) {
    if (!tag) continue;
    if (tag.includes('hidden')) mapped.add('hidden_gem');
    if (tag.includes('go-to') || tag.includes('go to') || tag.includes('repeat')) mapped.add('go_to');
    if (tag.includes('celebrat') || tag.includes('birthday')) mapped.add('celebration');
    if (tag.includes('casual') || tag.includes('quick')) mapped.add('casual');
    if (tag.includes('fancy') || tag.includes('date night')) mapped.add('fancy');
    if (tag.includes('late')) mapped.add('late_night');
  }

  return Array.from(mapped);
}

function vibeLabel(value: string): string {
  switch (value) {
    case 'hidden_gem':
      return 'Hidden Gem';
    case 'go_to':
      return 'Go-To';
    case 'celebration':
      return 'Celebration';
    case 'casual':
      return 'Casual';
    case 'fancy':
      return 'Fancy';
    case 'late_night':
      return 'Late Night';
    default:
      return value;
  }
}

export default function HangoutsPage() {
  const searchParams = useSearchParams();
  const restaurantParam = (searchParams.get('restaurant_id') ?? '').trim();
  const queryParam = (searchParams.get('q') ?? '').trim();

  const [allItems, setAllItems] = useState<EnrichedHangout[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<HangoutViewMode>('grid');
  const [filters, setFilters] = useState<HangoutFilterState>({
    search: queryParam,
    crew: 'all',
    placeType: 'all',
    vibe: 'all',
  });

  useEffect(() => {
    setFilters((current) => ({ ...current, search: queryParam }));
  }, [queryParam]);

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
        supabase.from('dish_entries').select('id,hangout_id,dish_name').eq('user_id', user.id).in('hangout_id', visitIds),
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

      const profileIds = Array.from(new Set(participantRowsFull.map((row) => row.user_id).filter((id): id is string => Boolean(id))));

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

      const dishRows = ((dishResult.data ?? []) as Array<{ id: string; hangout_id: string | null; dish_name?: string | null }>);

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

      const paths = Object.values(firstPhotoPathByHangout);
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

      const nextItems = mergedVisits.map((visit) => {
        const restaurant = visit.restaurant_id ? restaurantsById[visit.restaurant_id] : null;
        const restaurantName = restaurant?.name ?? 'Unknown place';
        const address = restaurant?.address ?? null;
        const timestamp = new Date(visit.visited_at ?? visit.created_at).getTime();
        const normalizedTimestamp = Number.isNaN(timestamp) ? 0 : timestamp;
        const normalizedVibes = normalizeVibes(visit.vibe_tags);
        const crew = crewByVisitId[visit.id] ?? [];

        return {
          id: visit.id,
          restaurantName,
          address,
          dateLabel: formatDate(visit.visited_at ?? visit.created_at),
          timestamp: normalizedTimestamp,
          href: `/uploads/${visit.id}`,
          coverPhotoUrl: firstPhotoPathByHangout[visit.id] ? signedByPath[firstPhotoPathByHangout[visit.id]] ?? null : null,
          crew,
          vibeBadges: normalizedVibes.length > 0 ? normalizedVibes.map(vibeLabel) : ['Casual'],
          placeType: inferPlaceType(restaurantName),
          photoCount: photoCountByHangout[visit.id] ?? 0,
          dishCount: dishCountByHangout[visit.id] ?? 0,
          crewSearch: crew.map((member) => normalizeToken(member.displayName)).join(' '),
          dishSearch: dishRows.filter((entry) => entry.hangout_id === visit.id).map((entry) => normalizeToken(entry.dish_name ?? '')).join(' '),
        } satisfies EnrichedHangout;
      });

      setAllItems(nextItems);
      setLoading(false);
    };

    void load();
  }, [restaurantParam]);

  const crewOptions = useMemo(() => {
    const values = Array.from(
      new Set(
        allItems
          .flatMap((item) => item.crew)
          .map((member) => member.displayName)
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return [{ value: 'all', label: 'All' }, ...values.map((value) => ({ value: normalizeToken(value), label: value }))];
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const textQuery = normalizeToken(filters.search);

    return allItems
      .filter((item) => {
        const searchMatch =
          !textQuery ||
          normalizeToken(item.restaurantName).includes(textQuery) ||
          normalizeToken(item.address).includes(textQuery) ||
          item.crewSearch.includes(textQuery) ||
          item.dishSearch.includes(textQuery);

        const crewMatch = filters.crew === 'all' || item.crew.some((member) => normalizeToken(member.displayName) === filters.crew);
        const placeTypeMatch = filters.placeType === 'all' || item.placeType === filters.placeType;
        const vibeMatch =
          filters.vibe === 'all' ||
          item.vibeBadges.some((badge) => normalizeToken(badge).replace(/\s+/g, '_') === filters.vibe);

        return searchMatch && crewMatch && placeTypeMatch && vibeMatch;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [allItems, filters]);

  return (
    <div className="space-y-3 pb-5">
      <section className="card-surface space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">Hangouts</h1>
          <Link href="/" className="text-xs font-medium text-app-link">
            Back to Home
          </Link>
        </div>
        <p className="text-sm text-app-muted">Shared food memories with your crew.</p>
      </section>

      <div className="flex items-center justify-between gap-2">
        <HangoutViewToggle view={view} onChange={setView} />
      </div>

      <HangoutFilters
        state={filters}
        onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
        crewOptions={crewOptions}
        onClear={() =>
          setFilters({
            search: '',
            crew: 'all',
            placeType: 'all',
            vibe: 'all',
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

