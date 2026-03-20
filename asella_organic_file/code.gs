// ============================================================================
//                            ASELLA ORGANIC 
// ============================================================================

var SPREADSHEET_ID = '1D3DqTKPgRtdw1TEfa_ZYg-sYa1i326TgI4Iek3evE8s';

// ── Telegram – fill in to enable alerts ──
var TELEGRAM_TOKEN = '8457796342:AAH3BrAnWzpDXJPej-lDJhMmr_vknmvu9Mc';
var TELEGRAM_CHAT  = '5951660425';

var FORM_TO_SHEET_MAP = {
  Sales:        'Sales_DB',
  Franchise:    'Franchise_DB',
  Vendor:       'Vendor_DB',
  Packaging:    'Packaging_DB',
  StockRequest: 'Stock_DB'
};

var STAFF_ONLY_FORMS = ['Vendor', 'Packaging', 'StockRequest'];

// ─────────────────────────────────────────────────────────────────────────────
//  doGet  (Index uses createHtmlOutputFromFile — no CORS, uses google.script.run)
// ─────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  if (page === 'tracking') {
    try {
      var tmpl = HtmlService.createTemplateFromFile('ordertracking');
      var ordResult = getOrderTrackingData({}, 'staff');
      var orders = ordResult.success ? transformOrdersForTracking(ordResult.rows) : [];
      tmpl.INITIAL_ORDERS = JSON.stringify(orders);
      tmpl.INITIAL_ERROR  = ordResult.success ? null : ordResult.message;
      tmpl.SCRIPT_URL = ScriptApp.getService().getUrl();
      return tmpl.evaluate()
        .setTitle('Asella — Order Tracking')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (err) {
      var tmplE = HtmlService.createTemplateFromFile('ordertracking');
      tmplE.INITIAL_ORDERS = '[]';
      tmplE.INITIAL_ERROR  = err.toString();
      tmplE.SCRIPT_URL = ScriptApp.getService().getUrl();
      return tmplE.evaluate().setTitle('Asella — Order Tracking')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  }
  // FIX-A: Index served as static HTML — uses google.script.run (no CORS issue)
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Asella Organic')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────────────────────
//  doPost — for ordertracking page actions only (analytics/update/export)
// ─────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'updateOrderStatus')
      return respond(updateOrderStatus(body.orderId, body.newStatus, body.notes, body.employeeId, body.changes || {}));
    if (body.action === 'updateOrderItems')
      return respond(updateOrderItems(body.orderId, body.changes || {}, body.employeeId, body.role));
    if (body.action === 'modifyOrderItems')
      return respond(modifyOrderItems(body.orderId, body.items || [], body.employeeId, body.role));
    // Telegram webhook posts update objects (has 'update_id' key)
    if (body.update_id !== undefined) {
      // Process webhook — deduplication is handled inside handleTelegramWebhook
      try { handleTelegramWebhook(body); } catch(we) { Logger.log("webhook handler: "+we); }
      return respond({ok:true}); // Always respond 200 fast so Telegram doesn't retry
    }
    if (body.action === 'getAnalytics') {
      var r = getOrderAnalytics();
      if (r.success) {
        var flat = {success:true};
        for (var k in r.data) flat[k] = r.data[k];
        return respond(flat);
      }
      return respond(r);
    }
    if (body.action === 'exportCsv') {
      var url = exportOrdersToCsv();
      return respond({success:!!url, url:url});
    }
    return respond({success:false, message:'Unknown action: ' + body.action});
  } catch (err) { return respond({success:false, message:err.toString()}); }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function validateCredentials(uid, pass) {
  try {
    if (!uid || !pass) return {success:false, message:'Enter ID and password.'};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('UserAuth');
    if (!sheet) return {success:false, message:'UserAuth sheet not found.'};
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (str(data[i][0]).toLowerCase() === uid.toLowerCase() && str(data[i][1]) === pass) {
        var role = mapRole(str(data[i][3]));
        return {success:true, userId:str(data[i][0]), name:str(data[i][2])||uid, role:role};
      }
    }
    return {success:false, message:'Invalid credentials.'};
  } catch (err) { return {success:false, message:err.message}; }
}

function mapRole(roleText) {
  var t = (roleText||'').toLowerCase().trim();
  if (t === 'admin') return 'admin';
  if (t.indexOf('admin') > -1) return 'admin';
  if (t.indexOf('general manager') > -1 || t.indexOf('general') > -1) return 'admin';
  // Manager now maps to admin — full system access
  if (t.indexOf('management') > -1 || t.indexOf('manager') > -1 || t.indexOf('managemnt') > -1) return 'admin';
  if (t.indexOf('director') > -1) return 'admin';
  if (t.indexOf('sales') > -1 || t === 'staff') return 'staff';
  // All other roles (Call center, Messenger, Model, etc.) are treated as staff
  return 'staff';
}

// ─────────────────────────────────────────────────────────────────────────────
//  FORM SUBMISSION
// ─────────────────────────────────────────────────────────────────────────────
function processSubmission(data) {
  try {
    var formType = data.formType || 'Sales';
// ─────────────────────────────────────────────────────────────────────────────
//  Index.html sends data.userRole; fallback to employeeRole for backwards compat
// ─────────────────────────────────────────────────────────────────────────────
    var role = data.userRole || data.employeeRole || 'guest';
    if (STAFF_ONLY_FORMS.indexOf(formType) > -1 && role === 'guest')
      return {success:false, message:'Staff login required for this form.'};

    var sheetName = FORM_TO_SHEET_MAP[formType];
    if (!sheetName) return {success:false, message:'Unknown form type: ' + formType};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return {success:false, message:'Sheet not found: ' + sheetName};

    var headers = sheet.getLastRow() > 0 ? sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0] : [];
    if (!headers.length || !headers[0]) {
      var dh = getDefaultHeaders(sheetName);
      sheet.getRange(1,1,1,dh.length).setValues([dh]);
      headers = dh;
    }

    var orderId = (formType==='Sales'||formType==='Franchise'||formType==='Order') ? generateOrderID(sheet) : '';
    var timestamp = new Date();
// ─────────────────────────────────────────────────────────────────────────────
// File upload
// ─────────────────────────────────────────────────────────────────────────────    
    var fileUrl = '';
    if (data.fileData && data.fileName) {
      try {
        var blob = Utilities.newBlob(Utilities.base64Decode(data.fileData), data.fileMime||'application/octet-stream', data.fileName);
        var folder = getDriveFolder();
        if (folder) { var f = folder.createFile(blob); f.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW); fileUrl = f.getUrl(); }
      } catch(fe) { Logger.log('File upload error: '+fe); }
    }

    var rows = buildRows(formType, data, headers, orderId, fileUrl, timestamp);
    if (!rows.length) return {success:false, message:'No data to save.'};
    sheet.getRange(sheet.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);

    // Non-blocking Telegram alerts
    try {
      var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
      if (formType === 'StockRequest') {
        sendTelegramAlert(
          '⚠️ <b>Stock Request</b>\n'
          +'━━━━━━━━━━━━━━━━━━\n'
          +'📦 Item: <b>'+str(data.stockItem)+'</b>\n'
          +'📏 Package Size: '+str(data.stockPackageSize)+'\n'
          +'🔢 Remaining: '+str(data.stockRemaining)+'\n'
          +'🛒 Qty Needed: <b>'+str(data.stockQuantityNeeded)+'</b>\n'
          +'📅 Needed By: '+str(data.stockDeliveryDate)+'\n'
          +'👤 Requested By: '+str(data.stockRequestedBy)+'\n'
          +'🕐 Date: '+now
        );
      }
      if (formType === 'Franchise' || formType === 'Sales' || formType === 'Order') {
        var iNames = Array.isArray(data.itemName)    ? data.itemName    : (data.itemName    ? [data.itemName]    : []);
        var iQtys  = Array.isArray(data.quantity)    ? data.quantity    : (data.quantity    ? [data.quantity]    : []);
        var iPkgs  = Array.isArray(data.packageSize) ? data.packageSize : (data.packageSize ? [data.packageSize] : []);
        var itemLines = '';
        for (var ti = 0; ti < iNames.length; ti++) {
          if (iNames[ti]) {
            var pkgLabel = iPkgs[ti] ? ' ['+str(iPkgs[ti])+']' : '';
            itemLines += '  • '+str(iNames[ti])+pkgLabel+' × '+str(iQtys[ti]||1)+'\n';
          }
        }
      // ───────────────────────────────────────────────────────────────────────────── 
      // Send rich notification with inline action buttons
      // ─────────────────────────────────────────────────────────────────────────────
        sendOrderNotification(formType, orderId, data, itemLines, now);
      }
// ─────────────────────────────────────────────────────────────────────────────
      // ── Vendor notification — send order details directly to the vendor ──
// ─────────────────────────────────────────────────────────────────────────────
      if (formType === 'Vendor') {
        var vINames = Array.isArray(data.vendorItem) ? data.vendorItem : (data.vendorItem ? [data.vendorItem] : []);
        var vAmts   = Array.isArray(data.vendorAmount) ? data.vendorAmount : (data.vendorAmount ? [data.vendorAmount] : []);
        var vPrices = Array.isArray(data.vendorPrice) ? data.vendorPrice : (data.vendorPrice ? [data.vendorPrice] : []);
        var vDates  = Array.isArray(data.vendorDeliveryDate) ? data.vendorDeliveryDate : (data.vendorDeliveryDate ? [data.vendorDeliveryDate] : []);
        var vLines  = '';
        for (var vi = 0; vi < vINames.length; vi++) {
          if (vINames[vi]) {
            vLines += '  • '+str(vINames[vi])+' | Amount: '+str(vAmts[vi]||'—');
            if (vPrices[vi]) vLines += ' | Price: '+str(vPrices[vi])+' ETB';
            if (vDates[vi])  vLines += ' | Deliver by: '+str(vDates[vi]);
            vLines += '\n';
          }
        }
        var vLocLine = str(data.city||data.location);
        if (data.country && data.country.trim()) vLocLine += ', '+str(data.country);
        var vendorMsg =
          '🏭 <b>Purchase Order from Asella Organic</b>\n'
          +'━━━━━━━━━━━━━━━━━━\n'
          +'📋 Ref: <b>'+str(orderId||'PO-'+now.replace(/[^0-9]/g,'').slice(0,10))+'</b>\n'
          +'🏢 Vendor: '+str(data.entityName)+'\n'
          +'📍 Location: '+vLocLine+'\n'
          +'📞 Phone: '+str(data.phoneNumber)+'\n'
          +'\n📦 Items Requested:\n'+(vLines||'  • (see attached sheet)\n')
          +'\n👤 Placed by: '+str(data.employeeId||'Asella Staff')+'\n'
          +'🕐 Date: '+now+'\n'
          +'\nPlease confirm this order by replying to this message.';
// ─────────────────────────────────────────────────────────────────────────────
// Send to main admin channel always
// ─────────────────────────────────────────────────────────────────────────────        
        sendTelegramAlert(vendorMsg);
      // ───────────────────────────────────────────────────────────────────────────── 
      // Send directly to vendor by @username — bot auto-delivers with Accept/Decline buttons
      // ─────────────────────────────────────────────────────────────────────────────
        if (data.vendorTelegram) {
          sendVendorTelegramAlert(data.vendorTelegram, vendorMsg, orderId);
        }
      }
    } catch(te) { Logger.log('Telegram: '+te); }

    return {success:true, message:'Submitted successfully! Order ID: '+orderId, orderId:orderId};
  } catch (err) { Logger.log('processSubmission: '+err); return {success:false, message:err.message}; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROW BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildRows(formType, data, headers, orderId, fileUrl, timestamp) {
  var rows = [];
  var base = {
    submission_date:timestamp, Order_ID:orderId,
    User:data.employeeId||'GUEST', FileURL:fileUrl, status:'Pending',
    user:data.employeeId||'SYSTEM', submission:timestamp, 'submission ':timestamp,
    LastUpdatedBy:data.employeeId||'SYSTEM', LastUpdateTimestamp:timestamp
  };
  var formFields = {
    Sales:    {customer_name:data.entityName, sex:data.gender, age:data.ageGroup,
               location:data.location, city:data.city, 'Phone number':data.phoneNumber, order_type:data.orderType},
    Franchise:{customer_name:data.entityName, 'Franchise type':data.franchiseType,
               location:data.location, city:data.city, 'Phone number':data.phoneNumber, order_type:data.orderType},
    Vendor:   {'vendor name':data.entityName, location:data.location, city:data.city,
               phone:data.phoneNumber, telegram:data.vendorTelegram||''},
    Packaging:{},
    StockRequest:{item:data.stockItem, 'pkg size':data.stockPackageSize,
      'stock available':data.stockRemaining, 'qty needed':data.stockQuantityNeeded,
      'delivery date':data.stockDeliveryDate, 'done by who':data.stockRequestedBy}
  };

  var itemNames  = firstNonEmpty(data.vendorItem, data.itemName);
  var quantities = firstNonEmpty(data.quantity);
  var pkgSizes   = firstNonEmpty(data.packageSize, data.pkgSize);
  var delDates   = firstNonEmpty(data.deliveryDate, data.vendorDeliveryDate, data.availDate);
  var prices     = firstNonEmpty(data.vendorPrice);
  var amounts    = firstNonEmpty(data.vendorAmount);
  var costs      = firstNonEmpty(data.packagingCost);

  if (itemNames.length > 0) {
    for (var i = 0; i < itemNames.length; i++) {
      var rd = mergeObjects(base, formFields[formType]||{});
      rd.item = itemNames[i]; rd.ItemName = itemNames[i];
      rd.Qty_needed = quantities[i]||amounts[i]||'';
      rd.Quantity   = quantities[i]||amounts[i]||'';
      rd.amount     = amounts[i]||quantities[i]||'';   // Vendor_DB 'amount'
      rd.size       = pkgSizes[i]||amounts[i]||'';     // Packaging_DB 'size'
      rd.Pkg_size   = pkgSizes[i]||'';
      rd.PackageSize= pkgSizes[i]||'';
      rd['totall price'] = data.totalPay||'';
      rd['delivery date']  = delDates[i]||'';
      rd['delivery date '] = delDates[i]||'';          // Packaging_DB has trailing space
      rd.DeliveryDate = delDates[i]||'';
      rd.price  = prices[i]||costs[i]||'';             // Vendor_DB & Packaging_DB 'price'
      rd.Price  = prices[i]||costs[i]||'';
      rows.push(mapRowToHeaders(headers, rd));
    }
  } else {
    var sr = mergeObjects(base, formFields[formType]||{});
    sr['totall price'] = data.totalPay||'';
    rows.push(mapRowToHeaders(headers, sr));
  }
  return rows;
}

function firstNonEmpty() {
  for (var i = 0; i < arguments.length; i++) {
    var a = arguments[i];
    if (Array.isArray(a) && a.length > 0) return a;
    if (a && !Array.isArray(a)) return [a];
  }
  return [];
}

function mergeObjects(a, b) {
  var r = {};
  for (var k in a) r[k] = a[k];
  for (var j in b) r[j] = b[j];
  return r;
}

function mapRowToHeaders(headers, data) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (!h) { row.push(''); continue; }
    var key = h.toString().trim();
    // Try exact key, then trimmed key
    if (data[h] !== undefined) row.push(data[h]);
    else if (data[key] !== undefined) row.push(data[key]);
    else row.push('');
  }
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ORDER TRACKING
// ─────────────────────────────────────────────────────────────────────────────
function getOrderTrackingData(filters, role) {
  try {
    if (!role || role === 'guest')
      return JSON.stringify({success:false, message:'Login required to view orders.'});

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var allRows = [];

    ['Sales_DB','Franchise_DB'].forEach(function(src) {
      var sheet = ss.getSheetByName(src);
      if (!sheet) return;
      var sd = sheet.getDataRange().getValues();
      if (sd.length < 2) return;
      var hdrs = sd[0].map(function(h){ return h ? h.toString().trim() : ''; });

      for (var i = 1; i < sd.length; i++) {
        var row = sd[i];
        if (!row.some(function(c){return c!==''&&c!==null&&c!==undefined;})) continue;

        var o = {};
        hdrs.forEach(function(h, idx) {
          if (!h) return;
          var v = row[idx];
          if (v instanceof Date)                  o[h] = isNaN(v.getTime()) ? '' : v.toISOString();
          else if (v === null || v === undefined) o[h] = '';
          else                                    o[h] = String(v);
        });

        var orderId  = o['Order_ID'] || '';
        var custName = o['customer_name'] || '';
        if (!orderId && !custName) continue;

        allRows.push({
          Source:              src,
          OrderID:             orderId,
          CustomerName:        custName,
          Phone:               o['Phone number'] || o['phone'] || '',
          Location:            o['location']     || '',
          City:                o['city']         || '',
          OrderType:           o['order_type']   || '',
          ItemName:            o['item']         || '',
          Quantity:            o['Qty_needed']   || o['amount'] || '',
          PackageSize:         o['Pkg_size']     || o['size']   || '',
          DeliveryDate:        o['delivery date']|| o['delivery date '] || '',
          Total:               o['totall price'] || '',
          Status:              o['status']       || 'Pending',
          Timestamp:           o['submission_date'] || o['submission'] || o['submission '] || '',
          EmployeeID:          o['User']  || o['user'] || '',
          Notes:               o['Notes'] || '',
          LastUpdatedBy:       o['LastUpdatedBy'] || '',
          LastUpdateTimestamp: o['LastUpdateTimestamp'] || '',
          FranchiseType:       o['Franchise type'] || '',
          Gender:              o['sex']  || '',
          AgeGroup:            o['age']  || ''
        });
      }
    });

    return JSON.stringify({success:true, rows:allRows});
  } catch (err) {
    Logger.log('getOrderTrackingData: ' + err);
    return JSON.stringify({success:false, message:err.message});
  }
}


