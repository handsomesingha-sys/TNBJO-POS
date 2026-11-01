/**
 * ============================================================================
 * ก๋วยเตี๋ยวโบราณ by เจ๊อ้น — Google Apps Script API
 * ============================================================================
 * Runtime: Google Apps Script V8
 * Database: Google Sheets
 * LINE: LINE Mini App (LIFF) + LINE Messaging API
 *
 * IMPORTANT SETUP
 * 1) Run initializeSystem() once from the Apps Script editor.
 *    If SPREADSHEET_ID is not set, this function creates a new spreadsheet.
 * 2) In Project Settings > Script Properties, set:
 *      LINE_LOGIN_CHANNEL_ID       = LINE Login channel ID linked to the LIFF app
 *      LINE_CHANNEL_ACCESS_TOKEN   = Messaging API channel access token
 *      LINE_WEBHOOK_BRIDGE_SECRET  = a long random secret shared with your webhook proxy
 *      LINE_GROUP_ID               = optional; can be captured when the bot joins a group
 *      ADMIN_PASSWORD              = the initial dashboard password (one-time only)
 *      LIFF_URL                    = optional; full LIFF URL for message buttons
 *      LINE_ALLOWED_STAFF_IDS      = optional comma-separated LINE user IDs allowed
 *                                    to operate orders from the group
 * 3) Run setupAdminPasswordHash() once after setting ADMIN_PASSWORD.
 *    It creates a salted hash and deletes the plain-text Script Property.
 * 4) Deploy as Web app, Execute as: Me, Who has access: Anyone.
 * 5) The LINE webhook MUST pass through a proxy (for example Cloudflare Worker)
 *    that verifies x-line-signature before forwarding JSON to this web app as:
 *      {"type":"lineWebhookBridge","bridgeSecret":"...","webhook":{...}}
 *    Apps Script doPost(e) does not expose the incoming HTTP headers needed to
 *    verify LINE's x-line-signature itself. Do NOT point LINE directly at this
 *    endpoint for production webhook processing.
 *
 * API TRANSPORT
 * - Read-only public requests: GET ?action=getBootstrap or ?action=getMenu.
 *   JSONP is supported for these public, non-sensitive read operations only:
 *   append &callback=someFunctionName
 * - Other API requests: POST JSON body, for example:
 *   {"action":"createOrder","idToken":"...","order":{...}}
 *   Use Content-Type: text/plain;charset=UTF-8 from a browser to avoid a CORS
 *   preflight request. ContentService responses are redirected by Google; the
 *   front-end must follow redirects. If a browser deployment still blocks CORS,
 *   put a small same-origin/CORS proxy in front of this API.
 *
 * CUSTOMER ORDER CONTRACT
 * {
 *   action: "createOrder",
 *   idToken: liff.getIDToken(),
 *   idempotencyKey: "unique-client-generated-key",
 *   order: {
 *     orderType: "DINE_IN" | "TAKEAWAY",
 *     tableNumber: "optional",
 *     paymentMethod: "CASH" | "PROMPTPAY",
 *     note: "optional",
 *     couponCode: "optional",
 *     items: [{
 *       menuId: "MENU_ID",
 *       quantity: 1,
 *       note: "optional",
 *       selections: [{ groupId: "GROUP_ID", choiceIds: ["CHOICE_ID"] }]
 *     }]
 *   }
 * }
 *
 * MENU OPTION DATA CONTRACT
 * Each Options sheet row belongs to a MenuID. ChoicesJSON is an array such as:
 * [{"choiceId":"small","name":"เส้นเล็ก","price":0,"isAvailable":true}]
 * Selections supplied by the client use groupId + choiceIds. Prices are always
 * recalculated from Sheets; prices supplied by the browser are ignored.
 * ============================================================================
 */

var APP_CONFIG = {
  STORE_NAME: 'ก๋วยเตี๋ยวโบราณ by เจ๊อ้น',
  TIME_ZONE: 'Asia/Bangkok',
  CURRENCY_SYMBOL: '฿',
  ADMIN_SESSION_TTL_SECONDS: 21600,
  ADMIN_LOGIN_MAX_ATTEMPTS: 5,
  ADMIN_LOGIN_LOCK_SECONDS: 900,
  MAX_ORDER_ITEMS: 30,
  MAX_ITEM_QUANTITY: 99,
  MAX_ORDER_NOTE_LENGTH: 500,
  MAX_PAYMENT_SLIP_BYTES: 8 * 1024 * 1024,
  LINE_API_BASE: 'https://api.line.me',
  LINE_ID_TOKEN_VERIFY_URL: 'https://api.line.me/oauth2/v2.1/verify'
};

var SHEET_HEADERS = {
  Categories: [
    'CategoryID', 'Name', 'Description', 'ImageURL', 'SortOrder',
    'IsActive', 'CreatedAt', 'UpdatedAt'
  ],
  Menu: [
    'MenuID', 'CategoryID', 'Name', 'Description', 'Price', 'ImageURL',
    'IsAvailable', 'IsRecommended', 'SortOrder', 'CreatedAt', 'UpdatedAt'
  ],
  Options: [
    'OptionGroupID', 'MenuID', 'Name', 'SelectionType', 'IsRequired',
    'MinSelect', 'MaxSelect', 'ChoicesJSON', 'SortOrder', 'IsActive',
    'CreatedAt', 'UpdatedAt'
  ],
  Orders: [
    'OrderID', 'OrderNumber', 'LineUserID', 'CustomerName', 'OrderType',
    'TableNumber', 'Status', 'PaymentMethod', 'PaymentStatus', 'Subtotal',
    'DiscountCode', 'DiscountAmount', 'DeliveryFee', 'Total', 'Note',
    'CreatedAt', 'UpdatedAt', 'AcceptedAt', 'PreparingAt', 'ReadyAt',
    'CompletedAt', 'CancelledAt', 'CancelReason', 'Source', 'IdempotencyKey'
  ],
  OrderItems: [
    'ItemID', 'OrderID', 'MenuID', 'MenuName', 'Quantity', 'BasePrice',
    'OptionsJSON', 'ExtraPrice', 'UnitPrice', 'LineTotal', 'Note'
  ],
  Customers: [
    'LineUserID', 'DisplayName', 'PictureURL', 'FirstSeenAt', 'LastSeenAt',
    'TotalOrders', 'TotalSpent'
  ],
  Payments: [
    'PaymentID', 'OrderID', 'Method', 'Amount', 'Status', 'SlipURL',
    'Reference', 'SubmittedAt', 'VerifiedAt', 'VerifiedBy', 'CreatedAt',
    'UpdatedAt'
  ],
  Promotions: [
    'PromotionID', 'Code', 'Name', 'DiscountType', 'DiscountValue',
    'MinSubtotal', 'MaxDiscount', 'StartAt', 'EndAt', 'UsageLimit',
    'UsedCount', 'IsActive', 'CreatedAt', 'UpdatedAt'
  ],
  StatusHistory: [
    'HistoryID', 'OrderID', 'OrderNumber', 'OldStatus', 'NewStatus',
    'ChangedBy', 'Channel', 'RequestKey', 'ChangedAt', 'CustomerNotified',
    'GroupNotified', 'NotificationError'
  ],
  Settings: ['Key', 'Value', 'UpdatedAt'],
  AdminLogs: ['LogID', 'Action', 'Actor', 'Timestamp', 'DetailsJSON']
};

var ORDER_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

var ORDER_STATUS_LABELS = {
  PENDING: 'รอร้านยืนยัน',
  ACCEPTED: 'รับออเดอร์แล้ว',
  PREPARING: 'กำลังปรุงอาหาร',
  READY: 'อาหารพร้อมรับ',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิกออเดอร์'
};

var ORDER_STATUS_COLORS = {
  PENDING: '#D97706',
  ACCEPTED: '#2563EB',
  PREPARING: '#7C3AED',
  READY: '#16A34A',
  COMPLETED: '#15803D',
  CANCELLED: '#DC2626'
};

var ALLOWED_STATUS_TRANSITIONS = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: []
};

var DEFAULT_SETTINGS = {
  storeName: APP_CONFIG.STORE_NAME,
  storeStatus: 'OPEN',
  acceptOrders: true,
  openingTime: '',
  closingTime: '',
  phone: '',
  address: '',
  promptPayId: '',
  promptPayName: '',
  minimumOrder: 0,
  deliveryFee: 0,
  acceptDineIn: true,
  acceptTakeaway: true,
  announcement: ''
};

/* ========================================================================== *
 *  WEB APP ENTRY POINTS
 * ========================================================================== */

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = String(params.action || 'health');
    var result;

    if (action === 'health') {
      result = {
        ok: true,
        service: APP_CONFIG.STORE_NAME + ' API',
        time: new Date().toISOString(),
        version: '1.0.0'
      };
    } else if (action === 'getMenu') {
      result = { ok: true, data: getMenuItems_(false) };
    } else if (action === 'getPublicSettings') {
      result = { ok: true, data: getPublicSettings_() };
    } else if (action === 'getBootstrap') {
      result = {
        ok: true,
        data: {
          categories: getCategories_(false),
          menu: getMenuItems_(false),
          settings: getPublicSettings_()
        }
      };
    } else {
      result = apiErrorResponse_('METHOD_NOT_ALLOWED', 'คำขอนี้ต้องใช้ POST');
    }

    if (params.callback) {
      if (!isValidJsonpCallback_(params.callback)) {
        return textOutput_('Invalid callback', ContentService.MimeType.TEXT);
      }
      return textOutput_(String(params.callback) + '(' + JSON.stringify(result) + ');', ContentService.MimeType.JAVASCRIPT);
    }
    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_(apiErrorResponse_('SERVER_ERROR', 'ไม่สามารถประมวลผลคำขอได้'));
  }
}

function doPost(e) {
  try {
    var request = parsePostBody_(e);

    if (request.type === 'lineWebhookBridge') {
      var expectedSecret = getScriptProperty_('LINE_WEBHOOK_BRIDGE_SECRET');
      if (!expectedSecret || !constantTimeEquals_(String(request.bridgeSecret || ''), expectedSecret)) {
        return jsonOutput_(apiErrorResponse_('UNAUTHORIZED_WEBHOOK', 'Webhook bridge ไม่ได้รับอนุญาต'));
      }
      var webhookResult = processLineWebhookPayload_(request.webhook || {});
      return jsonOutput_({ ok: true, data: webhookResult });
    }

    var apiResult = dispatchApiRequest_(request);
    return jsonOutput_(apiResult);
  } catch (error) {
    logError_('doPost', error);
    return jsonOutput_(apiErrorResponse_(error.code || 'SERVER_ERROR', error.publicMessage || 'เกิดข้อผิดพลาดในการประมวลผล'));
  }
}

