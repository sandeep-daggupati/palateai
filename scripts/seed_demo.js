/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');

const DEMO_SEED_ENABLED = (process.env.DEMO_SEED_ENABLED || '').toLowerCase() === 'true';
const DEMO_SEED_TAG = (process.env.DEMO_SEED_TAG || '').trim();
const DEMO_USER_ID = (process.env.DEMO_USER_ID || '').trim();
const BUDDY_USER_IDS = (process.env.BUDDY_USER_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const ALLOW_PROD_SEED = (process.env.ALLOW_PROD_SEED || '').toLowerCase() === 'true';
const NODE_ENV = process.env.NODE_ENV || 'development';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const DEMO_EMAIL_FALLBACK = process.env.DEMO_USER_EMAIL || 'demo@palateai.local';

const RESTAURANTS = [
  { name: 'Popeyes', place_id: 'demo-popeyes', address: '14 Canal St, New York, NY' },
  { name: 'Tomo Sushi', place_id: 'demo-tomo-sushi', address: '225 W 46th St, New York, NY' },
  { name: 'Joe\'s Pizza', place_id: 'demo-joes-pizza', address: '7 Carmine St, New York, NY' },
  { name: 'K-BBQ House', place_id: 'demo-kbbq-house', address: '32 W 32nd St, New York, NY' },
  { name: 'Sweetgreen', place_id: 'demo-sweetgreen', address: '50 Astor Pl, New York, NY' },
  { name: 'Chipotle', place_id: 'demo-chipotle', address: '864 Broadway, New York, NY' },
  { name: 'Los Tacos No. 1', place_id: 'demo-los-tacos', address: '75 9th Ave, New York, NY' },
  { name: 'Shake Shack', place_id: 'demo-shake-shack', address: 'Madison Ave & E.23rd St, New York, NY' },
  { name: 'Xi\'an Famous Foods', place_id: 'demo-xian-foods', address: '24 W 45th St, New York, NY' },
  { name: 'Dig', place_id: 'demo-dig', address: '856 Lexington Ave, New York, NY' },
];

const MENU_BY_RESTAURANT = {
  Popeyes: [
    { dish_name: 'Spicy Chicken Sandwich', price: 6.99 },
    { dish_name: 'Chicken Tenders', price: 7.99 },
    { dish_name: 'Cajun Fries', price: 3.59 },
    { dish_name: 'Chicken Nuggets', price: 4.99 },
    { dish_name: 'Mac and Cheese', price: 4.29 },
  ],
  'Tomo Sushi': [
    { dish_name: 'Spicy Tuna Roll', price: 8.5 },
    { dish_name: 'Salmon Avocado Roll', price: 9.25 },
    { dish_name: 'Miso Soup', price: 3.0 },
    { dish_name: 'Gyoza', price: 6.5 },
    { dish_name: 'Chirashi Bowl', price: 18.5 },
  ],
  'Joe\'s Pizza': [
    { dish_name: 'Pepperoni Slice', price: 4.25 },
    { dish_name: 'Margherita Slice', price: 4.0 },
    { dish_name: 'Garlic Knots', price: 3.5 },
    { dish_name: 'Sicilian Slice', price: 4.75 },
  ],
  'K-BBQ House': [
    { dish_name: 'Bulgogi Plate', price: 19.0 },
    { dish_name: 'Kimchi Pancake', price: 12.0 },
    { dish_name: 'Spicy Pork Belly', price: 21.0 },
    { dish_name: 'Steamed Rice', price: 2.5 },
  ],
  Sweetgreen: [
    { dish_name: 'Harvest Bowl', price: 14.5 },
    { dish_name: 'Chicken Pesto Parm', price: 15.25 },
    { dish_name: 'Shroomami Bowl', price: 13.9 },
  ],
  Chipotle: [
    { dish_name: 'Chicken Burrito Bowl', price: 12.75 },
    { dish_name: 'Steak Burrito', price: 13.95 },
    { dish_name: 'Chips and Guac', price: 5.25 },
  ],
  'Los Tacos No. 1': [
    { dish_name: 'Adobada Taco', price: 4.75 },
    { dish_name: 'Carne Asada Taco', price: 5.15 },
    { dish_name: 'Nopal Taco', price: 4.25 },
    { dish_name: 'Horchata', price: 3.5 },
  ],
  'Shake Shack': [
    { dish_name: 'ShackBurger', price: 8.95 },
    { dish_name: 'Chicken Bites', price: 6.5 },
    { dish_name: 'Crinkle Cut Fries', price: 4.25 },
    { dish_name: 'Vanilla Shake', price: 6.95 },
  ],
  'Xi\'an Famous Foods': [
    { dish_name: 'Spicy Cumin Lamb Noodles', price: 14.5 },
    { dish_name: 'Liang Pi Cold Skin Noodles', price: 11.95 },
    { dish_name: 'Stewed Pork Burger', price: 7.5 },
  ],
  Dig: [
    { dish_name: 'Herb Roasted Chicken Plate', price: 15.75 },
    { dish_name: 'Mac and Cheese Side', price: 4.5 },
    { dish_name: 'Roasted Sweet Potatoes', price: 4.0 },
  ],
};

function assertGuardrails() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SECRET_KEY.');
  }

  if (!DEMO_SEED_ENABLED) {
    throw new Error('DEMO_SEED_ENABLED must be true to run the demo seed.');
  }

  if (!DEMO_SEED_TAG) {
    throw new Error('DEMO_SEED_TAG is required. Example: DEMO_SEED_TAG=demo_seed_v1');
  }

  if (!DEMO_USER_ID) {
    throw new Error(
      [
        'DEMO_USER_ID is required.',
        'Create demo users once in Supabase Auth (dashboard or admin), then copy their UUID(s) into env:',
        '- DEMO_USER_ID=<demo-user-uuid>',
        '- BUDDY_USER_IDS=<buddy-uuid-1,buddy-uuid-2> (optional)',
      ].join('\n'),
    );
  }

  if (NODE_ENV === 'production' && !ALLOW_PROD_SEED) {
    throw new Error('Refusing to seed with NODE_ENV=production. Set ALLOW_PROD_SEED=true to override intentionally.');
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function dateDaysAgo(daysAgo, hour = 19) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hour, 15, 0, 0);
  return date.toISOString();
}