function transformOrdersForTracking(rows) {
  var grouped = {}, order = [];
  rows.forEach(function(r) {
    var id = str(r.OrderID) || ('NOID-'+r.CustomerName);
    if (!grouped[id]) {
      var ts = r.Timestamp, lu = r.LastUpdateTimestamp;
      grouped[id] = {
        orderId:r.OrderID||id, customerName:str(r.CustomerName), phone:str(r.Phone),
        location:str(r.Location), city:str(r.City), orderType:str(r.OrderType),
        franchiseType:str(r.FranchiseType), employeeId:str(r.EmployeeID),
        status:str(r.Status)||'Pending',
        timestamp:ts instanceof Date?ts.toISOString():str(ts),
        total:parseFloat(str(r.Total))||0, db:r.Source||'Sales_DB',
        items:[], notes:str(r.Notes), lastUpdatedBy:str(r.LastUpdatedBy),
        lastUpdate:lu instanceof Date?lu.toISOString():str(lu)
      };
      order.push(id);
    }
    var item = str(r.ItemName);
    if (item) grouped[id].items.push({
      itemName:item, quantity:str(r.Quantity),
      packageSize:str(r.PackageSize), deliveryDate:str(r.DeliveryDate)
    });
  });
  return order.map(function(id){return grouped[id];});
}

// ─────────────────────────────────────────────────────────────────────────────
//  UPDATE ORDER STATUS
// ─────────────────────────────────────────────────────────────────────────────
// Server-side price lookup — mirrors frontend PRICE_MAP
var GAS_PRICE_MAP = {
  'Kerbe Powder':{'100 g':800},
  'Kerbe Raw':{'100 g':800},
  'Ashwagandha Powder':{'100 g':1000,'220 g':2000,'250 g':2500},
  'Ashwagandha Tablet (Himalayan)':{'60 capsules':2500,'120 capsules':4500},
  'Chebe Powder':{'100 g':1000},
  'Chia Seed':{'250 g':800,'1 kg':3000},
  'Cinnamon':{'100 g':600},
  'Coffee Bean':{'500 g':800},
  'Turmeric Powder':{'200 g':450},
  'Hibiscus Dry Leaf':{'100 g':500,'200 g':1000},
  'Qasil Powder':{'200 g':450},
  'Moringa Powder':{'100 g':250,'200 g':350,'500 g':750,'1 kg':1100},
  'Moringa Seed':{'200 g':450,'500 g':1000},
  'Shilajit Capsules':{'60 capsules':4500},
  'Shilajit Gummies':{'30 gummies':4000,'60 gummies':4000},
  'Himalayan Shilajit Jell':{'1 jar (20g)':5000}
};
function _gasLookupPrice(itemName, pkg) {
  if (!itemName || !pkg) return 0;
  var m = GAS_PRICE_MAP[itemName];
  if (m && m[pkg] !== undefined) return m[pkg];
  // fuzzy lowercase match
  var keys = Object.keys(GAS_PRICE_MAP);
  for (var k = 0; k < keys.length; k++) {
    if (keys[k].toLowerCase() === itemName.toLowerCase()) {
      var m2 = GAS_PRICE_MAP[keys[k]];
      if (m2 && m2[pkg] !== undefined) return m2[pkg];
    }
  }
  return 0;
}

function modifyOrderItems(orderId, items, employeeId, role) {
  // items: [{item, pkg, qty}, ...] — all items for this order after modification
  try {
    if (!orderId) return {success:false, message:'No order ID provided.'};
    if (!items || !items.length) return {success:false, message:'No items provided.'};
    if (!role || role === 'guest') return {success:false, message:'Login required.'};

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var updated = false;

    ['Sales_DB','Franchise_DB'].forEach(function(src) {
      var sheet = ss.getSheetByName(src); if (!sheet) return;
      var sd = sheet.getDataRange().getValues(); if (sd.length < 2) return;
      var hdrs = sd[0].map(function(h){ return h?h.toString().trim():''; });

      var oidC  = findCol(hdrs, ['Order_ID']);
      var itemC = findCol(hdrs, ['item','ItemName']);
      var pkgC  = findCol(hdrs, ['Pkg_size','size','PackageSize']);
      var qtyC  = findCol(hdrs, ['Qty_needed','Quantity','quantity']);
      var lbC   = findCol(hdrs, ['LastUpdatedBy']);
      var ltC   = findCol(hdrs, ['LastUpdateTimestamp']);
      if (oidC === -1 || itemC === -1) return;
// ─────────────────────────────────────────────────────────────────────────────
      // Find all row indices for this order
// ─────────────────────────────────────────────────────────────────────────────      
      var matchRows = [];
      for (var i = 1; i < sd.length; i++) {
        if (str(sd[i][oidC]) === str(orderId)) matchRows.push(i);
      }
      if (!matchRows.length) return;

      var now = new Date();
      // Look up 'totall price' column (exact two-l spelling used in DB)
      var priceC = findCol(hdrs, ['totall price','Total','total']);
      // Per-item price column if exists (Sales_DB may have unit price column)
      var unitPriceC = findCol(hdrs, ['unit price','unit_price','price','Price']);

      var newOrderTotal = 0;

      // Strategy: update existing rows in place, add new rows, blank removed items
      for (var mi = 0; mi < Math.max(items.length, matchRows.length); mi++) {
        if (mi < items.length && mi < matchRows.length) {
          // Update existing row — also recalculate price based on new item+pkg+qty
          var ri = matchRows[mi];
          var newItemName = items[mi].item;
          var newPkg      = items[mi].pkg || '';
          var newQty      = parseInt(items[mi].qty) || 1;
          var unitPrice   = _gasLookupPrice(newItemName, newPkg);
          var lineTotal   = unitPrice * newQty;
          if (lineTotal > 0) newOrderTotal += lineTotal;
          if (itemC>-1) sheet.getRange(ri+1, itemC+1).setValue(newItemName);
          if (pkgC>-1)  sheet.getRange(ri+1, pkgC+1).setValue(newPkg);
          if (qtyC>-1)  sheet.getRange(ri+1, qtyC+1).setValue(newQty);
          if (unitPriceC>-1 && unitPrice>0) sheet.getRange(ri+1, unitPriceC+1).setValue(unitPrice);
          if (lbC>-1)   sheet.getRange(ri+1, lbC+1).setValue(employeeId||'SYSTEM');
          if (ltC>-1)   sheet.getRange(ri+1, ltC+1).setValue(now);
          updated = true;
        } else if (mi < items.length) {
          // New item — clone first matching row and update item fields
          var baseRI = matchRows[0];
          var newRowData = sd[baseRI].slice();
          var newItemName2 = items[mi].item;
          var newPkg2      = items[mi].pkg || '';
          var newQty2      = parseInt(items[mi].qty) || 1;
          var unitPrice2   = _gasLookupPrice(newItemName2, newPkg2);
          var lineTotal2   = unitPrice2 * newQty2;
          if (lineTotal2 > 0) newOrderTotal += lineTotal2;
          if (itemC>-1) newRowData[itemC] = newItemName2;
          if (pkgC>-1)  newRowData[pkgC]  = newPkg2;
          if (qtyC>-1)  newRowData[qtyC]  = newQty2;
          if (unitPriceC>-1 && unitPrice2>0) newRowData[unitPriceC] = unitPrice2;
          if (lbC>-1)   newRowData[lbC]   = employeeId||'SYSTEM';
          if (ltC>-1)   newRowData[ltC]   = now;
          sheet.appendRow(newRowData);
          updated = true;
        } else {
          // Remove extra row — blank the item name so it won't appear in tracking
          var ri2 = matchRows[mi];
          if (itemC>-1) sheet.getRange(ri2+1, itemC+1).setValue('');
          if (qtyC>-1)  sheet.getRange(ri2+1, qtyC+1).setValue(0);
          if (lbC>-1)   sheet.getRange(ri2+1, lbC+1).setValue(employeeId||'SYSTEM');
          if (ltC>-1)   sheet.getRange(ri2+1, ltC+1).setValue(now);
          updated = true;
        }
      }

      // Write new order total back to the 'totall price' column on the FIRST matching row
      // (that column stores the order-level total, not per-item)
      if (updated && newOrderTotal > 0 && priceC > -1 && matchRows.length > 0) {
        sheet.getRange(matchRows[0]+1, priceC+1).setValue(newOrderTotal);
      }
    });
    return {
      success: updated,
      message: updated ? 'Items updated for order '+orderId : 'Order not found.',
      newTotal: newOrderTotal > 0 ? newOrderTotal : undefined
    };
  } catch(err) { Logger.log('modifyOrderItems: '+err); return {success:false, message:err.message}; }
}