function dispatchApiRequest_(request) {
  var action = String(request.action || '');

  switch (action) {
    case 'health':
      return { ok: true, data: { service: APP_CONFIG.STORE_NAME + ' API', time: new Date().toISOString() } };

    case 'getBootstrap':
      return {
        ok: true,
        data: {
          categories: getCategories_(false),
          menu: getMenuItems_(false),
          settings: getPublicSettings_()
        }
      };

    case 'getMenu':
      return { ok: true, data: getMenuItems_(false) };

    case 'getPublicSettings':
      return { ok: true, data: getPublicSettings_() };

    case 'createOrder':
      return { ok: true, data: createCustomerOrder_(request) };

    case 'getMyOrders':
      return { ok: true, data: getMyOrders_(request) };

    case 'getOrder':
      return { ok: true, data: getCustomerOrder_(request) };

    case 'cancelOrder':
      return { ok: true, data: cancelCustomerOrder_(request) };

    case 'submitPaymentSlip':
      return { ok: true, data: submitPaymentSlip_(request) };

    case 'adminLogin':
      return { ok: true, data: adminLogin_(request) };

    case 'adminLogout':
      adminLogout_(request);
      return { ok: true, data: { loggedOut: true } };

    case 'adminGetDashboard':
      requireAdmin_(request);
      return { ok: true, data: getAdminDashboard_() };

    case 'adminListOrders':
      requireAdmin_(request);
      return { ok: true, data: adminListOrders_(request) };

    case 'adminGetOrder':
      requireAdmin_(request);
      return { ok: true, data: getOrderById_(request.orderId, true) };

    case 'adminUpdateOrderStatus':
      requireAdmin_(request);
      var statusChangeResult = changeOrderStatus_(
        request.orderId,
        request.status,
        'ADMIN',
        'DASHBOARD',
        request.requestKey || Utilities.getUuid(),
        request.cancelReason || ''
      );
      if (!statusChangeResult.duplicateRequest) {
        logAdminAction_('UPDATE_ORDER_STATUS', 'ADMIN', { orderId: request.orderId, status: request.status });
      }
      return { ok: true, data: statusChangeResult };

    case 'adminListMenu':
      requireAdmin_(request);
      return { ok: true, data: getMenuItems_(true) };

    case 'adminListCategories':
      requireAdmin_(request);
      return { ok: true, data: getCategories_(true) };

    case 'adminListPromotions':
      requireAdmin_(request);
      return { ok: true, data: readObjects_('Promotions').map(mapPromotionForAdmin_) };

    case 'adminListPayments':
      requireAdmin_(request);
      return { ok: true, data: adminListPayments_(request) };

    case 'adminListCustomers':
      requireAdmin_(request);
      return { ok: true, data: adminListCustomers_(request) };

    case 'adminUpsertMenu':
      requireAdmin_(request);
      return { ok: true, data: adminUpsertMenu_(request.menu || {}) };

    case 'adminSetMenuAvailability':
      requireAdmin_(request);
      return { ok: true, data: adminSetMenuAvailability_(request.menuId, request.isAvailable) };

    case 'adminDeleteMenu':
      requireAdmin_(request);
      return { ok: true, data: adminSetMenuAvailability_(request.menuId, false) };

    case 'adminSaveCategory':
      requireAdmin_(request);
      return { ok: true, data: adminSaveCategory_(request.category || {}) };

    case 'adminSaveSettings':
      requireAdmin_(request);
      return { ok: true, data: adminSaveSettings_(request.settings || {}) };

    case 'adminSavePromotion':
      requireAdmin_(request);
      return { ok: true, data: adminSavePromotion_(request.promotion || {}) };

    case 'adminVerifyPayment':
      requireAdmin_(request);
      return { ok: true, data: adminVerifyPayment_(request) };

    case 'adminGetReports':
      requireAdmin_(request);
      return { ok: true, data: adminGetReports_(request) };

    default:
      return apiErrorResponse_('UNKNOWN_ACTION', 'ไม่พบคำสั่ง API ที่ร้องขอ');
  }
}

function parsePostBody_(e) {
  if (!e) return {};
  var raw = e.postData && e.postData.contents ? e.postData.contents : '';
  if (!raw && e.parameter && e.parameter.payload) raw = e.parameter.payload;
  if (!raw) return e.parameter || {};

  try {
    return JSON.parse(raw);
  } catch (jsonError) {
    // Also accept URL-encoded form bodies with a single "payload" field.
    if (e.parameter && e.parameter.payload) {
      return JSON.parse(e.parameter.payload);
    }
    throw makeApiError_('INVALID_JSON', 'ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง');
  }
}

function jsonOutput_(value) {
  return textOutput_(JSON.stringify(value), ContentService.MimeType.JSON);
}

function textOutput_(value, mimeType) {
  return ContentService.createTextOutput(String(value)).setMimeType(mimeType || ContentService.MimeType.TEXT);
}

function apiErrorResponse_(code, message) {
  return {
    ok: false,
    error: {
      code: String(code || 'ERROR'),
      message: String(message || 'เกิดข้อผิดพลาด')
    }
  };
}

function isValidJsonpCallback_(callback) {
  return /^[A-Za-z_$][0-9A-Za-z_$\.]{0,100}$/.test(String(callback || ''));
}

/* ========================================================================== *
 *  INITIALIZATION & DATABASE SCHEMA
 * ========================================================================== */

/** Run once from the Apps Script editor to create the database and all headers. */
function initializeSystem() {
  var spreadsheet = getSpreadsheet_(true);
  var createdSheets = [];

  Object.keys(SHEET_HEADERS).forEach(function (sheetName) {
    var existed = !!spreadsheet.getSheetByName(sheetName);
    ensureSheet_(spreadsheet, sheetName);
    if (!existed) createdSheets.push(sheetName);
  });

  ensureDefaultSettings_();
  spreadsheet.setSpreadsheetTimeZone(APP_CONFIG.TIME_ZONE);

  var result = {
    message: 'สร้าง/ตรวจสอบโครงสร้างฐานข้อมูลเรียบร้อยแล้ว',
    spreadsheetName: spreadsheet.getName(),
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    createdSheets: createdSheets,
    allSheets: Object.keys(SHEET_HEADERS)
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * One-time password setup.
 * First add Script Property ADMIN_PASSWORD, run this function, then the plain
 * text property is deleted and replaced by a salted SHA-256 password hash.
 */
function setupAdminPasswordHash() {
  var properties = PropertiesService.getScriptProperties();
  var plainPassword = properties.getProperty('ADMIN_PASSWORD');

  if (!plainPassword) {
    throw new Error('กรุณาตั้ง Script Property ชื่อ ADMIN_PASSWORD ก่อน');
  }
  if (String(plainPassword).length < 8) {
    throw new Error('รหัสหลังบ้านควรมีอย่างน้อย 8 ตัวอักษร');
  }

  var salt = Utilities.getUuid() + Utilities.getUuid();
  properties.setProperty('ADMIN_PASSWORD_SALT', salt);
  properties.setProperty('ADMIN_PASSWORD_HASH', sha256Hex_(salt + '|' + plainPassword));
  properties.deleteProperty('ADMIN_PASSWORD');

  Logger.log('ตั้งค่ารหัสหลังบ้านเรียบร้อยแล้ว และลบรหัสแบบข้อความธรรมดาออกจาก Script Properties แล้ว');
  return { ok: true, message: 'ตั้งค่ารหัสหลังบ้านเรียบร้อยแล้ว' };
}

function getSpreadsheet_(createIfMissing) {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');

  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  if (createIfMissing) {
    var spreadsheet = SpreadsheetApp.create(APP_CONFIG.STORE_NAME + ' - Database');
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
    return spreadsheet;
  }

  throw makeApiError_('DATABASE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า Google Sheets');
}

function ensureSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getName() === 'Sheet1' && sheets[0].getLastRow() === 0) {
      sheet = sheets[0];
      sheet.setName(sheetName);
    } else {
      sheet = spreadsheet.insertSheet(sheetName);
    }
  }

  var expectedHeaders = SHEET_HEADERS[sheetName];
  if (!expectedHeaders) return sheet;

  var lastColumn = sheet.getLastColumn();
  var currentHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) { return String(value || '').trim(); })
    : [];
  currentHeaders = currentHeaders.filter(function (header) { return header !== ''; });

  if (currentHeaders.length === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
  } else {
    var missing = expectedHeaders.filter(function (header) { return currentHeaders.indexOf(header) === -1; });
    if (missing.length) {
      sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .setFontWeight('bold')
    .setBackground('#1F2937')
    .setFontColor('#FFFFFF');

  return sheet;
}

function ensureDefaultSettings_() {
  var existing = readObjects_('Settings');
  var existingKeys = {};
  existing.forEach(function (row) { existingKeys[String(row.Key)] = true; });

  var now = new Date().toISOString();
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (!existingKeys[key]) {
      appendObject_('Settings', { Key: key, Value: DEFAULT_SETTINGS[key], UpdatedAt: now });
    }
  });
}

function getSheet_(sheetName) {
  var spreadsheet = getSpreadsheet_(false);
  return ensureSheet_(spreadsheet, sheetName);
}

function readObjects_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  return values.filter(function (row) {
    return row.some(function (cell) { return cell !== '' && cell !== null; });
  }).map(function (row) {
    var object = {};
    headers.forEach(function (header, index) {
      if (header) object[header] = row[index];
    });
    return object;
  });
}

function appendObject_(sheetName, object) {
  var sheet = getSheet_(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var row = headers.map(function (header) {
    return safeSheetValue_(object[header]);
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateObjectByKey_(sheetName, keyHeader, keyValue, patch) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2) return false;

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
  var keyColumn = headers.indexOf(keyHeader) + 1;
  if (keyColumn < 1) throw new Error('ไม่พบคอลัมน์ ' + keyHeader + ' ในชีต ' + sheetName);

  var keyValues = sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  var targetRow = -1;
  for (var i = 0; i < keyValues.length; i++) {
    if (String(keyValues[i][0]) === String(keyValue)) {
      targetRow = i + 2;
      break;
    }
  }
  if (targetRow < 0) return false;

  Object.keys(patch).forEach(function (field) {
    var column = headers.indexOf(field) + 1;
    if (column > 0) sheet.getRange(targetRow, column).setValue(safeSheetValue_(patch[field]));
  });
  return true;
}

function deleteRowsByValue_(sheetName, keyHeader, keyValue) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var keyColumn = headers.indexOf(keyHeader) + 1;
  if (keyColumn < 1) return;

  var values = sheet.getRange(2, keyColumn, lastRow - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(keyValue)) sheet.deleteRow(i + 2);
  }
}

function safeSheetValue_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' && /^[=+@\-]/.test(value)) return "'" + value;
  return value;
}

/* ========================================================================== *
 *  PUBLIC MENU & STORE SETTINGS
 * ========================================================================== */

function getSetting_(key, fallback) {
  var rows = readObjects_('Settings');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Key) === String(key)) return rows[i].Value;
  }
  return fallback;
}

function setSetting_(key, value) {
  var now = new Date().toISOString();
  var rows = readObjects_('Settings');
  var found = rows.some(function (row) { return String(row.Key) === String(key); });
  if (found) {
    updateObjectByKey_('Settings', 'Key', key, { Value: value, UpdatedAt: now });
  } else {
    appendObject_('Settings', { Key: key, Value: value, UpdatedAt: now });
  }
}

function getSettingsMap_() {
  var map = {};
  readObjects_('Settings').forEach(function (row) {
    map[String(row.Key)] = row.Value;
  });
  return map;
}

function getPublicSettings_() {
  var settings = getSettingsMap_();
  return {
    storeName: String(settings.storeName || APP_CONFIG.STORE_NAME),
    storeStatus: String(settings.storeStatus || 'OPEN'),
    acceptOrders: toBoolean_(settings.acceptOrders, true),
    isAcceptingOrders: isStoreAcceptingOrders_(settings),
    openingTime: String(settings.openingTime || ''),
    closingTime: String(settings.closingTime || ''),
    phone: String(settings.phone || ''),
    address: String(settings.address || ''),
    promptPayId: String(settings.promptPayId || ''),
    promptPayName: String(settings.promptPayName || ''),
    minimumOrder: toNumber_(settings.minimumOrder, 0),
    deliveryFee: toNumber_(settings.deliveryFee, 0),
    acceptDineIn: toBoolean_(settings.acceptDineIn, true),
    acceptTakeaway: toBoolean_(settings.acceptTakeaway, true),
    announcement: String(settings.announcement || ''),
    currency: 'THB'
  };
}

