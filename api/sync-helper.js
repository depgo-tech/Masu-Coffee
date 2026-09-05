/**
 * SYNC HELPER - Multi-device Real-time Synchronization
 * =====================================================
 * File ini handle semua sinkronisasi data antara device/browser.
 * Prioritas: SERVER (Supabase) sebagai source of truth, bukan localStorage.
 * 
 * Gunakan di index.html dengan cara:
 * import { syncData, pushOrder, pushExpense, pushTransaction } from './api/sync-helper.js'
 * 
 * Atau di tag <script> biasa:
 * <script src="api/sync-helper.js"></script>
 * window.SyncHelper.syncData() untuk polling
 */

// ============================================
// CORE: Push & Pull dengan Supabase via API
// ============================================

const SyncHelper = {
  /**
   * GET dari server (Supabase via /api/func)
   * Ini adalah SOURCE OF TRUTH — desktop lain bisa update saat ini call GET
   */
  async fetchFromServer(endpoint, params = {}) {
    try {
      const url = new URL(`/api/${endpoint}`, window.location.origin);
      Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
      
      const response = await Promise.race([
        fetch(url, { cache: 'no-store' }).then(r => r.json()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      
      return response || { error: 'No data' };
    } catch (e) {
      return { error: e.message };
    }
  },

  /**
   * POST/PUT ke server (simpan data baru/update)
   * Ini yang mengirim action dari device ini ke Supabase
   */
  async pushToServer(endpoint, body, method = 'POST') {
    try {
      const response = await Promise.race([
        fetch(`/api/${endpoint}`, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(r => r.json()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      
      return response || { error: 'No response' };
    } catch (e) {
      return { error: e.message };
    }
  },

  /**
   * DELETE dari server
   */
  async deleteFromServer(endpoint) {
    try {
      const response = await Promise.race([
        fetch(`/api/${endpoint}`, { method: 'DELETE' }).then(r => r.json()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      
      return response || { error: 'No response' };
    } catch (e) {
      return { error: e.message };
    }
  },

  // ============================================
  // SPECIFIC: Sync untuk setiap modul
  // ============================================

  /**
   * SYNC ORDERS - Pull semua order dari Supabase
   * Dipanggil setiap 3 detik di background
   */
  async syncOrders() {
    const result = await this.fetchFromServer('transactions');
    if (result.error) return null;
    if (!Array.isArray(result)) return null;
    
    // Flatten order_items ke dalam order
    return result.map(order => ({
      order: order,
      items: (order.order_items || []).map(it => {
        try {
          return { ...it, addons: JSON.parse(it.addons || '[]') };
        } catch (e) {
          return { ...it, addons: [] };
        }
      }),
      order_number: order.order_number
    }));
  },

  /**
   * SYNC EXPENSES - Pull semua pengeluaran dari Supabase
   */
  async syncExpenses() {
    const result = await this.fetchFromServer('expenses');
    if (result.error) return null;
    return Array.isArray(result) ? result : null;
  },

  /**
   * SYNC KAS TRANSACTIONS - Pull mutasi kas (dari orders + expenses)
   * Note: func.js tidak expose endpoint khusus kas, jadi compute dari orders
   */
  async syncKasTransactions() {
    // Ambil orders (yang punya payment_method = cash/noncash)
    const orders = await this.syncOrders();
    if (!orders) return null;

    const transactions = [];
    orders.forEach(o => {
      const method = o.order?.payment_method || 'cash';
      const src = method === 'cash' ? 'cash_kasir' : 'bank_kecil';
      
      transactions.push({
        id: o.order?.id,
        date: o.order?.created_at ? new Date(o.order.created_at).toLocaleDateString('sv-SE') : '',
        ts: o.order?.created_at,
        src: src,
        type: 'in',
        cat: method === 'cash' ? 'sale_cash' : 'sale_noncash',
        desc: `Penjualan ${o.order_number} (${method.toUpperCase()})`,
        amount: parseFloat(o.order?.total || 0),
        m: method === 'cash' ? 'cash' : (method === 'qris' ? 'qris' : 'card')
      });
    });

    return transactions;
  },

  /**
   * PUSH ORDER - Simpan order baru ke Supabase
   * Device lain bakal liat dalam 3 detik
   */
  async pushOrder(orderData) {
    const result = await this.pushToServer('order', orderData);
    return result; // { order_number, order, duplicate?, error? }
  },

  /**
   * PUSH EXPENSE - Simpan pengeluaran ke Supabase
   */
  async pushExpense(expenseData) {
    const result = await this.pushToServer('expenses', expenseData);
    return result; // { id, error? }
  },

  /**
   * DELETE ORDER - Hapus order (balikin stok)
   */
  async deleteOrder(orderId) {
    const result = await this.deleteFromServer(`transactions/${orderId}`);
    return result; // { success, error? }
  },

  /**
   * DELETE EXPENSE - Hapus pengeluaran
   */
  async deleteExpense(expenseId) {
    const result = await this.deleteFromServer(`expenses/${expenseId}`);
    return result; // { success, error? }
  },

  /**
   * GET DASHBOARD - Statistik penjualan
   */
  async fetchDashboard(from, to) {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const result = await this.fetchFromServer('dashboard', params);
    return result;
  },

  /**
   * RESET SEMUA DATA - Hapus semua di Supabase
   * Hanya admin yang boleh panggil ini
   */
  async resetAllData() {
    const result = await this.pushToServer('reset-data', {}, 'POST');
    return result; // { success, results, error? }
  }
};

// Export untuk ES6 modules (jika dipakai dengan import)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncHelper;
}