function updateOrderStatus(orderId, newStatus, notes, employeeId, changes) {
  try {
    if (!orderId||!newStatus) return {success:false, message:'Order ID and status required.'};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var updated = false;
    ['Sales_DB','Franchise_DB'].forEach(function(src) {
      var sheet = ss.getSheetByName(src); if (!sheet) return;
      var sd = sheet.getDataRange().getValues(); if (sd.length < 2) return;
      var hdrs = sd[0];
      var oidC = findCol(hdrs,['Order_ID']), stC = findCol(hdrs,['status','Status']);
      var ntC = findCol(hdrs,['Notes','notes']);
      var lbC = findCol(hdrs,['LastUpdatedBy']); var ltC = findCol(hdrs,['LastUpdateTimestamp']);
      if (oidC===-1) return;
      for (var i = 1; i < sd.length; i++) {
        if (str(sd[i][oidC]) !== str(orderId)) continue;
        if (stC>-1) sheet.getRange(i+1,stC+1).setValue(newStatus);
        if (ntC>-1&&notes) {
          var prev=str(sheet.getRange(i+1,ntC+1).getValue());
          sheet.getRange(i+1,ntC+1).setValue(prev?prev+'\n'+notes:notes);
        }
        if (lbC>-1) sheet.getRange(i+1,lbC+1).setValue(employeeId||'');
        if (ltC>-1) sheet.getRange(i+1,ltC+1).setValue(new Date());
        updated = true;
      }
    });
    return {success:updated, message:updated?'Status updated to '+newStatus:'Order not found.'};
  } catch (err) { return {success:false, message:err.message}; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANALYTICS  (correct column names + no bad row filters)
// ─────────────────────────────────────────────────────────────────────────────
function getOrderAnalytics() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    function readSh(name) {
      var s = ss.getSheetByName(name); if (!s) return {headers:[],rows:[]};
      var d = s.getDataRange().getValues(); if (d.length < 2) return {headers:d[0]||[],rows:[]};
      return {headers:d[0], rows:d.slice(1)};
    }
    function toObj(hdrs, row) {
      var o = {};
      hdrs.forEach(function(h,i){ if(h!==null&&h!==undefined&&h!=='') o[h.toString().trim()]=row[i]; });
      return o;
    }
    function mk(ts) {
      if(!ts) return '';
      var d = ts instanceof Date ? ts : new Date(ts);
      return isNaN(d) ? '' : d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);
    }
    function yk(ts) {
      if(!ts) return '';
      var d = ts instanceof Date ? ts : new Date(ts);
      return isNaN(d) ? '' : String(d.getFullYear());
    }
    function inc(o,k,v) { if(!k||k==='undefined'||k==='null') return; o[k]=(o[k]||0)+(v||1); }

    // ── Money IN: Sales_DB + Franchise_DB ────────────────────────────
    var totalOrders=0, totalRevenue=0;
    var statusCount={}, itemCount={}, employeeCount={}, genderCount={}, ageGroupCount={}, regionCount={}, cityCount={};
    var revenueByMonth={}, ordersByYear={};

    ['Sales_DB','Franchise_DB'].forEach(function(shName) {
      var sh = readSh(shName);
      sh.rows.forEach(function(row) {
        if (!row.some(function(c){return c!==''&&c!==null&&c!==undefined;})) return;
        var o = toObj(sh.headers, row);
        totalOrders++;
        // FIX-C: exact column name 'totall price' (two l's)
        var rev = parseFloat(str(o['totall price']||0))||0;
        totalRevenue += rev;
        var st = str(o['status']||o['Status'])||'Pending'; inc(statusCount, st);
        var item = str(o['item']||''); if(item) inc(itemCount, item);
        var emp = str(o['User']||o['user']||'');
        if(emp && emp.toLowerCase()!=='guest' && emp!=='SYSTEM') inc(employeeCount, emp);
        var gen = str(o['sex']||''); if(gen) inc(genderCount, gen);
        var age = str(o['age']||''); if(age) inc(ageGroupCount, age);
        var loc = str(o['location']||''); if(loc) inc(regionCount, loc);
        var city = str(o['city']||''); if(city) inc(cityCount, city);
        var ts = o['submission_date']||o['submission']||o['submission ']||'';
        var m = mk(ts); if(m) inc(revenueByMonth, m, rev);
        var y = yk(ts); if(y) inc(ordersByYear, y);
      });
    });

    // ── Money OUT: Vendor_DB ─────────────────────────────────────────
    // FIX-E: Vendor_DB uses column 'price' for cost, 'amount' for quantity
    var totalVendorCost=0, vendorByMonth={};
    var vs = readSh('Vendor_DB');
    vs.rows.forEach(function(row) {
      if (!row.some(function(c){return c!==''&&c!==null&&c!==undefined;})) return;
      var o = toObj(vs.headers, row);
      var cost = parseFloat(str(o['price']||o['Price']||0))||0;
      totalVendorCost += cost;
      var m = mk(o['submission_date']||o['Timestamp']||''); if(m) inc(vendorByMonth, m, cost);
    });

    // ── Money OUT: Packaging_DB ──────────────────────────────────────
    // FIX-D: Packaging_DB columns: item, size, price, 'delivery date ' (trailing space)
    var stockMovement={}, totalPackagingCost=0, packagingByMonth={};
    var ps = readSh('Packaging_DB');
    ps.rows.forEach(function(row) {
      if (!row.some(function(c){return c!==''&&c!==null&&c!==undefined;})) return;
      var o = toObj(ps.headers, row);
      var item = str(o['item']||'');
      // Count packaging events per item (Packaging_DB has no qty col)
      if(item) inc(stockMovement, item);
      var cost = parseFloat(str(o['price']||o['Price']||0))||0;
      totalPackagingCost += cost;
      var m = mk(o['submission_date']||o['Timestamp']||''); if(m&&cost) inc(packagingByMonth, m, cost);
    });

    // ── Profit by month ─────────────────────────────────────────────
    var profitByMonth={}, allM={};
    Object.keys(revenueByMonth).forEach(function(m){allM[m]=true;});
    Object.keys(vendorByMonth).forEach(function(m){allM[m]=true;});
    Object.keys(packagingByMonth).forEach(function(m){allM[m]=true;});
    Object.keys(allM).forEach(function(m){
      profitByMonth[m]=(revenueByMonth[m]||0)-(vendorByMonth[m]||0)-(packagingByMonth[m]||0);
    });
    var totalCostOut = totalVendorCost + totalPackagingCost;

    // ── Top/bottom products ─────────────────────────────────────────
    var allItems = Object.keys(itemCount).map(function(k){return {name:k, count:itemCount[k]};})
                         .sort(function(a,b){return b.count-a.count;});
    var topItems    = allItems.slice(0,8);
    var bottomItems = allItems.slice(-8).reverse();

    // FIX-4: Return JSON.stringify — prevents GAS postMessage null serialization
    return JSON.stringify({success:true, data:{
      totalOrders:totalOrders, totalRevenue:totalRevenue,
      totalVendorCost:totalVendorCost, totalPackagingCost:totalPackagingCost,
      totalCostOut:totalCostOut, grossProfit:totalRevenue-totalCostOut,
      avgOrderValue:totalOrders?Math.round(totalRevenue/totalOrders):0,
      statusCount:statusCount, employeeCount:employeeCount,
      genderCount:genderCount, ageGroupCount:ageGroupCount,
      regionCount:regionCount, cityCount:cityCount,
      revenueByMonth:revenueByMonth, profitByMonth:profitByMonth,
      ordersByYear:ordersByYear, stockMovement:stockMovement,
      topItems:topItems, bottomItems:bottomItems
    }});
  } catch (err) {
    Logger.log('getOrderAnalytics: '+err);
    return JSON.stringify({success:false, message:err.message});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPORT CSV
// ─────────────────────────────────────────────────────────────────────────────
function exportOrdersToCsv() {
  try {
    // FIX-5: getOrderTrackingData now returns JSON string — must parse it
    var raw = getOrderTrackingData({}, 'staff');
    var result = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if (!result.success || !result.rows || !result.rows.length) return '';
    var cols = ['OrderID','CustomerName','Phone','Location','City','OrderType','EmployeeID',
                'Status','Timestamp','ItemName','Quantity','PackageSize','DeliveryDate','Total','Notes','Source'];
    var lines = [cols.join(',')];
    result.rows.forEach(function(o) {
      lines.push(cols.map(function(c){
        var v = str(o[c]||'');
        if (v.indexOf(',')>-1||v.indexOf('"')>-1||v.indexOf('\n')>-1) v = '"'+v.replace(/"/g,'""')+'"';
        return v;
      }).join(','));
    });
    var blob = Utilities.newBlob(lines.join('\n'), 'text/csv',
      'asella_orders_'+Utilities.formatDate(new Date(),'Africa/Addis_Ababa','yyyyMMdd_HHmm')+'.csv');
    var file = DriveApp.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) { Logger.log('exportOrdersToCsv: '+err); return ''; }
}

// =============================================================================
//  TELEGRAM BOT — ADVANCED FULL SYSTEM
//  Asella Organic | All features: notifications, commands, vendor alerts,
//  order management, analytics, team broadcasts, morning briefing
// =============================================================================

// ── Team recipients (Sales orders only, not Franchise) ──────────────────────
// Add numeric Telegram chat IDs. Get ID by sending /myid to the bot.
var SALES_TEAM = [
  { name: 'Nahom',  chatId: '1651812725' },
  { name: 'Kal',    chatId: '6145130083' },
  { name: 'Messay', chatId: '336797279'  }
];

// ── Role-based Bot Configuration ─────────────────────────────────────────────
// MANAGER_CHAT: The one person who sees everything (defaults to main admin chat)
var MANAGER_CHAT = TELEGRAM_CHAT; // Change this to manager's chat ID if different

// Roles: 'manager' | 'sales' | 'vendor' | 'unknown'
// The bot detects role automatically when each person sends /start.
// - Manager:    their chatId === MANAGER_CHAT
// - Sales team: their chatId is in SALES_TEAM array
// - Vendor:     anyone else who sends /start — treated as vendor
// You can also set a person's role explicitly in the TelegramUsers sheet
// by adding a 'role' column (values: manager / sales / vendor)
function _getBotRole(chatId, username) {
  // Check explicit role in TelegramUsers sheet first
  var explicit = _lookupUserRole(chatId);
  if (explicit) return explicit;
  // Manager
  if (str(chatId) === str(MANAGER_CHAT)) return 'manager';
  // Sales team member
  for (var i = 0; i < SALES_TEAM.length; i++) {
    if (str(SALES_TEAM[i].chatId) === str(chatId)) return 'sales';
  }
  // Everyone else who messages the bot is treated as vendor
  return 'vendor';
}

function _lookupUserRole(chatId) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('TelegramUsers');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    var hdrs = data[0].map(function(h){ return h ? h.toString().trim().toLowerCase() : ''; });
    var cidC  = hdrs.indexOf('chat_id');
    var roleC = hdrs.indexOf('role');
    if (cidC === -1 || roleC === -1) return null;
    for (var i = 1; i < data.length; i++) {
      if (str(data[i][cidC]) === str(chatId)) {
        var r = str(data[i][roleC]).toLowerCase().trim();
        if (r === 'manager' || r === 'sales' || r === 'vendor') return r;
      }
    }
    return null;
  } catch(e) { return null; }
}

// ── Emoji status map ─────────────────────────────────────────────────────────
var STATUS_EMOJI = {
  'Pending':    '⏳',
  'Confirmed':  '✅',
  'Packed':     '📦',
  'In Transit': '🚚',
  'Delivered':  '🎉',
  'Cancelled':  '❌'
};

// ─────────────────────────────────────────────────────────────────────────────
//  CORE SEND FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Send plain text message to the main admin channel
function sendTelegramAlert(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  _sendTelegramTo(TELEGRAM_CHAT, message);
}

// Send message with inline action buttons to the main admin channel
function sendTelegramAlertWithButtons(message, buttons) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  _sendWithButtons(TELEGRAM_CHAT, message, buttons);
}

// Send to a single recipient by numeric chat ID or @username.
// IMPORTANT: Bot can only message users who have sent it /start at least once.
function _sendTelegramTo(chatId, message) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  var target = String(chatId).trim();
  if (!target || target === '0') return;
  try {
    var resp = UrlFetchApp.fetch(
      'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage',
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: target, text: message, parse_mode: 'HTML' }),
        muteHttpExceptions: true
      }
    );
    var code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log('Telegram FAILED to ' + target + ' (HTTP ' + code + '): ' + resp.getContentText());
    }
    return code === 200;
  } catch (e) {
    Logger.log('Telegram ERROR to ' + target + ': ' + e);
    return false;
  }
}

// Send to all sales team members (used for Sales/Order form types)
function sendSalesTeamAlert(message) {
  for (var i = 0; i < SALES_TEAM.length; i++) {
    if (SALES_TEAM[i].chatId) _sendTelegramTo(SALES_TEAM[i].chatId, message);
  }
}