function isStoreAcceptingOrders_(settings) {
  var values = settings || getSettingsMap_();
  return String(values.storeStatus || 'OPEN').toUpperCase() === 'OPEN' && toBoolean_(values.acceptOrders, true);
}

function getCategories_(includeInactive) {
  return readObjects_('Categories').filter(function (row) {
    return includeInactive || toBoolean_(row.IsActive, true);
  }).map(function (row) {
    return {
      categoryId: String(row.CategoryID || ''),
      name: String(row.Name || ''),
      description: String(row.Description || ''),
      imageUrl: String(row.ImageURL || ''),
      sortOrder: toNumber_(row.SortOrder, 0),
      isActive: toBoolean_(row.IsActive, true)
    };
  }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
}

function getMenuItems_(includeUnavailable) {
  var categories = {};
  getCategories_(true).forEach(function (category) { categories[category.categoryId] = category; });

  var groupsByMenu = {};
  readObjects_('Options').forEach(function (row) {
    var menuId = String(row.MenuID || '');
    if (!menuId) return;
    if (!groupsByMenu[menuId]) groupsByMenu[menuId] = [];
    if (!toBoolean_(row.IsActive, true)) return;
    groupsByMenu[menuId].push({
      groupId: String(row.OptionGroupID || ''),
      name: String(row.Name || ''),
      selectionType: String(row.SelectionType || 'SINGLE'),
      isRequired: toBoolean_(row.IsRequired, false),
      minSelect: toNumber_(row.MinSelect, 0),
      maxSelect: toNumber_(row.MaxSelect, 1),
      choices: safeJsonParse_(row.ChoicesJSON, [])
    });
  });

  // Return unavailable dishes too. The customer UI can show a "sold out" badge;
  // the create-order endpoint independently rejects unavailable items.
  return readObjects_('Menu').map(function (row) {
    var category = categories[String(row.CategoryID || '')] || null;
    return {
      menuId: String(row.MenuID || ''),
      categoryId: String(row.CategoryID || ''),
      categoryName: category ? category.name : '',
      name: String(row.Name || ''),
      description: String(row.Description || ''),
      price: toNumber_(row.Price, 0),
      imageUrl: String(row.ImageURL || ''),
      isAvailable: toBoolean_(row.IsAvailable, true),
      isRecommended: toBoolean_(row.IsRecommended, false),
      sortOrder: toNumber_(row.SortOrder, 0),
      optionGroups: groupsByMenu[String(row.MenuID || '')] || []
    };
  }).sort(function (a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, 'th');
  });
}

/* ========================================================================== *
 *  LINE ID TOKEN VERIFICATION & CUSTOMER IDENTITY
 * ========================================================================== */

function verifyLineIdToken_(idToken) {
  var token = String(idToken || '').trim();
  if (!token) throw makeApiError_('LINE_LOGIN_REQUIRED', 'ไม่พบข้อมูลผู้ใช้ LINE กรุณาเปิดระบบผ่าน LINE อีกครั้ง');

  var channelId = getScriptProperty_('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw makeApiError_('LINE_CONFIG_MISSING', 'ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID');

  var cache = CacheService.getScriptCache();
  var cacheKey = 'line_identity_' + sha256Hex_(token).slice(0, 40);
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) {}
  }

  var response = UrlFetchApp.fetch(APP_CONFIG.LINE_ID_TOKEN_VERIFY_URL, {
    method: 'post',
    payload: { id_token: token, client_id: channelId },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var body = safeJsonParse_(response.getContentText(), {});

  if (status !== 200 || !body.sub || String(body.aud) !== String(channelId)) {
    throw makeApiError_('INVALID_LINE_TOKEN', 'ไม่สามารถยืนยันตัวตน LINE ได้ กรุณาปิดแล้วเปิด Mini App ใหม่');
  }

  var identity = {
    lineUserId: String(body.sub),
    displayName: String(body.name || 'ลูกค้า LINE'),
    pictureUrl: String(body.picture || ''),
    expiresAt: toNumber_(body.exp, 0)
  };
  cache.put(cacheKey, JSON.stringify(identity), 300);
  return identity;
}

function requireCustomer_(request) {
  return verifyLineIdToken_(request.idToken || request.lineIdToken || '');
}

/* ========================================================================== *
 *  ORDER CREATION & CUSTOMER ORDER HISTORY
 * ========================================================================== */

function createCustomerOrder_(request) {
  var identity = requireCustomer_(request);
  var input = request.order || {};
  var idempotencyKey = cleanString_(request.idempotencyKey || input.idempotencyKey || Utilities.getUuid(), 120);

  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw makeApiError_('INVALID_IDEMPOTENCY_KEY', 'ไม่พบรหัสอ้างอิงการสั่งซื้อ');
  }

  var settings = getSettingsMap_();
  if (!isStoreAcceptingOrders_(settings)) {
    throw makeApiError_('STORE_CLOSED', 'ขณะนี้ร้านปิดรับออเดอร์ชั่วคราว');
  }

  var orderType = String(input.orderType || 'TAKEAWAY').toUpperCase();
  if (orderType !== 'DINE_IN' && orderType !== 'TAKEAWAY') {
    throw makeApiError_('INVALID_ORDER_TYPE', 'รูปแบบการรับอาหารไม่ถูกต้อง');
  }
  if (orderType === 'DINE_IN' && !toBoolean_(settings.acceptDineIn, true)) {
    throw makeApiError_('DINE_IN_DISABLED', 'ร้านปิดรับประทานที่ร้านชั่วคราว');
  }
  if (orderType === 'TAKEAWAY' && !toBoolean_(settings.acceptTakeaway, true)) {
    throw makeApiError_('TAKEAWAY_DISABLED', 'ร้านปิดรับออเดอร์กลับบ้านชั่วคราว');
  }

  var paymentMethod = String(input.paymentMethod || 'CASH').toUpperCase();
  if (['CASH', 'PROMPTPAY'].indexOf(paymentMethod) === -1) {
    throw makeApiError_('INVALID_PAYMENT_METHOD', 'ช่องทางชำระเงินไม่ถูกต้อง');
  }

  var itemsInput = Array.isArray(input.items) ? input.items : [];
  if (itemsInput.length < 1 || itemsInput.length > APP_CONFIG.MAX_ORDER_ITEMS) {
    throw makeApiError_('INVALID_ORDER_ITEMS', 'กรุณาเลือกอาหารอย่างน้อย 1 รายการ และไม่เกิน ' + APP_CONFIG.MAX_ORDER_ITEMS + ' รายการ');
  }

  var calculated = calculateOrderItems_(itemsInput);
  var subtotal = roundMoney_(calculated.subtotal);
  var minimumOrder = toNumber_(settings.minimumOrder, 0);
  if (subtotal < minimumOrder) {
    throw makeApiError_('MINIMUM_ORDER_NOT_MET', 'ยอดสั่งซื้อขั้นต่ำคือ ' + formatMoney_(minimumOrder));
  }

  var couponCode = cleanString_(input.couponCode || '', 40).toUpperCase();
  var deliveryFee = orderType === 'TAKEAWAY' ? 0 : 0;
  var now = new Date().toISOString();
  var createdOrder;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var duplicate = readObjects_('Orders').filter(function (row) {
      return String(row.IdempotencyKey || '') === idempotencyKey;
    })[0];

    if (duplicate) {
      var createHistory = readObjects_('StatusHistory').filter(function (historyRow) {
        return String(historyRow.RequestKey) === 'CREATE:' + String(duplicate.OrderID);
      })[0] || {};
      return {
        order: getOrderById_(duplicate.OrderID, false),
        duplicateRequest: true,
        groupNotificationSent: toBoolean_(createHistory.GroupNotified, false),
        customerNotificationSent: toBoolean_(createHistory.CustomerNotified, false)
      };
    }

    var promotion = couponCode ? calculatePromotion_(couponCode, subtotal) : { code: '', discount: 0, promotionId: '' };
    var total = roundMoney_(Math.max(0, subtotal - promotion.discount + deliveryFee));
    var orderId = 'ORD_' + Utilities.getUuid().replace(/-/g, '').substring(0, 18).toUpperCase();
    var orderNumber = generateOrderNumber_();
    var customerName = identity.displayName || 'ลูกค้า LINE';
    var tableNumber = cleanString_(input.tableNumber || '', 30);
    var orderNote = cleanString_(input.note || '', APP_CONFIG.MAX_ORDER_NOTE_LENGTH);

    createdOrder = {
      OrderID: orderId,
      OrderNumber: orderNumber,
      LineUserID: identity.lineUserId,
      CustomerName: customerName,
      OrderType: orderType,
      TableNumber: tableNumber,
      Status: ORDER_STATUS.PENDING,
      PaymentMethod: paymentMethod,
      PaymentStatus: 'UNPAID',
      Subtotal: subtotal,
      DiscountCode: promotion.code,
      DiscountAmount: promotion.discount,
      DeliveryFee: deliveryFee,
      Total: total,
      Note: orderNote,
      CreatedAt: now,
      UpdatedAt: now,
      AcceptedAt: '',
      PreparingAt: '',
      ReadyAt: '',
      CompletedAt: '',
      CancelledAt: '',
      CancelReason: '',
      Source: 'LINE_MINI_APP',
      IdempotencyKey: idempotencyKey
    };

    appendObject_('Orders', createdOrder);

    calculated.items.forEach(function (item) {
      appendObject_('OrderItems', {
        ItemID: 'ITM_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
        OrderID: orderId,
        MenuID: item.menuId,
        MenuName: item.menuName,
        Quantity: item.quantity,
        BasePrice: item.basePrice,
        OptionsJSON: JSON.stringify(item.selectedOptions),
        ExtraPrice: item.extraPrice,
        UnitPrice: item.unitPrice,
        LineTotal: item.lineTotal,
        Note: item.note
      });
    });

    appendObject_('Payments', {
      PaymentID: 'PAY_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
      OrderID: orderId,
      Method: paymentMethod,
      Amount: total,
      Status: 'UNPAID',
      SlipURL: '',
      Reference: '',
      SubmittedAt: '',
      VerifiedAt: '',
      VerifiedBy: '',
      CreatedAt: now,
      UpdatedAt: now
    });

    appendObject_('StatusHistory', {
      HistoryID: 'HIS_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
      OrderID: orderId,
      OrderNumber: orderNumber,
      OldStatus: '',
      NewStatus: ORDER_STATUS.PENDING,
      ChangedBy: identity.lineUserId,
      Channel: 'CUSTOMER',
      RequestKey: 'CREATE:' + orderId,
      ChangedAt: now,
      CustomerNotified: false,
      GroupNotified: false,
      NotificationError: ''
    });

    updateCustomerAfterOrder_(identity, total, now);
    if (promotion.promotionId) incrementPromotionUsage_(promotion.promotionId);
  } finally {
    lock.releaseLock();
  }

  var groupNotification = { sent: false, error: '' };
  var customerNotification = { sent: false, error: '' };

  try {
    sendGroupOrderFlex_(createdOrder.OrderID);
    groupNotification.sent = true;
  } catch (notifyError) {
    groupNotification.error = safeErrorMessage_(notifyError);
    logError_('sendGroupOrderFlex_', notifyError);
  }

  // Send a receipt/status card to the customer after the order is saved.
  try {
    sendCustomerStatusFlex_(getOrderById_(createdOrder.OrderID, true));
    customerNotification.sent = true;
  } catch (customerNotifyError) {
    customerNotification.error = safeErrorMessage_(customerNotifyError);
    logError_('sendCustomerStatusFlex_initial', customerNotifyError);
  }

  var notificationErrors = [groupNotification.error, customerNotification.error].filter(Boolean).join(' | ');
  markHistoryNotifications_('CREATE:' + createdOrder.OrderID, customerNotification.sent, groupNotification.sent, notificationErrors);

  return {
    order: getOrderById_(createdOrder.OrderID, false),
    duplicateRequest: false,
    groupNotificationSent: groupNotification.sent,
    customerNotificationSent: customerNotification.sent,
    notificationError: notificationErrors
  };
}

