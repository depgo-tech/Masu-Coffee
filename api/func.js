import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Server env vars not set (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  let body = {};
  if (req.body) {
    if (typeof req.body === 'string') { try { body = JSON.parse(req.body); } catch (e) { body = {}; } }
    else body = req.body;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/^\/api\//, '').replace(/^\/+|\/+$/g, '');
    const parts = path.split('/').filter(Boolean);
    const resource = parts[0] || '';
    const id = parts[1];

    const toWibStart = (d) => new Date(d + 'T00:00:00+07:00').toISOString();
    const toWibEnd = (d) => {
      const t = new Date(d + 'T00:00:00+07:00');
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString();
    };

    // ===== RESET DATA (hapus semua transaksi di cloud + pasang tanda reset) =====
    if (resource === 'reset-data' && req.method === 'POST') {
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
      await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: new Date().toISOString() });
      // TANDA RESET: device lain membersihkan data lokalnya saat melihat timestamp ini berubah
      await supabase.from('settings').update({ last_reset_at: new Date().toISOString() }).eq('id', 1);
      return res.status(200).json({ success: true, results });
    }

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
      return res.status(200).json({
        c: cats.data || [], i: items.data || [], v: vars.data || [], a: ads.data || [], ia: ia.data || [],
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
        const { data: itemsInCat } = await supabase.from('menu_items').select('id').eq('category_id', id);
        const itemIds = (itemsInCat || []).map(i => i.id);
        if (itemIds.length) {
          await supabase.from('menu_variants').delete().in('menu_item_id', itemIds);
          await supabase.from('menu_item_addons').delete().in('menu_item_id', itemIds);
          await supabase.from('recipes').delete().in('menu_item_id', itemIds);
          await supabase.from('menu_items').delete().in('id', itemIds);
        }
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
        await supabase.from('menu_variants').delete().eq('menu_item_id', id);
        await supabase.from('menu_item_addons').delete().eq('menu_item_id', id);
        await supabase.from('recipes').delete().eq('menu_item_id', id);
        const { error } = await supabase.from('menu_items').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== PLACE ORDER =====
    if (resource === 'order' && req.method === 'POST') {
      const { order, items, table_id } = body;
      if (!order || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'order and a non-empty items array are required' });
      }

      // IDEMPOTENSI: created_at identik = order sudah pernah masuk → balikin yang lama
      if (order.created_at) {
        let dupQuery = supabase.from('orders').select('*, order_items(*)').eq('created_at', order.created_at);
        if (order.total != null) dupQuery = dupQuery.eq('total', order.total);
        const { data: existing } = await dupQuery.maybeSingle();
        if (existing) {
          return res.status(200).json({ order: existing, order_number: existing.order_number, duplicate: true });
        }
      }

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
        if (!result.error) { newOrder = result.data; orderErr = null; break; }
        orderErr = result.error;
        if (result.error.code === '23505' && order.created_at) {
          const { data: existing } = await supabase.from('orders').select('*, order_items(*)').eq('created_at', order.created_at).maybeSingle();
          if (existing) {
            return res.status(200).json({ order: existing, order_number: existing.order_number, duplicate: true });
          }
        }
        if (result.error.code !== '23505') break;
      }
      if (orderErr) return res.status(500).json({ error: orderErr.message });
      if (!newOrder) return res.status(500).json({ error: 'Could not allocate a unique order number, please retry' });

      const orderItems = items.map(it => ({ ...it, order_id: newOrder.id }));
      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
      if (itemsErr) {
        // Jangan tinggalkan order kosong bila insert items gagal
        await supabase.from('orders').delete().eq('id', newOrder.id);
        return res.status(500).json({ error: itemsErr.message });
      }

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

    // ===== TRANSACTIONS =====
    if (resource === 'transactions' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
      if (from) query = query.gte('created_at', toWibStart(from));
      if (to) query = query.lte('created_at', toWibEnd(to));
      const { data, error } = await query.limit(3000);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }
    if (resource === 'transactions' && req.method === 'PUT' && id) {
      const allowed = {};
      if (body.status !== undefined) allowed.status = body.status;
      if (Object.keys(allowed).length === 0) return res.status(400).json({ error: 'no updatable fields sent' });
      const { data, error } = await supabase.from('orders').update(allowed).eq('id', id).select();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data[0] || { success: true });
    }
    if (resource === 'transactions' && req.method === 'DELETE' && id) {
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
      // Mutasi kas dari penjualan ini juga dihapus (biar Kas & Bank ikut koreksi di semua device)
      if (ord?.order_number) await supabase.from('cash_transactions').delete().eq('ref', 'sale-' + ord.order_number);
      const { error } = await supabase.from('orders').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (resource === 'dashboard' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('id, total, order_type, created_at').neq('status', 'cancelled');
      if (from) query = query.gte('created_at', toWibStart(from));
      if (to) query = query.lte('created_at', toWibEnd(to));
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
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('ingredients').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        await supabase.from('recipes').delete().eq('ingredient_id', id);
        const { error } = await supabase.from('ingredients').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
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
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('recipes').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
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
      if (!ing) return res.status(404).json({ error: 'Bahan tidak ditemukan di server (belum tersinkron?)' });
      await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) + parseFloat(quantity) }).eq('id', ingredient_id);
      await supabase.from('stock_transactions').insert({ ingredient_id, quantity: parseFloat(quantity), type: 'in', note: note || 'Stock in' });
      return res.status(200).json({ success: true });
    }

    // ===== EMPLOYEES =====
    if (resource === 'employees') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('employees').select('*').eq('is_active', true).order('name');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.name || !body.pin) return res.status(400).json({ error: 'name and pin are required' });
        const { data, error } = await supabase.from('employees').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('employees').update({ is_active: false }).eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== ATTENDANCE =====
    if (resource === 'attendance') {
      if (req.method === 'GET') {
        const date = url.searchParams.get('date');
        let q = supabase.from('attendance').select('*').order('clock_in', { ascending: false });
        if (date) q = q.eq('date', date);
        const { data, error } = await q.limit(200);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.emp_id || !body.name || !body.date || !body.clock_in) {
          return res.status(400).json({ error: 'emp_id, name, date and clock_in are required' });
        }
        const { data, error } = await supabase.from('attendance').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('attendance').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
    }

    // ===== HOLDS =====
    if (resource === 'holds') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('holds').select('*').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.order_number || !body.cart) return res.status(400).json({ error: 'order_number and cart are required' });
        const { data, error } = await supabase.from('holds').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('holds').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== CHART OF ACCOUNTS =====
    if (resource === 'accounts') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('accounts').select('*').eq('is_active', true).order('sort_order');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.name || !body.group_label) return res.status(400).json({ error: 'name and group_label are required' });
        const { data, error } = await supabase.from('accounts').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('accounts').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== INVESTORS =====
    if (resource === 'investors') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('investors').select('*').order('id');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.name || body.percentage == null) return res.status(400).json({ error: 'name and percentage are required' });
        const { data, error } = await supabase.from('investors').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('investors').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('investors').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== PROFIT DISTRIBUTIONS =====
    if (resource === 'profit-distributions') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('profit_distributions').select('*, profit_distribution_items(*)').order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        const { items, ...dist } = body;
        if (!dist.period_label || dist.net_profit == null || !Array.isArray(items)) {
          return res.status(400).json({ error: 'period_label, net_profit and items[] are required' });
        }
        const { data: newDist, error: distErr } = await supabase.from('profit_distributions').insert(dist).select().single();
        if (distErr) return res.status(500).json({ error: distErr.message });
        const rows = items.map(it => ({ ...it, distribution_id: newDist.id }));
        const { error: itemsErr } = await supabase.from('profit_distribution_items').insert(rows);
        if (itemsErr) return res.status(500).json({ error: itemsErr.message });
        return res.status(200).json(newDist);
      }
      if (req.method === 'DELETE' && id) {
        await supabase.from('profit_distribution_items').delete().eq('distribution_id', id);
        const { error } = await supabase.from('profit_distributions').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== AUDIT LOG =====
    if (resource === 'audit-log') {
      if (req.method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.action) return res.status(400).json({ error: 'action is required' });
        const { error } = await supabase.from('audit_log').insert(body);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== EXPENSES =====
    if (resource === 'expenses') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('expenses').select('*, accounts(name, group_label, type)').order('date', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.date || body.amount == null) return res.status(400).json({ error: 'date and amount are required' });
        const { data, error } = await supabase.from('expenses').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('expenses').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== CASH TRANSACTIONS (Kas & Bank) =====
    if (resource === 'cash-transactions') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('cash_transactions').select('*').order('ts', { ascending: false }).limit(5000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json((data || []).map(r => ({ id: r.id, date: r.tx_date, ts: r.ts, src: r.src, type: r.type, cat: r.cat, desc: r.descr, amount: parseFloat(r.amount), m: r.m || undefined })));
      }
      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const ins = [];
        for (const t of rows) {
          if (!t.src || !t.type || t.amount == null) return res.status(400).json({ error: 'src, type, amount are required' });
          if (t.ref) {
            const { data: ex } = await supabase.from('cash_transactions').select('id').eq('ref', t.ref).limit(1);
            if (ex && ex.length) continue;
          }
          ins.push({ tx_date: t.date, ts: t.ts || new Date().toISOString(), src: t.src, type: t.type, cat: t.cat || '', descr: t.desc || '', ref: t.ref || null, amount: t.amount, m: t.m || null });
        }
        if (!ins.length) return res.status(200).json({ success: true, skipped: true });
        const { data, error } = await supabase.from('cash_transactions').insert(ins).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(Array.isArray(body) ? data : data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('cash_transactions').delete().eq('ref', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== KAS CLOSURES (Tutup Kasir) =====
    if (resource === 'kas-closures') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('kas_closures').select('*').order('created_at', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.close_date || !body.src) return res.status(400).json({ error: 'close_date and src are required' });
        const { data, error } = await supabase.from('kas_closures').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('kas_closures').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== PAYABLES =====
    if (resource === 'payables') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('payables').select('*').order('p_date', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.p_date || body.amount == null) return res.status(400).json({ error: 'p_date and amount are required' });
        const { data, error } = await supabase.from('payables').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('payables').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('payables').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== RECEIVABLES =====
    if (resource === 'receivables') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('receivables').select('*').order('r_date', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.r_date || body.amount == null) return res.status(400).json({ error: 'r_date and amount are required' });
        const { data, error } = await supabase.from('receivables').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const { data, error } = await supabase.from('receivables').update(body).eq('id', id).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('receivables').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== ASSETS =====
    if (resource === 'assets') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('assets').select('*').order('created_at', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.name || body.value == null) return res.status(400).json({ error: 'name and value are required' });
        const { data, error } = await supabase.from('assets').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('assets').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    // ===== STOCK BUYS (pembelian bahan via pengeluaran) =====
    if (resource === 'stock-buys') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('stock_buys').select('*').order('b_date', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.b_date) return res.status(400).json({ error: 'b_date is required' });
        const { data, error } = await supabase.from('stock_buys').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
    }

    // ===== STOCK OPNAME =====
    if (resource === 'stock-opname') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('stock_opname').select('*').order('date', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.date) return res.status(400).json({ error: 'date is required' });
        const { data, error } = await supabase.from('stock_opname').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
    }

    // ===== WASTE =====
    if (resource === 'waste') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('waste').select('*').order('date', { ascending: false }).limit(2000);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data);
      }
      if (req.method === 'POST') {
        if (!body.date || body.quantity == null) return res.status(400).json({ error: 'date and quantity are required' });
        const { data, error } = await supabase.from('waste').insert(body).select();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('waste').delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }
    }

    return res.status(404).json({ error: `Endpoint not found: ${req.method} /${path}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
