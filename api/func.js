import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseKey) : null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!supabase) return json({ error: 'Supabase not configured' }, 500);

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace('/api/', '').replace(/^\/+|\/+$/g, '');
    const segments = path.split('/').filter(Boolean);
    const resource = segments[0] || '';
    const id = segments[1];

    // ===== SETTINGS =====
    if (resource === 'settings') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'PUT') {
        const body = await req.json();
        const { data, error } = await supabase.from('settings').update({ ...body, updated_at: new Date().toISOString() }).eq('id', 1).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
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
      return json({
        categories: cats.data || [],
        items: (items.data || []),
        variants: vars.data || [],
        addons: ads.data || [],
        itemAddons: ia.data || [],
      });
    }

    // ===== CATEGORIES CRUD =====
    if (resource === 'categories') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('categories').select('*').order('sort_order');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('categories').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const { data, error } = await supabase.from('categories').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== MENU ITEM CRUD =====
    if (resource === 'menu-item') {
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('menu_items').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const { data, error } = await supabase.from('menu_items').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('menu_items').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== RECIPES CRUD =====
    if (resource === 'recipes') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('recipes').select('*, ingredients(*)').order('id');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('recipes').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== ADDONS CRUD =====
    if (resource === 'addons') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('addons').select('*').order('name');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('addons').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
    }

    // ===== TABLES =====
    if (resource === 'tables') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('tables').select('*').order('id');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('tables').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const { data, error } = await supabase.from('tables').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('tables').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== HOLD ORDER =====
    if (resource === 'hold-order' && req.method === 'POST') {
      const body = await req.json();
      const { data, error } = await supabase.from('tables').update({ status: 'held', hold_order: body.order_data, updated_at: new Date().toISOString() }).eq('id', body.table_id).select();
      if (error) return json({ error: error.message }, 500);
      return json(data[0] || { success: true });
    }

    if (resource === 'recall-order' && req.method === 'GET') {
      const tableId = url.searchParams.get('table_id');
      const { data, error } = await supabase.from('tables').select('*').eq('id', tableId).single();
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    if (resource === 'clear-hold' && req.method === 'POST') {
      const body = await req.json();
      const { error } = await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: new Date().toISOString() }).eq('id', body.table_id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    // ===== PLACE ORDER =====
    if (resource === 'order' && req.method === 'POST') {
      const body = await req.json();
      const { order, items, table_id } = body;

      const { data: lastOrder } = await supabase.from('orders').select('order_number').order('id', { ascending: false }).limit(1).maybeSingle();
      let orderNum = 'MS00001';
      if (lastOrder?.order_number) {
        const num = parseInt(lastOrder.order_number.replace(/\D/g, '')) + 1;
        orderNum = 'MS' + String(num).padStart(5, '0');
      }

      const { data: newOrder, error: orderErr } = await supabase.from('orders').insert({ ...order, order_number: orderNum }).select().single();
      if (orderErr) return json({ error: orderErr.message }, 500);

      const orderItems = items.map(it => ({ ...it, order_id: newOrder.id }));
      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
      if (itemsErr) return json({ error: itemsErr.message }, 500);

      if (table_id) {
        await supabase.from('tables').update({ status: 'available', hold_order: null, updated_at: new Date().toISOString() }).eq('id', table_id);
      }

      for (const item of items) {
        if (!item.menu_item_id) continue;
        const { data: recipes } = await supabase.from('recipes').select('ingredient_id, quantity').eq('menu_item_id', item.menu_item_id);
        if (recipes) {
          for (const r of recipes) {
            const reduceQty = parseFloat(r.quantity) * item.quantity;
            const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', r.ingredient_id).single();
            if (ing) {
              await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) - reduceQty }).eq('id', r.ingredient_id);
              await supabase.from('stock_transactions').insert({ ingredient_id: r.ingredient_id, quantity: -reduceQty, type: 'out', note: `Order ${orderNum}` });
            }
          }
        }
      }
      return json({ order: newOrder, order_number: orderNum });
    }

    // ===== TRANSACTIONS =====
    if (resource === 'transactions' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to + 'T23:59:59');
      const { data, error } = await query.limit(200);
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // ===== DASHBOARD =====
    if (resource === 'dashboard' && req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let query = supabase.from('orders').select('id, total, order_type, created_at');
      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to + 'T23:59:59');
      const { data: orders, error } = await query;
      if (error) return json({ error: error.message }, 500);

      const totalSales = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const dailyMap = {};
      orders.forEach(o => {
        const d = o.created_at.slice(0, 10);
        if (!dailyMap[d]) dailyMap[d] = { date: d, total: 0, count: 0 };
        dailyMap[d].total += parseFloat(o.total || 0);
        dailyMap[d].count += 1;
      });

      let topItems = [];
      if (from && to) {
        const { data: topData } = await supabase.from('order_items').select('menu_item_name, quantity, subtotal, order:orders!inner(created_at)').gte('order.created_at', from).lte('order.created_at', to + 'T23:59:59');
        const itemMap = {};
        (topData || []).forEach(it => {
          if (!itemMap[it.menu_item_name]) itemMap[it.menu_item_name] = { name: it.menu_item_name, qty: 0, revenue: 0 };
          itemMap[it.menu_item_name].qty += it.quantity;
          itemMap[it.menu_item_name].revenue += parseFloat(it.subtotal || 0);
        });
        topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
      }

      return json({
        totalSales, totalOrders: orders.length,
        dineInCount: orders.filter(o => o.order_type === 'dine-in').length,
        takeawayCount: orders.filter(o => o.order_type === 'takeaway').length,
        daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
        topItems,
      });
    }

    // ===== INGREDIENTS CRUD =====
    if (resource === 'ingredients') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('ingredients').select('*').order('name');
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('ingredients').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const { data, error } = await supabase.from('ingredients').update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('ingredients').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== STOCK IN =====
    if (resource === 'stock-in' && req.method === 'POST') {
      const body = await req.json();
      const { ingredient_id, quantity, note } = body;
      const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', ingredient_id).single();
      if (ing) {
        await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) + parseFloat(quantity) }).eq('id', ingredient_id);
        await supabase.from('stock_transactions').insert({ ingredient_id, quantity: parseFloat(quantity), type: 'in', note: note || 'Stock in' });
      }
      return json({ success: true });
    }

    // ===== STOCK OPNAME =====
    if (resource === 'stock-opname') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('stock_opname').select('*, ingredients(name, unit)').order('date', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { ingredient_id, actual_stock, note } = body;
        const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', ingredient_id).single();
        if (ing) {
          const diff = parseFloat(actual_stock) - parseFloat(ing.stock);
          await supabase.from('stock_opname').insert({
            ingredient_id, date: new Date().toISOString().slice(0, 10),
            system_stock: ing.stock, actual_stock, difference: diff, note
          }).select();
          await supabase.from('ingredients').update({ stock: parseFloat(actual_stock) }).eq('id', ingredient_id);
          await supabase.from('stock_transactions').insert({
            ingredient_id, quantity: diff, type: 'adjust', note: 'Stock Opname'
          });
        }
        return json({ success: true });
      }
    }

    // ===== WASTE =====
    if (resource === 'waste') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('waste').select('*, ingredients(name, unit, cost_per_unit)').order('date', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { ingredient_id, quantity, reason } = body;
        const { data: ing } = await supabase.from('ingredients').select('stock').eq('id', ingredient_id).single();
        if (ing) {
          await supabase.from('ingredients').update({ stock: parseFloat(ing.stock) - parseFloat(quantity) }).eq('id', ingredient_id);
          await supabase.from('stock_transactions').insert({
            ingredient_id, quantity: -parseFloat(quantity), type: 'waste', note: reason || 'Waste'
          });
        }
        const { data, error } = await supabase.from('waste').insert({ ingredient_id, date: new Date().toISOString().slice(0, 10), quantity, reason }).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('waste').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== HPP CALCULATION =====
    if (resource === 'hpp' && req.method === 'GET') {
      const { data: recipes } = await supabase.from('recipes').select('menu_item_id, quantity, ingredients(name, unit, cost_per_unit)');
      const { data: items } = await supabase.from('menu_items').select('id, name, base_price');
      if (!recipes || !items) return json({ error: 'Failed to fetch' }, 500);
      
      const result = items.map(item => {
        const itemRecipes = recipes.filter(r => r.menu_item_id === item.id);
        let totalCost = 0;
        const breakdown = itemRecipes.map(r => {
          const cost = parseFloat(r.quantity) * parseFloat(r.ingredients?.cost_per_unit || 0);
          totalCost += cost;
          return {
            ingredient: r.ingredients?.name,
            quantity: parseFloat(r.quantity),
            unit: r.ingredients?.unit,
            cost_per_unit: parseFloat(r.ingredients?.cost_per_unit || 0),
            total_cost: cost
          };
        });
        return {
          menu_item_id: item.id,
          name: item.name,
          price: parseFloat(item.base_price),
          hpp: totalCost,
          profit: parseFloat(item.base_price) - totalCost,
          margin: parseFloat(item.base_price) > 0 ? ((parseFloat(item.base_price) - totalCost) / parseFloat(item.base_price) * 100) : 0,
          breakdown
        };
      });
      return json(result);
    }

    // ===== EXPENSES =====
    if (resource === 'expenses') {
      if (req.method === 'GET') {
        const { data, error } = await supabase.from('expenses').select('*').order('date', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from('expenses').insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== PAYABLES & RECEIVABLES =====
    if (resource === 'payables' || resource === 'receivables') {
      const table = resource === 'payables' ? 'payables' : 'receivables';
      if (req.method === 'GET') {
        const { data, error } = await supabase.from(table).select('*').order('date', { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      if (req.method === 'POST') {
        const body = await req.json();
        const { data, error } = await supabase.from(table).insert(body).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0]);
      }
      if (req.method === 'PUT' && id) {
        const body = await req.json();
        const { data, error } = await supabase.from(table).update(body).eq('id', id).select();
        if (error) return json({ error: error.message }, 500);
        return json(data[0] || { success: true });
      }
      if (req.method === 'DELETE' && id) {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ===== ACCOUNTING DASHBOARD =====
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

      const { data: payables } = await supabase.from('payables').select('*').eq('status', 'unpaid');
      const { data: receivables } = await supabase.from('receivables').select('*').eq('status', 'unpaid');
      
      const totalPayables = (payables || []).reduce((s, p) => s + (parseFloat(p.amount) - parseFloat(p.paid_amount || 0)), 0);
      const totalReceivables = (receivables || []).reduce((s, r) => s + (parseFloat(r.amount) - parseFloat(r.received_amount || 0)), 0);

      return json({
        totalRevenue, totalExpenses,
        netProfit: totalRevenue - totalExpenses,
        expByCategory, totalPayables, totalReceivables,
        orderCount: (orders || []).length,
      });
    }

    return json({ error: 'Endpoint not found: ' + path }, 404);
  } catch (e) {
    return json({ error: e.message, stack: e.stack }, 500);
  }
}