function calculateOrderItems_(itemsInput) {
  var menuMap = {};
  readObjects_('Menu').forEach(function (row) {
    menuMap[String(row.MenuID)] = row;
  });

  var allGroups = readObjects_('Options').filter(function (row) { return toBoolean_(row.IsActive, true); });
  var calculatedItems = [];
  var subtotal = 0;

  itemsInput.forEach(function (itemInput) {
    var menuId = cleanString_(itemInput.menuId || '', 100);
    var menu = menuMap[menuId];
    if (!menu || !toBoolean_(menu.IsAvailable, true)) {
      throw makeApiError_('MENU_UNAVAILABLE', 'มีเมนูบางรายการหมดหรือปิดขาย กรุณาตรวจสอบรายการอาหารอีกครั้ง');
    }

    var quantity = Math.floor(toNumber_(itemInput.quantity, 0));
    if (quantity < 1 || quantity > APP_CONFIG.MAX_ITEM_QUANTITY) {
      throw makeApiError_('INVALID_QUANTITY', 'จำนวนอาหารไม่ถูกต้อง');
    }

    var menuPrice = toNumber_(menu.Price, -1);
    if (menuPrice < 0) throw makeApiError_('INVALID_MENU_PRICE', 'พบเมนูที่ตั้งราคาไม่ถูกต้อง');

    var groups = allGroups.filter(function (group) { return String(group.MenuID) === menuId; });
    var selections = Array.isArray(itemInput.selections) ? itemInput.selections : [];
    var selectedOptions = [];
    var extraPrice = 0;

    groups.forEach(function (group) {
      var selection = selections.filter(function (entry) {
        return String(entry.groupId || '') === String(group.OptionGroupID);
      })[0];
      var choiceIds = selection && Array.isArray(selection.choiceIds)
        ? selection.choiceIds.map(String)
        : [];
      var minSelect = toNumber_(group.MinSelect, toBoolean_(group.IsRequired, false) ? 1 : 0);
      var maxSelect = toNumber_(group.MaxSelect, 1);

      if (choiceIds.length < minSelect || choiceIds.length > maxSelect) {
        throw makeApiError_('INVALID_MENU_OPTIONS', 'กรุณาเลือกตัวเลือกของเมนู ' + String(menu.Name) + ' ให้ครบถ้วน');
      }
      if (new Set(choiceIds).size !== choiceIds.length) {
        throw makeApiError_('DUPLICATE_MENU_OPTION', 'พบตัวเลือกอาหารซ้ำกัน');
      }

      var choices = safeJsonParse_(group.ChoicesJSON, []);
      var groupSelected = [];
      choiceIds.forEach(function (choiceId) {
        var choice = choices.filter(function (entry) { return String(entry.choiceId) === choiceId; })[0];
        if (!choice || choice.isAvailable === false) {
          throw makeApiError_('INVALID_MENU_OPTION', 'ตัวเลือกอาหารบางรายการไม่พร้อมให้บริการ');
        }
        var choicePrice = toNumber_(choice.price, 0);
        extraPrice += choicePrice;
        groupSelected.push({
          choiceId: String(choice.choiceId),
          name: String(choice.name || ''),
          price: choicePrice
        });
      });

      if (groupSelected.length) {
        selectedOptions.push({
          groupId: String(group.OptionGroupID),
          groupName: String(group.Name || ''),
          choices: groupSelected
        });
      }
    });

    // Reject selections for groups that do not belong to this menu.
    selections.forEach(function (selection) {
      var isValidGroup = groups.some(function (group) { return String(group.OptionGroupID) === String(selection.groupId); });
      if (!isValidGroup && (selection.choiceIds || []).length) {
        throw makeApiError_('INVALID_MENU_OPTIONS', 'พบตัวเลือกที่ไม่ตรงกับเมนูอาหาร');
      }
    });

    var unitPrice = roundMoney_(menuPrice + extraPrice);
    var lineTotal = roundMoney_(unitPrice * quantity);
    subtotal += lineTotal;

    calculatedItems.push({
      menuId: menuId,
      menuName: String(menu.Name || ''),
      quantity: quantity,
      basePrice: menuPrice,
      selectedOptions: selectedOptions,
      extraPrice: roundMoney_(extraPrice),
      unitPrice: unitPrice,
      lineTotal: lineTotal,
      note: cleanString_(itemInput.note || '', 300)
    });
  });

  return { items: calculatedItems, subtotal: roundMoney_(subtotal) };
}

function generateOrderNumber_() {
  var day = Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyyMMdd');
  var prefix = 'JO-' + day + '-';
  var rows = readObjects_('Orders');
  var maxSequence = 0;

  rows.forEach(function (row) {
    var orderNumber = String(row.OrderNumber || '');
    if (orderNumber.indexOf(prefix) === 0) {
      var sequence = parseInt(orderNumber.substring(prefix.length), 10);
      if (!isNaN(sequence) && sequence > maxSequence) maxSequence = sequence;
    }
  });
  return prefix + String(maxSequence + 1).padStart(3, '0');
}

function updateCustomerAfterOrder_(identity, orderTotal, now) {
  var customers = readObjects_('Customers');
  var current = customers.filter(function (row) { return String(row.LineUserID) === identity.lineUserId; })[0];

  if (current) {
    updateObjectByKey_('Customers', 'LineUserID', identity.lineUserId, {
      DisplayName: identity.displayName,
      PictureURL: identity.pictureUrl,
      LastSeenAt: now,
      TotalOrders: toNumber_(current.TotalOrders, 0) + 1,
      TotalSpent: roundMoney_(toNumber_(current.TotalSpent, 0) + orderTotal)
    });
  } else {
    appendObject_('Customers', {
      LineUserID: identity.lineUserId,
      DisplayName: identity.displayName,
      PictureURL: identity.pictureUrl,
      FirstSeenAt: now,
      LastSeenAt: now,
      TotalOrders: 1,
      TotalSpent: roundMoney_(orderTotal)
    });
  }
}

function calculatePromotion_(code, subtotal) {
  var promotions = readObjects_('Promotions');
  var promotion = promotions.filter(function (row) {
    return String(row.Code || '').toUpperCase() === code && toBoolean_(row.IsActive, false);
  })[0];

  if (!promotion) throw makeApiError_('INVALID_COUPON', 'ไม่พบคูปองหรือคูปองนี้ไม่พร้อมใช้งาน');

  var now = new Date().getTime();
  var startAt = promotion.StartAt ? new Date(promotion.StartAt).getTime() : 0;
  var endAt = promotion.EndAt ? new Date(promotion.EndAt).getTime() : Number.MAX_SAFE_INTEGER;
  if ((startAt && now < startAt) || (endAt && now > endAt)) {
    throw makeApiError_('COUPON_EXPIRED', 'คูปองนี้ยังไม่เริ่มใช้หรือหมดอายุแล้ว');
  }

  var minSubtotal = toNumber_(promotion.MinSubtotal, 0);
  if (subtotal < minSubtotal) throw makeApiError_('COUPON_MINIMUM_NOT_MET', 'ยอดสั่งซื้อยังไม่ถึงขั้นต่ำของคูปอง');

  var usageLimit = toNumber_(promotion.UsageLimit, 0);
  var usedCount = toNumber_(promotion.UsedCount, 0);
  if (usageLimit > 0 && usedCount >= usageLimit) throw makeApiError_('COUPON_USAGE_LIMIT', 'คูปองนี้ถูกใช้ครบจำนวนแล้ว');

  var value = toNumber_(promotion.DiscountValue, 0);
  var discount = String(promotion.DiscountType || 'FIXED').toUpperCase() === 'PERCENT'
    ? subtotal * value / 100
    : value;
  var maxDiscount = toNumber_(promotion.MaxDiscount, 0);
  if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  discount = roundMoney_(Math.max(0, Math.min(subtotal, discount)));

  return { code: code, discount: discount, promotionId: String(promotion.PromotionID) };
}

function incrementPromotionUsage_(promotionId) {
  var promotion = readObjects_('Promotions').filter(function (row) { return String(row.PromotionID) === String(promotionId); })[0];
  if (!promotion) return;
  updateObjectByKey_('Promotions', 'PromotionID', promotionId, {
    UsedCount: toNumber_(promotion.UsedCount, 0) + 1,
    UpdatedAt: new Date().toISOString()
  });
}

function getMyOrders_(request) {
  var identity = requireCustomer_(request);
  return readObjects_('Orders').filter(function (row) {
    return String(row.LineUserID) === identity.lineUserId;
  }).sort(function (a, b) {
    return new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime();
  }).slice(0, 50).map(function (row) {
    return mapOrderSummary_(row, false);
  });
}

function getCustomerOrder_(request) {
  var identity = requireCustomer_(request);
  var order = getOrderById_(request.orderId, true);
  if (!order || order.lineUserId !== identity.lineUserId) {
    throw makeApiError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
  }
  return order;
}

function cancelCustomerOrder_(request) {
  var identity = requireCustomer_(request);
  var order = getOrderById_(request.orderId, false);
  if (!order || order.lineUserId !== identity.lineUserId) {
    throw makeApiError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
  }
  if (order.status !== ORDER_STATUS.PENDING) {
    throw makeApiError_('CANNOT_CANCEL_ORDER', 'ออเดอร์นี้ร้านรับดำเนินการแล้ว กรุณาติดต่อร้านเพื่อขอยกเลิก');
  }
  return changeOrderStatus_(request.orderId, ORDER_STATUS.CANCELLED, identity.lineUserId, 'CUSTOMER', request.requestKey || Utilities.getUuid(), 'ลูกค้าขอยกเลิก');
}

/* ========================================================================== *
 *  ORDER LOOKUPS & ADMIN ORDER MANAGEMENT
 * ========================================================================== */

function getOrderById_(orderId, includeItems) {
  var id = String(orderId || '');
  if (!id) return null;
  var row = readObjects_('Orders').filter(function (entry) { return String(entry.OrderID) === id; })[0];
  if (!row) return null;
  return mapOrderSummary_(row, includeItems !== false);
}