// Send a vendor purchase order notification directly to the vendor's Telegram.
// chatIdOrUsername: numeric chat ID preferred (e.g. '1234567890').
// @username also works if vendor has previously sent /start to the bot.
// HOW VENDOR GETS THEIR CHAT ID: They message the bot → bot replies with their ID.
// Send a purchase order to a vendor by @username.
// The vendor must have sent /start to the bot first for this to work.
// orderId is used to generate Accept/Decline/Changes buttons.
function sendVendorTelegramAlert(chatIdOrUsername, message, orderId) {
  if (!TELEGRAM_TOKEN || !chatIdOrUsername) return;
  var raw = String(chatIdOrUsername).trim().replace(/^@/, '').replace(/\s+/g, '');
  if (!raw) return;

  var targetId = null;
  var isNumeric = /^\d+$/.test(raw);

  if (isNumeric) {
    // Direct numeric chat ID
    targetId = raw;
  } else {
    // Username — look up in TelegramUsers sheet (registered via /start)
    targetId = _lookupTelegramChatId(raw.toLowerCase());
    if (!targetId) {
      Logger.log('Vendor not registered yet: @' + raw);
      // Store in pending + notify admin
      _storePendingVendorMessage('@' + raw, raw, orderId || 'PO', message);
      sendTelegramAlert(
        '⚠️ <b>Vendor Not Registered on Bot</b>\n'
        + '━━━━━━━━━━━━━━━━━━\n'
        + '🏭 Vendor username: <code>@' + raw + '</code>\n'
        + '📋 Order: <b>' + (orderId || 'PO') + '</b>\n\n'
        + '<b>Action needed:</b>\n'
        + 'Ask the vendor to open Telegram, find the bot, and send /start.\n'
        + 'The purchase order will be delivered automatically once they do.\n\n'
        + '💡 <i>Once registered, all future POs will be instant.</i>'
      );
      return;
    }
  }

  // Send the purchase order WITH interactive vendor buttons
  var poButtons = [
    [{ text: '✅ Accept Order',      callback_data: 'po_accept_'  + (orderId || 'PO') },
     { text: '❌ Decline Order',     callback_data: 'po_decline_' + (orderId || 'PO') }],
    [{ text: '💬 Request Changes',   callback_data: 'po_changes_' + (orderId || 'PO') },
     { text: '📋 View Full Details', callback_data: 'po_view_'    + (orderId || 'PO') }]
  ];

  var sent = _sendWithButtonsResult(targetId, message, poButtons);
  if (!sent) {
    Logger.log('Vendor delivery failed to ' + targetId + ', storing pending.');
    _storePendingVendorMessage(targetId, raw, orderId || 'PO', message);
    sendTelegramAlert(
      '⚠️ <b>Vendor Delivery Failed</b>\n'
      + 'Chat ID: <code>' + targetId + '</code>\n'
      + 'Username: @' + raw + '\n'
      + 'Order: <b>' + (orderId || 'PO') + '</b>\n'
      + 'The message was saved and will retry automatically.'
    );
  }
}

// _sendWithButtonsResult — returns true if sent OK
function _sendWithButtonsResult(chatId, text, buttons) {
  if (!TELEGRAM_TOKEN || !chatId) return false;
  try {
    var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId, text: text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }),
      muteHttpExceptions: true
    });
    return resp.getResponseCode() === 200;
  } catch(e) { Logger.log('_sendWithButtonsResult: ' + e); return false; }
}

// Store undelivered vendor PO for later retry
function _storePendingVendorMessage(chatIdOrUsername, vendorName, orderId, message) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('PendingVendorMessages');
    if (!sheet) {
      sheet = ss.insertSheet('PendingVendorMessages');
      sheet.appendRow(['stored_at','vendor_name','order_id','chat_id_or_username','message','delivered','delivered_at']);
    }
    sheet.appendRow([new Date(), vendorName, orderId, chatIdOrUsername, message, 'NO', '']);
  } catch(e) { Logger.log('_storePendingVendorMessage: ' + e); }
}

// Look up vendor chat ID by PO reference (for change approval flow)
function _lookupVendorChatIdByPO(orderId) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('PendingVendorMessages');
    if (!sheet) return null;
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0].map(function(h){ return h ? h.toString().toLowerCase().trim() : ''; });
    var oidC  = hdrs.indexOf('order_id');
    var cidC  = hdrs.indexOf('chat_id_or_username');
    for (var i = data.length-1; i >= 1; i--) {
      if (str(data[i][oidC]) === orderId) return str(data[i][cidC]);
    }
    return null;
  } catch(e) { return null; }
}

