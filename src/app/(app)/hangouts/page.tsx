'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FilterChips } from '@/components/FilterChips';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { ReceiptUpload, ReceiptUploadStatus, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';

const LIST_LIMIT = 30;

const ACTIVITY_FILTER_OPTIONS: Array<{ label: string; value: 'all' | ReceiptUploadStatus }> = [
  { label: 'All', value: 'all' },
  { label: 'Needs review', value: 'needs_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Processing', value: 'processing' },
  { label: 'Failed', value: 'failed' },
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

function sortByVisitDateDesc(a: ReceiptUpload, b: ReceiptUpload) {
  const aDate = new Date(a.visited_at ?? a.created_at).getTime();
  const bDate = new Date(b.visited_at ?? b.created_at).getTime();
  return bDate - aDate;
}

export default function HangoutsPage() {
  const searchParams = useSearchParams();
  const restaurantParam = (searchParams.get('restaurant_id') ?? '').trim();
  const queryParam = (searchParams.get('q') ?? '').trim().toLowerCase();

  const [visits, setVisits] = useState<ReceiptUpload[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [activityFilter, setActivityFilter] = useState<'all' | ReceiptUploadStatus>('all');

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setVisits([]);
        setRestaurantsById({});
        return;
      }

      let ownVisitQuery = supabase
        .from('receipt_uploads')
        .select('id,user_id,restaurant_id,status,visited_at,created_at,visit_note')
        .eq('user_id', user.id)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      if (activityFilter !== 'all') {
        ownVisitQuery = ownVisitQuery.eq('status', activityFilter);
      }

      if (restaurantParam) {
        ownVisitQuery = ownVisitQuery.eq('restaurant_id', restaurantParam);
      }

      const [{ data: ownVisitRows }, { data: participantRows }] = await Promise.all([
        ownVisitQuery,
        supabase
          .from('visit_participants')
          .select('visit_id,status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .limit(300),
      ]);

      const participantVisitIds = ((participantRows ?? []) as Pick<VisitParticipant, 'visit_id' | 'status'>[])
        .map((row) => row.visit_id)
        .filter((value, index, self) => self.indexOf(value) === index);

      let sharedVisitRows: ReceiptUpload[] = [];
      if (participantVisitIds.length > 0) {
        let sharedVisitQuery = supabase
          .from('receipt_uploads')
          .select('id,user_id,restaurant_id,status,visited_at,created_at,visit_note')
          .in('id', participantVisitIds)
          .order('visited_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(LIST_LIMIT);

        if (activityFilter !== 'all') {
          sharedVisitQuery = sharedVisitQuery.eq('status', activityFilter);
        }

        if (restaurantParam) {
          sharedVisitQuery = sharedVisitQuery.eq('restaurant_id', restaurantParam);
        }

        const { data: sharedRows } = await sharedVisitQuery;
        sharedVisitRows = (sharedRows ?? []) as ReceiptUpload[];
      }

      const mergedVisits = [...((ownVisitRows ?? []) as ReceiptUpload[]), ...sharedVisitRows]
        .filter((row, index, self) => self.findIndex((entry) => entry.id === row.id) === index)
        .sort(sortByVisitDateDesc);

      const restaurantIds = Array.from(new Set(mergedVisits.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));

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
      setRestaurantsById(restaurantLookup);
    };

    void load();
  }, [activityFilter, restaurantParam]);

  const filteredRows = useMemo(() => {
    const base = visits.map((visit) => ({
      ...visit,
      restaurantName: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
      address: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.address ?? null : null,
      placeId: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.place_id ?? null : null,
      dateLabel: formatDate(visit.visited_at ?? visit.created_at),
      directionsHref: getGoogleMapsLink(visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.place_id ?? null : null, visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.address ?? null : null),
    }));

    if (!queryParam) return base;
    return base.filter((row) => row.restaurantName.toLowerCase().includes(queryParam));
  }, [queryParam, restaurantsById, visits]);

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
                  <StatusChip status={visit.status} />
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