function mapOrderSummary_(row, includeItems) {
  var order = {
    orderId: String(row.OrderID || ''),
    orderNumber: String(row.OrderNumber || ''),
    lineUserId: String(row.LineUserID || ''),
    customerName: String(row.CustomerName || ''),
    orderType: String(row.OrderType || ''),
    tableNumber: String(row.TableNumber || ''),
    status: String(row.Status || ''),
    statusLabel: ORDER_STATUS_LABELS[String(row.Status || '')] || String(row.Status || ''),
    paymentMethod: String(row.PaymentMethod || ''),
    paymentStatus: String(row.PaymentStatus || ''),
    subtotal: toNumber_(row.Subtotal, 0),
    discountCode: String(row.DiscountCode || ''),
    discountAmount: toNumber_(row.DiscountAmount, 0),
    deliveryFee: toNumber_(row.DeliveryFee, 0),
    total: toNumber_(row.Total, 0),
    note: String(row.Note || ''),
    createdAt: toIsoString_(row.CreatedAt),
    updatedAt: toIsoString_(row.UpdatedAt),
    acceptedAt: toIsoString_(row.AcceptedAt),
    preparingAt: toIsoString_(row.PreparingAt),
    readyAt: toIsoString_(row.ReadyAt),
    completedAt: toIsoString_(row.CompletedAt),
    cancelledAt: toIsoString_(row.CancelledAt),
    cancelReason: String(row.CancelReason || ''),
    source: String(row.Source || '')
  };

  if (includeItems) {
    order.items = readObjects_('OrderItems').filter(function (item) {
      return String(item.OrderID) === order.orderId;
    }).map(function (item) {
      return {
        itemId: String(item.ItemID || ''),
        menuId: String(item.MenuID || ''),
        menuName: String(item.MenuName || ''),
        quantity: toNumber_(item.Quantity, 0),
        basePrice: toNumber_(item.BasePrice, 0),
        options: safeJsonParse_(item.OptionsJSON, []),
        extraPrice: toNumber_(item.ExtraPrice, 0),
        unitPrice: toNumber_(item.UnitPrice, 0),
        lineTotal: toNumber_(item.LineTotal, 0),
        note: String(item.Note || '')
      };
    });
    order.history = readObjects_('StatusHistory').filter(function (historyRow) {
      return String(historyRow.OrderID) === order.orderId;
    }).sort(function (a, b) {
      return new Date(a.ChangedAt).getTime() - new Date(b.ChangedAt).getTime();
    }).map(function (historyRow) {
      return {
        oldStatus: String(historyRow.OldStatus || ''),
        status: String(historyRow.NewStatus || ''),
        statusLabel: ORDER_STATUS_LABELS[String(historyRow.NewStatus || '')] || String(historyRow.NewStatus || ''),
        channel: String(historyRow.Channel || ''),
        changedAt: toIsoString_(historyRow.ChangedAt)
      };
    });
  }
  return order;
}

function adminListOrders_(request) {
  var statusFilter = String(request.status || '').toUpperCase();
  var dateFilter = String(request.date || '');
  var limit = Math.max(1, Math.min(200, Math.floor(toNumber_(request.limit, 100))));

  return readObjects_('Orders').filter(function (row) {
    if (statusFilter && statusFilter !== 'ALL' && String(row.Status) !== statusFilter) return false;
    if (dateFilter) {
      var orderDate = Utilities.formatDate(new Date(row.CreatedAt), APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
      if (orderDate !== dateFilter) return false;
    }
    return true;
  }).sort(function (a, b) {
    return new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime();
  }).slice(0, limit).map(function (row) {
    return mapOrderSummary_(row, toBoolean_(request.includeItems, false));
  });
}

function getAdminDashboard_() {
  var today = Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  var orders = readObjects_('Orders');
  var todaysOrders = orders.filter(function (row) {
    return Utilities.formatDate(new Date(row.CreatedAt), APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd') === today;
  });
  var counts = {};
  Object.keys(ORDER_STATUS).forEach(function (key) { counts[key] = 0; });
  todaysOrders.forEach(function (row) {
    var status = String(row.Status || '');
    if (counts.hasOwnProperty(status)) counts[status]++;
  });

  var sales = todaysOrders.filter(function (row) { return String(row.Status) === ORDER_STATUS.COMPLETED; })
    .reduce(function (sum, row) { return sum + toNumber_(row.Total, 0); }, 0);

  return {
    date: today,
    totalOrdersToday: todaysOrders.length,
    completedOrdersToday: counts.COMPLETED,
    pendingOrders: counts.PENDING,
    preparingOrders: counts.PREPARING,
    readyOrders: counts.READY,
    cancelledOrdersToday: counts.CANCELLED,
    completedSalesToday: roundMoney_(sales),
    statusCounts: counts,
    recentOrders: todaysOrders.sort(function (a, b) {
      return new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime();
    }).slice(0, 8).map(function (row) { return mapOrderSummary_(row, false); }),
    settings: getPublicSettings_()
  };
}

function changeOrderStatus_(orderId, newStatus, actor, channel, requestKey, cancelReason) {
  var id = String(orderId || '');
  var status = String(newStatus || '').toUpperCase();
  if (!id || !ORDER_STATUS[status]) throw makeApiError_('INVALID_STATUS', 'สถานะออเดอร์ไม่ถูกต้อง');

  var changedOrder = null;
  var historyRequestKey = String(requestKey || Utilities.getUuid());
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var history = readObjects_('StatusHistory');
    var duplicateHistory = history.filter(function (row) { return String(row.RequestKey) === historyRequestKey; })[0];
    if (duplicateHistory) {
      return {
        order: getOrderById_(id, true),
        duplicateRequest: true,
        customerNotified: toBoolean_(duplicateHistory.CustomerNotified, false),
        groupNotified: toBoolean_(duplicateHistory.GroupNotified, false)
      };
    }

    var orderRow = readObjects_('Orders').filter(function (row) { return String(row.OrderID) === id; })[0];
    if (!orderRow) throw makeApiError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');

    var oldStatus = String(orderRow.Status || '');
    var allowed = ALLOWED_STATUS_TRANSITIONS[oldStatus] || [];
    if (allowed.indexOf(status) === -1) {
      throw makeApiError_('INVALID_STATUS_TRANSITION', 'ไม่สามารถเปลี่ยนจากสถานะ ' + (ORDER_STATUS_LABELS[oldStatus] || oldStatus) + ' ไปเป็น ' + ORDER_STATUS_LABELS[status] + ' ได้');
    }

    var now = new Date().toISOString();
    var patch = { Status: status, UpdatedAt: now };
    if (status === ORDER_STATUS.ACCEPTED) patch.AcceptedAt = now;
    if (status === ORDER_STATUS.PREPARING) patch.PreparingAt = now;
    if (status === ORDER_STATUS.READY) patch.ReadyAt = now;
    if (status === ORDER_STATUS.COMPLETED) patch.CompletedAt = now;
    if (status === ORDER_STATUS.CANCELLED) {
      patch.CancelledAt = now;
      patch.CancelReason = cleanString_(cancelReason || '', 300);
    }

    updateObjectByKey_('Orders', 'OrderID', id, patch);
    appendObject_('StatusHistory', {
      HistoryID: 'HIS_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
      OrderID: id,
      OrderNumber: String(orderRow.OrderNumber || ''),
      OldStatus: oldStatus,
      NewStatus: status,
      ChangedBy: String(actor || 'SYSTEM'),
      Channel: String(channel || 'SYSTEM'),
      RequestKey: historyRequestKey,
      ChangedAt: now,
      CustomerNotified: false,
      GroupNotified: false,
      NotificationError: ''
    });
    changedOrder = getOrderById_(id, true);
  } finally {
    lock.releaseLock();
  }

  var customerSent = false;
  var groupSent = false;
  var notificationErrors = [];

  try {
    sendCustomerStatusFlex_(changedOrder);
    customerSent = true;
  } catch (customerError) {
    notificationErrors.push('ลูกค้า: ' + safeErrorMessage_(customerError));
    logError_('sendCustomerStatusFlex_', customerError);
  }

  try {
    sendGroupOrderFlex_(id);
    groupSent = true;
  } catch (groupError) {
    notificationErrors.push('กลุ่มร้าน: ' + safeErrorMessage_(groupError));
    logError_('sendGroupOrderFlex_', groupError);
  }

  markHistoryNotifications_(historyRequestKey, customerSent, groupSent, notificationErrors.join(' | '));

  return {
    order: getOrderById_(id, true),
    duplicateRequest: false,
    customerNotified: customerSent,
    groupNotified: groupSent,
    notificationErrors: notificationErrors
  };
}

/* ========================================================================== *
 *  LINE MESSAGING API — FLEX MESSAGE PUSHES
 * ========================================================================== */

function sendGroupOrderFlex_(orderId) {
  var groupId = getScriptProperty_('LINE_GROUP_ID');
  if (!groupId) throw new Error('ยังไม่พบ LINE_GROUP_ID กรุณาเชิญ OA เข้ากลุ่มร้านและตั้งค่า Webhook Bridge');

  var order = getOrderById_(orderId, true);
  if (!order) throw new Error('ไม่พบออเดอร์สำหรับส่ง LINE Flex Message');

  var bubble = buildGroupOrderBubble_(order);
  return linePushMessage_(groupId, [{
    type: 'flex',
    altText: 'ออเดอร์ ' + order.orderNumber + ' — ' + (ORDER_STATUS_LABELS[order.status] || order.status),
    contents: bubble
  }]);
}

function sendCustomerStatusFlex_(order) {
  if (!order || !order.lineUserId) throw new Error('ไม่พบ LINE User ID ของลูกค้า');

  var bubble = buildCustomerStatusBubble_(order);
  return linePushMessage_(order.lineUserId, [{
    type: 'flex',
    altText: 'ออเดอร์ ' + order.orderNumber + ': ' + (ORDER_STATUS_LABELS[order.status] || order.status),
    contents: bubble
  }]);
}

function buildGroupOrderBubble_(order) {
  var bodyContents = [
    flexText_(APP_CONFIG.STORE_NAME, 'sm', '#6B7280', false),
    flexText_('ออเดอร์ใหม่ / รายละเอียดออเดอร์', 'lg', '#111827', true),
    flexText_(order.orderNumber, 'xxl', '#111827', true),
    flexText_('ลูกค้า: ' + (order.customerName || 'ลูกค้า LINE'), 'sm', '#374151', false),
    flexText_((order.orderType === 'DINE_IN' ? 'รับประทานที่ร้าน' : 'ซื้อกลับบ้าน') + (order.tableNumber ? ' · โต๊ะ ' + order.tableNumber : ''), 'sm', '#6B7280', false),
    flexSeparator_()
  ];

  var visibleItems = (order.items || []).slice(0, 8);
  visibleItems.forEach(function (item) {
    var itemDetails = [];
    if (item.options && item.options.length) itemDetails.push(formatOptionsText_(item.options));
    if (item.note) itemDetails.push('หมายเหตุ: ' + item.note);
    var itemContents = [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: item.quantity + ' × ' + cleanString_(item.menuName, 80), size: 'sm', weight: 'bold', wrap: true, flex: 5 },
          { type: 'text', text: formatMoney_(item.lineTotal), size: 'sm', align: 'end', flex: 2 }
        ]
      }
    ];
    if (itemDetails.length) itemContents.push(flexText_(cleanString_(itemDetails.join(' · '), 220), 'xs', '#6B7280', false));
    bodyContents.push({ type: 'box', layout: 'vertical', spacing: 'xs', contents: itemContents });
  });
  if ((order.items || []).length > visibleItems.length) {
    bodyContents.push(flexText_('และอีก ' + ((order.items || []).length - visibleItems.length) + ' รายการ · ดูรายละเอียดใน Dashboard', 'xs', '#6B7280', false));
  }

  bodyContents.push(flexSeparator_());
  bodyContents.push(flexKeyValue_('ยอดอาหาร', formatMoney_(order.subtotal)));
  if (order.discountAmount > 0) bodyContents.push(flexKeyValue_('ส่วนลด', '-' + formatMoney_(order.discountAmount)));
  if (order.deliveryFee > 0) bodyContents.push(flexKeyValue_('ค่าจัดส่ง', formatMoney_(order.deliveryFee)));
  bodyContents.push(flexKeyValue_('ชำระโดย', order.paymentMethod === 'PROMPTPAY' ? 'โอน/PromptPay' : 'เงินสด'));
  bodyContents.push({
    type: 'box', layout: 'horizontal', margin: 'md',
    contents: [
      { type: 'text', text: 'ยอดรวม', weight: 'bold', size: 'md', flex: 1 },
      { type: 'text', text: formatMoney_(order.total), weight: 'bold', size: 'xl', color: '#15803D', align: 'end', flex: 1 }
    ]
  });
  if (order.note) bodyContents.push(flexText_('หมายเหตุจากลูกค้า: ' + order.note, 'sm', '#374151', false));

  var footerContents = [
    flexText_('สถานะปัจจุบัน: ' + (ORDER_STATUS_LABELS[order.status] || order.status), 'sm', ORDER_STATUS_COLORS[order.status] || '#374151', true)
  ];
  getNextStatusButtons_(order.status).forEach(function (button) {
    footerContents.push({
      type: 'button',
      style: button.style,
      color: button.color,
      height: 'sm',
      action: {
        type: 'postback',
        label: button.label,
        data: 'action=change_status&orderId=' + encodeURIComponent(order.orderId) + '&status=' + encodeURIComponent(button.status),
        displayText: button.label + ' ' + order.orderNumber
      }
    });
  });

  if (getNextStatusButtons_(order.status).length === 0) {
    footerContents.push(flexText_('ออเดอร์นี้ไม่มีขั้นตอนที่ต้องดำเนินการต่อ', 'xs', '#6B7280', false));
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#F9FAFB',
      contents: [flexText_('ORDER MANAGEMENT', 'xs', '#6B7280', true)]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: bodyContents },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: footerContents }
  };
}