// Look up a numeric Telegram chat ID by username from the TelegramUsers sheet
function _lookupTelegramChatId(username) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('TelegramUsers');
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return null;
    var hdrs = data[0].map(function(h){ return h ? h.toString().trim().toLowerCase() : ''; });
    var cidC = hdrs.indexOf('chat_id');
    var unC  = hdrs.indexOf('username');
    if (cidC === -1 || unC === -1) return null;
    for (var i = 1; i < data.length; i++) {
      var un = str(data[i][unC]).toLowerCase().replace('@','');
      if (un === username && str(data[i][cidC])) return str(data[i][cidC]);
    }
    return null;
  } catch (e) { Logger.log('_lookupTelegramChatId: ' + e); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  RICH ORDER NOTIFICATION (with inline action buttons)
//  Called from processSubmission — replaces plain sendTelegramAlert for orders
// ─────────────────────────────────────────────────────────────────────────────
function sendOrderNotification(formType, orderId, data, itemLines, now) {
  var isFranchise = (formType === 'Franchise');
  var icon  = isFranchise ? '📦' : '🛒';
  var title = isFranchise ? 'Bulk / Franchise Order' : 'New Sales Order';
  var locationLine = str(data.city || data.location || '');
  if (data.country && data.country.trim()) locationLine += ', ' + str(data.country);

  var msg =
    icon + ' <b>' + title + '</b>\n'
    + '━━━━━━━━━━━━━━━━━━\n'
    + '🆔 Order ID: <b>' + str(orderId) + '</b>\n'
    + '👤 Customer: ' + str(data.entityName) + '\n'
    + '📞 Phone: ' + str(data.phoneNumber) + '\n'
    + '📋 Order Type: ' + str(data.orderType) + '\n'
    + (isFranchise && data.franchiseType ? '🏪 Franchise Type: ' + str(data.franchiseType) + '\n' : '')
    + '📍 Location: ' + locationLine + '\n'
    + '🧾 Items:\n' + (itemLines || '  • (see sheet)\n')
    + (!isFranchise ? '💰 Total: <b>' + str(data.totalPay) + ' ETB</b>\n' : '')
    + '🧑‍💼 By: ' + str(data.employeeId || 'guest') + '\n'
    + '🕐 ' + now;

  // Inline action buttons for quick management from Telegram
  var buttons = [
    [{ text: '✅ Confirm',   callback_data: 'confirm_'  + orderId },
     { text: '📦 Pack',      callback_data: 'pack_'     + orderId }],
    [{ text: '🚚 In Transit',callback_data: 'deliver_'  + orderId },
     { text: '🎉 Delivered', callback_data: 'done_'     + orderId }],
    [{ text: '❌ Cancel',    callback_data: 'cancel_'   + orderId },
     { text: '🔍 Details',   callback_data: 'detail_'   + orderId }]
  ];

  if (isFranchise) {
    // Franchise → admin channel only (with buttons)
    _sendWithButtons(TELEGRAM_CHAT, msg, buttons);
  } else {
    // Sales → admin channel + individual sales team members
    _sendWithButtons(TELEGRAM_CHAT, msg, buttons);
    for (var i = 0; i < SALES_TEAM.length; i++) {
      if (SALES_TEAM[i].chatId) _sendWithButtons(SALES_TEAM[i].chatId, msg, buttons);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WEBHOOK HANDLER — receives all Telegram bot messages & button clicks
// ─────────────────────────────────────────────────────────────────────────────
function handleTelegramWebhook(update) {
  try {
    // ── Deduplication: skip updates we've already processed ──
    // Telegram retries webhooks that don't respond in time; this prevents loops.
    var uid = update.update_id;
    if (uid !== undefined) {
      var props   = PropertiesService.getScriptProperties();
      var lastUid = parseInt(props.getProperty('last_update_id') || '0', 10);
      if (uid <= lastUid) {
        Logger.log('Skipping duplicate update_id: ' + uid);
        return; // already processed
      }
      props.setProperty('last_update_id', String(uid));
    }

    var message       = update.message || update.edited_message;
    var callbackQuery = update.callback_query;

    // ── Inline button callbacks ──────────────────────────────────────
    if (callbackQuery) {
      var cData   = callbackQuery.data || '';
      var cChatId = str(callbackQuery.message.chat.id);
      var cMsgId  = callbackQuery.message.message_id;
      _answerCallback(callbackQuery.id);

      var oid, r;
      if      (cData.indexOf('confirm_') === 0) {
        oid = cData.slice(8);
        r = updateOrderStatus(oid, 'Confirmed', 'Confirmed via Telegram', 'TelegramBot', {});
        _sendTelegramTo(cChatId, r.success ? '✅ Order <b>' + oid + '</b> confirmed!' : '❌ ' + r.message);
        if (r.success) _editMessageAppend(cChatId, cMsgId, callbackQuery.message.text, '\n✅ CONFIRMED');
      } else if (cData.indexOf('pack_') === 0) {
        oid = cData.slice(5);
        r = updateOrderStatus(oid, 'Packed', 'Packed via Telegram', 'TelegramBot', {});
        _sendTelegramTo(cChatId, r.success ? '📦 Order <b>' + oid + '</b> marked Packed!' : '❌ ' + r.message);
      } else if (cData.indexOf('po_approvechg_') === 0) {
        var poId = cData.slice(14);
        // Notify vendor that changes were approved
        var vendorChatId = _lookupVendorChatIdByPO(poId);
        if (vendorChatId) {
          _sendTelegramTo(vendorChatId,
            '✅ <b>Changes Approved</b>'
            + 'PO Ref: <b>' + poId + '</b>'
            + 'The Asella team has approved your requested changes.'
            + 'A revised order will be sent to you shortly.'
          );
        }
        _sendTelegramTo(cChatId, '✅ Vendor notified that changes are approved for ' + poId);

      } else if (cData.indexOf('po_rejectchg_') === 0) {
        var poId = cData.slice(13);
        var vendorChatId2 = _lookupVendorChatIdByPO(poId);
        if (vendorChatId2) {
          _sendTelegramTo(vendorChatId2,
            '❌ <b>Change Request Not Approved</b>'
            + 'PO Ref: <b>' + poId + '</b>'
            + 'The Asella team cannot accommodate the requested changes.'
            + 'Please proceed with the original order or contact us directly.'
          );
        }
        _sendTelegramTo(cChatId, '✅ Vendor notified that changes were rejected for ' + poId);

      } else if (cData.indexOf('deliver_') === 0) {
        oid = cData.slice(8);
        r = updateOrderStatus(oid, 'In Transit', 'In Transit via Telegram', 'TelegramBot', {});
        _sendTelegramTo(cChatId, r.success ? '🚚 Order <b>' + oid + '</b> in transit!' : '❌ ' + r.message);
      } else if (cData.indexOf('done_') === 0) {
        oid = cData.slice(5);
        r = updateOrderStatus(oid, 'Delivered', 'Delivered via Telegram', 'TelegramBot', {});
        _sendTelegramTo(cChatId, r.success ? '🎉 Order <b>' + oid + '</b> delivered!' : '❌ ' + r.message);
      } else if (cData.indexOf('cancel_') === 0) {
        oid = cData.slice(7);
        r = updateOrderStatus(oid, 'Cancelled', 'Cancelled via Telegram', 'TelegramBot', {});
        _sendTelegramTo(cChatId, r.success ? '❌ Order <b>' + oid + '</b> cancelled.' : '❌ ' + r.message);
      } else if (cData.indexOf('detail_') === 0) {
        oid = cData.slice(7);
        _sendOrderDetail(cChatId, oid);
      } else if (cData === 'pending_orders')    { _sendPendingOrders(cChatId);
      } else if (cData === 'today_orders')      { _sendTodayOrders(cChatId);
      } else if (cData === 'week_orders')       { _sendWeekOrders(cChatId);
      } else if (cData === 'analytics_summary') { _sendAnalyticsSummary(cChatId);
      } else if (cData === 'overdue_orders')    { _sendOverdueOrders(cChatId);
      } else if (cData === 'my_po_orders')       { _sendVendorMyOrders(cChatId, callbackQuery.from);
      } else if (cData === 'export_csv')        {
        var cbP = PropertiesService.getScriptProperties();
        var cbK = 'export_cd_' + cChatId;
        if (Date.now() - parseInt(cbP.getProperty(cbK)||'0',10) < 60000) {
          _sendTelegramTo(cChatId, '⏳ Export already running. Wait 60 seconds.');
        } else {
          cbP.setProperty(cbK, String(Date.now()));
          _sendTelegramTo(cChatId, '⏳ Generating CSV…');
          var url = exportOrdersToCsv();
          _sendTelegramTo(cChatId, url ? '📥 <a href="' + url + '">Download Orders CSV</a>' : '❌ Export failed.');
        }

      // ── VENDOR PURCHASE ORDER RESPONSES ───────────────────────────────
      } else if (cData.indexOf('po_accept_') === 0) {
        var poId = cData.slice(10);
        _handleVendorResponse(cChatId, poId, 'accepted', callbackQuery.message.from);
        _editMessageAppend(cChatId, cMsgId, callbackQuery.message.text, '✅ <b>YOU ACCEPTED THIS ORDER</b>');

      } else if (cData.indexOf('po_decline_') === 0) {
        var poId = cData.slice(11);
        _handleVendorResponse(cChatId, poId, 'declined', callbackQuery.message.from);
        _editMessageAppend(cChatId, cMsgId, callbackQuery.message.text, '❌ <b>YOU DECLINED THIS ORDER</b>');

 } else if (cData.indexOf('po_changes_') === 0) {
        var poId = cData.slice(11);
        _sendTelegramTo(cChatId,
          '💬 <b>Request Changes for ' + poId + '</b>'
          + 'Please reply with your message, e.g.:'
          + '<i>"I can deliver 80 units instead of 100 by March 15"</i>'
          + 'Your message will be forwarded to the Asella team.'
        );
        // Store that we're waiting for a reply from this vendor about this PO
        PropertiesService.getScriptProperties().setProperty(
          'vendor_reply_' + cChatId, poId + '|changes_requested'
        );

      } else if (cData.indexOf('po_view_') === 0) {
        var poId = cData.slice(8);
        _sendVendorPODetails(cChatId, poId);
      }
      return;
    }

    if (!message || !message.text) return;

    var chatId = str(message.chat.id);
    var text   = message.text.trim();
    var lower  = text.toLowerCase();
    var from   = message.from || {};

    // ── Auto-register on every message (keeps record fresh) ─────────
    _registerChatUser(chatId, from);

    // ── On /start: retry any pending vendor messages for this user ──
    if ((from.username || chatId) && (cmd === 'start')) {
      _retryPendingForUser(chatId, from.username || '');
    }

    // ── Check if vendor is in a reply flow (awaiting change request text) ──
    var vendorReplyKey = 'vendor_reply_' + chatId;
    var pendingReply   = PropertiesService.getScriptProperties().getProperty(vendorReplyKey);
    if (pendingReply && !text.startsWith('/')) {
      var prParts = pendingReply.split('|');
      var prPoId  = prParts[0];
      // Forward their message to manager
      _sendWithButtons(MANAGER_CHAT,
        '💬 <b>Vendor Change Request</b>'
        + '━━━━━━━━━━━━━━━━━━'
        + '🏭 Vendor: ' + (from.username ? '@' + from.username : str(chatId)) + ''
        + '📋 PO Ref: <b>' + prPoId + '</b>'
        + '💬 Message:<i>' + text + '</i>',
        [[{text:'✅ Approve Changes', callback_data:'po_approvechg_'+prPoId},
          {text:'❌ Reject Changes',  callback_data:'po_rejectchg_'+prPoId}]]
      );
      _sendTelegramTo(chatId,
        '✅ Your message has been forwarded to the Asella team.'
        + 'They will review your request and get back to you shortly.'
      );
      PropertiesService.getScriptProperties().deleteProperty(vendorReplyKey);
      return;
    }

    // ── Parse command and optional argument ─────────────────────────
    var parts   = text.replace(/\s+/g,' ').split(' ');
    var cmd     = (parts[0] || '').toLowerCase().replace(/^\//, '');
    var arg     = parts.slice(1).join(' ').trim();
    var argUp   = arg.toUpperCase();

    // ══════════════════════════════════════════════════════════════════
    //  COMMAND ROUTER
    // ══════════════════════════════════════════════════════════════════

    // ── Determine role for this user ──────────────────────────────────
    var userRole = _getBotRole(chatId, from.username || '');

    if (cmd === 'start' || cmd === 'help') {
      _sendHelpMenu(chatId, from, userRole);

    } else if (cmd === 'myid' || cmd === 'id') {
      _sendTelegramTo(chatId,
        '🆔 <b>Your Telegram Info</b>\n'
        + '━━━━━━━━━━━━━━━━━━\n'
        + 'Chat ID: <code>' + chatId + '</code>\n'
        + 'Username: ' + (from.username ? '@' + from.username : '(none set)') + '\n'
        + 'Name: ' + (from.first_name || '') + (from.last_name ? ' ' + from.last_name : '') + '\n\n'
        + '📋 <b>Share this Chat ID with Asella Organic</b>\n'
        + 'to receive vendor purchase orders and notifications.\n'
        + 'Your ID: <code>' + chatId + '</code>'
      );

    } else if (cmd === 'register') {
      _sendTelegramTo(chatId,
        '✅ <b>Registered!</b>\n'
        + 'Chat ID: <code>' + chatId + '</code>\n'
        + 'You will now receive order notifications.\n\n'
        + '<b>To receive vendor PO notifications:</b>\n'
        + 'Give your Chat ID to Asella staff when creating your vendor profile:\n'
        + '<code>' + chatId + '</code>'
      );

    } else if (userRole === 'vendor') {
      // ── VENDOR — handle vendor-specific callbacks only ──────────────
      // Vendors can only interact with their own purchase orders (PO buttons)
      // All internal management commands are hidden from vendors
      _sendTelegramTo(chatId,
        'ℹ️ Use the buttons on your purchase orders to respond.\n'
        + 'Type /help to see your options.'
      );

    } else if (cmd === 'pending') {
      _sendPendingOrders(chatId);

    } else if (cmd === 'today') {
      _sendTodayOrders(chatId);

    } else if (cmd === 'week') {
      _sendWeekOrders(chatId);

    } else if (cmd === 'month') {
      _sendMonthOrders(chatId);

    } else if (cmd === 'stats' || cmd === 'analytics') {
      _sendAnalyticsSummary(chatId);

    } else if (cmd === 'overdue') {
      _sendOverdueOrders(chatId);

    } else if (cmd === 'order' && argUp) {
      _sendOrderDetail(chatId, argUp);

    } else if (cmd === 'search' && arg) {
      _searchOrders(chatId, arg);

    } else if (cmd === 'confirm' && argUp) {
      var r2 = updateOrderStatus(argUp, 'Confirmed', 'Confirmed via Telegram by '+str(from.first_name||chatId), 'TelegramBot', {});
      _sendTelegramTo(chatId, r2.success ? '✅ Order <b>' + argUp + '</b> confirmed!' : '❌ ' + r2.message);

    } else if (cmd === 'pack' && argUp) {
      var r3 = updateOrderStatus(argUp, 'Packed', 'Packed via Telegram', 'TelegramBot', {});
      _sendTelegramTo(chatId, r3.success ? '📦 Order <b>' + argUp + '</b> marked Packed!' : '❌ ' + r3.message);

    } else if (cmd === 'deliver' && argUp) {
      var r4 = updateOrderStatus(argUp, 'In Transit', 'In Transit via Telegram', 'TelegramBot', {});
      _sendTelegramTo(chatId, r4.success ? '🚚 Order <b>' + argUp + '</b> in transit!' : '❌ ' + r4.message);

    } else if (cmd === 'done' && argUp) {
      var r5 = updateOrderStatus(argUp, 'Delivered', 'Delivered via Telegram', 'TelegramBot', {});
      _sendTelegramTo(chatId, r5.success ? '🎉 Order <b>' + argUp + '</b> delivered!' : '❌ ' + r5.message);

    } else if (cmd === 'cancel' && argUp) {
      var r6 = updateOrderStatus(argUp, 'Cancelled', 'Cancelled via Telegram', 'TelegramBot', {});
      _sendTelegramTo(chatId, r6.success ? '❌ Order <b>' + argUp + '</b> cancelled.' : '❌ ' + r6.message);

    } else if (cmd === 'status' && argUp) {
      // /status ORD-XXXX STATUS  e.g. /status ORD-20260306-0001 Delivered
      var parts2 = argUp.split(' ');
      var sid = parts2[0];
      var sst = parts2.slice(1).join(' ');
      var validStatuses = ['Pending','Confirmed','Packed','In Transit','Delivered','Cancelled'];
      var matchedStatus = validStatuses.filter(function(s){ return s.toLowerCase() === sst.toLowerCase(); })[0];
      if (!matchedStatus) {
        _sendTelegramTo(chatId, '❌ Unknown status. Valid: Pending, Confirmed, Packed, In Transit, Delivered, Cancelled');
      } else {
        var r7 = updateOrderStatus(sid, matchedStatus, 'Updated via Telegram', 'TelegramBot', {});
        _sendTelegramTo(chatId, r7.success ? STATUS_EMOJI[matchedStatus] + ' Order <b>' + sid + '</b> → ' + matchedStatus : '❌ ' + r7.message);
      }

    } else if (cmd === 'export') {
      var expProps2 = PropertiesService.getScriptProperties();
      var expKey2   = 'export_cd_' + chatId;
      var lastExp2  = parseInt(expProps2.getProperty(expKey2) || '0', 10);
      if (Date.now() - lastExp2 < 60000) {
        _sendTelegramTo(chatId, '⏳ Export already running. Wait 60 seconds between exports.');
      } else {
        expProps2.setProperty(expKey2, String(Date.now()));
        _sendTelegramTo(chatId, '⏳ Generating CSV export…');
        var csvUrl = exportOrdersToCsv();
        _sendTelegramTo(chatId, csvUrl ? '📥 <a href="' + csvUrl + '">Download Orders CSV</a>' : '❌ Export failed. Check GAS logs.');
      }

    } else if (cmd === 'broadcast' && arg) {
      // Admin-only broadcast to all registered users
      if (str(chatId) !== str(TELEGRAM_CHAT)) {
        _sendTelegramTo(chatId, '❌ Broadcast is admin-only.');
      } else {
        var bCount = _broadcastToAllUsers('📢 <b>Asella Organic</b>\n' + arg);
        _sendTelegramTo(chatId, '✅ Broadcast sent to ' + bCount + ' registered users.');
      }

    } else if (cmd === 'team') {
      var teamMsg = '👥 <b>Sales Team</b>\n━━━━━━━━━━━━━━━━━━\n';
      SALES_TEAM.forEach(function(m) {
        teamMsg += (m.chatId ? '🟢' : '⚫') + ' ' + m.name + ': ' + (m.chatId ? '<code>' + m.chatId + '</code>' : 'No ID set') + '\n';
      });
      _sendTelegramTo(chatId, teamMsg);

    } else if (cmd === 'low' || cmd === 'stock') {
      _sendLowStockSummary(chatId);

    } else if (cmd === 'myorders' || cmd === 'mypo') {
      // Vendor views their own purchase orders
      _sendVendorMyOrders(chatId, from);

    } else {
      // Try treating raw input as an order ID
      if (/^ORD-\d{8}-\d{4}/i.test(text)) {
        _sendOrderDetail(chatId, text.trim().toUpperCase());
      } else {
        _sendTelegramTo(chatId, 'Unknown command. Type /help to see all commands.');
      }
    }

  } catch (e) { Logger.log('handleTelegramWebhook: ' + e); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOT HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function _sendHelpMenu(chatId, from, role) {
  var name = (from && from.first_name) ? from.first_name : 'there';
  role = role || _getBotRole(chatId, (from && from.username) || '');

  // ── VENDOR menu ─────────────────────────────────────────────────────────
  if (role === 'vendor') {
    _sendWithButtons(chatId,
      '🌿 <b>Asella Organic — Supplier Portal</b>'
      + '━━━━━━━━━━━━━━━━━━'
      + 'Hello ' + name + '! 👋'
      + 'You are registered as a <b>supplier/vendor</b>.'
      + 'When Asella Organic sends you a purchase order, you will receive it here.'
      + 'You can then <b>Accept</b>, <b>Decline</b>, or <b>Request Changes</b> directly from this chat.'
      + '<b>Your commands:</b>'
      + '/myid — See your Telegram ID'
      + '/myorders — View your recent purchase orders'
      + '📋 <i>Share your Telegram username with Asella staff so they can send you orders.</i>',
      [[{ text: '📦 My Purchase Orders', callback_data: 'my_po_orders' }]]
    );
    return;
  }

  // ── SALES TEAM menu ──────────────────────────────────────────────────────
  if (role === 'sales') {
    _sendWithButtons(chatId,
      '🌿 <b>Asella Organic — Sales Portal</b>'
      + '━━━━━━━━━━━━━━━━━━'
      + 'Hello ' + name + '! 🧑‍💼'
      + '<b>📋 Your Orders</b>'
      + '/pending — Pending orders'
      + '/today — Todays orders'
      + '/week — This weeks summary'
      + '/order ORD-XXXX — Order details'
      + '/search NAME — Search customer'
      + '<b>⚙️ Update Status</b>'
      + '/confirm ORD-XXXX'
      + '/pack ORD-XXXX'
      + '/deliver ORD-XXXX'
      + '/done ORD-XXXX'
      + '/cancel ORD-XXXX'
      + '<b>🔧 Tools</b>'
      + '/stats — Summary'
      + '/myid — Your chat ID',
      [
        [{ text: '📋 Pending',  callback_data: 'pending_orders' },
         { text: '📅 Today',    callback_data: 'today_orders' }],
        [{ text: '📆 This Week',callback_data: 'week_orders' },
         { text: '📊 Stats',    callback_data: 'analytics_summary' }]
      ]
    );
    return;
  }

  // ── MANAGER / ADMIN menu (full access) ──────────────────────────────────
  _sendWithButtons(chatId,
    '🌿 <b>Asella Organic Bot — Manager Dashboard</b>'
    + '━━━━━━━━━━━━━━━━━━'
    + 'Hello ' + name + '! 👑'
    + '<b>📋 Orders</b>'
    + '/pending — Pending orders'

    + '/today — Todays  orders & revenue'
    + '/week — 7-day summary'
    + '/month — Monthly report'
    + '/overdue — Stuck/overdue orders'
    + '/order ORD-XXXX — Order details'
    + '/search NAME — Search by customer'
    + '<b>⚙️ Update Orders</b>'
    + '/confirm /pack /deliver /done /cancel ORD-XXXX'
    + '<b>📊 Analytics</b>'
    + '/stats — Business summary'
    + '/low — Stock requests'
    + '<b>🏭 Vendors</b>'
    + '/vendors — Recent vendor orders'
    + '<b>🔧 Tools</b>'
    + '/export — Download CSV'
    + '/broadcast MSG — Message all users'
    + '/team — Sales team status',
    [
      [{ text: '📋 Pending',   callback_data: 'pending_orders' },
       { text: '📅 Today',     callback_data: 'today_orders' }],
      [{ text: '📆 This Week', callback_data: 'week_orders' },
       { text: '📊 Stats',     callback_data: 'analytics_summary' }],
      [{ text: '⚠️ Overdue',  callback_data: 'overdue_orders' },
       { text: '📥 Export',   callback_data: 'export_csv' }]
    ]
  );
}

function _sendPendingOrders(chatId) {
  try {
    var raw     = getOrderTrackingData({}, 'admin');
    var rows    = JSON.parse(raw).rows || [];
    var pending = rows.filter(function(r){ return r.Status === 'Pending'; });
    if (!pending.length) { _sendTelegramTo(chatId, '✅ No pending orders right now!'); return; }
    pending.sort(function(a,b){ return new Date(a.Timestamp||0) - new Date(b.Timestamp||0); }); // oldest first
    var msg = '⏳ <b>Pending Orders (' + pending.length + ')</b>\n━━━━━━━━━━━━━━━━━━\n';
    // Show unique orders (group items)
    var seen = {}, uniquePending = [];
    pending.forEach(function(o) {
      if (!seen[o.OrderID]) { seen[o.OrderID] = true; uniquePending.push(o); }
    });
    uniquePending.slice(0, 8).forEach(function(o) {
      var age = o.Timestamp ? _ageLabel(new Date(o.Timestamp)) : '?';
      msg += '🆔 <b>' + o.OrderID + '</b> — ' + o.CustomerName + '\n'
           + '  📦 ' + o.ItemName + (o.PackageSize ? ' [' + o.PackageSize + ']' : '') + ' × ' + o.Quantity + '\n'
           + '  📞 ' + o.Phone + '  ⏱ ' + age + '\n';
    });
    if (uniquePending.length > 8) msg += '…and ' + (uniquePending.length - 8) + ' more.\n';
    msg += '\nUse /confirm ORD-XXXX or tap buttons below:';
    _sendTelegramTo(chatId, msg);
    // Action buttons for first 3
    uniquePending.slice(0, 3).forEach(function(o) {
      _sendWithButtons(chatId,
        '⚡ <b>' + o.OrderID + '</b> — ' + o.CustomerName,
        [
          [{ text: '✅ Confirm', callback_data: 'confirm_' + o.OrderID },
           { text: '📦 Pack',   callback_data: 'pack_'    + o.OrderID }],
          [{ text: '🚚 Transit',callback_data: 'deliver_' + o.OrderID },
           { text: '🔍 Detail', callback_data: 'detail_'  + o.OrderID }],
          [{ text: '❌ Cancel', callback_data: 'cancel_'  + o.OrderID }]
        ]
      );
    });
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _sendTodayOrders(chatId) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var tz   = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var todayRows = rows.filter(function(r){
      return r.Timestamp && r.Timestamp.slice(0, 10) === today;
    });
    if (!todayRows.length) { _sendTelegramTo(chatId, '📅 No orders today yet.'); return; }
    var totalRev = todayRows.reduce(function(s, r){ return s + (parseFloat(r.Total) || 0); }, 0);
    // Count unique orders
    var uniqueIds = {};
    todayRows.forEach(function(r){ uniqueIds[r.OrderID] = true; });
    var orderCount = Object.keys(uniqueIds).length;
    var pending   = todayRows.filter(function(r){ return r.Status === 'Pending'; }).length;
    var delivered = todayRows.filter(function(r){ return r.Status === 'Delivered'; }).length;
    var msg = '📅 <b>Today\'s Orders</b>\n'
            + '━━━━━━━━━━━━━━━━━━\n'
            + '📦 Orders: <b>' + orderCount + '</b>  ⏳ Pending: ' + pending + '  🎉 Done: ' + delivered + '\n'
            + '💰 Revenue: <b>ETB ' + Number(totalRev).toLocaleString() + '</b>\n'
            + '━━━━━━━━━━━━━━━━━━\n';
    // Show unique orders
    var seen2 = {};
    todayRows.sort(function(a,b){ return new Date(b.Timestamp||0) - new Date(a.Timestamp||0); });
    todayRows.forEach(function(o) {
      if (seen2[o.OrderID]) return;
      seen2[o.OrderID] = true;
      var src = o.Source === 'Franchise_DB' ? '📦' : '🛒';
      var sEmoji = STATUS_EMOJI[o.Status] || '❓';
      msg += src + ' <b>' + o.OrderID + '</b> ' + o.CustomerName + ' ' + sEmoji + '\n'
           + '  ' + o.ItemName + (o.PackageSize ? ' [' + o.PackageSize + ']' : '') + ' × ' + o.Quantity + '\n';
    });
    _sendWithButtons(chatId, msg, [
      [{ text: '⏳ Show Pending', callback_data: 'pending_orders' },
       { text: '📊 Full Stats',  callback_data: 'analytics_summary' }]
    ]);
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _sendWeekOrders(chatId) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var now  = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    var weekRows = rows.filter(function(r){
      return r.Timestamp && new Date(r.Timestamp) >= weekAgo;
    });
    var totalRev = weekRows.reduce(function(s, r){ return s + (parseFloat(r.Total) || 0); }, 0);
    var uniqueIds = {};
    weekRows.forEach(function(r){ uniqueIds[r.OrderID] = true; });
    var orderCount = Object.keys(uniqueIds).length;
    var pending   = weekRows.filter(function(r){ return r.Status === 'Pending'; }).length;
    var delivered = weekRows.filter(function(r){ return r.Status === 'Delivered'; }).length;
    // Daily breakdown
    var byDay = {};
    weekRows.forEach(function(r) {
      var d = r.Timestamp ? r.Timestamp.slice(0, 10) : '?';
      if (!byDay[d]) byDay[d] = { count: 0, rev: 0 };
      byDay[d].count++;
      byDay[d].rev += parseFloat(r.Total) || 0;
    });
    var dayLines = '';
    Object.keys(byDay).sort().reverse().slice(0, 7).forEach(function(d) {
      dayLines += '  ' + d + ': ' + byDay[d].count + ' items, ETB ' + Number(byDay[d].rev).toLocaleString() + '\n';
    });
    _sendTelegramTo(chatId,
      '📆 <b>Last 7 Days</b>\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '📦 Orders: <b>' + orderCount + '</b>\n'
      + '💰 Revenue: <b>ETB ' + Number(totalRev).toLocaleString() + '</b>\n'
      + '⏳ Pending: ' + pending + '  🎉 Delivered: ' + delivered + '\n'
      + '📈 Avg/day: ETB ' + Math.round(totalRev / 7).toLocaleString() + '\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '<b>Daily Breakdown:</b>\n' + (dayLines || '  No data\n')
    );
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _sendMonthOrders(chatId) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var tz   = Session.getScriptTimeZone();
    var thisMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    var monthRows = rows.filter(function(r){
      return r.Timestamp && r.Timestamp.slice(0, 7) === thisMonth;
    });
    var totalRev = monthRows.reduce(function(s, r){ return s + (parseFloat(r.Total) || 0); }, 0);
    var uniqueIds = {};
    monthRows.forEach(function(r){ uniqueIds[r.OrderID] = true; });
    // Item popularity this month
    var itemCounts = {};
    monthRows.forEach(function(r){ if(r.ItemName) itemCounts[r.ItemName] = (itemCounts[r.ItemName]||0)+1; });
    var topItem = Object.keys(itemCounts).sort(function(a,b){ return itemCounts[b]-itemCounts[a]; })[0] || '—';
    _sendTelegramTo(chatId,
      '📅 <b>' + thisMonth + ' Monthly Report</b>\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '📦 Orders: <b>' + Object.keys(uniqueIds).length + '</b>\n'
      + '💰 Revenue: <b>ETB ' + Number(totalRev).toLocaleString() + '</b>\n'
      + '🏆 Top Item: ' + topItem + '\n'
    );
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _sendOverdueOrders(chatId) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var cutoff = new Date(Date.now() - 24 * 3600 * 1000); // 24h ago
    var overdue = rows.filter(function(r){
      return r.Status === 'Pending' && r.Timestamp && new Date(r.Timestamp) < cutoff;
    });
    var seen3 = {}, uniqueOverdue = [];
    overdue.forEach(function(o){ if(!seen3[o.OrderID]){ seen3[o.OrderID]=true; uniqueOverdue.push(o); }});
    if (!uniqueOverdue.length) { _sendTelegramTo(chatId, '✅ No overdue orders! Everything is on track.'); return; }
    var msg = '⚠️ <b>Overdue Orders (' + uniqueOverdue.length + ')</b>\n'
            + 'Pending for more than 24 hours:\n━━━━━━━━━━━━━━━━━━\n';
    uniqueOverdue.slice(0, 8).forEach(function(o) {
      msg += '🆔 <b>' + o.OrderID + '</b> — ' + o.CustomerName + '\n'
           + '  ⏱ Waiting: ' + _ageLabel(new Date(o.Timestamp)) + '\n'
           + '  📞 ' + o.Phone + '\n';
    });
    _sendTelegramTo(chatId, msg);
    // Action buttons for first 2 overdue
    uniqueOverdue.slice(0, 2).forEach(function(o) {
      _sendWithButtons(chatId, '⚡ Act on <b>' + o.OrderID + '</b> — ' + o.CustomerName,
        [[{ text: '✅ Confirm', callback_data: 'confirm_' + o.OrderID },
          { text: '❌ Cancel',  callback_data: 'cancel_'  + o.OrderID }]]
      );
    });
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _sendOrderDetail(chatId, orderId) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var matches = rows.filter(function(r){ return r.OrderID === orderId; });
    if (!matches.length) { _sendTelegramTo(chatId, '❌ Order <b>' + orderId + '</b> not found.'); return; }
    var o = matches[0];
    var itemLines = matches.map(function(m){
      return '  • ' + m.ItemName + (m.PackageSize ? ' [' + m.PackageSize + ']' : '') + ' × ' + m.Quantity
           + (m.DeliveryDate ? ' (by ' + m.DeliveryDate.slice(0,10) + ')' : '');
    }).join('\n');
    var sEmoji = STATUS_EMOJI[o.Status] || '❓';
    var msg = '📋 <b>Order Details</b>\n'
            + '━━━━━━━━━━━━━━━━━━\n'
            + '🆔 ID: <b>' + o.OrderID + '</b>\n'
            + '👤 Customer: ' + o.CustomerName + '\n'
            + '📞 Phone: ' + o.Phone + '\n'
            + '📍 Location: ' + (o.City || o.Location || '—') + '\n'
            + '🔖 Status: ' + sEmoji + ' <b>' + o.Status + '</b>\n'
            + '📋 Order Type: ' + (o.OrderType || '—') + '\n'
            + '🧑‍💼 Employee: ' + o.EmployeeID + '\n'
            + '📅 Date: ' + (o.Timestamp ? o.Timestamp.slice(0,10) : '—') + '\n'
            + '⏱ Age: ' + (o.Timestamp ? _ageLabel(new Date(o.Timestamp)) : '—') + '\n'
            + '🧾 Items:\n' + itemLines + '\n'
            + '💰 Total: <b>ETB ' + (o.Total ? Number(o.Total).toLocaleString() : '—') + '</b>\n'
            + (o.Notes ? '📝 Notes: ' + o.Notes + '\n' : '');
    _sendWithButtons(chatId, msg,
      [[{ text: '✅ Confirm',   callback_data: 'confirm_' + orderId },
        { text: '📦 Pack',     callback_data: 'pack_'    + orderId }],
       [{ text: '🚚 Transit',  callback_data: 'deliver_' + orderId },
        { text: '🎉 Delivered',callback_data: 'done_'    + orderId }],
       [{ text: '❌ Cancel',   callback_data: 'cancel_'  + orderId }]]
    );
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _searchOrders(chatId, query) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var q    = query.toLowerCase();
    var matches = rows.filter(function(r){
      return (r.CustomerName && r.CustomerName.toLowerCase().indexOf(q) > -1)
          || (r.Phone && r.Phone.indexOf(q) > -1)
          || (r.OrderID && r.OrderID.toLowerCase().indexOf(q) > -1);
    });
    if (!matches.length) { _sendTelegramTo(chatId, '🔍 No results for "' + query + '"'); return; }
    var seen4 = {}, uniqueMatches = [];
    matches.forEach(function(o){ if(!seen4[o.OrderID]){ seen4[o.OrderID]=true; uniqueMatches.push(o); }});
    var msg = '🔍 <b>Search: "' + query + '"</b> (' + uniqueMatches.length + ' found)\n━━━━━━━━━━━━━━━━━━\n';
    uniqueMatches.slice(0, 8).forEach(function(o) {
      var sEmoji = STATUS_EMOJI[o.Status] || '❓';
      msg += sEmoji + ' <b>' + o.OrderID + '</b> — ' + o.CustomerName + '\n'
           + '  📞 ' + o.Phone + '  📅 ' + (o.Timestamp ? o.Timestamp.slice(0,10) : '—') + '\n';
    });
    if (uniqueMatches.length > 8) msg += '…and ' + (uniqueMatches.length-8) + ' more.';
    _sendTelegramTo(chatId, msg);
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

function _sendAnalyticsSummary(chatId) {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var totalOrders = rows.length;
    var totalRev = rows.reduce(function(s,r){ return s + (parseFloat(r.Total)||0); }, 0);
    var pending   = rows.filter(function(r){ return r.Status==='Pending'; }).length;
    var confirmed = rows.filter(function(r){ return r.Status==='Confirmed'; }).length;
    var packed    = rows.filter(function(r){ return r.Status==='Packed'; }).length;
    var transit   = rows.filter(function(r){ return r.Status==='In Transit'; }).length;
    var delivered = rows.filter(function(r){ return r.Status==='Delivered'; }).length;
    var cancelled = rows.filter(function(r){ return r.Status==='Cancelled'; }).length;
    var tz    = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var todayCount = rows.filter(function(r){ return r.Timestamp && r.Timestamp.slice(0,10)===today; }).length;
    var thisMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    var monthCount = rows.filter(function(r){ return r.Timestamp && r.Timestamp.slice(0,7)===thisMonth; }).length;
    // Item ranking
    var itemCts = {};
    rows.forEach(function(r){ if(r.ItemName) itemCts[r.ItemName]=(itemCts[r.ItemName]||0)+1; });
    var topItem = Object.keys(itemCts).sort(function(a,b){ return itemCts[b]-itemCts[a]; })[0] || '—';
    _sendWithButtons(chatId,
      '📊 <b>Business Summary</b>\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '📦 Total Orders: <b>' + totalOrders + '</b>\n'
      + '📅 Today: <b>' + todayCount + '</b>  |  This Month: <b>' + monthCount + '</b>\n'
      + '💰 Total Revenue: <b>ETB ' + Number(totalRev).toLocaleString() + '</b>\n'
      + '🏆 Top Item: ' + topItem + '\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '⏳ Pending: ' + pending + '\n'
      + '✅ Confirmed: ' + confirmed + '\n'
      + '📦 Packed: ' + packed + '\n'
      + '🚚 In Transit: ' + transit + '\n'
      + '🎉 Delivered: ' + delivered + '\n'
      + '❌ Cancelled: ' + cancelled,
      [[{ text: '⏳ Pending Orders', callback_data: 'pending_orders' },
        { text: '📅 Today',        callback_data: 'today_orders' }],
       [{ text: '📆 This Week',    callback_data: 'week_orders' },
        { text: '📥 Export CSV',   callback_data: 'export_csv' }]]
    );
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

// ── Vendor response handler (Accept / Decline) ───────────────────────────
function _handleVendorResponse(chatId, poId, response, fromObj) {
  var vendorName = (fromObj && fromObj.username) ? '@' + fromObj.username
                 : (fromObj && fromObj.first_name) ? fromObj.first_name
                 : str(chatId);
  var icon  = response === 'accepted' ? '✅' : '❌';
  var label = response === 'accepted' ? 'ACCEPTED' : 'DECLINED';

  // Notify manager with full details
  _sendWithButtons(MANAGER_CHAT,
    icon + ' <b>Vendor ' + label + ' Purchase Order</b>\n'
    + '━━━━━━━━━━━━━━━━━━\n'
    + '🏭 Vendor: ' + vendorName + '\n'
    + '📋 PO Ref: <b>' + poId + '</b>\n'
    + '🕐 Time: ' + Utilities.formatDate(new Date(), 'Africa/Addis_Ababa', 'dd/MM/yyyy HH:mm'),
    response === 'accepted'
      ? [[{text:'📦 Mark as Processing', callback_data:'confirm_'+poId}]]
      : [[{text:'🔄 Send to Another Vendor', callback_data:'detail_'+poId}]]
  );
  // Also notify all sales team
  sendSalesTeamAlert(icon + ' Vendor ' + vendorName + ' has <b>' + label + '</b> PO <b>' + poId + '</b>');

  // Confirm to vendor
  _sendTelegramTo(chatId,
    response === 'accepted'
      ? '✅ <b>Thank you!</b>\nYour acceptance has been recorded for PO <b>' + poId + '</b>.\nThe Asella team will be in touch with next steps.'
      : '❌ <b>Noted.</b>\nYour decline has been recorded for PO <b>' + poId + '</b>.\nIf you change your mind, please contact us directly.'
  );
}

// ── Vendor views their own purchase orders ────────────────────────────────
function _sendVendorMyOrders(chatId, fromObj) {
  try {
    var username = (fromObj && fromObj.username) ? fromObj.username.toLowerCase() : '';
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Vendor_DB');
    if (!sheet || sheet.getLastRow() < 2) {
      _sendTelegramTo(chatId, '📦 No purchase orders found for your account.');
      return;
    }
    var data = sheet.getDataRange().getValues();
    var hdrs = data[0].map(function(h){ return h ? h.toString().toLowerCase().trim() : ''; });
    var nameC = hdrs.indexOf('vendor name');
    var teleC = hdrs.indexOf('telegram');
    var itemC = hdrs.indexOf('item');
    var amtC  = hdrs.indexOf('amount');
    var dateC = hdrs.indexOf('submission_date');
    var oidC  = hdrs.indexOf('order_id');
    var priceC= hdrs.indexOf('price');

    // Find rows belonging to this vendor (match by telegram username or chat ID)
    var myOrders = [];
    for (var i = 1; i < data.length; i++) {
      var tg = str(data[i][teleC] || '').toLowerCase().replace('@','');
      if (tg === username || tg === str(chatId)) {
        myOrders.push(data[i]);
      }
    }

    if (!myOrders.length) {
      _sendTelegramTo(chatId,
        '📦 No purchase orders found for your account.\n\n'
        + 'ℹ️ Make sure Asella staff have your Telegram username (<code>@' + (username || 'yours') + '</code>) in your vendor profile.'
      );
      return;
    }

    var msg = '📦 <b>Your Purchase Orders (' + myOrders.length + ')</b>\n━━━━━━━━━━━━━━━━━━\n';
    myOrders.slice(-5).reverse().forEach(function(row) {
      var oid  = oidC  > -1 ? str(row[oidC])  : '—';
      var item = itemC > -1 ? str(row[itemC])  : '—';
      var amt  = amtC  > -1 ? str(row[amtC])   : '—';
      var dt   = dateC > -1 ? str(row[dateC]).slice(0,10)  : '—';
      msg += '📋 <b>' + oid + '</b> (' + dt + ')\n  ' + item + ' × ' + amt + '\n';
    });

    _sendWithButtons(chatId, msg, [
      myOrders.slice(-3).map(function(row) {
        var oid = oidC > -1 ? str(row[oidC]) : 'PO';
        return { text: oid, callback_data: 'po_view_' + oid };
      })
    ]);
  } catch(e) { _sendTelegramTo(chatId, '❌ Error loading orders: ' + e.message); }
}

// ── Vendor views full PO details ─────────────────────────────────────────
function _sendVendorPODetails(chatId, poId) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Vendor_DB');
    if (!sheet) { _sendTelegramTo(chatId, '❌ Order not found.'); return; }
    var data = sheet.getDataRange().getValues();
    var hdrs = data[0].map(function(h){ return h ? h.toString().toLowerCase().trim() : ''; });
    var oidC  = hdrs.indexOf('order_id');
    var itemC = hdrs.indexOf('item');
    var amtC  = hdrs.indexOf('amount');
    var priceC= hdrs.indexOf('price');
    var ddC   = hdrs.indexOf('delivery date');
    var dateC = hdrs.indexOf('submission_date');

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      if (oidC > -1 && str(data[i][oidC]) === poId) rows.push(data[i]);
    }
    if (!rows.length) { _sendTelegramTo(chatId, '❌ PO <b>' + poId + '</b> not found.'); return; }

    var msg = '📋 <b>Purchase Order Details</b>\n━━━━━━━━━━━━━━━━━━\n'
            + '🆔 Ref: <b>' + poId + '</b>\n'
            + '📅 Date: ' + (dateC > -1 ? str(rows[0][dateC]).slice(0,10) : '—') + '\n'
            + '📦 Items:\n';
    rows.forEach(function(row) {
      msg += '  • ' + (itemC > -1 ? str(row[itemC]) : '—')
           + ' × ' + (amtC  > -1 ? str(row[amtC])  : '—');
      if (priceC > -1 && str(row[priceC])) msg += ' @ ETB ' + str(row[priceC]);
      if (ddC    > -1 && str(row[ddC]))   msg += ' | Deliver: ' + str(row[ddC]).slice(0,10);
      msg += '\n';
    });

    _sendWithButtons(chatId, msg, [
      [{ text: '✅ Accept',           callback_data: 'po_accept_'  + poId },
       { text: '❌ Decline',          callback_data: 'po_decline_' + poId }],
      [{ text: '💬 Request Changes',  callback_data: 'po_changes_' + poId }]
    ]);
  } catch(e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

// Retry pending vendor messages for a user who just sent /start
function _retryPendingForUser(chatId, username) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('PendingVendorMessages');
    if (!sheet || sheet.getLastRow() < 2) return;
    var data  = sheet.getDataRange().getValues();
    var hdrs  = data[0].map(function(h){ return h ? h.toString().toLowerCase().trim() : ''; });
    var cidC  = hdrs.indexOf('chat_id_or_username');
    var msgC  = hdrs.indexOf('message');
    var oidC  = hdrs.indexOf('order_id');
    var delC  = hdrs.indexOf('delivered');
    if (cidC === -1 || msgC === -1) return;

    var uname = (username || '').toLowerCase().replace('@','');
    var delivered = 0;

    for (var i = 1; i < data.length; i++) {
      if (str(data[i][delC] || '') === 'YES') continue; // already delivered
      var storedTarget = str(data[i][cidC]).toLowerCase().replace('@','');
      var matches = (storedTarget === str(chatId)) || (uname && storedTarget === uname);
      if (!matches) continue;

      var poId  = oidC > -1 ? str(data[i][oidC]) : 'PO';
      var msg   = msgC > -1 ? str(data[i][msgC])  : '📦 You have a pending purchase order.';

      var poButtons = [
        [{ text: '✅ Accept Order',      callback_data: 'po_accept_'  + poId },
         { text: '❌ Decline Order',     callback_data: 'po_decline_' + poId }],
        [{ text: '💬 Request Changes',   callback_data: 'po_changes_' + poId },
         { text: '📋 View Full Details', callback_data: 'po_view_'    + poId }]
      ];

      var sent = _sendWithButtonsResult(chatId, msg, poButtons);
      if (sent) {
        if (delC > -1) sheet.getRange(i+1, delC+1).setValue('YES');
        // Also write delivery time if column exists
        var delAtC = hdrs.indexOf('delivered_at');
        if (delAtC > -1) sheet.getRange(i+1, delAtC+1).setValue(new Date());
        delivered++;
      }
    }

    if (delivered > 0) {
      Logger.log('_retryPendingForUser: delivered ' + delivered + ' pending POs to ' + chatId);
      _sendTelegramTo(MANAGER_CHAT,
        '✅ <b>Pending PO Delivered</b>\n'
        + 'Vendor ' + (username ? '@'+username : str(chatId)) + ' sent /start.\n'
        + delivered + ' queued purchase order(s) delivered successfully.'
      );
    }
  } catch (e) { Logger.log('_retryPendingForUser: ' + e); }
}

function _sendLowStockSummary(chatId) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Stock_DB');
    if (!sheet) { _sendTelegramTo(chatId, '❌ Stock_DB sheet not found.'); return; }
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) { _sendTelegramTo(chatId, '✅ No stock requests on record.'); return; }
    var hdrs = data[0].map(function(h){ return h ? h.toString().trim() : ''; });
    var itemC = hdrs.indexOf('item');
    var qtyC  = hdrs.indexOf('qty needed');
    var datC  = hdrs.indexOf('delivery date');
    var reqC  = hdrs.indexOf('done by who');
    var msg   = '📦 <b>Stock Requests</b>\n━━━━━━━━━━━━━━━━━━\n';
    var count = 0;
    for (var i = data.length - 1; i >= 1 && count < 8; i--) {
      var item = itemC > -1 ? str(data[i][itemC]) : '';
      if (!item) continue;
      var qty  = qtyC > -1  ? str(data[i][qtyC])  : '?';
      var dt   = datC > -1  ? str(data[i][datC])   : '?';
      var req  = reqC > -1  ? str(data[i][reqC])   : '?';
      msg += '⚠️ <b>' + item + '</b> — need: ' + qty + '\n'
           + '  📅 By: ' + dt + '  👤 ' + req + '\n';
      count++;
    }
    if (count === 0) msg += '✅ No recent stock requests.';
    _sendTelegramTo(chatId, msg);
  } catch (e) { _sendTelegramTo(chatId, '❌ Error: ' + e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MORNING BRIEFING — Set a daily time trigger to call this at 8 AM
// ─────────────────────────────────────────────────────────────────────────────
function sendMorningBriefing() {
  try {
    var raw  = getOrderTrackingData({}, 'admin');
    var rows = JSON.parse(raw).rows || [];
    var tz   = Session.getScriptTimeZone();
    var yesterday = Utilities.formatDate(new Date(Date.now()-86400000), tz, 'yyyy-MM-dd');
    var yRows = rows.filter(function(r){ return r.Timestamp && r.Timestamp.slice(0,10)===yesterday; });
    var yRev  = yRows.reduce(function(s,r){ return s+(parseFloat(r.Total)||0); }, 0);
    var yUniqueIds = {}; yRows.forEach(function(r){ yUniqueIds[r.OrderID]=true; });

    var pending = rows.filter(function(r){ return r.Status==='Pending'; });
    var cutoff  = new Date(Date.now()-24*3600*1000);
    var overdue = pending.filter(function(r){ return r.Timestamp && new Date(r.Timestamp)<cutoff; });
    var overdueIds = {}; overdue.forEach(function(r){ overdueIds[r.OrderID]=true; });

    var msg =
      '☀️ <b>Good Morning — Asella Organic Briefing</b>\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '📅 Yesterday (' + yesterday + '):\n'
      + '  📦 Orders: ' + Object.keys(yUniqueIds).length + '\n'
      + '  💰 Revenue: ETB ' + Number(yRev).toLocaleString() + '\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '⏳ Pending Now: <b>__PENDING_PLACEHOLDER__</b>\n';

    // Count unique pending
    var upIds = {};
    pending.forEach(function(r){ upIds[r.OrderID]=true; });
    msg = msg.replace('__PENDING_PLACEHOLDER__', Object.keys(upIds).length);

    if (Object.keys(overdueIds).length > 0) {
      msg += '⚠️ Overdue (>24h): <b>' + Object.keys(overdueIds).length + '</b> — use /overdue\n';
    } else {
      msg += '✅ No overdue orders\n';
    }
    msg += '\nHave a great day! 🌿';

    _sendWithButtons(TELEGRAM_CHAT, msg, [
      [{ text: '⏳ Pending Orders', callback_data: 'pending_orders' },
       { text: '📊 Stats',         callback_data: 'analytics_summary' }]
    ]);
    // Also send to sales team
    for (var i = 0; i < SALES_TEAM.length; i++) {
      if (SALES_TEAM[i].chatId) _sendTelegramTo(SALES_TEAM[i].chatId, msg);
    }
  } catch (e) { Logger.log('sendMorningBriefing: ' + e); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  USER REGISTRATION & BROADCAST
// ─────────────────────────────────────────────────────────────────────────────

function _registerChatUser(chatId, fromObj) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('TelegramUsers');
    if (!sheet) {
      sheet = ss.insertSheet('TelegramUsers');
      sheet.appendRow(['chat_id', 'username', 'first_name', 'last_name', 'role', 'registered_at', 'last_seen']);
    }
    var data = sheet.getDataRange().getValues();
    var hdrs = data[0].map(function(h){ return h ? h.toString().trim().toLowerCase() : ''; });
    var cidC = hdrs.indexOf('chat_id');
    var unC  = hdrs.indexOf('username');
    var lsC  = hdrs.indexOf('last_seen');
    if (cidC === -1) return;
    for (var i = 1; i < data.length; i++) {
      if (str(data[i][cidC]) === str(chatId)) {
        if (lsC > -1) sheet.getRange(i+1, lsC+1).setValue(new Date());
        if (unC > -1 && fromObj && fromObj.username) sheet.getRange(i+1, unC+1).setValue(fromObj.username);
        return;
      }
    }
    // New registration — detect role
    var detectedRole = _getBotRole(chatId, (fromObj && fromObj.username) || '');
    sheet.appendRow([
      str(chatId),
      (fromObj && fromObj.username)   || '',
      (fromObj && fromObj.first_name) || '',
      (fromObj && fromObj.last_name)  || '',
      detectedRole,
      new Date(),
      new Date()
    ]);
    // Notify admin of new user
    var roleIcon = {manager:'👑', sales:'🧑‍💼', vendor:'🏭', unknown:'👤'}[detectedRole] || '👤';
    sendTelegramAlert(
      roleIcon + ' <b>New Bot User Registered</b>\n'
      + 'Role: <b>' + detectedRole + '</b>\n'
      + 'Name: ' + ((fromObj && fromObj.first_name) || '') + ' ' + ((fromObj && fromObj.last_name) || '') + '\n'
      + 'Username: ' + ((fromObj && fromObj.username) ? '@' + fromObj.username : '(none)') + '\n'
      + 'Chat ID: <code>' + chatId + '</code>'
    );
  } catch (e) { Logger.log('_registerChatUser: ' + e); }
}

function _broadcastToAllUsers(message) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('TelegramUsers');
    if (!sheet) return 0;
    var data = sheet.getDataRange().getValues();
    var hdrs = data[0].map(function(h){ return h ? h.toString().trim().toLowerCase() : ''; });
    var cidC = hdrs.indexOf('chat_id');
    if (cidC === -1) return 0;
    var sent = 0;
    for (var i = 1; i < data.length; i++) {
      var cid = str(data[i][cidC]);
      if (cid) { _sendTelegramTo(cid, message); sent++; }
    }
    return sent;
  } catch (e) { Logger.log('_broadcastToAllUsers: ' + e); return 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TELEGRAM API HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _sendWithButtons(chatId, text, buttons) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId, text: text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }),
      muteHttpExceptions: true
    });
  } catch (e) { Logger.log('_sendWithButtons: ' + e); }
}

function _answerCallback(callbackId) {
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/answerCallbackQuery', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ callback_query_id: callbackId }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

function _editMessageAppend(chatId, msgId, originalText, appendText) {
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/editMessageText', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId, message_id: msgId,
        text: originalText + appendText, parse_mode: 'HTML'
      }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

// Human-readable age label from a Date object
function _ageLabel(date) {
  var diff = Date.now() - date.getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

// ─────────────────────────────────────────────────────────────────────────────
//  WEBHOOK SETUP UTILITY (run once from GAS editor after deploying as web app)
// ─────────────────────────────────────────────────────────────────────────────

// Run this once manually if you ever need to reset the deduplication counter.
function clearUpdateHistory() {
  PropertiesService.getScriptProperties().deleteProperty('last_update_id');
  Logger.log('Update history cleared.');
}
function setupWebhook() {
  var url  = ScriptApp.getService().getUrl();
  var resp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/setWebhook?url=' + encodeURIComponent(url)
  );
  Logger.log('Webhook set: ' + resp.getContentText());
  Logger.log('Web App URL: ' + url);
}

function removeWebhook() { deleteWebhook(); }
function deleteWebhook() {
  var resp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/deleteWebhook'
  );
  Logger.log('Webhook deleted: ' + resp.getContentText());
}

function testTelegramConnection() {
  var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getMe');
  Logger.log('Bot info: ' + resp.getContentText());
  _sendTelegramTo(TELEGRAM_CHAT, '✅ <b>Bot connection test successful!</b>\nAsella Organic bot is active and connected.');
}

// ─────────────────────────────────────────────────────────────────────────────
//  DAILY TRIGGER SETUP (run once from GAS editor)
//  This creates a daily 8 AM trigger for the morning briefing.
// ─────────────────────────────────────────────────────────────────────────────
function createDailyBriefingTrigger() {
  // Delete any existing morning briefing triggers
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'sendMorningBriefing') ScriptApp.deleteTrigger(t);
  });
  // Create new trigger at 8:00 AM every day
  ScriptApp.newTrigger('sendMorningBriefing')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
  Logger.log('Daily morning briefing trigger created for 8 AM.');
}

