'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FilterChips } from '@/components/FilterChips';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { Hangout, HangoutParticipant, Restaurant } from '@/lib/supabase/types';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';

const LIST_LIMIT = 30;

const ACTIVITY_FILTER_OPTIONS: Array<{ label: string; value: 'all' | 'mine' | 'with_me' }> = [
  { label: 'All', value: 'all' },
  { label: 'Mine', value: 'mine' },
  { label: 'With me', value: 'with_me' },
];

type RestaurantLookup = {
  name: string;
  address: string | null;
  place_id: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sortByVisitDateDesc(a: Hangout, b: Hangout) {
  const aDate = new Date(a.occurred_at ?? a.created_at).getTime();
  const bDate = new Date(b.occurred_at ?? b.created_at).getTime();
  return bDate - aDate;
}

export default function HangoutsPage() {
  const searchParams = useSearchParams();
  const restaurantParam = (searchParams.get('restaurant_id') ?? '').trim();
  const queryParam = (searchParams.get('q') ?? '').trim().toLowerCase();

  const [visits, setVisits] = useState<Hangout[]>([]);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [activityFilter, setActivityFilter] = useState<'all' | 'mine' | 'with_me'>('all');

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setVisits([]);
        setParticipantCounts({});
        setRestaurantsById({});
        return;
      }

      let ownVisitQuery = supabase.from('hangouts').select('*').eq('owner_user_id', user.id).order('occurred_at', { ascending: false }).limit(LIST_LIMIT);

      if (restaurantParam) {
        ownVisitQuery = ownVisitQuery.eq('restaurant_id', restaurantParam);
      }

      const [{ data: ownVisitRows }, { data: participantRows }] = await Promise.all([
        ownVisitQuery,
        supabase
          .from('hangout_participants')
          .select('hangout_id')
          .eq('user_id', user.id)
          .limit(300),
      ]);

      const participantVisitIds = ((participantRows ?? []) as Pick<HangoutParticipant, 'hangout_id'>[])
        .map((row) => row.hangout_id)
        .filter((value, index, self) => self.indexOf(value) === index);

      let sharedVisitRows: Hangout[] = [];
      if (participantVisitIds.length > 0) {
        let sharedVisitQuery = supabase
          .from('hangouts')
          .select('*')
          .in('id', participantVisitIds)
          .order('occurred_at', { ascending: false })
          .limit(LIST_LIMIT);

        if (restaurantParam) {
          sharedVisitQuery = sharedVisitQuery.eq('restaurant_id', restaurantParam);
        }

        const { data: sharedRows } = await sharedVisitQuery;
        sharedVisitRows = (sharedRows ?? []) as Hangout[];
      }

      let mergedVisits = [...((ownVisitRows ?? []) as Hangout[]), ...sharedVisitRows]
        .filter((row, index, self) => self.findIndex((entry) => entry.id === row.id) === index)
        .sort(sortByVisitDateDesc);

      if (activityFilter === 'mine') {
        mergedVisits = mergedVisits.filter((row) => row.owner_user_id === user.id);
      }
      if (activityFilter === 'with_me') {
        mergedVisits = mergedVisits.filter((row) => row.owner_user_id !== user.id);
      }

      const restaurantIds = Array.from(new Set(mergedVisits.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));
      const hangoutIds = mergedVisits.map((row) => row.id);

      const countMap: Record<string, number> = {};
      if (hangoutIds.length > 0) {
        const { data: allParticipants } = await supabase.from('hangout_participants').select('hangout_id,user_id').in('hangout_id', hangoutIds).limit(1000);
        for (const row of (allParticipants ?? []) as Array<Pick<HangoutParticipant, 'hangout_id' | 'user_id'>>) {
          countMap[row.hangout_id] = (countMap[row.hangout_id] ?? 0) + 1;
        }
      }

      let restaurantLookup: Record<string, RestaurantLookup> = {};
      if (restaurantIds.length > 0) {
        const { data: restaurantRows } = await supabase.from('restaurants').select('id,name,address,place_id').in('id', restaurantIds);

        restaurantLookup = ((restaurantRows ?? []) as Pick<Restaurant, 'id' | 'name' | 'address' | 'place_id'>[]).reduce(
          (acc, row) => {
            acc[row.id] = {
              name: row.name,
              address: row.address,
              place_id: row.place_id,
            };
            return acc;
          },
          {} as Record<string, RestaurantLookup>,
        );
      }

      setVisits(mergedVisits);
      setParticipantCounts(countMap);
      setRestaurantsById(restaurantLookup);
    };

    void load();
  }, [activityFilter, restaurantParam]);

  const filteredRows = useMemo(() => {
    const base = visits.map((visit) => {
      const restaurantName = visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.name ?? 'Unknown place' : 'Unknown place';
      const address = visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.address ?? null : null;
      const placeId = visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.place_id ?? null : null;

      return {
        ...visit,
        restaurantName,
        address,
        placeId,
        dateLabel: formatDate(visit.occurred_at ?? visit.created_at),
        withCount: participantCounts[visit.id] ?? 1,
        directionsHref: getGoogleMapsLink(placeId, address, restaurantName),
      };
    });

    if (!queryParam) return base;
    return base.filter((row) => row.restaurantName.toLowerCase().includes(queryParam));
  }, [participantCounts, queryParam, restaurantsById, visits]);

  return (
    <div className="space-y-3 pb-6">
      <section className="card-surface space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">Hangouts</h1>
          <Link href="/" className="text-xs font-medium text-app-link">
            Back to Home
          </Link>
        </div>
        <p className="text-sm text-app-muted">Full activity with status filters.</p>
      </section>

      <section className="space-y-2">
        <FilterChips options={ACTIVITY_FILTER_OPTIONS} selected={activityFilter} onChange={setActivityFilter} />
        {filteredRows.length === 0 ? (
          <p className="empty-surface">No hangouts yet.</p>
        ) : (
          <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
            {filteredRows.map((visit) => (
              <Link key={visit.id} href={`/uploads/${visit.id}`} className="block px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-medium text-app-text">{visit.restaurantName}</p>
                  <p className="text-xs text-app-muted">With {visit.withCount}</p>
                </div>
                {visit.address && <p className="text-xs text-app-muted">{visit.address}</p>}
                <p className="text-xs text-app-muted">{visit.dateLabel}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}