function buildCustomerStatusBubble_(order) {
  var status = order.status;
  var statusLabel = ORDER_STATUS_LABELS[status] || status;
  var subtitle = getCustomerStatusMessage_(status);
  var bodyContents = [
    flexText_(APP_CONFIG.STORE_NAME, 'sm', '#6B7280', false),
    flexText_(statusLabel, 'xl', ORDER_STATUS_COLORS[status] || '#111827', true),
    flexText_('หมายเลขออเดอร์ ' + order.orderNumber, 'md', '#111827', true),
    flexText_(subtitle, 'sm', '#4B5563', false),
    flexSeparator_(),
    flexKeyValue_('รูปแบบรับอาหาร', order.orderType === 'DINE_IN' ? 'รับประทานที่ร้าน' : 'ซื้อกลับบ้าน'),
    flexKeyValue_('ยอดรวม', formatMoney_(order.total))
  ];

  if (order.tableNumber) bodyContents.push(flexKeyValue_('หมายเลขโต๊ะ', order.tableNumber));
  if (status === ORDER_STATUS.CANCELLED && order.cancelReason) bodyContents.push(flexText_('เหตุผล: ' + order.cancelReason, 'sm', '#DC2626', false));

  var footerContents = [];
  var liffUrl = getScriptProperty_('LIFF_URL');
  if (liffUrl) {
    footerContents.push({
      type: 'button',
      style: 'primary',
      color: '#16A34A',
      action: { type: 'uri', label: 'ดูรายละเอียดออเดอร์', uri: liffUrl }
    });
  }
  footerContents.push(flexText_('ขอบคุณที่ใช้บริการครับ', 'xs', '#6B7280', false));

  return {
    type: 'bubble',
    size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px', contents: bodyContents },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: footerContents }
  };
}

function getNextStatusButtons_(status) {
  var buttons = {
    PENDING: [
      { status: 'ACCEPTED', label: '✓ รับออเดอร์', style: 'primary', color: '#16A34A' },
      { status: 'CANCELLED', label: '✕ ยกเลิกออเดอร์', style: 'secondary', color: '#DC2626' }
    ],
    ACCEPTED: [
      { status: 'PREPARING', label: 'เริ่มปรุงอาหาร', style: 'primary', color: '#2563EB' },
      { status: 'CANCELLED', label: 'ยกเลิกออเดอร์', style: 'secondary', color: '#DC2626' }
    ],
    PREPARING: [
      { status: 'READY', label: 'อาหารพร้อมรับ', style: 'primary', color: '#16A34A' },
      { status: 'CANCELLED', label: 'ยกเลิกออเดอร์', style: 'secondary', color: '#DC2626' }
    ],
    READY: [
      { status: 'COMPLETED', label: '✓ เสร็จสิ้น', style: 'primary', color: '#15803D' }
    ],
    COMPLETED: [],
    CANCELLED: []
  };
  return buttons[status] || [];
}

function getCustomerStatusMessage_(status) {
  var messages = {
    PENDING: 'ร้านได้รับคำสั่งซื้อแล้ว กำลังรอยืนยันออเดอร์',
    ACCEPTED: 'ร้านยืนยันออเดอร์แล้ว ขอบคุณที่รอครับ',
    PREPARING: 'เชฟกำลังปรุงอาหารให้คุณอย่างตั้งใจ',
    READY: 'อาหารของคุณพร้อมรับแล้วครับ',
    COMPLETED: 'ออเดอร์ของคุณเสร็จสมบูรณ์ ขอบคุณที่อุดหนุนครับ',
    CANCELLED: 'คำสั่งซื้อถูกยกเลิก หากมีข้อสงสัยกรุณาติดต่อร้าน'
  };
  return messages[status] || 'ร้านมีการอัปเดตสถานะคำสั่งซื้อของคุณ';
}

function flexText_(text, size, color, bold) {
  var value = String(text || '');
  if (!value) return { type: 'text', text: ' ', size: size || 'xs', color: color || '#6B7280' };
  return {
    type: 'text', text: value, size: size || 'sm', color: color || '#111827',
    weight: bold ? 'bold' : 'regular', wrap: true
  };
}

function flexSeparator_() {
  return { type: 'separator', margin: 'md', color: '#E5E7EB' };
}

function flexKeyValue_(label, value) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: String(label), size: 'sm', color: '#6B7280', flex: 4 },
      { type: 'text', text: String(value), size: 'sm', color: '#111827', align: 'end', wrap: true, flex: 5 }
    ]
  };
}

function formatOptionsText_(options) {
  return (options || []).map(function (group) {
    var choices = (group.choices || []).map(function (choice) {
      return choice.name + (toNumber_(choice.price, 0) > 0 ? ' (+' + formatMoney_(choice.price) + ')' : '');
    }).join(', ');
    return group.groupName + ': ' + choices;
  }).join(' · ');
}

function linePushMessage_(to, messages) {
  var accessToken = getScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!accessToken) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
  if (!to) throw new Error('ไม่พบปลายทาง LINE สำหรับส่งข้อความ');

  var response = UrlFetchApp.fetch(APP_CONFIG.LINE_API_BASE + '/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({ to: String(to), messages: messages }),
    muteHttpExceptions: true
  });

  var responseCode = response.getResponseCode();
  if (responseCode < 200 || responseCode >= 300) {
    var errorBody = safeJsonParse_(response.getContentText(), {});
    throw new Error('LINE Messaging API ส่งข้อความไม่สำเร็จ (' + responseCode + '): ' + String(errorBody.message || response.getContentText()).substring(0, 250));
  }
  return { sent: true, statusCode: responseCode };
}

/* ========================================================================== *
 *  LINE WEBHOOK BRIDGE & GROUP POSTBACK HANDLER
 * ========================================================================== */

function processLineWebhookPayload_(webhook) {
  var events = Array.isArray(webhook.events) ? webhook.events : [];
  var processed = 0;
  var errors = [];

  events.forEach(function (event) {
    try {
      if (event.type === 'join' && event.source && event.source.type === 'group') {
        captureLineGroupId_(event.source.groupId);
      }
      if (event.type === 'postback') {
        handleLinePostbackEvent_(event);
      }
      if (event.source && event.source.type === 'group' && event.source.groupId) {
        captureLineGroupId_(event.source.groupId);
      }
      processed++;
    } catch (error) {
      errors.push(safeErrorMessage_(error));
      logError_('processLineWebhookPayload_', error);
      if (event.replyToken) {
        try { lineReplyText_(event.replyToken, 'ไม่สามารถดำเนินการได้ กรุณารีเฟรชออเดอร์จากระบบหลังบ้าน'); } catch (ignore) {}
      }
    }
  });

  return { received: events.length, processed: processed, errors: errors };
}

function captureLineGroupId_(groupId) {
  if (!groupId) return;
  var properties = PropertiesService.getScriptProperties();
  var current = properties.getProperty('LINE_GROUP_ID');
  if (!current) {
    properties.setProperty('LINE_GROUP_ID', String(groupId));
    Logger.log('Captured LINE_GROUP_ID from the first group webhook event.');
  }
}

function handleLinePostbackEvent_(event) {
  var source = event.source || {};
  var groupId = String(source.groupId || '');
  var configuredGroupId = getScriptProperty_('LINE_GROUP_ID');
  if (!groupId || source.type !== 'group') {
    throw makeApiError_('INVALID_POSTBACK_SOURCE', 'คำสั่งนี้ใช้ได้จากกลุ่ม LINE ของร้านเท่านั้น');
  }
  if (configuredGroupId && configuredGroupId !== groupId) {
    throw makeApiError_('WRONG_LINE_GROUP', 'คำสั่งมาจากกลุ่ม LINE ที่ไม่ได้กำหนดไว้');
  }
  if (!configuredGroupId) captureLineGroupId_(groupId);

  var staffIds = String(getScriptProperty_('LINE_ALLOWED_STAFF_IDS') || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);
  var operatorId = String(source.userId || '');
  if (staffIds.length && staffIds.indexOf(operatorId) === -1) {
    if (event.replyToken) lineReplyText_(event.replyToken, 'บัญชี LINE นี้ไม่มีสิทธิ์จัดการออเดอร์');
    throw makeApiError_('STAFF_NOT_ALLOWED', 'บัญชี LINE นี้ไม่มีสิทธิ์จัดการออเดอร์');
  }

  var data = parseQueryString_(event.postback && event.postback.data ? event.postback.data : '');
  if (data.action !== 'change_status' || !data.orderId || !data.status) {
    throw makeApiError_('INVALID_POSTBACK', 'ข้อมูลปุ่มไม่ถูกต้อง');
  }

  var eventId = String(event.webhookEventId || Utilities.getUuid());
  var result = changeOrderStatus_(data.orderId, data.status, operatorId || 'LINE_GROUP_MEMBER', 'LINE_GROUP', 'LINE:' + eventId, '');
  if (event.replyToken) {
    var replyText = result.duplicateRequest
      ? 'รายการนี้ได้รับการดำเนินการไปแล้ว'
      : 'อัปเดตออเดอร์ ' + result.order.orderNumber + ' เป็นสถานะ ' + result.order.statusLabel + ' แล้ว';
    lineReplyText_(event.replyToken, replyText);
  }
  return result;
}

function parseQueryString_(query) {
  var output = {};
  String(query || '').split('&').forEach(function (part) {
    if (!part) return;
    var pieces = part.split('=');
    var key = decodeURIComponent(pieces.shift() || '');
    var value = decodeURIComponent(pieces.join('=') || '');
    output[key] = value;
  });
  return output;
}

function lineReplyText_(replyToken, text) {
  var accessToken = getScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!accessToken || !replyToken) return;
  var response = UrlFetchApp.fetch(APP_CONFIG.LINE_API_BASE + '/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: String(text).substring(0, 5000) }] }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    Logger.log('LINE reply failed: ' + response.getResponseCode() + ' ' + response.getContentText());
  }
}

