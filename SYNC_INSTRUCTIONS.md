# 🔄 MULTI-DEVICE SYNC FIX

## Masalah
Aplikasi menyimpan data di **localStorage** setiap device → tidak sinkron otomatis antar device.

## Solusi
Update 3 function di `index.html` untuk prioritas **Supabase sebagai source of truth**:

### 1. Update `syncBG()` - Line 460
**GANTI polling dari 8 detik → 3 detik**
```javascript
// Sinkron instan saat app dibuka / layar kembali aktif + polling 3 detik
function startPolling(){
  if(window._pollT)return;
  window._pollT=setInterval(function(){
    if(document.visibilityState==='visible')syncBG()
  },3000);  // ← UBAH dari 8000 ke 3000
  if(!window._visHook){window._visHook=true;document.addEventListener('visibilitychange',function(){if(!document.hidden)syncBG()});}
}
```

### 2. Update `dP()` - Line 691
**Ubah untuk LANGSUNG sync setelah order disimpan**
```javascript
// SEBELUM YANG INI:
// aP('order',{order:op,items:ip}).then(function(result){...})

// GANTI DENGAN:
aP('order',{order:op,items:ip}).then(function(result){
  if(result&&!result.error&&result.order_number){
    rec.order_number=result.order_number;
    lsSet('pos_orders',lO);
    tt(result.duplicate?'Tersinkron (order sudah ada di cloud)':'Tersinkron ke Cloud!');
    syncBG();  // ← LANGSUNG SYNC
  }else{
    lOb.push({path:'order',payload:{order:op,items:ip},ref:localNum,queued_at:Date.now()});
    saveOb();
    tt('Disimpan lokal - otomatis sync saat online',true);
  }
  setTimeout(function(){unlockSave('dP')},1200);
});
```

### 3. Update `sE2()` - Line 963
**Ubah untuk LANGSUNG sync pengeluaran**
```javascript
// SEBELUM YANG INI:
// if(apiOn){aP('expenses',{...}).then(function(r){...})}

// GANTI DENGAN:
if(apiOn){
  aP('expenses',{date:d,category:cat,description:desc,amount:amt,payment_method:method,account_id:rec.account_id}).then(function(r){
    if(r&&!r.error&&r.id){
      var idx=lE.findIndex(function(e){return e.id===tempId});
      if(idx>-1){
        lE[idx].id=r.id;
        lsSet('pos_exp',lE)
      }
    }
    syncBG();  // ← LANGSUNG SYNC
    unlockSave('sE');
  })
}else{
  unlockSave('sE')
}
```

## Test Instructions

### Device A (Browser 1)
1. Buka: http://localhost:3000 (atau URL Vercel Anda)
2. Login
3. Penjualan → Buat order "Espresso Rp 50.000"
4. Bayar dengan Cash
5. ✓ Order tersimpan

### Device B (Browser 2 / Tab baru)
1. Refresh halaman
2. Riwayat Order → Filter hari ini
3. **HARUSNYA dalam 3 detik, order Device A muncul di sini**
4. Notasi: "Tersinkron ke Cloud!"

### Pengeluaran
1. **Device A**: Kas & Bank → + Pengeluaran Kasir → Rp 100.000
2. **Device B**: Refresh atau tunggu 3 detik → mutasi kas update

## Konfigurasi yang Diperlukan

✅ `.env` atau Vercel Environment:
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxx...
```

✅ Tables di Supabase sudah ada (dari screenshot):
- `orders` (penjualan)
- `order_items` (detail order)
- `expenses` (pengeluaran)

## Expected Result
✅ 2 device buka app → 3 detik sync
✅ Order di device A → 3 detik muncul di device B
✅ Pengeluaran di device A → 3 detik muncul di device B
✅ Data TIDAK duplikat (idempotensi di `func.js` handle)
✅ Offline-first: jika offline, data cache di localStorage + otomatis push saat online

## Files yang Sudah Ada
- ✅ `/api/func.js` - Backend handler (Supabase)
- ✅ `/api/sync-helper.js` - Helper functions (baru ditambah)
- ✅ `/index.html` - Frontend (tinggal update 3 line)
- ✅ `/vercel.json` - Routing config
- ✅ `/package.json` - Dependencies

## Tidak Perlu Tambah
❌ Tidak perlu `server.js` Node.js baru
❌ Tidak perlu database lokal lagi
❌ Tidak perlu mengubah struktur tabel
