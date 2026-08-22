import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Setup CORS & Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server env vars not set (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // FIX: req.body on Vercel is already parsed into an object when
  // Content-Type: application/json is sent. The old code called
  // JSON.parse(req.body) unconditionally, which throws if req.body
  // is already an object (TypeError: not valid JSON).
  let body = {};
  if (req.body) {
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body); } catch (e) { body = {}; }
    } else {
      body = req.body;
    }
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '');
    const parts = path.split('/').filter(Boolean);
    const resource = parts[0] || '';
    const id = parts[1];

    // ===== SETTINGS =====
    if (resource === 'settings') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'PUT') {
        const { data, error } = await supabase.from('settings').update({ ...body, updated_at: new Date().toISOString() }).eq('id', 1).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
    }

    // ===== MENU =====
    if (resource === 'menu' && req.method === 'GET') {
      const [cats, items, vars, ads, ia] = await Promise.all([
        supabase.from('categories').select('*').order('sort_order'),
        supabase.from('menu_items').select('*').order('sort_order'),
        supabase.from('menu_variants').select('*').order('sort_order'),
        supabase.from('addons').select('*').eq('is_active', true),
        supabase.from('menu_item_addons').select('*'),
      ]);
      // FIX: frontend expects keys { c, i, v, a, ia } (see loadMenu()/md
      // usage in index.html), not { categories, items, variants, addons,
      // itemAddons }. The old response shape silently broke sync — apiOn
      // would flip true but md.c/md.i etc stayed undefined until reload.
      return res.status(200).json({
        c: cats.data || [],
        i: items.data || [],
        v: vars.data || [],
        a: ads.data || [],
        ia: ia.data || [],
      });
    }

    // ===== CATEGORIES =====
    if (resource === 'categories') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('categories').select('*').order('sort_order');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.name) return res.status(400).json({ error: 'name is required' });
        const { data, error } = await supabase.from('categories').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('categories').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== MENU ITEM =====
    if (resource === 'menu-item') {
      if (req.method === 'POST') {
        if (!body.name || body.base_price == null) return res.status(400).json({ error: 'name and base_price are required' });
        const { data, error } = await supabase.from('menu_items').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('menu_items').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('menu_items').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== TABLES =====
    if (resource === 'tables') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('tables').select('*').order('id');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        const { data, error } = await supabase.from('tables').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('tables').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('tables').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== HOLD ORDER =====
    if (resource === 'hold-order' && req.method === 'POST') {
      if (!body.table_id) return res.status(400).json({ error: 'table_id is required' });
      const { data, error } = await supabase.from('tables').update({ status: 'held', hold_order: body.order_data, updated_at: new Date().toISOString() }).eq('id', body.table_id).select();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data[0] || { success: true });
    }
    if (resource === 'recall-order' && req.method === 'GET') {
      const tableId = url.searchParams.get('table_id');
      const { data, error } = await supabase.from('tables').select('*').eq('id', tableId).single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }
    if (resource === 'clear-hold' && req.method === 'POST') {
      if (!body.table_id) return res.status(400).json({ error: 'table_id is required' });
      const { error } = await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: new Date().toISOString() }).eq('id', body.table_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // ===== PLACE ORDER =====
    if (resource === 'order' && req.method === 'POST') {
      const { order, items, table_id } = body;
      if (!order || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'order and a non-empty items array are required' });
      }

      // FIX: the old order-number generator read the last row and
      // incremented it in JS, which is not atomic — two orders placed
      // at nearly the same time can read the same "last" row and both
      // write the same order_number, causing a collision/overwrite.
      // We now retry on a unique-constraint violation (Postgres code
      // 23505) instead of trusting a single read-then-write.
      let newOrder = null;
      let orderErr = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: lastOrder } = await supabase.from('orders').select('order_number').order('id', { ascending: false }).limit(1).maybeSingle();
        let orderNum = 'MS00001';
        if (lastOrder?.order_number) {
          const num = parseInt(lastOrder.order_number.replace(/\D/g, '')) + 1 + attempt;
          orderNum = 'MS' + String(num).padStart(5, '0');
        } else if (attempt > 0) {
          orderNum = 'MS' + String(attempt + 1).padStart(5, '0');
        }

        const result = await supabase.from('orders').insert({ ...order, order_number: orderNum }).select().single();
        if (!result.error) {
          newOrder = result.data;
          orderErr = null;
          break;
        }
        orderErr = result.error;
        // 23505 = unique_violation in Postgres — retry with a new number
        if (result.error.code !== '23505') break;
      }
      if (orderErr) return res.status(500).json({ error: orderErr.message });
      if (!newOrder) return res.status(500).json({ error: 'Could not allocate a unique order number, please retry' });

      const orderItems = items.map(it => ({ ...it, order_id: newOrder.id }));
      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
      if (itemsErr) return res.status(500).json({ error: itemsErr.message });

      if (table_id) {
        await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: new Date().toISOString() }).eq('id', table_id);
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
      return res.status(200).json({ order: newOrder, order_number: newOrder.order_number });
    }

    // ===== TRANSACTIONS & DASHBOARD =====
    if (resource === 'transactions' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to + 'T23:59:59');
      const { data, error } = await query.limit(200);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }

    if (resource === 'dashboard' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('id, total, order_type, created_at');
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to + 'T23:59:59');
      const { data: orders, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const totalSales = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      return res.status(200).json({
        totalSales, totalOrders: orders.length,
        dineInCount: orders.filter(o => o.order_type === 'dine-in').length,
        takeawayCount: orders.filter(o => o.order_type === 'takeaway').length
      });
    }

    // ===== INGREDIENTS & STOCK =====
    if (resource === 'ingredients') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('ingredients').select('*').order('name');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.name) return res.status(400).json({ error: 'name is required' });
        const { data, error } = await supabase.from('ingredients').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
    }
    if (resource === 'recipes') {
       if (req.method === 'GET') {
        const { data, error } = await supabase.from('recipes').select('*, ingredients(*)').order('id');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
       if (req.method === 'POST') {
        if (!body.menu_item_id || !body.ingredient_id || body.quantity == null) {
          return res.status(400).json({ error: 'menu_item_id, ingredient_id and quantity are required' });
        }
        const { data, error } = await supabase.from('recipes').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
       if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }
    if (resource === 'stock-in' && req.method === 'POST') {
      const { ingredient_id, quantity, note } = body;
      if (!ingredient_id || !quantity) return res.status(400).json({ error: 'ingredient_id and quantity are required' });
      const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', ingredient_id).single();
      if (ing) {
        await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) + parseFloat(quantity) }).eq('id', ingredient_id);
        await supabase.from('stock_transactions').insert({ ingredient_id, quantity: parseFloat(quantity), type: 'in', note: note || 'Stock in' });
      }
      return res.status(200).json({ success: true });
    }

    // ===== EXPENSES & ACCOUNTING =====
    if (resource === 'expenses') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('expenses').select('*').order('date', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.date || body.amount == null) return res.status(400).json({ error: 'date and amount are required' });
        const { data, error } = await supabase.from('expenses').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    if (resource === 'acc-dashboard' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let expQuery = supabase.from('expenses').select('amount, category, date');
      if (from) expQuery = expQuery.gte('date', from);
      if (to) expQuery = expQuery.lte('date', to);
      const { data: expenses } = await expQuery;

      let ordQuery = supabase.from('orders').select('total, created_at');
      if (from) ordQuery = ordQuery.gte('created_at', from);
      if (to) ordQuery = ordQuery.lte('created_at', to + 'T23:59:59');
      const { data: orders } = await ordQuery;

      const totalRevenue = (orders || []).reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const totalExpenses = (expenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);

      const expByCategory = {};
      (expenses || []).forEach(e => {
        if (!expByCategory[e.category]) expByCategory[e.category] = 0;
        expByCategory[e.category] += parseFloat(e.amount || 0);
      });

      return res.status(200).json({
        totalRevenue, totalExpenses,
        netProfit: totalRevenue - totalExpenses,
        expByCategory
      });
    }

    return res.status(404).json({ error: `Endpoint not found: ${req.method} /${path}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