function markHistoryNotifications_(requestKey, customerSent, groupSent, errorMessage) {
  var rows = readObjects_('StatusHistory');
  var row = rows.filter(function (entry) { return String(entry.RequestKey) === String(requestKey); })[0];
  if (!row) return;
  updateObjectByKey_('StatusHistory', 'HistoryID', row.HistoryID, {
    CustomerNotified: !!customerSent,
    GroupNotified: !!groupSent,
    NotificationError: String(errorMessage || '')
  });
}

/* ========================================================================== *
 *  ADMIN AUTHENTICATION & SESSION MANAGEMENT
 * ========================================================================== */

function adminLogin_(request) {
  var cache = CacheService.getScriptCache();
  if (cache.get('admin_login_lock')) {
    throw makeApiError_('ADMIN_LOGIN_LOCKED', 'มีการกรอกรหัสผิดหลายครั้ง กรุณาลองใหม่ภายหลัง');
  }

  var password = String(request.password || '');
  var properties = PropertiesService.getScriptProperties();
  var expectedHash = properties.getProperty('ADMIN_PASSWORD_HASH');
  var salt = properties.getProperty('ADMIN_PASSWORD_SALT');
  if (!expectedHash || !salt) {
    throw makeApiError_('ADMIN_PASSWORD_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่ารหัสเข้าใช้งานหลังบ้าน');
  }

  var inputHash = sha256Hex_(salt + '|' + password);
  if (!constantTimeEquals_(inputHash, expectedHash)) {
    var attempts = toNumber_(cache.get('admin_login_attempts'), 0) + 1;
    cache.put('admin_login_attempts', String(attempts), APP_CONFIG.ADMIN_LOGIN_LOCK_SECONDS);
    if (attempts >= APP_CONFIG.ADMIN_LOGIN_MAX_ATTEMPTS) {
      cache.put('admin_login_lock', '1', APP_CONFIG.ADMIN_LOGIN_LOCK_SECONDS);
    }
    throw makeApiError_('INVALID_ADMIN_PASSWORD', 'รหัสเข้าใช้งานไม่ถูกต้อง');
  }

  cache.remove('admin_login_attempts');
  cache.remove('admin_login_lock');

  var sessionToken = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var sessionKey = adminSessionCacheKey_(sessionToken);
  cache.put(sessionKey, 'ADMIN', APP_CONFIG.ADMIN_SESSION_TTL_SECONDS);

  logAdminAction_('LOGIN', 'ADMIN', {});
  return {
    sessionToken: sessionToken,
    expiresIn: APP_CONFIG.ADMIN_SESSION_TTL_SECONDS
  };
}

function requireAdmin_(request) {
  var token = String(request.sessionToken || request.adminToken || '');
  if (!token) throw makeApiError_('ADMIN_AUTH_REQUIRED', 'กรุณาเข้าสู่ระบบหลังบ้าน');
  var session = CacheService.getScriptCache().get(adminSessionCacheKey_(token));
  if (session !== 'ADMIN') throw makeApiError_('ADMIN_SESSION_EXPIRED', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return true;
}

function adminLogout_(request) {
  var token = String(request.sessionToken || request.adminToken || '');
  if (token) CacheService.getScriptCache().remove(adminSessionCacheKey_(token));
  logAdminAction_('LOGOUT', 'ADMIN', {});
}

function adminSessionCacheKey_(token) {
  return 'admin_session_' + sha256Hex_(String(token)).substring(0, 48);
}

/* ========================================================================== *
 *  ADMIN MENU, CATEGORY, SETTINGS & PROMOTION MANAGEMENT
 * ========================================================================== */

function adminUpsertMenu_(menu) {
  var name = cleanString_(menu.name || '', 150);
  var categoryId = cleanString_(menu.categoryId || '', 100);
  var price = toNumber_(menu.price, -1);
  if (!name) throw makeApiError_('INVALID_MENU_NAME', 'กรุณาระบุชื่อเมนูอาหาร');
  if (price < 0) throw makeApiError_('INVALID_MENU_PRICE', 'กรุณาระบุราคาเมนูให้ถูกต้อง');

  var menuId = cleanString_(menu.menuId || '', 100) || 'MENU_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
  var now = new Date().toISOString();
  var existing = readObjects_('Menu').filter(function (row) { return String(row.MenuID) === menuId; })[0];
  var menuRecord = {
    MenuID: menuId,
    CategoryID: categoryId,
    Name: name,
    Description: cleanString_(menu.description || '', 1000),
    Price: roundMoney_(price),
    ImageURL: cleanString_(menu.imageUrl || '', 1500),
    IsAvailable: toBoolean_(menu.isAvailable, true),
    IsRecommended: toBoolean_(menu.isRecommended, false),
    SortOrder: toNumber_(menu.sortOrder, 0),
    CreatedAt: existing ? existing.CreatedAt : now,
    UpdatedAt: now
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (existing) {
      updateObjectByKey_('Menu', 'MenuID', menuId, menuRecord);
    } else {
      appendObject_('Menu', menuRecord);
    }
    if (Array.isArray(menu.optionGroups)) saveMenuOptionGroups_(menuId, menu.optionGroups);
  } finally {
    lock.releaseLock();
  }

  logAdminAction_(existing ? 'UPDATE_MENU' : 'CREATE_MENU', 'ADMIN', { menuId: menuId, name: name });
  return getMenuItems_(true).filter(function (item) { return item.menuId === menuId; })[0];
}

function saveMenuOptionGroups_(menuId, optionGroups) {
  deleteRowsByValue_('Options', 'MenuID', menuId);
  var now = new Date().toISOString();

  optionGroups.forEach(function (group, index) {
    var groupName = cleanString_(group.name || '', 120);
    if (!groupName) return;
    var choices = Array.isArray(group.choices) ? group.choices : [];
    var normalizedChoices = choices.map(function (choice) {
      return {
        choiceId: cleanString_(choice.choiceId || '', 100) || 'CHOICE_' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase(),
        name: cleanString_(choice.name || '', 120),
        price: roundMoney_(Math.max(0, toNumber_(choice.price, 0))),
        isAvailable: toBoolean_(choice.isAvailable, true)
      };
    }).filter(function (choice) { return choice.name; });

    appendObject_('Options', {
      OptionGroupID: cleanString_(group.groupId || '', 100) || 'OPT_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(),
      MenuID: menuId,
      Name: groupName,
      SelectionType: String(group.selectionType || 'SINGLE').toUpperCase() === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE',
      IsRequired: toBoolean_(group.isRequired, false),
      MinSelect: Math.max(0, Math.floor(toNumber_(group.minSelect, toBoolean_(group.isRequired, false) ? 1 : 0))),
      MaxSelect: Math.max(1, Math.floor(toNumber_(group.maxSelect, 1))),
      ChoicesJSON: JSON.stringify(normalizedChoices),
      SortOrder: toNumber_(group.sortOrder, index),
      IsActive: toBoolean_(group.isActive, true),
      CreatedAt: now,
      UpdatedAt: now
    });
  });
}

function adminSetMenuAvailability_(menuId, isAvailable) {
  var id = String(menuId || '');
  var updated = updateObjectByKey_('Menu', 'MenuID', id, {
    IsAvailable: toBoolean_(isAvailable, false),
    UpdatedAt: new Date().toISOString()
  });
  if (!updated) throw makeApiError_('MENU_NOT_FOUND', 'ไม่พบเมนูอาหาร');
  logAdminAction_('SET_MENU_AVAILABILITY', 'ADMIN', { menuId: id, isAvailable: !!isAvailable });
  return { menuId: id, isAvailable: toBoolean_(isAvailable, false) };
}

function adminSaveCategory_(category) {
  var name = cleanString_(category.name || '', 120);
  if (!name) throw makeApiError_('INVALID_CATEGORY_NAME', 'กรุณาระบุชื่อหมวดหมู่');
  var categoryId = cleanString_(category.categoryId || '', 100) || 'CAT_' + Utilities.getUuid().replace(/-/g, '').substring(0, 14).toUpperCase();
  var existing = readObjects_('Categories').filter(function (row) { return String(row.CategoryID) === categoryId; })[0];
  var now = new Date().toISOString();
  var record = {
    CategoryID: categoryId,
    Name: name,
    Description: cleanString_(category.description || '', 500),
    ImageURL: cleanString_(category.imageUrl || '', 1500),
    SortOrder: toNumber_(category.sortOrder, 0),
    IsActive: toBoolean_(category.isActive, true),
    CreatedAt: existing ? existing.CreatedAt : now,
    UpdatedAt: now
  };
  if (existing) updateObjectByKey_('Categories', 'CategoryID', categoryId, record);
  else appendObject_('Categories', record);
  logAdminAction_(existing ? 'UPDATE_CATEGORY' : 'CREATE_CATEGORY', 'ADMIN', { categoryId: categoryId, name: name });
  return getCategories_(true).filter(function (entry) { return entry.categoryId === categoryId; })[0];
}

function adminSaveSettings_(settings) {
  var allowedKeys = [
    'storeName', 'storeStatus', 'acceptOrders', 'openingTime', 'closingTime',
    'phone', 'address', 'promptPayId', 'promptPayName', 'minimumOrder',
    'deliveryFee', 'acceptDineIn', 'acceptTakeaway', 'announcement'
  ];
  var updated = [];

  Object.keys(settings).forEach(function (key) {
    if (allowedKeys.indexOf(key) === -1) return;
    var value = settings[key];
    if (key === 'storeStatus') {
      value = String(value).toUpperCase();
      if (['OPEN', 'CLOSED', 'PAUSED'].indexOf(value) === -1) return;
    }
    if (['acceptOrders', 'acceptDineIn', 'acceptTakeaway'].indexOf(key) !== -1) value = toBoolean_(value, false);
    if (['minimumOrder', 'deliveryFee'].indexOf(key) !== -1) value = Math.max(0, roundMoney_(toNumber_(value, 0)));
    if (typeof value === 'string') value = cleanString_(value, 2000);
    setSetting_(key, value);
    updated.push(key);
  });

  logAdminAction_('UPDATE_SETTINGS', 'ADMIN', { keys: updated });
  return { updatedKeys: updated, settings: getPublicSettings_() };
}

function adminSavePromotion_(promotion) {
  var code = cleanString_(promotion.code || '', 40).toUpperCase();
  var name = cleanString_(promotion.name || '', 150);
  var type = String(promotion.discountType || 'FIXED').toUpperCase();
  var value = toNumber_(promotion.discountValue, -1);
  if (!code || !name || value < 0 || ['FIXED', 'PERCENT'].indexOf(type) === -1) {
    throw makeApiError_('INVALID_PROMOTION', 'กรุณาตรวจสอบข้อมูลโปรโมชัน');
  }

  var promotionId = cleanString_(promotion.promotionId || '', 100) || 'PRO_' + Utilities.getUuid().replace(/-/g, '').substring(0, 14).toUpperCase();
  var existing = readObjects_('Promotions').filter(function (row) { return String(row.PromotionID) === promotionId; })[0];
  var now = new Date().toISOString();
  var record = {
    PromotionID: promotionId,
    Code: code,
    Name: name,
    DiscountType: type,
    DiscountValue: value,
    MinSubtotal: Math.max(0, toNumber_(promotion.minSubtotal, 0)),
    MaxDiscount: Math.max(0, toNumber_(promotion.maxDiscount, 0)),
    StartAt: promotion.startAt || '',
    EndAt: promotion.endAt || '',
    UsageLimit: Math.max(0, Math.floor(toNumber_(promotion.usageLimit, 0))),
    UsedCount: existing ? toNumber_(existing.UsedCount, 0) : 0,
    IsActive: toBoolean_(promotion.isActive, true),
    CreatedAt: existing ? existing.CreatedAt : now,
    UpdatedAt: now
  };

  if (existing) updateObjectByKey_('Promotions', 'PromotionID', promotionId, record);
  else appendObject_('Promotions', record);
  logAdminAction_(existing ? 'UPDATE_PROMOTION' : 'CREATE_PROMOTION', 'ADMIN', { promotionId: promotionId, code: code });
  return { promotionId: promotionId, code: code, isActive: record.IsActive };
}

/* ========================================================================== *
 *  PAYMENT SLIP UPLOAD & VERIFICATION
 * ========================================================================== */

function submitPaymentSlip_(request) {
  var identity = requireCustomer_(request);
  var order = getOrderById_(request.orderId, false);
  if (!order || order.lineUserId !== identity.lineUserId) throw makeApiError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
  if (order.status === ORDER_STATUS.CANCELLED) throw makeApiError_('ORDER_CANCELLED', 'ไม่สามารถส่งสลิปสำหรับออเดอร์ที่ยกเลิกแล้ว');

  var base64 = String(request.imageBase64 || '').replace(/^data:[^,]+,/, '');
  var mimeType = String(request.mimeType || 'image/jpeg').toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mimeType) === -1) {
    throw makeApiError_('INVALID_SLIP_TYPE', 'รองรับไฟล์ JPG, PNG หรือ WEBP เท่านั้น');
  }
  if (!base64) throw makeApiError_('EMPTY_SLIP', 'ไม่พบไฟล์สลิป');

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > APP_CONFIG.MAX_PAYMENT_SLIP_BYTES) throw makeApiError_('SLIP_TOO_LARGE', 'ไฟล์สลิปต้องมีขนาดไม่เกิน 8 MB');

  var folderId = getScriptProperty_('PAYMENT_SLIP_FOLDER_ID');
  var folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.createFolder(APP_CONFIG.STORE_NAME + ' - Payment Slips');
    PropertiesService.getScriptProperties().setProperty('PAYMENT_SLIP_FOLDER_ID', folder.getId());
  }

  var extension = mimeType === 'image/png' ? 'png' : (mimeType === 'image/webp' ? 'webp' : 'jpg');
  var fileName = 'SLIP_' + order.orderNumber + '_' + new Date().getTime() + '.' + extension;
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = folder.createFile(blob);

  var payments = readObjects_('Payments').filter(function (row) { return String(row.OrderID) === String(order.orderId); });
  var payment = payments[0];
  if (payment) {
    updateObjectByKey_('Payments', 'PaymentID', payment.PaymentID, {
      Status: 'PENDING_REVIEW',
      SlipURL: file.getUrl(),
      SubmittedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    });
  }
  updateObjectByKey_('Orders', 'OrderID', order.orderId, {
    PaymentStatus: 'PENDING_REVIEW',
    UpdatedAt: new Date().toISOString()
  });

  return { orderId: order.orderId, paymentStatus: 'PENDING_REVIEW', message: 'ส่งสลิปเรียบร้อยแล้ว รอร้านตรวจสอบ' };
}