function pickStatus(index) {
  if (index % 13 === 0) return 'needs_review';
  if (index % 17 === 0) return 'processing';
  return 'approved';
}

function identityTagAt(index) {
  const pattern = [
    'go_to', 'go_to', 'go_to', 'go_to',
    'hidden_gem',
    null,
    'try_again', 'try_again',
    null,
    null,
    'never_again',
    null,
  ];
  return pattern[index % pattern.length];
}

function emailPrefix(value) {
  if (!value) return 'demo-user';
  const prefix = value.split('@')[0];
  return prefix && prefix.trim().length > 0 ? prefix.trim() : 'demo-user';
}

async function getUserByIdOrFail(admin, id, label) {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data.user) {
    throw new Error(`Unable to resolve ${label} by id ${id}: ${error ? error.message : 'not found'}`);
  }
  return data.user;
}

async function upsertProfiles(admin, users) {
  const rows = users.map((user) => {
    const metadata = user.user_metadata || {};
    const fullName = typeof metadata.full_name === 'string' && metadata.full_name.trim().length > 0
      ? metadata.full_name.trim()
      : emailPrefix(user.email);

    return {
      id: user.id,
      display_name: fullName,
      avatar_url: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
      email: user.email ? user.email.toLowerCase() : null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await admin.from('profiles').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Failed to upsert profiles: ${error.message}`);
}

async function checkedDelete(queryPromise, label) {
  const { error } = await queryPromise;
  if (error) {
    throw new Error(`Failed to delete ${label}: ${error.message}`);
  }
}

async function wipeSeedData(admin, demoUserId) {
  console.log(`Wiping seed data for user ${demoUserId} (seed_tag=${DEMO_SEED_TAG})...`);

  const { data: uploads, error: uploadSelectError } = await admin
    .from('receipt_uploads')
    .select('id')
    .eq('user_id', demoUserId)
    .eq('seed_tag', DEMO_SEED_TAG);

  if (uploadSelectError) {
    throw new Error(`Failed to fetch seeded uploads for wipe: ${uploadSelectError.message}`);
  }

  const uploadIds = (uploads || []).map((row) => row.id);

  // Delete in strict dependency order.
  if (uploadIds.length > 0) {
    await checkedDelete(
      admin.from('extracted_line_items').delete().in('upload_id', uploadIds).eq('seed_tag', DEMO_SEED_TAG),
      'extracted_line_items',
    );

    await checkedDelete(
      admin.from('visit_participants').delete().in('visit_id', uploadIds).eq('seed_tag', DEMO_SEED_TAG),
      'visit_participants',
    );

    await checkedDelete(
      admin.from('dish_entries').delete().in('source_upload_id', uploadIds).eq('seed_tag', DEMO_SEED_TAG),
      'dish_entries',
    );
  }

  await checkedDelete(admin.from('daily_insights').delete().eq('user_id', demoUserId), 'daily_insights');
  await checkedDelete(
    admin.from('receipt_uploads').delete().eq('user_id', demoUserId).eq('seed_tag', DEMO_SEED_TAG),
    'receipt_uploads',
  );
}

function buildHangoutPlan() {
  const recentOffsets = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13];
  const midOffsets = [15, 18, 21, 24, 28, 32, 36, 40, 44, 48, 54, 60];
  const oldOffsets = [63, 68, 72, 76, 82, 88];
  const offsets = [...recentOffsets, ...midOffsets, ...oldOffsets];

  const restaurantOrder = [
    'Popeyes', 'Popeyes', 'Popeyes', 'Popeyes', 'Popeyes',
    'Joe\'s Pizza', 'Sweetgreen', 'Chipotle', 'Shake Shack', 'Los Tacos No. 1', 'Tomo Sushi', 'Dig',
    'Tomo Sushi', 'K-BBQ House', 'Joe\'s Pizza', 'Xi\'an Famous Foods', 'Tomo Sushi', 'Shake Shack',
    'Chipotle', 'Dig', 'Los Tacos No. 1', 'Joe\'s Pizza', 'Tomo Sushi', 'Sweetgreen',
    'Xi\'an Famous Foods', 'Dig', 'Shake Shack', 'Los Tacos No. 1', 'Chipotle', 'Sweetgreen',
  ];

  return offsets.map((daysAgo, index) => ({
    daysAgo,
    restaurantName: restaurantOrder[index % restaurantOrder.length],
    status: pickStatus(index),
    shareThis: index % 7 === 0 || index % 11 === 0,
  }));
}

function pickMenuItems(restaurantName, hangoutIndex) {
  const menu = MENU_BY_RESTAURANT[restaurantName] || MENU_BY_RESTAURANT.Popeyes;
  const itemCount = 3 + (hangoutIndex % 5);
  const uniqueCount = Math.min(itemCount, menu.length);

  const items = [];
  for (let i = 0; i < uniqueCount; i += 1) {
    const menuItem = menu[(hangoutIndex + i) % menu.length];
    const qtyBoost = hangoutIndex % 5 === 0 && i === 0;
    const quantity = qtyBoost ? 2 : 1;
    const includePrice = !(hangoutIndex % 9 === 0 && i === uniqueCount - 1);

    items.push({
      dish_name: menuItem.dish_name,
      quantity,
      unit_price: includePrice ? Number((menuItem.price + ((hangoutIndex % 3) * 0.15)).toFixed(2)) : null,
    });
  }

  return items;
}

async function seedRestaurants(admin, demoUserId) {
  const payload = RESTAURANTS.map((restaurant) => ({
    user_id: demoUserId,
    name: restaurant.name,
    place_id: restaurant.place_id,
    address: restaurant.address,
    seed_tag: DEMO_SEED_TAG,
  }));

  const { error: upsertError } = await admin.from('restaurants').upsert(payload, { onConflict: 'user_id,place_id' });
  if (upsertError) throw new Error(`Failed to seed restaurants: ${upsertError.message}`);

  const { data: rows, error: selectError } = await admin
    .from('restaurants')
    .select('id,name')
    .eq('user_id', demoUserId)
    .in('place_id', RESTAURANTS.map((r) => r.place_id));

  if (selectError) throw new Error(`Failed to read seeded restaurants: ${selectError.message}`);

  const map = new Map();
  for (const row of rows || []) {
    map.set(row.name, row.id);
  }
  return map;
}

async function seedHangoutsAndEntries(admin, demoUser, buddies, restaurantMap) {
  const plan = buildHangoutPlan();

  const uploadRows = [];
  const extractedRows = [];
  const dishRows = [];
  const participantRows = [];

  let dishCounter = 0;

  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    const uploadId = randomUUID();
    const visitedAt = dateDaysAgo(step.daysAgo, 18 + (i % 3));
    const restaurantId = restaurantMap.get(step.restaurantName) || null;

    uploadRows.push({
      id: uploadId,
      user_id: demoUser.id,
      restaurant_id: restaurantId,
      status: step.status,
      type: 'receipt',
      image_paths: [],
      currency_detected: 'USD',
      visited_at: visitedAt,
      visit_note: i % 4 === 0 ? 'Great crew energy and solid picks.' : null,
      is_shared: step.shareThis,
      share_visibility: 'private',
      seed_tag: DEMO_SEED_TAG,
    });

    const items = pickMenuItems(step.restaurantName, i);

    for (const item of items) {
      const unitPrice = item.unit_price;

      extractedRows.push({
        id: randomUUID(),
        upload_id: uploadId,
        name_raw: item.dish_name,
        name_final: item.dish_name,
        price_raw: unitPrice,
        price_final: unitPrice,
        included: true,
        quantity: item.quantity,
        unit_price: unitPrice,
        grouped: item.quantity > 1,
        seed_tag: DEMO_SEED_TAG,
      });

      const hadIt = dishCounter % 9 !== 0;
      dishRows.push({
        id: randomUUID(),
        user_id: demoUser.id,
        restaurant_id: restaurantId,
        dish_name: item.dish_name,
        price_original: unitPrice,
        currency_original: 'USD',
        price_usd: unitPrice,
        quantity: item.quantity,
        eaten_at: visitedAt,
        source_upload_id: uploadId,
        dish_key: slugify(`${step.restaurantName}-${item.dish_name}`),
        identity_tag: identityTagAt(dishCounter),
        rating: hadIt ? ((dishCounter % 5) + 1) : null,
        comment: hadIt && dishCounter % 6 === 0 ? 'Would order again with friends.' : null,
        had_it: hadIt,
        seed_tag: DEMO_SEED_TAG,
      });

      dishCounter += 1;
    }

    if (step.shareThis && buddies.length > 0) {
      participantRows.push({
        id: randomUUID(),
        visit_id: uploadId,
        user_id: demoUser.id,
        role: 'host',
        invited_email: null,
        status: 'active',
        seed_tag: DEMO_SEED_TAG,
      });

      const buddyA = buddies[i % buddies.length];
      participantRows.push({
        id: randomUUID(),
        visit_id: uploadId,
        user_id: buddyA.id,
        role: 'participant',
        invited_email: null,
        status: 'active',
        seed_tag: DEMO_SEED_TAG,
      });

      if (i % 2 === 0 && buddies[1]) {
        participantRows.push({
          id: randomUUID(),
          visit_id: uploadId,
          user_id: buddies[1].id,
          role: 'participant',
          invited_email: null,
          status: 'active',
          seed_tag: DEMO_SEED_TAG,
        });
      }
    }
  }

  const { error: uploadError } = await admin.from('receipt_uploads').insert(uploadRows);
  if (uploadError) throw new Error(`Failed to insert receipt_uploads: ${uploadError.message}`);

  const { error: extractedError } = await admin.from('extracted_line_items').insert(extractedRows);
  if (extractedError) throw new Error(`Failed to insert extracted_line_items: ${extractedError.message}`);

  const { error: dishError } = await admin.from('dish_entries').insert(dishRows);
  if (dishError) throw new Error(`Failed to insert dish_entries: ${dishError.message}`);

  if (participantRows.length > 0) {
    const { error: participantError } = await admin.from('visit_participants').insert(participantRows);
    if (participantError) throw new Error(`Failed to insert visit_participants: ${participantError.message}`);
  }

  return {
    uploads: uploadRows.length,
    extracted: extractedRows.length,
    dishEntries: dishRows.length,
    participants: participantRows.length,
  };
}

async function main() {
  assertGuardrails();

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const wipeOnly = process.argv.includes('--wipe');

  const demoUser = await getUserByIdOrFail(admin, DEMO_USER_ID, 'demo user');
  const buddyUsers = [];
  for (let i = 0; i < BUDDY_USER_IDS.length; i += 1) {
    const buddy = await getUserByIdOrFail(admin, BUDDY_USER_IDS[i], `buddy user #${i + 1}`);
    buddyUsers.push(buddy);
  }

  await upsertProfiles(admin, [demoUser, ...buddyUsers]);

  await wipeSeedData(admin, demoUser.id);
  if (wipeOnly) {
    console.log('Seed wipe complete.');
    process.exit(0);
  }

  const restaurantMap = await seedRestaurants(admin, demoUser.id);
  const summary = await seedHangoutsAndEntries(admin, demoUser, buddyUsers, restaurantMap);

  console.log('Demo seed complete.');
  console.log(`- seed_tag: ${DEMO_SEED_TAG}`);
  console.log(`- demo_user_id: ${demoUser.id}`);
  console.log(`- demo_user_email: ${demoUser.email || DEMO_EMAIL_FALLBACK}`);
  console.log(`- buddy_user_ids: ${BUDDY_USER_IDS.length > 0 ? BUDDY_USER_IDS.join(',') : '(none)'}`);
  console.log(`- restaurants: ${restaurantMap.size}`);
  console.log(`- uploads: ${summary.uploads}`);
  console.log(`- extracted_line_items: ${summary.extracted}`);
  console.log(`- dish_entries: ${summary.dishEntries}`);
  console.log(`- visit_participants: ${summary.participants}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