// ─────────────────────────────────────────────────────────────────────────────
//  USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
function getUsers(role) {
  try {
    if (role !== 'admin' && role !== 'manager') return {success:false, message:'Admin access required.'};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('UserAuth');
    if (!sheet) return {success:false, message:'UserAuth not found.'};
    var data = sheet.getDataRange().getValues();
    var users = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) users.push({id:str(data[i][0]), name:str(data[i][2]), role:str(data[i][3])});
    }
    return {success:true, users:users};
  } catch (err) { return {success:false, message:err.message}; }
}

function addUser(userData, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return {success:false, message:'Admin or Manager access required.'};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('UserAuth');
    if (!sheet) return {success:false, message:'UserAuth not found.'};
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (str(data[i][0]).toLowerCase() === userData.id.toLowerCase())
        return {success:false, message:'User ID already exists.'};
    }
    sheet.appendRow([userData.id, userData.password, userData.name||userData.id, userData.role||'staff']);
    return {success:true, message:'User added successfully.'};
  } catch (err) { return {success:false, message:err.message}; }
}

function deleteUser(uid, role) {
  try {
    if (role !== 'admin' && role !== 'manager') return {success:false, message:'Admin or Manager access required.'};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('UserAuth');
    if (!sheet) return {success:false, message:'UserAuth not found.'};
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (str(data[i][0]).toLowerCase() === uid.toLowerCase()) {
        sheet.deleteRow(i+1); return {success:true, message:'User deleted.'};
      }
    }
    return {success:false, message:'User not found.'};
  } catch (err) { return {success:false, message:err.message}; }
}