function adminVerifyPayment_(request) {
  var orderId = String(request.orderId || '');
  var status = String(request.paymentStatus || '').toUpperCase();
  if (['PAID', 'REJECTED'].indexOf(status) === -1) throw makeApiError_('INVALID_PAYMENT_STATUS', 'สถานะการชำระเงินไม่ถูกต้อง');

  var payment = readObjects_('Payments').filter(function (row) { return String(row.OrderID) === orderId; })[0];
  if (!payment) throw makeApiError_('PAYMENT_NOT_FOUND', 'ไม่พบข้อมูลการชำระเงิน');
  var now = new Date().toISOString();

  updateObjectByKey_('Payments', 'PaymentID', payment.PaymentID, {
    Status: status,
    VerifiedAt: now,
    VerifiedBy: 'ADMIN',
    UpdatedAt: now
  });
  updateObjectByKey_('Orders', 'OrderID', orderId, { PaymentStatus: status, UpdatedAt: now });
  logAdminAction_('VERIFY_PAYMENT', 'ADMIN', { orderId: orderId, paymentStatus: status });
  return { orderId: orderId, paymentStatus: status };
}

function mapPromotionForAdmin_(row) {
  return {
    promotionId: String(row.PromotionID || ''),
    code: String(row.Code || ''),
    name: String(row.Name || ''),
    discountType: String(row.DiscountType || 'FIXED'),
    discountValue: toNumber_(row.DiscountValue, 0),
    minSubtotal: toNumber_(row.MinSubtotal, 0),
    maxDiscount: toNumber_(row.MaxDiscount, 0),
    startAt: toIsoString_(row.StartAt),
    endAt: toIsoString_(row.EndAt),
    usageLimit: toNumber_(row.UsageLimit, 0),
    usedCount: toNumber_(row.UsedCount, 0),
    isActive: toBoolean_(row.IsActive, false)
  };
}

function adminListPayments_(request) {
  var filter = String(request.status || '').toUpperCase();
  var limit = Math.max(1, Math.min(200, Math.floor(toNumber_(request.limit, 100))));
  return readObjects_('Payments').filter(function (row) {
    return !filter || filter === 'ALL' || String(row.Status || '').toUpperCase() === filter;
  }).sort(function (a, b) {
    return new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime();
  }).slice(0, limit).map(function (row) {
    var order = readObjects_('Orders').filter(function (entry) { return String(entry.OrderID) === String(row.OrderID); })[0] || {};
    return {
      paymentId: String(row.PaymentID || ''),
      orderId: String(row.OrderID || ''),
      orderNumber: String(order.OrderNumber || ''),
      customerName: String(order.CustomerName || ''),
      method: String(row.Method || ''),
      amount: toNumber_(row.Amount, 0),
      status: String(row.Status || ''),
      slipUrl: String(row.SlipURL || ''),
      reference: String(row.Reference || ''),
      submittedAt: toIsoString_(row.SubmittedAt),
      verifiedAt: toIsoString_(row.VerifiedAt),
      createdAt: toIsoString_(row.CreatedAt)
    };
  });
}

function adminListCustomers_(request) {
  var limit = Math.max(1, Math.min(500, Math.floor(toNumber_(request.limit, 100))));
  return readObjects_('Customers').sort(function (a, b) {
    return new Date(b.LastSeenAt).getTime() - new Date(a.LastSeenAt).getTime();
  }).slice(0, limit).map(function (row) {
    return {
      lineUserId: String(row.LineUserID || ''),
      displayName: String(row.DisplayName || ''),
      pictureUrl: String(row.PictureURL || ''),
      firstSeenAt: toIsoString_(row.FirstSeenAt),
      lastSeenAt: toIsoString_(row.LastSeenAt),
      totalOrders: toNumber_(row.TotalOrders, 0),
      totalSpent: toNumber_(row.TotalSpent, 0)
    };
  });
}

/* ========================================================================== *
 *  SALES REPORTS & ADMIN AUDIT LOG
 * ========================================================================== */

function adminGetReports_(request) {
  var days = Math.max(1, Math.min(365, Math.floor(toNumber_(request.days, 30))));
  var now = new Date();
  var start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  var orders = readObjects_('Orders').filter(function (row) {
    var createdAt = new Date(row.CreatedAt).getTime();
    return createdAt >= start.getTime() && createdAt <= now.getTime() && String(row.Status) !== ORDER_STATUS.CANCELLED;
  });

  var salesByDay = {};
  var topItems = {};
  var allOrderItems = readObjects_('OrderItems');
  var completedOrderIds = {};
  var completedCount = 0;
  var completedSales = 0;

  orders.forEach(function (order) {
    if (String(order.Status) === ORDER_STATUS.COMPLETED) {
      completedCount++;
      completedSales += toNumber_(order.Total, 0);
      var day = Utilities.formatDate(new Date(order.CreatedAt), APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
      salesByDay[day] = (salesByDay[day] || 0) + toNumber_(order.Total, 0);
      completedOrderIds[String(order.OrderID)] = true;
    }
  });

  allOrderItems.forEach(function (item) {
    if (!completedOrderIds[String(item.OrderID)]) return;
    var key = String(item.MenuName || 'ไม่ระบุเมนู');
    topItems[key] = (topItems[key] || 0) + toNumber_(item.Quantity, 0);
  });

  var salesTrend = Object.keys(salesByDay).sort().map(function (day) {
    return { date: day, sales: roundMoney_(salesByDay[day]) };
  });
  var bestSellers = Object.keys(topItems).map(function (name) {
    return { menuName: name, quantity: topItems[name] };
  }).sort(function (a, b) { return b.quantity - a.quantity; }).slice(0, 10);

  return {
    days: days,
    orderCount: orders.length,
    completedOrderCount: completedCount,
    completedSales: roundMoney_(completedSales),
    averageOrderValue: completedCount ? roundMoney_(completedSales / completedCount) : 0,
    salesTrend: salesTrend,
    bestSellers: bestSellers
  };
}

function logAdminAction_(action, actor, details) {
  try {
    appendObject_('AdminLogs', {
      LogID: 'LOG_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
      Action: String(action || ''),
      Actor: String(actor || 'ADMIN'),
      Timestamp: new Date().toISOString(),
      DetailsJSON: JSON.stringify(details || {})
    });
  } catch (error) {
    logError_('logAdminAction_', error);
  }
}

/* ========================================================================== *
 *  GENERAL UTILITIES
 * ========================================================================== */

function getScriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function makeApiError_(code, message) {
  var error = new Error(String(message || code || 'เกิดข้อผิดพลาด'));
  error.code = String(code || 'ERROR');
  error.publicMessage = String(message || 'เกิดข้อผิดพลาด');
  return error;
}

function cleanString_(value, maxLength) {
  var text = String(value === undefined || value === null ? '' : value).trim();
  return text.substring(0, maxLength || 1000);
}

function toNumber_(value, fallback) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (value === true) return 1;
  if (value === false || value === '' || value === null || value === undefined) return fallback === undefined ? 0 : fallback;
  var parsed = Number(String(value).replace(/,/g, '').trim());
  return isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
}

function toBoolean_(value, fallback) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    var normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].indexOf(normalized) !== -1) return true;
    if (['false', '0', 'no', 'n', 'off'].indexOf(normalized) !== -1) return false;
  }
  return fallback === undefined ? false : fallback;
}

function roundMoney_(value) {
  return Math.round((toNumber_(value, 0) + Number.EPSILON) * 100) / 100;
}

function formatMoney_(value) {
  var amount = roundMoney_(value);
  return APP_CONFIG.CURRENCY_SYMBOL + amount.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function toIsoString_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  var date = new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function safeJsonParse_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (error) { return fallback; }
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    var normalized = (byte + 256) % 256;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function constantTimeEquals_(a, b) {
  var left = String(a || '');
  var right = String(b || '');
  var maxLength = Math.max(left.length, right.length);
  var difference = left.length ^ right.length;
  for (var i = 0; i < maxLength; i++) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function safeErrorMessage_(error) {
  return String(error && error.publicMessage ? error.publicMessage : (error && error.message ? error.message : 'unknown error')).substring(0, 300);
}

function logError_(context, error) {
  Logger.log('[' + context + '] ' + (error && error.stack ? error.stack : String(error)));
}
