import { createClient } from '@supabase/supabase-js';

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: H });
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;

  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: H });

  const url0 = new URL(request.url);
  const path0 = url0.pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '');

  // ===== PING: selalu OK selama function hidup (dipakai badge Online/Local) =====
  if (path0 === 'ping') return json({ ok: true, t: Date.now() });

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: 'Server env vars not set (SUPABASE_URL / SUPABASE_SERVICE_KEY)' }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let body = {};
  if (request.method === 'POST' || request.method === 'PUT') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  try {
    const url = url0;
    const path = path0;
    const parts = path.split('/').filter(Boolean);
    const resource = parts[0] || '';
    const id = parts[1];

    const now = () => new Date().toISOString();
    const toWibStart = (d) => new Date(d + 'T00:00:00+07:00').toISOString();
    const toWibEnd = (d) => {
      const t = new Date(d + 'T00:00:00+07:00');
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString();
    };
    // Kunci isi-baris tanpa id/timestamp -> untuk deteksi duplikat persis
    const normRow = (o) => JSON.stringify(Object.keys(o || {})
      .filter(k => !['id', 'created_at', 'updated_at'].includes(k))
      .sort()
      .map(k => (o[k] === null || o[k] === undefined) ? '' : String(o[k])));

    // ===== RESET DATA =====
    if (resource === 'reset-data' && request.method === 'POST') {
      const results = {};
      const wipe = async (table, col) => {
        try {
          const { data: rows, error: selErr } = await supabase.from(table).select(col).limit(50000);
          if (selErr) { results[table] = selErr.message; return; }
          if (!rows || !rows.length) { results[table] = 'empty'; return; }
          const ids = rows.map(r => r[col]);
          const CHUNK = 500;
          for (let i = 0; i < ids.length; i += CHUNK) {
            const { error } = await supabase.from(table).delete().in(col, ids.slice(i, i + CHUNK));
            if (error) { results[table] = error.message; return; }
          }
          results[table] = 'ok';
        } catch (e) { results[table] = e.message; }
      };
      await wipe('order_items', 'id');
      await wipe('orders', 'id');
      await wipe('expenses', 'id');
      await wipe('holds', 'id');
      await wipe('profit_distribution_items', 'id');
      await wipe('profit_distributions', 'id');
      await wipe('stock_transactions', 'id');
      await wipe('cash_transactions', 'id');
      await wipe('kas_closures', 'id');
      await wipe('payables', 'id');
      await wipe('receivables', 'id');
      await wipe('assets', 'id');
      await wipe('stock_buys', 'id');
      await wipe('stock_opname', 'id');
      await wipe('waste', 'id');
      await wipe('journal_entries', 'id');
      await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: now() });
      // Tanda reset: device lain membersihkan lokal saat melihat timestamp ini berubah
      const resetStamp = now();
      const { data: su } = await supabase.from('settings').update({ last_reset_at: resetStamp }).eq('id', 1).select();
      if (!su || su.length === 0) {
        try { await supabase.from('settings').insert({ id: 1, last_reset_at: resetStamp }); } catch (e) {}
      }
      const ua = request.headers.get('user-agent') || 'unknown';
      const ip = request.headers.get('cf-connecting-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
      const performedBy = (body && body.device) ? String(body.device).slice(0, 80) : 'unknown';
      try {
        await supabase.from('audit_log').insert({
          action: 'reset-data', entity_type: 'system', entity_id: String(Date.now()),
          detail: results, performed_by: 'device: ' + performedBy + ' | UA: ' + ua.slice(0, 120) + ' | IP: ' + ip
        });
      } catch (e) {}
      return json({ success: true, results });
    }

    // ===== IMPORT DATA =====
    if (resource === 'import-data' && request.method === 'POST') {
      const orders = body.orders || [];
      const expenses = body.expenses || [];
      const cash = body.cash || [];
      const results = { orders: 0, orderItems: 0, expenses: 0, cash: 0, skippedOrders: 0, skippedExpenses: 0, skippedCash: 0, errors: [] };

      if (Array.isArray(orders) && orders.length) {
        const nums = orders.map(o => o.order_number).filter(Boolean);
        let existSet = new Set();
        if (nums.length) {
          const { data: exist } = await supabase.from('orders').select('order_number').in('order_number', nums);
          existSet = new Set((exist || []).map(r => r.order_number));
        }
        for (const o of orders) {
          const { items, ...ord } = o;
          if (!ord.order_number || existSet.has(ord.order_number)) { results.skippedOrders++; continue; }
          const { data: ins, error } = await supabase.from('orders').insert(ord).select().single();
          if (error) { results.errors.push('order ' + ord.order_number + ': ' + error.message); continue; }
          results.orders++;
          if (Array.isArray(items) && items.length) {
            const rows = items.map(it => ({ ...it, order_id: ins.id }));
            const { error: ie } = await supabase.from('order_items').insert(rows);
            if (!ie) results.orderItems += rows.length; else results.errors.push('items ' + ord.order_number + ': ' + ie.message);
          }
        }
      }

      if (Array.isArray(expenses) && expenses.length) {
        const { data: ex } = await supabase.from('expenses').select('date,description,amount').limit(20000);
        const ekey = e => [e.date, (e.description || ''), String(e.amount)].join('|');
        const exSet = new Set((ex || []).map(ekey));
        const toIns = [];
        for (const e of expenses) {
          if (!e.date || e.amount == null) { results.errors.push('expense invalid'); continue; }
          const k = ekey(e);
          if (exSet.has(k)) { results.skippedExpenses++; continue; }
          exSet.add(k);
          toIns.push(e);
        }
        if (toIns.length) {
          const { data: ins, error } = await supabase.from('expenses').insert(toIns).select();
          if (error) results.errors.push('expenses: ' + error.message);
          else results.expenses += ins.length;
        }
      }

      if (Array.isArray(cash) && cash.length) {
        for (const t of cash) {
          if (!t.src || !t.type || t.amount == null || !t.date) { results.errors.push('cash invalid'); continue; }
          if (t.ref) {
            const { data: c } = await supabase.from('cash_transactions').select('id').eq('ref', t.ref).limit(1);
            if (c && c.length) { results.skippedCash++; continue; }
          }
          const { error } = await supabase.from('cash_transactions').insert({ tx_date: t.date, ts: t.ts || now(), src: t.src, type: t.type, cat: t.cat || '', descr: t.desc || '', ref: t.ref || null, amount: t.amount, m: t.m || null, investor_id: t.investor_id || null });
          if (!error) results.cash++; else results.errors.push('cash: ' + error.message);
        }
      }
      return json({ success: true, results });
    }

    // ===== SETTINGS (GET tidak pernah 500; PUT auto-buat row kalau belum ada) =====
    if (resource === 'settings') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
        if (error) return json({ id: 1, last_reset_at: null, updated_at: null });
        return json(data);
      }
      if (request.method === 'PUT') {
        let { data, error } = await supabase.from('settings').update({ ...body, updated_at: now() }).eq('id', 1).select();
        if (error) return json({ error: error.message }, 500);
        if (!data || !data.length) {
          const ins = await supabase.from('settings').insert({ ...body, id: 1, updated_at: now() }).select();
          if (ins.error) return json({ error: ins.error.message }, 500);
          data = ins.data;
        }
        return json(data[0] || { success: true });
      }
    }

    // ===== MENU =====
    if (resource === 'menu' && request.method === 'GET') {
      const [cats, items, vars, ads, ia] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order'),
        supabase.from('menu_items').select('*').order('sort_order'),
        supabase.from('menu_variants').select('*').order('sort_order'),
        supabase.from('addons').select('*').eq('is_active', true),
        supabase.from('menu_item_addons').select('*'),
      ]);
      return json({ c: cats.data || [], i: items.data || [], v: vars.data || [], a: ads.data || [], ia: ia.data || [] });
    }

    // ===== CATEGORIES =====
    if (resource === 'categories') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('categories').select('*').order('sort_order');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.name) return json({ error: 'name is required' }, 400);
        const { data, error } = await supabase.from('categories').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('categories').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { data: itemsInCat } = await supabase.from('menu_items').select('id').eq('category_id', id);
        const itemIds = (itemsInCat || []).map(i => i.id);
        if (itemIds.length) {
          await supabase.from('menu_variants').delete().in('menu_item_id', itemIds);
          await supabase.from('menu_item_addons').delete().in('menu_item_id', itemIds);
          await supabase.from('recipes').delete().in('menu_item_id', itemIds);
          await supabase.from('menu_items').delete().in('id', itemIds);
        }
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== MENU ITEM =====
    if (resource === 'menu-item') {
      if (request.method === 'POST') {
        if (!body.name || body.base_price == null) return json({ error: 'name and base_price are required' }, 400);
        const { data, error } = await supabase.from('menu_items').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('menu_items').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        await supabase.from('menu_variants').delete().eq('menu_item_id', id);
        await supabase.from('menu_item_addons').delete().eq('menu_item_id', id);
        await supabase.from('recipes').delete().eq('menu_item_id', id);
        const { error } = await supabase.from('menu_items').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

       // ===== PLACE ORDER (Idempoten by order_number, fallback to created_at) =====
    if (resource === 'order' && request.method === 'POST') {
      const { order, items, table_id } = body;
      if (!order || !items || !Array.isArray(items) || items.length === 0) {
        return json({ error: 'order and a non-empty items array are required' }, 400);
      }

      // 1. CEK ORDER_NUMBER TERLEBIH DAHULU (Paling Akurat)
      if (order.order_number) {
        const { data: existingByNum } = await supabase.from('orders').select('*, order_items(*)').eq('order_number', order.order_number).maybeSingle();
        if (existingByNum) return json({ order: existingByNum, order_number: existingByNum.order_number, duplicate: true });
      }

      // 2. FALLBACK CEK CREATED_AT + TOTAL (Untuk jaga-jaga)
      if (order.created_at) {
        let dupQuery = supabase.from('orders').select('*, order_items(*)').eq('created_at', order.created_at);
        if (order.total != null) dupQuery = dupQuery.eq('total', order.total);
        const { data: existingByTime } = await dupQuery.maybeSingle();
        if (existingByTime) return json({ order: existingByTime, order_number: existingByTime.order_number, duplicate: true });
      }

      let newOrder = null;
      let orderErr = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: lastOrder } = await supabase.from('orders').select('order_number').order('id', { ascending: false }).limit(1).maybeSingle();
        let orderNum = order.order_number || 'MS00001'; // Prioritaskan order_number dari frontend
        
        // Jika frontend mengirim order_number yang bentrok (sangat jarang), generate baru
        if (attempt > 0 || !order.order_number) {
          const num = lastOrder ? parseInt(lastOrder.order_number.replace(/\D/g, '')) + 1 + attempt : 1;
          orderNum = 'MS' + String(num).padStart(5, '0');
        }

        const result = await supabase.from('orders').insert({ ...order, order_number: orderNum }).select().single();
        if (!result.error) { newOrder = result.data; orderErr = null; break; }
        
        orderErr = result.error;
        if (result.error.code === '23505') { // Unique violation
          // Cek lagi, mungkin order baru saja masuk dari device lain
          const { data: existing } = await supabase.from('orders').select('*, order_items(*)').eq('order_number', orderNum).maybeSingle();
          if (existing) return json({ order: existing, order_number: existing.order_number, duplicate: true });
        } else {
          break;
        }
      }
      
      if (orderErr) return json({ error: orderErr.message }, 500);
      if (!newOrder) return json({ error: 'Could not allocate a unique order number, please retry' }, 500);

      const orderItems = items.map(it => ({ ...it, order_id: newOrder.id }));
      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
      if (itemsErr) {
        await supabase.from('orders').delete().eq('id', newOrder.id);
        return json({ error: itemsErr.message }, 500);
      }

      if (table_id) {
        await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: now() }).eq('id', table_id);
      }

      for (const item of items) {
        if (!item.menu_item_id) continue;
        const { data: recipes } = await supabase.from('recipes').select('ingredient_id, quantity').eq('menu_item_id', item.menu_item_id);
        if (recipes && recipes.length > 0) {
          for (const r of recipes) {
            const reduceQty = parseFloat(r.quantity) * item.quantity;
            const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', r.ingredient_id).single();
            if (ing) {
              await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) - reduceQty }).eq('id', r.ingredient_id);
              await supabase.from('stock_transactions').insert({ ingredient_id: r.ingredient_id, quantity: -reduceQty, type: 'out', note: `Order ${newOrder.order_number}` });
            }
          }
        }
      }
      return json({ order: newOrder, order_number: newOrder.order_number });
    }

    // ===== TRANSACTIONS =====
    if (resource === 'transactions' && request.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
      if (from) query = query.gte('created_at', toWibStart(from));
      if (to) query = query.lte('created_at', toWibEnd(to));
      const { data, error } = await query.limit(3000);
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }
    if (resource === 'transactions' && request.method === 'PUT' && id) {
      const allowed = {};
      if (body.status !== undefined) allowed.status = body.status;
      if (Object.keys(allowed).length === 0) return json({ error: 'no updatable fields sent' }, 400);
      const { data, error } = await supabase.from('orders').update(allowed).eq('id', id).select();
      if (error) return json({ error: error.message }, 500);
      return json(data[0] || { success: true });
    }
    if (resource === 'transactions' && request.method === 'DELETE' && id) {
      const { data: ord } = await supabase.from('orders').select('order_number').eq('id', id).maybeSingle();
      const { data: oItems } = await supabase.from('order_items').select('*').eq('order_id', id);
      for (const item of (oItems || [])) {
        if (!item.menu_item_id) continue;
        const { data: recipes } = await supabase.from('recipes').select('ingredient_id, quantity').eq('menu_item_id', item.menu_item_id);
        for (const r of (recipes || [])) {
          const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', r.ingredient_id).single();
          if (ing) {
            await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) + parseFloat(r.quantity) * item.quantity }).eq('id', r.ingredient_id);
          }
        }
      }
      await supabase.from('order_items').delete().eq('order_id', id);
      // Mutasi kas dari penjualan ini juga dihapus (semua device konsisten)
      if (ord?.order_number) {
        await supabase.from('cash_transactions').delete().eq('ref', 'sale-' + ord.order_number);
        await supabase.from('cash_transactions').delete().like('descr', '%' + ord.order_number + '%');
      }
      const { error } = await supabase.from('orders').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    // ===== DASHBOARD =====
    if (resource === 'dashboard' && request.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('id, total, order_type, created_at').neq('status', 'cancelled');
      if (from) query = query.gte('created_at', toWibStart(from));
      if (to) query = query.lte('created_at', toWibEnd(to));
      const { data: orders, error } = await query;
      if (error) return json({ error: error.message }, 500);
      const totalSales = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      return json({
        totalSales, totalOrders: orders.length,
        dineInCount: orders.filter(o => o.order_type === 'dine-in').length,
        takeawayCount: orders.filter(o => o.order_type === 'takeaway').length
      });
    }

    // ===== INGREDIENTS =====
    if (resource === 'ingredients') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('ingredients').select('*').order('name');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.name) return json({ error: 'name is required' }, 400);
        const { data, error } = await supabase.from('ingredients').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('ingredients').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        await supabase.from('recipes').delete().eq('ingredient_id', id);
        const { error } = await supabase.from('ingredients').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== RECIPES =====
    if (resource === 'recipes') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('recipes').select('*, ingredients(*)').order('id');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.menu_item_id || !body.ingredient_id || body.quantity == null) {
          return json({ error: 'menu_item_id, ingredient_id and quantity are required' }, 400);
        }
        const { data, error } = await supabase.from('recipes').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('recipes').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== STOCK IN =====
    if (resource === 'stock-in' && request.method === 'POST') {
      const { ingredient_id, quantity, note } = body;
      if (!ingredient_id || !quantity) return json({ error: 'ingredient_id and quantity are required' }, 400);
      const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', ingredient_id).single();
      if (!ing) return json({ error: 'Bahan tidak ditemukan di server (belum tersinkron?)' }, 404);
      await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) + parseFloat(quantity) }).eq('id', ingredient_id);
      await supabase.from('stock_transactions').insert({ ingredient_id, quantity: parseFloat(quantity), type: 'in', note: note || 'Stock in' });
      return json({ success: true });
    }

    // ===== EMPLOYEES =====
    if (resource === 'employees') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('employees').select('*').eq('is_active', true).order('name');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.name || !body.pin) return json({ error: 'name and pin are required' }, 400);
        const { data, error } = await supabase.from('employees').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('employees').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== ATTENDANCE (POST idempoten: replay outbox tidak bikin dobel) =====
    if (resource === 'attendance') {
      if (request.method === 'GET') {
        const date = url.searchParams.get('date');
        let q = supabase.from('attendance').select('*').order('clock_in', { ascending: false });
        if (date) q = q.eq('date', date);
        const { data, error } = await q.limit(200);
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.emp_id || !body.name || !body.date || !body.clock_in) {
          return json({ error: 'emp_id, name, date and clock_in are required' }, 400);
        }
        const { data: dupe } = await supabase.from('attendance').select('*').eq('emp_id', body.emp_id).eq('date', body.date).eq('clock_in', body.clock_in).limit(1);
        if (dupe && dupe.length) return json(dupe[0]);
        const { data, error } = await supabase.from('attendance').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('attendance').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from('attendance').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== HOLDS (POST idempoten by order_number) =====
    if (resource === 'holds') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('holds').select('*').order('created_at', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.order_number || !body.cart) return json({ error: 'order_number and cart are required' }, 400);
        const { data: dupe } = await supabase.from('holds').select('*').eq('order_number', body.order_number).limit(1);
        if (dupe && dupe.length) return json(dupe[0]);
        const { data, error } = await supabase.from('holds').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from('holds').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== ACCOUNTS =====
    if (resource === 'accounts') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('accounts').select('*').eq('is_active', true).order('sort_order');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.name || !body.group_label) return json({ error: 'name and group_label are required' }, 400);
        const { data, error } = await supabase.from('accounts').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('accounts').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== INVESTORS =====
    if (resource === 'investors') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('investors').select('*').order('id');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.name || body.percentage == null) return json({ error: 'name and percentage are required' }, 400);
        const { data, error } = await supabase.from('investors').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('investors').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from('investors').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== PROFIT DISTRIBUTIONS (POST idempoten by period_label) =====
    if (resource === 'profit-distributions') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('profit_distributions').select('*, profit_distribution_items(*)').order('created_at', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        const { items, ...dist } = body;
        if (!dist.period_label || dist.net_profit == null || !Array.isArray(items)) {
          return json({ error: 'period_label, net_profit and items[] are required' }, 400);
        }
        const { data: pdExist } = await supabase.from('profit_distributions').select('*').eq('period_label', dist.period_label).limit(1);
        if (pdExist && pdExist.length) return json(pdExist[0]);
        const { data: newDist, error: distErr } = await supabase.from('profit_distributions').insert(dist).select().single();
        if (distErr) return json({ error: distErr.message }, 500);
        const rows = items.map(it => ({ ...it, distribution_id: newDist.id }));
        const { error: itemsErr } = await supabase.from('profit_distribution_items').insert(rows);
        if (itemsErr) return json({ error: itemsErr.message }, 500);
        return json(newDist);
      }
      if (request.method === 'DELETE' && id) {
        await supabase.from('profit_distribution_items').delete().eq('distribution_id', id);
        const { error } = await supabase.from('profit_distributions').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== AUDIT LOG =====
    if (resource === 'audit-log') {
      if (request.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.action) return json({ error: 'action is required' }, 400);
        const { error } = await supabase.from('audit_log').insert(body);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== EXPENSES (POST anti-duplikat; DELETE bersihkan mutasi kas terkait) =====
    if (resource === 'expenses') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('expenses').select('*, accounts(name, group_label, type)').order('date', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        if (!body.date || body.amount == null) return json({ error: 'date and amount are required' }, 400);
        try {
          let q = supabase.from('expenses').select('id').eq('date', body.date).eq('amount', body.amount);
          if (body.description != null) q = q.eq('description', body.description);
          const { data: sim, error: simErr } = await q.limit(1);
          if (!simErr && sim && sim.length) {
            const { data: full } = await supabase.from('expenses').select('*').eq('id', sim[0].id).limit(1);
            if (full && full.length) return json(full[0]);
          }
        } catch (e) {}
        const { data, error } = await supabase.from('expenses').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from('expenses').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { data: exp } = await supabase.from('expenses').select('description, category, amount').eq('id', id).maybeSingle();
        if (exp) {
          await supabase.from('cash_transactions').delete().eq('ref', 'exp-' + id);
          const d = exp.description || exp.category || '';
          if (d) await supabase.from('cash_transactions').delete().like('descr', '%' + d + '%');
        }
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== CASH TRANSACTIONS (Kas & Bank) — mapping date->tx_date, desc->descr =====
    if (resource === 'cash-transactions') {
      if (request.method === 'GET') {
        const { data, error } = await supabase.from('cash_transactions').select('*').order('ts', { ascending: false }).limit(5000);
        if (error) return json({ error: error.message }, 500);
        return json((data || []).map(r => ({ id: r.id, date: r.tx_date, ts: r.ts, src: r.src, type: r.type, cat: r.cat, desc: r.descr, amount: parseFloat(r.amount), m: r.m || undefined, investor_id: r.investor_id || null })));
      }
      if (request.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const ins = [];
        for (const t of rows) {
          if (!t.src || !t.type || t.amount == null) return json({ error: 'src, type, amount are required' }, 400);
          if (t.ref) {
            const { data: ex } = await supabase.from('cash_transactions').select('id').eq('ref', t.ref).limit(1);
            if (ex && ex.length) continue; // idempoten by ref
          } else {
            // anti-duplikat untuk entri tanpa ref: cek isi identik
            try {
              let dq = supabase.from('cash_transactions').select('id')
                .eq('tx_date', t.date).eq('src', t.src).eq('type', t.type).eq('amount', t.amount);
              if (t.desc != null) dq = dq.eq('descr', t.desc);
              const { data: sim, error: simErr } = await dq.limit(1);
              if (!simErr && sim && sim.length) continue;
            } catch (e) {}
          }
          ins.push({ tx_date: t.date, ts: t.ts || now(), src: t.src, type: t.type, cat: t.cat || '', descr: t.desc || '', ref: t.ref || null, amount: t.amount, m: t.m || null, investor_id: t.investor_id || null });
        }
        if (!ins.length) return json({ success: true, skipped: true });
        const { data, error } = await supabase.from('cash_transactions').insert(ins).select();
        if (error) return json({ error: error.message }, 500);
        return json(Array.isArray(body) ? data : data[0]);
      }
      if (request.method === 'PUT' && id) {
        if (!/^\d+$/.test(String(id))) return json({ error: 'numeric id required' }, 400);
        const up = {};
        if (body.descr !== undefined) up.descr = body.descr;
        if (body.desc !== undefined) up.descr = body.desc;
        if (body.amount !== undefined) up.amount = body.amount;
        if (body.src !== undefined) up.src = body.src;
        if (body.tx_date !== undefined) up.tx_date = body.tx_date;
        if (body.date !== undefined) up.tx_date = body.date;
        if (!Object.keys(up).length) return json({ error: 'no updatable fields' }, 400);
        const { data, error } = await supabase.from('cash_transactions').update(up).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        // id numerik ATAU ref (cth: sale-MS00001, exp-12)
        const q = /^\d+$/.test(String(id))
          ? supabase.from('cash_transactions').delete().eq('id', id)
          : supabase.from('cash_transactions').delete().eq('ref', id);
        const { error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== RESOURCE GENERIK (anti-duplikat persis di POST) =====
    const SYNC_TABLES = {
      'kas-closures': { t: 'kas_closures', o: 'created_at' },
      'assets':       { t: 'assets',       o: 'created_at' },
      'stock-buys':   { t: 'stock_buys',   o: 'b_date' },
      'stock-opname': { t: 'stock_opname', o: 'date' },
      'waste':        { t: 'waste',        o: 'date' },
      'payables':     { t: 'payables',     o: 'p_date' },
      'receivables':  { t: 'receivables',  o: 'r_date' },
      'profit-shares':{ t: 'profit_shares',o: 'id' },
      'tables':       { t: 'tables',       o: 'id' }
    };
    if (SYNC_TABLES[resource]) {
      const cfg = SYNC_TABLES[resource];
      if (request.method === 'GET') {
        const { data, error } = await supabase.from(cfg.t).select('*').order(cfg.o, { ascending: false }).limit(2000);
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (request.method === 'POST') {
        // Anti-duplikat: kalau sudah ada baris dengan isi identik persis, balikin baris itu
        try {
          const key = normRow(body);
          if (key !== '[]') {
            const { data: cands } = await supabase.from(cfg.t).select('*').limit(2000);
            const same = (cands || []).find(c => normRow(c) === key);
            if (same) return json(same);
          }
        } catch (e) {}
        const { data, error } = await supabase.from(cfg.t).insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (request.method === 'PUT' && id) {
        const { data, error } = await supabase.from(cfg.t).update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (request.method === 'DELETE' && id) {
        const { error } = await supabase.from(cfg.t).delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    return json({ error: `Endpoint not found: ${request.method} /${path}` }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