function changePassword(empId, newPass, requesterId, requesterRole) {
  try {
    if (requesterRole !== 'admin' && requesterRole !== 'manager' && empId !== requesterId)
      return {success:false, message:'Permission denied.'};
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('UserAuth');
    if (!sheet) return {success:false, message:'UserAuth not found.'};
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (str(data[i][0]).toLowerCase() === empId.toLowerCase()) {
        sheet.getRange(i+1, 2).setValue(newPass);
        return {success:true, message:'Password updated.'};
      }
    }
    return {success:false, message:'User not found.'};
  } catch (err) { return {success:false, message:err.message}; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRIVE & FILE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getDriveFolder() {
  var folderId = '1qNMUKSEzARKjDL2yK5TLcKqDZlcjfGbg';
  try {
    var iter = DriveApp.getFolderById(folderId);
    if (iter) return iter;
  } catch(e) {}
  try {
    var folders = DriveApp.getFoldersByName('Asella Organic Uploads');
    if (folders.hasNext()) return folders.next();
    return DriveApp.createFolder('Asella Organic Uploads');
  } catch(e) { return null; }
}

function uploadFileToDrive(fileObject) {
  try {
    if (!fileObject||!fileObject.data) return '';
    var blob = Utilities.newBlob(Utilities.base64Decode(fileObject.data), fileObject.mimeType||'application/octet-stream', fileObject.name||'upload');
    var folder = getDriveFolder();
    if (!folder) return '';
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) { Logger.log('uploadFileToDrive: '+e); return ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ORDER ID GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
function generateOrderID(sheet) {
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return buildOrderId(1, null);
    var hdrs = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    var idCol = findCol(hdrs,['Order_ID']);
    if (idCol === -1) return buildOrderId(1, null);
    if (lastRow < 2) return buildOrderId(1, null);
    var scanStart = Math.max(2, lastRow-499);
    var scanRows = sheet.getRange(scanStart,idCol+1,lastRow-scanStart+1,1).getValues();
    var today = Utilities.formatDate(new Date(),'Africa/Addis_Ababa','yyyyMMdd');
    var maxNum = 0, dayPfx = 'ORD-'+today+'-';
    scanRows.forEach(function(r){
      var v=str(r[0]);
      if(v.indexOf(dayPfx)===0){var n=parseInt(v.slice(dayPfx.length),10);if(!isNaN(n)&&n>maxNum)maxNum=n;}
    });
    return buildOrderId(maxNum+1, today);
  } catch(e) { return buildOrderId(1, null); }
}
function buildOrderId(num,d){
  d=d||Utilities.formatDate(new Date(),'Africa/Addis_Ababa','yyyyMMdd');
  return 'ORD-'+d+'-'+padLeft(num,4);
}
function padLeft(n,l){var s=String(n);while(s.length<l)s='0'+s;return s;}

// ─────────────────────────────────────────────────────────────────────────────
//  DEFAULT HEADERS  (matches real DB columns from xlsx)
// ─────────────────────────────────────────────────────────────────────────────
function getDefaultHeaders(sheetName) {
  var map = {
    Sales_DB:     ['submission_date','Order_ID','User','customer_name','sex','age','location','city',
                   'Phone number','order_type','item','Qty_needed','Pkg_size','delivery date',
                   'totall price','FileURL','status','LastUpdatedBy','LastUpdateTimestamp','Notes'],
    Franchise_DB: ['submission_date','Order_ID','User','customer_name','Franchise type','location','city',
                   'Phone number','order_type','item','Qty_needed','Pkg_size','delivery date',
                   'totall price','FileURL','status','LastUpdatedBy','LastUpdateTimestamp','Notes'],
    Vendor_DB:    ['submission_date','User','vendor name','location','city','phone','item','amount',
                   'delivery date','price','FileURL'],
    Packaging_DB: ['submission_date','User','item','size','price','delivery date ','FileURL'],
    Stock_DB:     ['submission_date','User','item','pkg size','stock available','qty needed',
                   'delivery date','done by who','FileURL']
  };
  return map[sheetName]||['Timestamp','Data'];
}

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function str(v) {
  if (v===null||v===undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return v.toString();
}

function findCol(headers, candidates) {
  for (var c=0;c<candidates.length;c++) {
    var cand=candidates[c].toLowerCase().trim();
    for (var h=0;h<headers.length;h++) {
      if(headers[h]&&headers[h].toString().toLowerCase().trim()===cand) return h;
    }
  }
  return -1;
}