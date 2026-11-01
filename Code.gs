/**
 * ร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้น
 * Google Apps Script API + Google Sheets database
 * Version: 1.0.0
 * Time zone: Asia/Bangkok
 *
 * IMPORTANT
 * 1) Run setupSystem() once from the Apps Script editor.
 * 2) Set the Script Properties documented in the hand-off notes.
 * 3) Deploy this project as a Web App (Execute as: Me; Who has access: Anyone).
 * 4) The GitHub Pages frontend must POST URL-encoded `payload` to this Web App
 *    through a hidden iframe and receive the result using postMessage. This avoids
 *    relying on unsupported custom CORS headers from Apps Script ContentService.
 * 5) Apps Script Web App events do not expose the X-Line-Signature request header.
 *    Therefore LINE webhooks MUST be signature-verified by a trusted proxy (e.g.
 *    Cloudflare Worker) before forwarding the JSON envelope to this script.
 *
 * Security note: INITIAL_ADMIN_PASSWORD is the requested first-use password.
 * setupSystem() stores only a salted hash in Script Properties. After the first
 * successful setup, remove the literal from this source and keep the stored hash.
 */

'use strict';

var APP = Object.freeze({
  NAME: 'ก๋วยเตี๋ยวโบราณ by เจ๊อ้น',
  VERSION: '1.0.0',
  TIME_ZONE: 'Asia/Bangkok',
  INITIAL_ADMIN_PASSWORD: 'APSB6767255',
  SESSION_TTL_SECONDS: 21600, // 6 hours
  CACHE_TTL_SECONDS: 300,
  QR_TTL_SECONDS: 300,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_ORDER_ITEMS: 50,
  MAX_QUANTITY: 99,
  MAX_NOTE_LENGTH: 500,
  LINE_API_BASE: 'https://api.line.me/v2/bot',
  LINE_ID_TOKEN_VERIFY_URL: 'https://api.line.me/oauth2/v2.1/verify',
  IMGBB_UPLOAD_URL: 'https://api.imgbb.com/1/upload',
  STATUS: {
    NEW: 'NEW',
    ACCEPTED: 'ACCEPTED',
    PREPARING: 'PREPARING',
    READY: 'READY',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
  },
  STATUS_LABELS: {
    NEW: 'ออเดอร์ใหม่',
    ACCEPTED: 'รับออเดอร์แล้ว',
    PREPARING: 'กำลังปรุงอาหาร',
    READY: 'อาหารพร้อมแล้ว',
    COMPLETED: 'เสร็จสิ้น',
    CANCELLED: 'ยกเลิกแล้ว'
  },
  SHEETS: {
    Settings: [
      'key', 'value', 'description', 'updatedAt'
    ],
    Categories: [
      'categoryId', 'name', 'sortOrder', 'isActive', 'createdAt', 'updatedAt'
    ],
    Products: [
      'productId', 'categoryId', 'name', 'description', 'price', 'imageUrl',
      'isFeatured', 'isPopular', 'isAvailable', 'sortOrder', 'createdAt', 'updatedAt'
    ],
    OptionGroups: [
      'groupId', 'name', 'selectionType', 'minSelect', 'maxSelect', 'isRequired',
      'isActive', 'sortOrder', 'createdAt', 'updatedAt'
    ],
    Options: [
      'optionId', 'groupId', 'name', 'extraPrice', 'isActive', 'sortOrder',
      'createdAt', 'updatedAt'
    ],
    ProductOptions: [
      'productOptionId', 'productId', 'groupId', 'sortOrder', 'createdAt'
    ],
    Orders: [
      'orderId', 'clientRequestId', 'customerLineUserId', 'customerName',
      'customerPicture', 'orderType', 'paymentMethod', 'paymentStatus',
      'subtotal', 'discount', 'total', 'status', 'note', 'tableNumber',
      'source', 'createdAt', 'updatedAt', 'acceptedAt', 'preparingAt',
      'readyAt', 'completedAt', 'cancelledAt', 'cancelReason', 'lastActor'
    ],
    OrderItems: [
      'itemId', 'orderId', 'productId', 'productName', 'unitPrice',
      'quantity', 'note', 'lineTotal'
    ],
    OrderItemOptions: [
      'orderItemOptionId', 'itemId', 'orderId', 'optionId', 'groupId',
      'groupName', 'optionName', 'extraPrice', 'quantity', 'lineTotal'
    ],
    Customers: [
      'lineUserId', 'displayName', 'pictureUrl', 'points', 'spendRemainder', 'pointsUpdatedAt',
      'createdAt', 'updatedAt', 'isBlocked'
    ],
    Payments: [
      'paymentId', 'orderId', 'method', 'amount', 'status', 'slipUrl',
      'verifiedBy', 'verifiedAt', 'createdAt'
    ],
    PointSettings: [
      'settingId', 'value', 'description', 'updatedAt'
    ],
    PointTransactions: [
      'transactionId', 'lineUserId', 'orderId', 'amountSpent', 'pointsChange',
      'type', 'description', 'createdBy', 'createdAt', 'referenceId'
    ],
    PointQR: [
      'qrId', 'tokenHash', 'lineUserId', 'amount', 'mode', 'status',
      'expiresAt', 'usedAt', 'createdBy', 'createdAt', 'transactionId'
    ],
    PointRewards: [
      'rewardId', 'name', 'description', 'pointsCost', 'rewardType',
      'rewardValue', 'imageUrl', 'isActive', 'stock', 'sortOrder',
      'createdAt', 'updatedAt'
    ],
    PointRedemptions: [
      'redemptionId', 'lineUserId', 'rewardId', 'rewardName', 'pointsCost',
      'status', 'createdAt', 'processedAt', 'processedBy'
    ],
    OrderStatusHistory: [
      'historyId', 'orderId', 'oldStatus', 'newStatus', 'actorType',
      'actorId', 'note', 'createdAt'
    ],
    NotificationLogs: [
      'logId', 'targetType', 'targetId', 'orderId', 'messageType',
      'status', 'errorMessage', 'createdAt'
    ],
    AdminActivityLogs: [
      'logId', 'adminId', 'action', 'entityType', 'entityId', 'details', 'createdAt'
    ],
    AdminUsers: [
      'lineUserId', 'displayName', 'role', 'isActive', 'createdAt', 'updatedAt'
    ]
  },
  DEFAULT_SETTINGS: [
    ['storeName', 'ก๋วยเตี๋ยวโบราณ by เจ๊อ้น', 'ชื่อร้าน'],
    ['storeDescription', 'ก๋วยเตี๋ยวโบราณ รสชาติต้นตำรับ', 'คำอธิบายร้าน'],
    ['storePhone', '', 'เบอร์โทรศัพท์ร้าน'],
    ['storeAddress', '', 'ที่อยู่ร้าน'],
    ['openTime', '08:00', 'เวลาเปิดร้าน'],
    ['closeTime', '17:00', 'เวลาปิดร้าน'],
    ['isStoreOpen', 'true', 'เปิดรับออเดอร์หรือไม่'],
    ['allowDineIn', 'true', 'เปิดให้รับประทานที่ร้าน'],
    ['allowTakeaway', 'true', 'เปิดให้ซื้อกลับบ้าน'],
    ['allowDelivery', 'false', 'เปิดบริการจัดส่ง'],
    ['promptPayName', '', 'ชื่อบัญชีพร้อมเพย์'],
    ['promptPayId', '', 'หมายเลขพร้อมเพย์'],
    ['promptPayQrUrl', '', 'URL รูป QR พร้อมเพย์'],
    ['currency', 'THB', 'สกุลเงิน']
  ],
  DEFAULT_POINT_SETTINGS: [
    ['pointsEnabled', 'true', 'เปิดใช้งานระบบสะสมแต้ม'],
    ['bahtPerPoint', '25', 'ยอดซื้อที่ใช้คำนวณต่อหนึ่งหน่วยแต้ม'],
    ['pointsPerUnit', '1', 'จำนวนแต้มที่ได้รับต่อหน่วย'],
    ['minimumSpend', '25', 'ยอดซื้อขั้นต่ำที่สะสมแต้มได้'],
    ['roundingMode', 'floor', 'วิธีคำนวณเศษเงิน: floor หรือ carry'],
    ['expiryMonths', '0', 'อายุแต้มเป็นเดือน; 0 หมายถึงไม่หมดอายุ']
  ]
});

/* ========================================================================== */
/* 1. WEB APP ENTRY POINTS                                                    */
/* ========================================================================== */

/**
 * Health/info page. The browser frontend uses doPost() for API operations.
 * @param {Object} e Apps Script event.
 * @return {HtmlOutput}
 */
function doGet(e) {
  var html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>', escapeHtml_(APP.NAME), ' API</title>',
    '<style>body{font:16px system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#1f2937}',
    'code{background:#f3f4f6;padding:3px 6px;border-radius:6px}</style></head><body>',
    '<h1>', escapeHtml_(APP.NAME), '</h1>',
    '<p>API is running. Version: <code>', APP.VERSION, '</code></p>',
    '<p>Use POST with a URL-encoded field named <code>payload</code>.</p>',
    '</body></html>'
  ].join('');
  return HtmlService.createHtmlOutput(html)
    .setTitle(APP.NAME + ' API')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * API endpoint.
 * Browser frontend: submit a form field named "payload" to this URL, targeting
 * a hidden iframe. This endpoint answers via window.top.postMessage().
 * Trusted webhook proxy: POST JSON {gatewaySecret, lineWebhook} after validating
 * the original LINE X-Line-Signature header.
 *
 * @param {Object} e Apps Script event.
 * @return {HtmlOutput|TextOutput}
 */
function doPost(e) {
  try {
    var contentType = e && e.postData ? String(e.postData.type || '') : '';

    // Only accept LINE events that a trusted proxy has already signature-verified.
    if (contentType.indexOf('application/json') === 0 && e.postData && e.postData.contents) {
      var envelope = JSON.parse(e.postData.contents);
      var expectedGatewaySecret = getScriptProperty_('WEBHOOK_PROXY_SECRET');
      if (!expectedGatewaySecret || !constantTimeEquals_(
        String(envelope.gatewaySecret || ''), expectedGatewaySecret
      )) {
        return ContentService.createTextOutput('Unauthorized');
      }
      if (!envelope.lineWebhook || typeof envelope.lineWebhook !== 'object') {
        return ContentService.createTextOutput('Bad Request');
      }
      processVerifiedLineWebhook_(envelope.lineWebhook);
      return ContentService.createTextOutput('OK');
    }

    var rawPayload = e && e.parameter ? e.parameter.payload : '';
    if (!rawPayload && e && e.postData && e.postData.contents) {
      // Allows server-to-server callers that send URL-encoded payload fields.
      rawPayload = e.postData.contents;
    }
    var request = parsePayload_(rawPayload);
    var requestId = String(request.requestId || '').trim();
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
      throw appError_('INVALID_REQUEST_ID', 'requestId ต้องเป็นรหัสสุ่ม 16-100 ตัวอักษร');
    }

    var result;
    try {
      result = apiDispatch_(request);
    } catch (apiError) {
      result = errorResult_(apiError);
    }
    return postMessageResponse_(requestId, result);
  } catch (error) {
    var fallbackId = 'request-error';
    return postMessageResponse_(fallbackId, errorResult_(error));
  }
}

/**
 * Main API router. All mutations and private reads are POST actions.
 * @param {Object} req
 * @return {Object}
 */
function apiDispatch_(req) {
  var action = String(req.action || '').trim();
  var data = req.data && typeof req.data === 'object' ? req.data : {};

  switch (action) {
    case 'meta.ping':
      return successResult_({ version: APP.VERSION, app: APP.NAME, time: new Date().toISOString() });

    case 'public.getMenu':
      return successResult_(getPublicMenu_());
    case 'public.getStoreInfo':
      return successResult_(getPublicStoreInfo_());

    case 'admin.login':
      return successResult_(adminLogin_(data.password));
    case 'admin.logout':
      return successResult_(adminLogout_(data.sessionToken));
    case 'admin.getDashboard':
      requireAdmin_(data.sessionToken);
      return successResult_(getDashboardSummary_());
    case 'admin.getCatalog':
      requireAdmin_(data.sessionToken);
      return successResult_(getAdminCatalog_());
    case 'admin.listOrders':
      requireAdmin_(data.sessionToken);
      return successResult_(listOrders_(data));
    case 'admin.getOrder':
      requireAdmin_(data.sessionToken);
      return successResult_(getOrderDetail_(data.orderId));
    case 'admin.updateOrderStatus':
      var statusAdmin = requireAdmin_(data.sessionToken);
      return successResult_(updateOrderStatus_(data.orderId, data.status, {
        type: 'ADMIN', id: statusAdmin.adminId, note: data.note || '', cancelReason: data.cancelReason || ''
      }));
    case 'admin.saveCategory':
      var categoryAdmin = requireAdmin_(data.sessionToken);
      return successResult_(saveCategory_(data.category || {}, categoryAdmin.adminId));
    case 'admin.saveProduct':
      var productAdmin = requireAdmin_(data.sessionToken);
      return successResult_(saveProduct_(data.product || {}, productAdmin.adminId));
    case 'admin.deleteProduct':
      var deleteProductAdmin = requireAdmin_(data.sessionToken);
      return successResult_(setProductAvailability_(data.productId, false, deleteProductAdmin.adminId));
    case 'admin.setProductAvailability':
      var availableAdmin = requireAdmin_(data.sessionToken);
      return successResult_(setProductAvailability_(data.productId, !!data.isAvailable, availableAdmin.adminId));
    case 'admin.saveOptionGroup':
      var groupAdmin = requireAdmin_(data.sessionToken);
      return successResult_(saveOptionGroup_(data.group || {}, groupAdmin.adminId));
    case 'admin.saveOption':
      var optionAdmin = requireAdmin_(data.sessionToken);
      return successResult_(saveOption_(data.option || {}, optionAdmin.adminId));
    case 'admin.linkProductOption':
      var linkAdmin = requireAdmin_(data.sessionToken);
      return successResult_(linkProductOption_(data.productId, data.groupId, data.sortOrder, linkAdmin.adminId));
    case 'admin.saveStoreSettings':
      var settingsAdmin = requireAdmin_(data.sessionToken);
      return successResult_(saveStoreSettings_(data.settings || {}, settingsAdmin.adminId));
    case 'admin.getStoreSettings':
      requireAdmin_(data.sessionToken);
      return successResult_(getSettingsMap_());
    case 'admin.getPointSettings':
      requireAdmin_(data.sessionToken);
      return successResult_(getPointSettingsMap_());
    case 'admin.getCustomers':
      requireAdmin_(data.sessionToken);
      return successResult_(listCustomers_(data));
    case 'admin.getCustomer':
      requireAdmin_(data.sessionToken);
      return successResult_(getCustomerDetail_(data.lineUserId));
    case 'admin.scanCustomerPointQR':
      var scanAdmin = requireAdmin_(data.sessionToken);
      return successResult_(scanCustomerPointQr_(data.qrToken, data.amount, scanAdmin.adminId));
    case 'admin.createStorePointQR':
      var qrAdmin = requireAdmin_(data.sessionToken);
      return successResult_(createStorePointQr_(data.amount, qrAdmin.adminId));
    case 'admin.getStorePointQRStatus':
      requireAdmin_(data.sessionToken);
      return successResult_(getStorePointQrStatus_(data.qrToken));
    case 'admin.adjustPoints':
      var pointsAdmin = requireAdmin_(data.sessionToken);
      return successResult_(adjustCustomerPoints_(data.lineUserId, data.pointsChange, data.reason, pointsAdmin.adminId));
    case 'admin.listPointTransactions':
      requireAdmin_(data.sessionToken);
      return successResult_(listPointTransactions_(data));
    case 'admin.listRedemptions':
      requireAdmin_(data.sessionToken);
      return successResult_(listPointRedemptions_(data));
    case 'admin.updateRedemptionStatus':
      var redemptionAdmin = requireAdmin_(data.sessionToken);
      return successResult_(updateRedemptionStatus_(data.redemptionId, data.status, redemptionAdmin.adminId));
    case 'admin.saveReward':
      var rewardAdmin = requireAdmin_(data.sessionToken);
      return successResult_(savePointReward_(data.reward || {}, rewardAdmin.adminId));
    case 'admin.savePointSettings':
      var pointSettingsAdmin = requireAdmin_(data.sessionToken);
      return successResult_(savePointSettings_(data.settings || {}, pointSettingsAdmin.adminId));
    case 'admin.updatePaymentStatus':
      var paymentAdmin = requireAdmin_(data.sessionToken);
      return successResult_(updatePaymentStatus_(data.orderId, data.status, data.slipUrl || '', paymentAdmin.adminId));
    case 'admin.uploadImage':
      var imageAdmin = requireAdmin_(data.sessionToken);
      return successResult_(uploadImageToImgBB_(data.imageBase64, data.fileName, imageAdmin.adminId));
    case 'admin.saveLineAdmin':
      var lineAdmin = requireAdmin_(data.sessionToken);
      return successResult_(saveLineAdmin_(data.user || {}, lineAdmin.adminId));
    case 'admin.listLineAdmins':
      requireAdmin_(data.sessionToken);
      return successResult_(listLineAdmins_());

    case 'customer.bootstrap':
      return successResult_(customerBootstrap_(data.idToken));
    case 'customer.createOrder':
      return successResult_(createCustomerOrder_(data));
    case 'customer.getOrders':
      return successResult_(getCustomerOrders_(data.idToken, data.limit));
    case 'customer.getOrder':
      return successResult_(getCustomerOrder_(data.idToken, data.orderId));
    case 'customer.getPoints':
      return successResult_(getCustomerPoints_(data.idToken));
    case 'customer.getPointHistory':
      return successResult_(getCustomerPointHistory_(data.idToken, data.limit));
    case 'customer.createPointQR':
      return successResult_(createCustomerPointQr_(data.idToken));
    case 'customer.getPointQRStatus':
      return successResult_(getCustomerPointQrStatus_(data.idToken, data.qrToken));
    case 'customer.redeemStorePointQR':
      return successResult_(redeemStorePointQr_(data.idToken, data.qrToken));
    case 'customer.getRewards':
      return successResult_(getActiveRewards_());
    case 'customer.redeemReward':
      return successResult_(redeemPointReward_(data.idToken, data.rewardId));

    default:
      throw appError_('UNKNOWN_ACTION', 'ไม่รู้จักคำสั่ง API: ' + action);
  }
}

/* ========================================================================== */
/* 2. INITIAL SETUP AND DATABASE SCHEMA                                       */
/* ========================================================================== */

/** Run once from Apps Script editor to create all Sheets and headers. */
function setupSystem() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getOrCreateDatabase_();
    try { ss.setSpreadsheetTimeZone(APP.TIME_ZONE); } catch (timezoneError) { Logger.log(timezoneError.message); }
    Object.keys(APP.SHEETS).forEach(function (sheetName) {
      ensureSheetSchema_(ss, sheetName, APP.SHEETS[sheetName]);
    });
    seedKeyValueSheet_('Settings', APP.DEFAULT_SETTINGS);
    seedKeyValueSheet_('PointSettings', APP.DEFAULT_POINT_SETTINGS);
    initializeAdminPassword_();
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('API_CREATED_AT')) props.setProperty('API_CREATED_AT', new Date().toISOString());
    props.setProperty('APP_VERSION', APP.VERSION);
    SpreadsheetApp.flush();
    var result = {
      spreadsheetId: ss.getId(),
      spreadsheetUrl: ss.getUrl(),
      sheetsCreatedOrChecked: Object.keys(APP.SHEETS),
      adminPasswordInitialized: !!props.getProperty('ADMIN_PASSWORD_HASH'),
      nextStep: 'ตั้งค่า Script Properties และ Deploy เป็น Web App'
    };
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Creates or repairs headers without deleting existing data. */
function createAllHeaders() {
  return setupSystem();
}

function getOrCreateDatabase_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (spreadsheetId) {
    try { ss = SpreadsheetApp.openById(spreadsheetId); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) {
    ss = SpreadsheetApp.create(APP.NAME + ' - Database');
  }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getDatabase_() {
  var id = getScriptProperty_('SPREADSHEET_ID');
  if (!id) throw appError_('DATABASE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า SPREADSHEET_ID กรุณารัน setupSystem()');
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw appError_('DATABASE_ACCESS_ERROR', 'เปิด Google Sheet ไม่ได้: ' + err.message);
  }
}

function ensureSheetSchema_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var existingHeaders = existing.map(function (v) { return String(v || '').trim(); }).filter(Boolean);

  if (sheet.getLastRow() === 0 || !existingHeaders.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var missing = headers.filter(function (header) { return existingHeaders.indexOf(header) === -1; });
    if (missing.length) {
      var startCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
    .setFontWeight('bold')
    .setBackground('#17372D')
    .setFontColor('#FFFFFF')
    .setWrap(true);
  sheet.autoResizeColumns(1, Math.min(Math.max(sheet.getLastColumn(), headers.length), 20));
  return sheet;
}

function seedKeyValueSheet_(sheetName, rows) {
  var sheet = getDatabase_().getSheetByName(sheetName);
  var existing = getRowsAsObjects_(sheet);
  var existingKeys = {};
  existing.forEach(function (row) { existingKeys[String(row.key || row.settingId)] = true; });
  var now = new Date();
  rows.forEach(function (item) {
    var key = item[0];
    if (!existingKeys[key]) {
      if (sheetName === 'Settings') {
        appendObject_(sheet, { key: key, value: item[1], description: item[2], updatedAt: now });
      } else {
        appendObject_(sheet, { settingId: key, value: item[1], description: item[2], updatedAt: now });
      }
    }
  });
}

function initializeAdminPassword_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_PASSWORD_HASH')) return;
  var salt = randomToken_();
  props.setProperty('ADMIN_PASSWORD_SALT', salt);
  props.setProperty('ADMIN_PASSWORD_HASH', hashText_(APP.INITIAL_ADMIN_PASSWORD + salt));
  props.setProperty('ADMIN_PASSWORD_CREATED_AT', new Date().toISOString());
}

/**
 * Reset the dashboard password from APP.INITIAL_ADMIN_PASSWORD.
 * Edit that constant first, then run this function from the Apps Script editor.
 * This utility also works in a standalone Apps Script project.
 */
function resetAdminPasswordFromConstant() {
  var password = String(APP.INITIAL_ADMIN_PASSWORD || '');
  if (password.length < 10) throw new Error('รหัสต้องมีอย่างน้อย 10 ตัวอักษร');
  var salt = randomToken_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD_SALT', salt);
  props.setProperty('ADMIN_PASSWORD_HASH', hashText_(password + salt));
  props.setProperty('ADMIN_PASSWORD_CHANGED_AT', new Date().toISOString());
  return { ok: true, message: 'ตั้งรหัส Dashboard ใหม่แล้ว' };
}

/** Use this from the editor to change the one-field dashboard password. */
function changeAdminPasswordFromEditor() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('เปลี่ยนรหัสเข้า Dashboard', 'กรอกรหัสใหม่ (อย่างน้อย 10 ตัวอักษร)', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return { ok: false, message: 'ยกเลิกแล้ว' };
  var password = response.getResponseText();
  if (password.length < 10) throw new Error('รหัสต้องมีอย่างน้อย 10 ตัวอักษร');
  var salt = randomToken_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_PASSWORD_SALT', salt);
  props.setProperty('ADMIN_PASSWORD_HASH', hashText_(password + salt));
  props.setProperty('ADMIN_PASSWORD_CHANGED_AT', new Date().toISOString());
  return { ok: true, message: 'เปลี่ยนรหัสแล้ว' };
}

/* ========================================================================== */
/* 3. AUTHENTICATION AND SESSION MANAGEMENT                                   */
/* ========================================================================== */

function adminLogin_(password) {
  var input = String(password || '');
  if (!input) throw appError_('PASSWORD_REQUIRED', 'กรุณากรอกรหัสเข้าใช้งาน');
  var cache = CacheService.getScriptCache();
  var throttleKey = 'login_fail_' + hashText_(getClientFingerprint_(input));
  var attempts = Number(cache.get(throttleKey) || 0);
  if (attempts >= 8) throw appError_('LOGIN_THROTTLED', 'ลองรหัสผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่');

  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('ADMIN_PASSWORD_SALT');
  var expected = props.getProperty('ADMIN_PASSWORD_HASH');
  if (!salt || !expected) throw appError_('ADMIN_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่ารหัสหลังบ้าน กรุณารัน setupSystem()');

  if (!constantTimeEquals_(hashText_(input + salt), expected)) {
    cache.put(throttleKey, String(attempts + 1), 900);
    throw appError_('INVALID_PASSWORD', 'รหัสเข้าใช้งานไม่ถูกต้อง');
  }
  cache.remove(throttleKey);

  var sessionToken = randomToken_();
  var session = {
    adminId: 'OWNER',
    role: 'OWNER',
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + APP.SESSION_TTL_SECONDS * 1000
  };
  cache.put('admin_session_' + hashText_(sessionToken), JSON.stringify(session), APP.SESSION_TTL_SECONDS);
  logAdminActivity_('OWNER', 'LOGIN', 'SESSION', sessionToken.substring(0, 8), 'เข้าสู่ระบบหลังบ้าน');
  return { sessionToken: sessionToken, expiresIn: APP.SESSION_TTL_SECONDS, admin: { id: 'OWNER', role: 'OWNER' } };
}

function adminLogout_(sessionToken) {
  if (sessionToken) CacheService.getScriptCache().remove('admin_session_' + hashText_(String(sessionToken)));
  return { loggedOut: true };
}

function requireAdmin_(sessionToken) {
  if (!sessionToken) throw appError_('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบหลังบ้าน');
  var key = 'admin_session_' + hashText_(String(sessionToken));
  var raw = CacheService.getScriptCache().get(key);
  if (!raw) throw appError_('SESSION_EXPIRED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  var session = JSON.parse(raw);
  if (Number(session.expiresAt) <= Date.now()) {
    CacheService.getScriptCache().remove(key);
    throw appError_('SESSION_EXPIRED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  return session;
}

/* ========================================================================== */
/* 4. PUBLIC MENU AND STORE SETTINGS                                          */
/* ========================================================================== */

function getPublicMenu_() {
  var categories = getRowsAsObjects_(getSheet_('Categories')).filter(function (r) { return isTruthy_(r.isActive); });
  var products = getRowsAsObjects_(getSheet_('Products')).filter(function (r) { return isTruthy_(r.isAvailable); });
  var groups = getRowsAsObjects_(getSheet_('OptionGroups')).filter(function (r) { return isTruthy_(r.isActive); });
  var options = getRowsAsObjects_(getSheet_('Options')).filter(function (r) { return isTruthy_(r.isActive); });
  var links = getRowsAsObjects_(getSheet_('ProductOptions'));

  categories.sort(sortByOrder_);
  products.sort(sortByOrder_);
  groups.sort(sortByOrder_);
  options.sort(sortByOrder_);

  var productData = products.map(function (p) {
    var productLinks = links.filter(function (link) { return String(link.productId) === String(p.productId); });
    var productGroups = productLinks.map(function (link) {
      var group = groups.filter(function (g) { return String(g.groupId) === String(link.groupId); })[0];
      if (!group) return null;
      return {
        groupId: group.groupId,
        name: group.name,
        selectionType: group.selectionType || 'single',
        minSelect: toNumber_(group.minSelect, 0),
        maxSelect: toNumber_(group.maxSelect, 1),
        isRequired: isTruthy_(group.isRequired),
        options: options.filter(function (o) { return String(o.groupId) === String(group.groupId); }).map(publicOption_)
      };
    }).filter(Boolean);
    return publicProduct_(p, productGroups);
  });

  return {
    categories: categories.map(function (c) {
      return { categoryId: c.categoryId, name: c.name, sortOrder: toNumber_(c.sortOrder, 0) };
    }),
    products: productData,
    store: getPublicStoreInfo_()
  };
}

function publicProduct_(p, groups) {
  return {
    productId: p.productId,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description || '',
    price: toNumber_(p.price, 0),
    imageUrl: p.imageUrl || '',
    isFeatured: isTruthy_(p.isFeatured),
    isPopular: isTruthy_(p.isPopular),
    isAvailable: isTruthy_(p.isAvailable),
    sortOrder: toNumber_(p.sortOrder, 0),
    optionGroups: groups || []
  };
}

function publicOption_(o) {
  return {
    optionId: o.optionId,
    name: o.name,
    extraPrice: toNumber_(o.extraPrice, 0),
    sortOrder: toNumber_(o.sortOrder, 0)
  };
}

function getPublicStoreInfo_() {
  var settings = getSettingsMap_();
  return {
    storeName: settings.storeName || APP.NAME,
    storeDescription: settings.storeDescription || '',
    storePhone: settings.storePhone || '',
    storeAddress: settings.storeAddress || '',
    openTime: settings.openTime || '',
    closeTime: settings.closeTime || '',
    isStoreOpen: isTruthy_(settings.isStoreOpen),
    allowDineIn: isTruthy_(settings.allowDineIn),
    allowTakeaway: isTruthy_(settings.allowTakeaway),
    allowDelivery: isTruthy_(settings.allowDelivery),
    promptPayName: settings.promptPayName || '',
    promptPayId: settings.promptPayId || '',
    promptPayQrUrl: settings.promptPayQrUrl || ''
  };
}

function getSettingsMap_() {
  var rows = getRowsAsObjects_(getSheet_('Settings'));
  var map = {};
  rows.forEach(function (row) { map[String(row.key)] = row.value; });
  return map;
}

function saveStoreSettings_(settings, adminId) {
  var allowed = [
    'storeName', 'storeDescription', 'storePhone', 'storeAddress', 'openTime',
    'closeTime', 'isStoreOpen', 'allowDineIn', 'allowTakeaway', 'allowDelivery',
    'promptPayName', 'promptPayId', 'promptPayQrUrl'
  ];
  var sheet = getSheet_('Settings');
  withScriptLock_(function () {
    Object.keys(settings).forEach(function (key) {
      if (allowed.indexOf(key) === -1) return;
      var value = settings[key];
      if (typeof value === 'string' && value.length > 1000) throw appError_('INVALID_SETTING', 'ค่าตั้งค่ายาวเกินไป: ' + key);
      var row = findRowByValue_(sheet, 'key', key);
      if (row) updateRowObject_(sheet, row.rowNumber, { value: value, updatedAt: new Date() });
      else appendObject_(sheet, { key: key, value: value, description: '', updatedAt: new Date() });
    });
  });
  logAdminActivity_(adminId, 'SAVE_SETTINGS', 'SETTINGS', 'STORE', 'แก้ไขการตั้งค่าร้าน');
  return getPublicStoreInfo_();
}

/* ========================================================================== */
/* 5. CATALOG MANAGEMENT                                                      */
/* ========================================================================== */

function getAdminCatalog_() {
  return {
    categories: getRowsAsObjects_(getSheet_('Categories')),
    products: getRowsAsObjects_(getSheet_('Products')),
    optionGroups: getRowsAsObjects_(getSheet_('OptionGroups')),
    options: getRowsAsObjects_(getSheet_('Options')),
    productOptions: getRowsAsObjects_(getSheet_('ProductOptions'))
  };
}

function saveCategory_(category, adminId) {
  var name = cleanText_(category.name, 100, 'ชื่อหมวดหมู่');
  var id = String(category.categoryId || '').trim() || newId_('CAT');
  var sheet = getSheet_('Categories');
  var existing = findRowByValue_(sheet, 'categoryId', id);
  var row = {
    categoryId: id,
    name: name,
    sortOrder: toNumber_(category.sortOrder, 0),
    isActive: category.isActive === undefined ? true : isTruthy_(category.isActive),
    updatedAt: new Date()
  };
  if (existing) updateRowObject_(sheet, existing.rowNumber, row);
  else { row.createdAt = new Date(); appendObject_(sheet, row); }
  logAdminActivity_(adminId, 'SAVE_CATEGORY', 'CATEGORY', id, name);
  return row;
}

function saveProduct_(product, adminId) {
  var name = cleanText_(product.name, 120, 'ชื่อเมนู');
  var categoryId = String(product.categoryId || '').trim();
  if (!categoryId) throw appError_('CATEGORY_REQUIRED', 'กรุณาเลือกหมวดหมู่อาหาร');
  if (!findRowByValue_(getSheet_('Categories'), 'categoryId', categoryId)) throw appError_('CATEGORY_NOT_FOUND', 'ไม่พบหมวดหมู่ที่เลือก');
  var price = toNumber_(product.price, -1);
  if (price < 0 || price > 1000000) throw appError_('INVALID_PRICE', 'ราคาเมนูไม่ถูกต้อง');
  var id = String(product.productId || '').trim() || newId_('PROD');
  var sheet = getSheet_('Products');
  var existing = findRowByValue_(sheet, 'productId', id);
  var row = {
    productId: id,
    categoryId: categoryId,
    name: name,
    description: cleanText_(product.description || '', 1000, 'รายละเอียด'),
    price: price,
    imageUrl: validateHttpUrl_(product.imageUrl || ''),
    isFeatured: isTruthy_(product.isFeatured),
    isPopular: isTruthy_(product.isPopular),
    isAvailable: product.isAvailable === undefined ? true : isTruthy_(product.isAvailable),
    sortOrder: toNumber_(product.sortOrder, 0),
    updatedAt: new Date()
  };
  if (existing) updateRowObject_(sheet, existing.rowNumber, row);
  else { row.createdAt = new Date(); appendObject_(sheet, row); }
  logAdminActivity_(adminId, 'SAVE_PRODUCT', 'PRODUCT', id, name);
  return row;
}

function setProductAvailability_(productId, isAvailable, adminId) {
  var sheet = getSheet_('Products');
  var row = findRowByValue_(sheet, 'productId', String(productId || ''));
  if (!row) throw appError_('PRODUCT_NOT_FOUND', 'ไม่พบเมนูอาหาร');
  updateRowObject_(sheet, row.rowNumber, { isAvailable: !!isAvailable, updatedAt: new Date() });
  logAdminActivity_(adminId, 'SET_PRODUCT_AVAILABILITY', 'PRODUCT', productId, String(isAvailable));
  return { productId: productId, isAvailable: !!isAvailable };
}

function saveOptionGroup_(group, adminId) {
  var name = cleanText_(group.name, 100, 'ชื่อกลุ่มตัวเลือก');
  var selectionType = String(group.selectionType || 'single').toLowerCase();
  if (['single', 'multiple'].indexOf(selectionType) === -1) throw appError_('INVALID_SELECTION_TYPE', 'selectionType ต้องเป็น single หรือ multiple');
  var minSelect = toNumber_(group.minSelect, 0);
  var maxSelect = toNumber_(group.maxSelect, selectionType === 'single' ? 1 : 10);
  if (minSelect < 0 || maxSelect < 1 || minSelect > maxSelect || maxSelect > 30) throw appError_('INVALID_SELECTION_LIMIT', 'จำนวนตัวเลือกไม่ถูกต้อง');
  var id = String(group.groupId || '').trim() || newId_('GRP');
  var sheet = getSheet_('OptionGroups');
  var existing = findRowByValue_(sheet, 'groupId', id);
  var row = {
    groupId: id,
    name: name,
    selectionType: selectionType,
    minSelect: minSelect,
    maxSelect: maxSelect,
    isRequired: isTruthy_(group.isRequired),
    isActive: group.isActive === undefined ? true : isTruthy_(group.isActive),
    sortOrder: toNumber_(group.sortOrder, 0),
    updatedAt: new Date()
  };
  if (existing) updateRowObject_(sheet, existing.rowNumber, row);
  else { row.createdAt = new Date(); appendObject_(sheet, row); }
  logAdminActivity_(adminId, 'SAVE_OPTION_GROUP', 'OPTION_GROUP', id, name);
  return row;
}

function saveOption_(option, adminId) {
  var groupId = String(option.groupId || '').trim();
  if (!findRowByValue_(getSheet_('OptionGroups'), 'groupId', groupId)) throw appError_('GROUP_NOT_FOUND', 'ไม่พบกลุ่มตัวเลือก');
  var name = cleanText_(option.name, 100, 'ชื่อตัวเลือก');
  var extraPrice = toNumber_(option.extraPrice, 0);
  if (extraPrice < 0 || extraPrice > 1000000) throw appError_('INVALID_EXTRA_PRICE', 'ราคาเพิ่มไม่ถูกต้อง');
  var id = String(option.optionId || '').trim() || newId_('OPT');
  var sheet = getSheet_('Options');
  var existing = findRowByValue_(sheet, 'optionId', id);
  var row = {
    optionId: id,
    groupId: groupId,
    name: name,
    extraPrice: extraPrice,
    isActive: option.isActive === undefined ? true : isTruthy_(option.isActive),
    sortOrder: toNumber_(option.sortOrder, 0),
    updatedAt: new Date()
  };
  if (existing) updateRowObject_(sheet, existing.rowNumber, row);
  else { row.createdAt = new Date(); appendObject_(sheet, row); }
  logAdminActivity_(adminId, 'SAVE_OPTION', 'OPTION', id, name);
  return row;
}

function linkProductOption_(productId, groupId, sortOrder, adminId) {
  if (!findRowByValue_(getSheet_('Products'), 'productId', String(productId))) throw appError_('PRODUCT_NOT_FOUND', 'ไม่พบเมนูอาหาร');
  if (!findRowByValue_(getSheet_('OptionGroups'), 'groupId', String(groupId))) throw appError_('GROUP_NOT_FOUND', 'ไม่พบกลุ่มตัวเลือก');
  var sheet = getSheet_('ProductOptions');
  var existingRows = getRowsAsObjectsWithNumbers_(sheet);
  var existing = existingRows.filter(function (r) { return String(r.productId) === String(productId) && String(r.groupId) === String(groupId); })[0];
  if (existing) return { linked: true, alreadyLinked: true };
  appendObject_(sheet, {
    productOptionId: newId_('PLINK'), productId: productId, groupId: groupId,
    sortOrder: toNumber_(sortOrder, 0), createdAt: new Date()
  });
  logAdminActivity_(adminId, 'LINK_PRODUCT_OPTION', 'PRODUCT', productId, groupId);
  return { linked: true };
}

/* ========================================================================== */
/* 6. CUSTOMER IDENTITY THROUGH LINE LIFF ID TOKEN                            */
/* ========================================================================== */

function customerBootstrap_(idToken) {
  var profile = verifyLineIdToken_(idToken);
  var customer = upsertCustomer_(profile);
  return {
    customer: {
      lineUserId: customer.lineUserId,
      displayName: customer.displayName,
      pictureUrl: customer.pictureUrl,
      points: toNumber_(customer.points, 0)
    },
    store: getPublicStoreInfo_()
  };
}

function verifyLineIdToken_(idToken) {
  var token = String(idToken || '').trim();
  if (!token) throw appError_('LINE_ID_TOKEN_REQUIRED', 'ไม่พบ LINE ID Token กรุณาเปิดผ่าน LINE LIFF');
  var cached = CacheService.getScriptCache().get('line_id_' + hashText_(token));
  if (cached) return JSON.parse(cached);

  var channelId = getScriptProperty_('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw appError_('LINE_LOGIN_NOT_CONFIGURED', 'กรุณาตั้งค่า LINE_LOGIN_CHANNEL_ID ใน Script Properties');
  var response = UrlFetchApp.fetch(APP.LINE_ID_TOKEN_VERIFY_URL, {
    method: 'post',
    payload: { id_token: token, client_id: channelId },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) throw appError_('INVALID_LINE_ID_TOKEN', 'ตรวจสอบ LINE ID Token ไม่สำเร็จ กรุณาเปิด LIFF ใหม่');
  var profile;
  try { profile = JSON.parse(body); } catch (err) { throw appError_('LINE_VERIFY_ERROR', 'ผลตรวจสอบจาก LINE ไม่ถูกต้อง'); }
  if (!profile.sub || String(profile.aud) !== String(channelId) || Number(profile.exp) * 1000 <= Date.now()) {
    throw appError_('INVALID_LINE_ID_TOKEN', 'LINE ID Token หมดอายุหรือไม่ตรงกับ Channel');
  }
  var safeProfile = {
    lineUserId: String(profile.sub),
    displayName: cleanText_(profile.name || 'สมาชิก LINE', 100, 'ชื่อสมาชิก'),
    pictureUrl: validateHttpUrl_(profile.picture || '')
  };
  CacheService.getScriptCache().put('line_id_' + hashText_(token), JSON.stringify(safeProfile), 240);
  return safeProfile;
}

function upsertCustomer_(profile) {
  var sheet = getSheet_('Customers');
  var row = findRowByValue_(sheet, 'lineUserId', profile.lineUserId);
  var now = new Date();
  if (row) {
    updateRowObject_(sheet, row.rowNumber, {
      displayName: profile.displayName || row.displayName,
      pictureUrl: profile.pictureUrl || row.pictureUrl,
      updatedAt: now
    });
    return getRowObject_(sheet, row.rowNumber);
  }
  var customer = {
    lineUserId: profile.lineUserId,
    displayName: profile.displayName || 'สมาชิก LINE',
    pictureUrl: profile.pictureUrl || '',
    points: 0,
    spendRemainder: 0,
    pointsUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    isBlocked: false
  };
  appendObject_(sheet, customer);
  return customer;
}

/* ========================================================================== */
/* 7. CUSTOMER ORDERS                                                         */
/* ========================================================================== */

function createCustomerOrder_(data) {
  var profile = verifyLineIdToken_(data.idToken);
  var customer = upsertCustomer_(profile);
  var clientRequestId = String(data.clientRequestId || '').trim();
  if (!clientRequestId || !/^[A-Za-z0-9_-]{10,100}$/.test(clientRequestId)) {
    throw appError_('INVALID_CLIENT_REQUEST_ID', 'กรุณาส่ง clientRequestId สำหรับป้องกันการสั่งซ้ำ');
  }
  var orderSheet = getSheet_('Orders');
  var previous = findRowByValue_(orderSheet, 'clientRequestId', clientRequestId);
  if (previous) {
    if (String(previous.customerLineUserId) !== profile.lineUserId) throw appError_('IDEMPOTENCY_CONFLICT', 'clientRequestId นี้ถูกใช้ไปแล้ว');
    return getOrderDetail_(previous.orderId);
  }

  var store = getPublicStoreInfo_();
  if (!store.isStoreOpen) throw appError_('STORE_CLOSED', 'ขณะนี้ร้านปิดรับออเดอร์ชั่วคราว');
  var orderType = String(data.orderType || 'takeaway').toLowerCase();
  var allowedTypes = { dinein: store.allowDineIn, takeaway: store.allowTakeaway, delivery: store.allowDelivery };
  if (!allowedTypes[orderType]) throw appError_('ORDER_TYPE_DISABLED', 'ร้านยังไม่เปิดรับรายการแบบนี้');
  var paymentMethod = String(data.paymentMethod || 'cash').toLowerCase();
  if (['cash', 'promptpay'].indexOf(paymentMethod) === -1) throw appError_('INVALID_PAYMENT_METHOD', 'วิธีชำระเงินไม่ถูกต้อง');
  var items = Array.isArray(data.items) ? data.items : [];
  if (!items.length || items.length > APP.MAX_ORDER_ITEMS) throw appError_('INVALID_ORDER_ITEMS', 'จำนวนรายการอาหารไม่ถูกต้อง');

  var calculated = calculateOrderItems_(items);
  var discount = 0; // Discount coupons are intentionally not trusted from client input.
  var total = Math.max(0, calculated.subtotal - discount);
  var orderId = newId_('ORD');
  var now = new Date();
  var order = {
    orderId: orderId,
    clientRequestId: clientRequestId,
    customerLineUserId: profile.lineUserId,
    customerName: customer.displayName || profile.displayName,
    customerPicture: customer.pictureUrl || profile.pictureUrl,
    orderType: orderType,
    paymentMethod: paymentMethod,
    paymentStatus: paymentMethod === 'cash' ? 'UNPAID' : 'PENDING',
    subtotal: calculated.subtotal,
    discount: discount,
    total: total,
    status: APP.STATUS.NEW,
    note: cleanText_(data.note || '', APP.MAX_NOTE_LENGTH, 'หมายเหตุ'),
    tableNumber: cleanText_(data.tableNumber || '', 30, 'หมายเลขโต๊ะ'),
    source: 'LIFF',
    createdAt: now,
    updatedAt: now,
    lastActor: 'CUSTOMER'
  };

  var duplicateOrderId = '';
  withScriptLock_(function () {
    var duplicate = findRowByValue_(orderSheet, 'clientRequestId', clientRequestId);
    if (duplicate) {
      if (String(duplicate.customerLineUserId) !== profile.lineUserId) throw appError_('IDEMPOTENCY_CONFLICT', 'clientRequestId นี้ถูกใช้ไปแล้ว');
      duplicateOrderId = String(duplicate.orderId);
      return;
    }
    appendObject_(orderSheet, order);
    calculated.items.forEach(function (item) {
      appendObject_(getSheet_('OrderItems'), {
        itemId: item.itemId, orderId: orderId, productId: item.productId,
        productName: item.productName, unitPrice: item.unitPrice,
        quantity: item.quantity, note: item.note, lineTotal: item.lineTotal
      });
      item.options.forEach(function (option) {
        appendObject_(getSheet_('OrderItemOptions'), {
          orderItemOptionId: newId_('IOPT'), itemId: item.itemId, orderId: orderId,
          optionId: option.optionId, groupId: option.groupId, groupName: option.groupName,
          optionName: option.optionName, extraPrice: option.extraPrice,
          quantity: option.quantity, lineTotal: option.lineTotal
        });
      });
    });
    appendObject_(getSheet_('OrderStatusHistory'), {
      historyId: newId_('HIST'), orderId: orderId, oldStatus: '', newStatus: APP.STATUS.NEW,
      actorType: 'CUSTOMER', actorId: profile.lineUserId, note: 'ลูกค้าสั่งอาหาร', createdAt: now
    });
    if (paymentMethod === 'promptpay') {
      appendObject_(getSheet_('Payments'), {
        paymentId: newId_('PAY'), orderId: orderId, method: 'PROMPTPAY', amount: total,
        status: 'PENDING', slipUrl: '', verifiedBy: '', verifiedAt: '', createdAt: now
      });
    }
  });

  // If another request with the same idempotency key won the lock, return that order.
  if (duplicateOrderId) return getOrderDetail_(duplicateOrderId);

  // The order is retained even if LINE push fails; the notification failure is logged.
  sendNewOrderToLineGroup_(orderId);
  logCustomerEvent_(profile.lineUserId, 'CREATE_ORDER', orderId, 'สั่งอาหารสำเร็จ');
  return getOrderDetail_(orderId);
}

function calculateOrderItems_(items) {
  var products = getRowsAsObjects_(getSheet_('Products'));
  var groups = getRowsAsObjects_(getSheet_('OptionGroups'));
  var options = getRowsAsObjects_(getSheet_('Options'));
  var links = getRowsAsObjects_(getSheet_('ProductOptions'));
  var resultItems = [];
  var subtotal = 0;

  items.forEach(function (input) {
    var productId = String(input.productId || '');
    var product = products.filter(function (p) { return String(p.productId) === productId && isTruthy_(p.isAvailable); })[0];
    if (!product) throw appError_('PRODUCT_UNAVAILABLE', 'มีเมนูที่ไม่พบหรือปิดขาย กรุณาตรวจสอบตะกร้า');
    var quantity = Math.floor(toNumber_(input.quantity, 0));
    if (quantity < 1 || quantity > APP.MAX_QUANTITY) throw appError_('INVALID_QUANTITY', 'จำนวนสินค้าไม่ถูกต้อง');
    var allowedGroupIds = links.filter(function (l) { return String(l.productId) === productId; }).map(function (l) { return String(l.groupId); });
    var chosen = Array.isArray(input.options) ? input.options : [];
    var selectedByGroup = {};
    var optionRows = [];
    chosen.forEach(function (selected) {
      var optionId = String(selected.optionId || '');
      var option = options.filter(function (o) { return String(o.optionId) === optionId && isTruthy_(o.isActive); })[0];
      if (!option || allowedGroupIds.indexOf(String(option.groupId)) === -1) throw appError_('INVALID_OPTION', 'มีตัวเลือกอาหารที่ไม่ถูกต้อง');
      var group = groups.filter(function (g) { return String(g.groupId) === String(option.groupId) && isTruthy_(g.isActive); })[0];
      if (!group) throw appError_('INVALID_OPTION_GROUP', 'กลุ่มตัวเลือกนี้ไม่พร้อมใช้งาน');
      var optionQty = Math.floor(toNumber_(selected.quantity, 1));
      if (optionQty < 1 || optionQty > APP.MAX_QUANTITY) throw appError_('INVALID_OPTION_QUANTITY', 'จำนวนตัวเลือกไม่ถูกต้อง');
      selectedByGroup[group.groupId] = (selectedByGroup[group.groupId] || 0) + 1;
      optionRows.push({
        optionId: option.optionId,
        groupId: group.groupId,
        groupName: group.name,
        optionName: option.name,
        extraPrice: toNumber_(option.extraPrice, 0),
        quantity: optionQty,
        lineTotal: toNumber_(option.extraPrice, 0) * optionQty
      });
    });
    allowedGroupIds.forEach(function (groupId) {
      var group = groups.filter(function (g) { return String(g.groupId) === groupId && isTruthy_(g.isActive); })[0];
      if (!group) return;
      var selectedCount = selectedByGroup[groupId] || 0;
      var min = toNumber_(group.minSelect, 0);
      var max = toNumber_(group.maxSelect, 1);
      if (isTruthy_(group.isRequired) && min < 1) min = 1;
      if (selectedCount < min || selectedCount > max) {
        throw appError_('OPTION_SELECTION_INVALID', 'กรุณาเลือกตัวเลือกในกลุ่ม ' + group.name + ' ให้ถูกต้อง');
      }
      if (String(group.selectionType || 'single') === 'single' && selectedCount > 1) {
        throw appError_('OPTION_SELECTION_INVALID', 'กลุ่ม ' + group.name + ' เลือกได้เพียงหนึ่งรายการ');
      }
    });
    var optionTotal = optionRows.reduce(function (sum, o) { return sum + o.lineTotal; }, 0);
    var unitPrice = toNumber_(product.price, 0);
    var lineTotal = (unitPrice + optionTotal) * quantity;
    subtotal += lineTotal;
    resultItems.push({
      itemId: newId_('ITEM'), productId: productId, productName: product.name,
      unitPrice: unitPrice, quantity: quantity,
      note: cleanText_(input.note || '', 300, 'หมายเหตุรายการ'),
      lineTotal: lineTotal, options: optionRows
    });
  });
  return { items: resultItems, subtotal: subtotal };
}

function getCustomerOrders_(idToken, limit) {
  var profile = verifyLineIdToken_(idToken);
  var max = Math.min(Math.max(Math.floor(toNumber_(limit, 20)), 1), 50);
  var rows = getRowsAsObjects_(getSheet_('Orders')).filter(function (o) {
    return String(o.customerLineUserId) === profile.lineUserId;
  });
  rows.sort(function (a, b) { return dateMillis_(b.createdAt) - dateMillis_(a.createdAt); });
  return rows.slice(0, max).map(orderSummary_);
}

function getCustomerOrder_(idToken, orderId) {
  var profile = verifyLineIdToken_(idToken);
  var order = getOrderDetail_(orderId);
  if (String(order.customerLineUserId) !== profile.lineUserId) throw appError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
  return order;
}

function getOrderDetail_(orderId) {
  var order = findRowByValue_(getSheet_('Orders'), 'orderId', String(orderId || ''));
  if (!order) throw appError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
  var items = getRowsAsObjects_(getSheet_('OrderItems')).filter(function (i) { return String(i.orderId) === String(orderId); });
  var options = getRowsAsObjects_(getSheet_('OrderItemOptions'));
  var history = getRowsAsObjects_(getSheet_('OrderStatusHistory')).filter(function (h) { return String(h.orderId) === String(orderId); });
  var payment = getRowsAsObjects_(getSheet_('Payments')).filter(function (p) { return String(p.orderId) === String(orderId); })[0] || null;
  history.sort(function (a, b) { return dateMillis_(a.createdAt) - dateMillis_(b.createdAt); });
  return Object.assign({}, order, {
    items: items.map(function (item) {
      return Object.assign({}, item, {
        options: options.filter(function (o) { return String(o.itemId) === String(item.itemId); })
      });
    }),
    statusHistory: history,
    payment: payment,
    statusLabel: APP.STATUS_LABELS[order.status] || order.status
  });
}

function orderSummary_(order) {
  return {
    orderId: order.orderId,
    orderType: order.orderType,
    total: toNumber_(order.total, 0),
    status: order.status,
    statusLabel: APP.STATUS_LABELS[order.status] || order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt
  };
}

function listOrders_(filters) {
  var rows = getRowsAsObjects_(getSheet_('Orders'));
  if (filters.status) rows = rows.filter(function (r) { return String(r.status) === String(filters.status); });
  if (filters.date) {
    var dateKey = String(filters.date);
    rows = rows.filter(function (r) { return Utilities.formatDate(new Date(r.createdAt), APP.TIME_ZONE, 'yyyy-MM-dd') === dateKey; });
  }
  if (filters.query) {
    var q = String(filters.query).toLowerCase();
    rows = rows.filter(function (r) {
      return String(r.orderId).toLowerCase().indexOf(q) !== -1 ||
        String(r.customerName).toLowerCase().indexOf(q) !== -1 ||
        String(r.customerLineUserId).toLowerCase().indexOf(q) !== -1;
    });
  }
  rows.sort(function (a, b) { return dateMillis_(b.createdAt) - dateMillis_(a.createdAt); });
  var max = Math.min(Math.max(Math.floor(toNumber_(filters.limit, 100)), 1), 500);
  return rows.slice(0, max).map(function (row) {
    return Object.assign(orderSummary_(row), {
      customerName: row.customerName,
      customerLineUserId: row.customerLineUserId,
      note: row.note,
      tableNumber: row.tableNumber,
      orderType: row.orderType
    });
  });
}

function updateOrderStatus_(orderId, newStatus, actor) {
  var status = String(newStatus || '').toUpperCase();
  if (!APP.STATUS[status]) throw appError_('INVALID_ORDER_STATUS', 'สถานะออเดอร์ไม่ถูกต้อง');
  var result = withScriptLock_(function () {
    var sheet = getSheet_('Orders');
    var row = findRowByValue_(sheet, 'orderId', String(orderId || ''));
    if (!row) throw appError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
    var oldStatus = String(row.status || '');
    if (oldStatus === status) return { order: getOrderDetail_(orderId), changed: false };
    if (!isValidStatusTransition_(oldStatus, status)) {
      throw appError_('INVALID_STATUS_TRANSITION', 'ไม่สามารถเปลี่ยนสถานะจาก ' + (APP.STATUS_LABELS[oldStatus] || oldStatus) + ' เป็น ' + APP.STATUS_LABELS[status]);
    }
    if (status === APP.STATUS.CANCELLED && !String(actor.cancelReason || actor.note || '').trim()) {
      throw appError_('CANCEL_REASON_REQUIRED', 'กรุณาระบุเหตุผลการยกเลิก');
    }
    var now = new Date();
    var patch = { status: status, updatedAt: now, lastActor: actor.type + ':' + actor.id };
    if (status === APP.STATUS.ACCEPTED) patch.acceptedAt = now;
    if (status === APP.STATUS.PREPARING) patch.preparingAt = now;
    if (status === APP.STATUS.READY) patch.readyAt = now;
    if (status === APP.STATUS.COMPLETED) patch.completedAt = now;
    if (status === APP.STATUS.CANCELLED) {
      patch.cancelledAt = now;
      patch.cancelReason = cleanText_(actor.cancelReason || actor.note || '', 300, 'เหตุผลยกเลิก');
    }
    updateRowObject_(sheet, row.rowNumber, patch);
    appendObject_(getSheet_('OrderStatusHistory'), {
      historyId: newId_('HIST'), orderId: orderId, oldStatus: oldStatus,
      newStatus: status, actorType: actor.type, actorId: actor.id,
      note: cleanText_(actor.note || actor.cancelReason || '', 300, 'หมายเหตุ'), createdAt: now
    });
    return { order: getOrderDetail_(orderId), changed: true };
  });

  if (result.changed) {
    sendOrderStatusToCustomer_(orderId);
    sendOrderProgressToLineGroup_(orderId);
    logAdminActivity_(actor.id, 'UPDATE_ORDER_STATUS', 'ORDER', orderId, status);
  }
  return result.order;
}

function isValidStatusTransition_(oldStatus, newStatus) {
  var transitions = {};
  transitions[APP.STATUS.NEW] = [APP.STATUS.ACCEPTED, APP.STATUS.CANCELLED];
  transitions[APP.STATUS.ACCEPTED] = [APP.STATUS.PREPARING, APP.STATUS.CANCELLED];
  transitions[APP.STATUS.PREPARING] = [APP.STATUS.READY, APP.STATUS.CANCELLED];
  transitions[APP.STATUS.READY] = [APP.STATUS.COMPLETED, APP.STATUS.CANCELLED];
  transitions[APP.STATUS.COMPLETED] = [];
  transitions[APP.STATUS.CANCELLED] = [];
  return (transitions[oldStatus] || []).indexOf(newStatus) !== -1;
}

/* ========================================================================== */
/* 8. POINTS, QR TOKENS, AND REWARDS                                          */
/* ========================================================================== */

function createCustomerPointQr_(idToken) {
  var profile = verifyLineIdToken_(idToken);
  upsertCustomer_(profile);
  if (!isTruthy_(getPointSettingsMap_().pointsEnabled)) throw appError_('POINTS_DISABLED', 'ร้านปิดระบบสะสมแต้มชั่วคราว');
  return createPointQr_({ mode: 'CUSTOMER', lineUserId: profile.lineUserId, amount: '', createdBy: profile.lineUserId });
}

function createStorePointQr_(amount, adminId) {
  var value = validatePositiveMoney_(amount, 'ยอดซื้อ');
  return createPointQr_({ mode: 'STORE', lineUserId: '', amount: value, createdBy: adminId });
}

function createPointQr_(options) {
  var token = randomToken_() + randomToken_();
  var tokenHash = hashText_(token);
  var now = new Date();
  var expiresAt = new Date(now.getTime() + APP.QR_TTL_SECONDS * 1000);
  withScriptLock_(function () {
    var sheet = getSheet_('PointQR');
    if (options.mode === 'CUSTOMER') {
      getRowsAsObjectsWithNumbers_(sheet).forEach(function (row) {
        if (String(row.lineUserId) === String(options.lineUserId) && row.mode === 'CUSTOMER' && row.status === 'ACTIVE') {
          updateRowObject_(sheet, row.rowNumber, { status: 'REPLACED' });
        }
      });
    }
    appendObject_(sheet, {
      qrId: newId_('PQR'), tokenHash: tokenHash, lineUserId: options.lineUserId,
      amount: options.amount, mode: options.mode, status: 'ACTIVE',
      expiresAt: expiresAt, usedAt: '', createdBy: options.createdBy,
      createdAt: now, transactionId: ''
    });
  });
  return {
    qrToken: token,
    qrPayload: 'JAEON-POINT:' + token,
    mode: options.mode,
    amount: options.amount,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: APP.QR_TTL_SECONDS
  };
}

function scanCustomerPointQr_(qrToken, amount, adminId) {
  var value = validatePositiveMoney_(amount, 'ยอดซื้อ');
  var token = normalizeQrToken_(qrToken);
  return withScriptLock_(function () {
    var sheet = getSheet_('PointQR');
    var row = findRowByValue_(sheet, 'tokenHash', hashText_(token));
    if (!row || row.mode !== 'CUSTOMER') throw appError_('QR_NOT_FOUND', 'ไม่พบ QR สะสมแต้มของลูกค้า');
    validateActiveQr_(row);
    var transaction = awardPoints_(row.lineUserId, value, {
      type: 'EARN', description: 'สะสมแต้มจากหน้าร้าน', createdBy: adminId, referenceId: row.qrId
    });
    updateRowObject_(sheet, row.rowNumber, { status: 'USED', usedAt: new Date(), amount: value, transactionId: transaction.transactionId });
    return Object.assign({ customer: getCustomerDetail_(row.lineUserId) }, transaction);
  });
}

function redeemStorePointQr_(idToken, qrToken) {
  var profile = verifyLineIdToken_(idToken);
  upsertCustomer_(profile);
  var token = normalizeQrToken_(qrToken);
  return withScriptLock_(function () {
    var sheet = getSheet_('PointQR');
    var row = findRowByValue_(sheet, 'tokenHash', hashText_(token));
    if (!row || row.mode !== 'STORE') throw appError_('QR_NOT_FOUND', 'ไม่พบ QR สะสมแต้มจากร้าน');
    validateActiveQr_(row);
    var transaction = awardPoints_(profile.lineUserId, toNumber_(row.amount, 0), {
      type: 'EARN', description: 'สะสมแต้มจาก QR ของร้าน', createdBy: 'STORE_QR', referenceId: row.qrId
    });
    updateRowObject_(sheet, row.rowNumber, {
      status: 'USED', usedAt: new Date(), lineUserId: profile.lineUserId,
      transactionId: transaction.transactionId
    });
    return Object.assign({ customer: getCustomerDetail_(profile.lineUserId) }, transaction);
  });
}


function getCustomerPointQrStatus_(idToken, qrToken) {
  var profile = verifyLineIdToken_(idToken);
  var token = normalizeQrToken_(qrToken);
  var row = findRowByValue_(getSheet_('PointQR'), 'tokenHash', hashText_(token));
  if (!row || row.mode !== 'CUSTOMER' || String(row.lineUserId) !== profile.lineUserId) {
    throw appError_('QR_NOT_FOUND', 'ไม่พบ QR Code ของสมาชิกนี้');
  }
  if (row.status === 'ACTIVE' && dateMillis_(row.expiresAt) <= Date.now()) {
    updateRowObject_(getSheet_('PointQR'), row.rowNumber, { status: 'EXPIRED' });
    row.status = 'EXPIRED';
  }
  var transaction = row.transactionId ? findRowByValue_(getSheet_('PointTransactions'), 'transactionId', row.transactionId) : null;
  var customer = findRowByValue_(getSheet_('Customers'), 'lineUserId', profile.lineUserId);
  return {
    status: row.status,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    amount: toNumber_(row.amount, 0),
    pointsEarned: transaction ? toNumber_(transaction.pointsChange, 0) : 0,
    pointsBalance: customer ? toNumber_(customer.points, 0) : 0
  };
}

function getStorePointQrStatus_(qrToken) {
  var token = normalizeQrToken_(qrToken);
  var row = findRowByValue_(getSheet_('PointQR'), 'tokenHash', hashText_(token));
  if (!row || row.mode !== 'STORE') throw appError_('QR_NOT_FOUND', 'ไม่พบ QR Code จากร้าน');
  if (row.status === 'ACTIVE' && dateMillis_(row.expiresAt) <= Date.now()) {
    updateRowObject_(getSheet_('PointQR'), row.rowNumber, { status: 'EXPIRED' });
    row.status = 'EXPIRED';
  }
  var transaction = row.transactionId ? findRowByValue_(getSheet_('PointTransactions'), 'transactionId', row.transactionId) : null;
  return {
    status: row.status,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    amount: toNumber_(row.amount, 0),
    customerLineUserId: row.lineUserId || '',
    pointsEarned: transaction ? toNumber_(transaction.pointsChange, 0) : 0
  };
}

function validateActiveQr_(row) {
  if (String(row.status) !== 'ACTIVE') throw appError_('QR_ALREADY_USED', 'QR นี้ถูกใช้แล้วหรือถูกยกเลิก');
  if (dateMillis_(row.expiresAt) <= Date.now()) {
    updateRowObject_(getSheet_('PointQR'), row.rowNumber, { status: 'EXPIRED' });
    throw appError_('QR_EXPIRED', 'QR หมดอายุแล้ว กรุณาสร้าง QR ใหม่');
  }
}

function normalizeQrToken_(value) {
  var token = String(value || '').trim();
  token = token.replace(/^JAEON-POINT:/i, '');
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(token)) throw appError_('INVALID_QR_TOKEN', 'QR Code ไม่ถูกต้อง');
  return token;
}

function awardPoints_(lineUserId, amountSpent, metadata) {
  var settings = getPointSettingsMap_();
  if (!isTruthy_(settings.pointsEnabled)) throw appError_('POINTS_DISABLED', 'ร้านปิดระบบสะสมแต้มชั่วคราว');
  var minimum = toNumber_(settings.minimumSpend, 0);
  var bahtPerPoint = Math.max(1, toNumber_(settings.bahtPerPoint, 25));
  var pointsPerUnit = Math.max(0, toNumber_(settings.pointsPerUnit, 1));
  var roundingMode = String(settings.roundingMode || 'floor').toLowerCase();
  if (amountSpent < minimum) throw appError_('NO_POINTS_EARNED', 'ยอดซื้อยังไม่ถึงยอดขั้นต่ำ ' + minimum + ' บาท');

  var customer = findRowByValue_(getSheet_('Customers'), 'lineUserId', lineUserId);
  if (!customer) throw appError_('CUSTOMER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิก');
  var previousRemainder = roundingMode === 'carry' ? toNumber_(customer.spendRemainder, 0) : 0;
  var eligibleSpend = amountSpent + previousRemainder;
  var units = Math.floor(eligibleSpend / bahtPerPoint);
  var points = units * pointsPerUnit;
  var nextRemainder = roundingMode === 'carry' ? eligibleSpend - units * bahtPerPoint : 0;
  var newBalance = toNumber_(customer.points, 0) + points;
  var now = new Date();
  updateRowObject_(getSheet_('Customers'), customer.rowNumber, {
    points: newBalance, spendRemainder: nextRemainder,
    pointsUpdatedAt: now, updatedAt: now
  });
  var transaction = {
    transactionId: newId_('PTX'), lineUserId: lineUserId, orderId: metadata.orderId || '',
    amountSpent: amountSpent, pointsChange: points, type: metadata.type || 'EARN',
    description: metadata.description || (points > 0 ? 'สะสมแต้ม' : 'บันทึกยอดซื้อเพื่อสะสมเศษยอด'),
    createdBy: metadata.createdBy || '', createdAt: now, referenceId: metadata.referenceId || ''
  };
  appendObject_(getSheet_('PointTransactions'), transaction);
  return Object.assign(transaction, { balance: newBalance, spendRemainder: nextRemainder });
}

function getPointSettingsMap_() {
  var map = {};
  getRowsAsObjects_(getSheet_('PointSettings')).forEach(function (row) { map[String(row.settingId)] = row.value; });
  return map;
}

function savePointSettings_(settings, adminId) {
  var allowed = ['pointsEnabled', 'bahtPerPoint', 'pointsPerUnit', 'minimumSpend', 'roundingMode', 'expiryMonths'];
  var sheet = getSheet_('PointSettings');
  withScriptLock_(function () {
    Object.keys(settings).forEach(function (key) {
      if (allowed.indexOf(key) === -1) return;
      var value = settings[key];
      if (['bahtPerPoint', 'pointsPerUnit', 'minimumSpend', 'expiryMonths'].indexOf(key) !== -1 && toNumber_(value, -1) < 0) {
        throw appError_('INVALID_POINT_SETTING', 'ค่าตั้งค่าแต้มไม่ถูกต้อง: ' + key);
      }
      if (key === 'bahtPerPoint' && toNumber_(value, 0) < 1) throw appError_('INVALID_POINT_SETTING', 'bahtPerPoint ต้องมากกว่าหรือเท่ากับ 1');
      if (key === 'pointsPerUnit' && toNumber_(value, 0) < 1) throw appError_('INVALID_POINT_SETTING', 'pointsPerUnit ต้องมากกว่าหรือเท่ากับ 1');
      if (key === 'roundingMode' && ['floor', 'carry'].indexOf(String(value).toLowerCase()) === -1) throw appError_('INVALID_POINT_SETTING', 'roundingMode ต้องเป็น floor หรือ carry');
      if (key === 'expiryMonths' && toNumber_(value, 0) !== 0) throw appError_('POINT_EXPIRY_NOT_IMPLEMENTED', 'เวอร์ชันนี้ยังไม่เปิดใช้วันหมดอายุแต้ม กรุณาตั้งเป็น 0');
      var row = findRowByValue_(sheet, 'settingId', key);
      if (row) updateRowObject_(sheet, row.rowNumber, { value: value, updatedAt: new Date() });
      else appendObject_(sheet, { settingId: key, value: value, description: '', updatedAt: new Date() });
    });
  });
  logAdminActivity_(adminId, 'SAVE_POINT_SETTINGS', 'POINTS', 'SETTINGS', 'แก้ไขเงื่อนไขสะสมแต้ม');
  return getPointSettingsMap_();
}

function getCustomerPoints_(idToken) {
  var profile = verifyLineIdToken_(idToken);
  var customer = upsertCustomer_(profile);
  return {
    points: toNumber_(customer.points, 0),
    customer: { displayName: customer.displayName, pictureUrl: customer.pictureUrl },
    rewards: getActiveRewards_()
  };
}

function getCustomerPointHistory_(idToken, limit) {
  var profile = verifyLineIdToken_(idToken);
  var max = Math.min(Math.max(Math.floor(toNumber_(limit, 50)), 1), 200);
  var rows = getRowsAsObjects_(getSheet_('PointTransactions')).filter(function (r) { return String(r.lineUserId) === profile.lineUserId; });
  rows.sort(function (a, b) { return dateMillis_(b.createdAt) - dateMillis_(a.createdAt); });
  return rows.slice(0, max);
}

function adjustCustomerPoints_(lineUserId, pointsChange, reason, adminId) {
  var delta = Math.floor(toNumber_(pointsChange, 0));
  if (!delta || Math.abs(delta) > 100000) throw appError_('INVALID_POINTS_CHANGE', 'จำนวนแต้มที่ปรับไม่ถูกต้อง');
  var description = cleanText_(reason, 300, 'เหตุผลปรับแต้ม');
  if (!description) throw appError_('REASON_REQUIRED', 'กรุณาระบุเหตุผล');
  return withScriptLock_(function () {
    var customer = findRowByValue_(getSheet_('Customers'), 'lineUserId', String(lineUserId));
    if (!customer) throw appError_('CUSTOMER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิก');
    var balance = toNumber_(customer.points, 0) + delta;
    if (balance < 0) throw appError_('INSUFFICIENT_POINTS', 'แต้มคงเหลือไม่เพียงพอ');
    updateRowObject_(getSheet_('Customers'), customer.rowNumber, { points: balance, pointsUpdatedAt: new Date(), updatedAt: new Date() });
    var tx = {
      transactionId: newId_('PTX'), lineUserId: lineUserId, orderId: '', amountSpent: 0,
      pointsChange: delta, type: delta > 0 ? 'ADJUST_ADD' : 'ADJUST_SUB',
      description: description, createdBy: adminId, createdAt: new Date(), referenceId: ''
    };
    appendObject_(getSheet_('PointTransactions'), tx);
    logAdminActivity_(adminId, 'ADJUST_POINTS', 'CUSTOMER', lineUserId, description + ' (' + delta + ')');
    return { transaction: tx, balance: balance };
  });
}

function savePointReward_(reward, adminId) {
  var name = cleanText_(reward.name, 100, 'ชื่อของรางวัล');
  var pointsCost = Math.floor(toNumber_(reward.pointsCost, 0));
  if (pointsCost < 1) throw appError_('INVALID_REWARD_COST', 'แต้มที่ใช้แลกต้องมากกว่า 0');
  var id = String(reward.rewardId || '').trim() || newId_('REWARD');
  var sheet = getSheet_('PointRewards');
  var existing = findRowByValue_(sheet, 'rewardId', id);
  var row = {
    rewardId: id, name: name,
    description: cleanText_(reward.description || '', 500, 'รายละเอียดของรางวัล'),
    pointsCost: pointsCost,
    rewardType: String(reward.rewardType || 'PRODUCT').toUpperCase(),
    rewardValue: toNumber_(reward.rewardValue, 0),
    imageUrl: validateHttpUrl_(reward.imageUrl || ''),
    isActive: reward.isActive === undefined ? true : isTruthy_(reward.isActive),
    stock: reward.stock === '' || reward.stock === undefined ? -1 : Math.floor(toNumber_(reward.stock, -1)),
    sortOrder: toNumber_(reward.sortOrder, 0), updatedAt: new Date()
  };
  if (existing) updateRowObject_(sheet, existing.rowNumber, row);
  else { row.createdAt = new Date(); appendObject_(sheet, row); }
  logAdminActivity_(adminId, 'SAVE_REWARD', 'REWARD', id, name);
  return row;
}

function getActiveRewards_() {
  return getRowsAsObjects_(getSheet_('PointRewards')).filter(function (r) {
    return isTruthy_(r.isActive) && (toNumber_(r.stock, -1) !== 0);
  }).sort(sortByOrder_).map(function (r) {
    return {
      rewardId: r.rewardId, name: r.name, description: r.description,
      pointsCost: toNumber_(r.pointsCost, 0), rewardType: r.rewardType,
      rewardValue: toNumber_(r.rewardValue, 0), imageUrl: r.imageUrl || '',
      stock: toNumber_(r.stock, -1)
    };
  });
}

function redeemPointReward_(idToken, rewardId) {
  var profile = verifyLineIdToken_(idToken);
  upsertCustomer_(profile);
  return withScriptLock_(function () {
    var reward = findRowByValue_(getSheet_('PointRewards'), 'rewardId', String(rewardId));
    if (!reward || !isTruthy_(reward.isActive) || toNumber_(reward.stock, -1) === 0) throw appError_('REWARD_UNAVAILABLE', 'ของรางวัลนี้หมดหรือปิดแลกแล้ว');
    var customer = findRowByValue_(getSheet_('Customers'), 'lineUserId', profile.lineUserId);
    var cost = toNumber_(reward.pointsCost, 0);
    var balance = toNumber_(customer.points, 0);
    if (balance < cost) throw appError_('INSUFFICIENT_POINTS', 'แต้มของคุณไม่เพียงพอสำหรับแลกรางวัลนี้');
    var now = new Date();
    var newBalance = balance - cost;
    updateRowObject_(getSheet_('Customers'), customer.rowNumber, { points: newBalance, pointsUpdatedAt: now, updatedAt: now });
    if (toNumber_(reward.stock, -1) > 0) {
      updateRowObject_(getSheet_('PointRewards'), reward.rowNumber, { stock: toNumber_(reward.stock, 0) - 1, updatedAt: now });
    }
    var redemption = {
      redemptionId: newId_('RED'), lineUserId: profile.lineUserId,
      rewardId: reward.rewardId, rewardName: reward.name, pointsCost: cost,
      status: 'PENDING', createdAt: now, processedAt: '', processedBy: ''
    };
    appendObject_(getSheet_('PointRedemptions'), redemption);
    appendObject_(getSheet_('PointTransactions'), {
      transactionId: newId_('PTX'), lineUserId: profile.lineUserId, orderId: '', amountSpent: 0,
      pointsChange: -cost, type: 'REDEEM', description: 'แลกรางวัล: ' + reward.name,
      createdBy: 'CUSTOMER', createdAt: now, referenceId: redemption.redemptionId
    });
    return { redemption: redemption, pointsBalance: newBalance };
  });
}

function listPointTransactions_(filters) {
  var rows = getRowsAsObjects_(getSheet_('PointTransactions'));
  if (filters.lineUserId) rows = rows.filter(function (r) { return String(r.lineUserId) === String(filters.lineUserId); });
  rows.sort(function (a, b) { return dateMillis_(b.createdAt) - dateMillis_(a.createdAt); });
  return rows.slice(0, Math.min(Math.max(toNumber_(filters.limit, 200), 1), 1000));
}

function listPointRedemptions_(filters) {
  var rows = getRowsAsObjects_(getSheet_('PointRedemptions'));
  if (filters.status) rows = rows.filter(function (r) { return String(r.status) === String(filters.status); });
  rows.sort(function (a, b) { return dateMillis_(b.createdAt) - dateMillis_(a.createdAt); });
  return rows.slice(0, Math.min(Math.max(toNumber_(filters.limit, 100), 1), 500));
}

function updateRedemptionStatus_(redemptionId, status, adminId) {
  var nextStatus = String(status || '').toUpperCase();
  if (['APPROVED', 'REJECTED', 'COMPLETED'].indexOf(nextStatus) === -1) throw appError_('INVALID_REDEMPTION_STATUS', 'สถานะการแลกรางวัลไม่ถูกต้อง');
  return withScriptLock_(function () {
    var row = findRowByValue_(getSheet_('PointRedemptions'), 'redemptionId', String(redemptionId));
    if (!row) throw appError_('REDEMPTION_NOT_FOUND', 'ไม่พบรายการแลกรางวัล');
    if (row.status === 'COMPLETED' || row.status === 'REJECTED') throw appError_('REDEMPTION_CLOSED', 'รายการนี้ปิดแล้ว');
    if (nextStatus === 'REJECTED' && row.status !== 'REJECTED') {
      var customer = findRowByValue_(getSheet_('Customers'), 'lineUserId', String(row.lineUserId));
      if (customer) {
        var restored = toNumber_(customer.points, 0) + toNumber_(row.pointsCost, 0);
        updateRowObject_(getSheet_('Customers'), customer.rowNumber, { points: restored, pointsUpdatedAt: new Date(), updatedAt: new Date() });
        appendObject_(getSheet_('PointTransactions'), {
          transactionId: newId_('PTX'), lineUserId: row.lineUserId, orderId: '', amountSpent: 0,
          pointsChange: toNumber_(row.pointsCost, 0), type: 'REDEMPTION_REFUND',
          description: 'คืนแต้มจากการปฏิเสธแลกรางวัล: ' + row.rewardName,
          createdBy: adminId, createdAt: new Date(), referenceId: row.redemptionId
        });
      }
      var reward = findRowByValue_(getSheet_('PointRewards'), 'rewardId', String(row.rewardId));
      if (reward && toNumber_(reward.stock, -1) >= 0) {
        updateRowObject_(getSheet_('PointRewards'), reward.rowNumber, { stock: toNumber_(reward.stock, 0) + 1, updatedAt: new Date() });
      }
    }
    updateRowObject_(getSheet_('PointRedemptions'), row.rowNumber, {
      status: nextStatus, processedAt: new Date(), processedBy: adminId
    });
    logAdminActivity_(adminId, 'UPDATE_REDEMPTION', 'REDEMPTION', redemptionId, nextStatus);
    return { redemptionId: redemptionId, status: nextStatus };
  });
}

/* ========================================================================== */
/* 9. CUSTOMER AND ADMIN RECORDS                                              */
/* ========================================================================== */

function listCustomers_(filters) {
  var rows = getRowsAsObjects_(getSheet_('Customers'));
  if (filters.query) {
    var q = String(filters.query).toLowerCase();
    rows = rows.filter(function (r) {
      return String(r.displayName).toLowerCase().indexOf(q) !== -1 || String(r.lineUserId).toLowerCase().indexOf(q) !== -1;
    });
  }
  rows.sort(function (a, b) { return dateMillis_(b.updatedAt) - dateMillis_(a.updatedAt); });
  return rows.slice(0, Math.min(Math.max(toNumber_(filters.limit, 100), 1), 500));
}

function getCustomerDetail_(lineUserId) {
  var row = findRowByValue_(getSheet_('Customers'), 'lineUserId', String(lineUserId || ''));
  if (!row) throw appError_('CUSTOMER_NOT_FOUND', 'ไม่พบข้อมูลสมาชิก');
  var transactions = getRowsAsObjects_(getSheet_('PointTransactions')).filter(function (r) { return String(r.lineUserId) === String(lineUserId); });
  transactions.sort(function (a, b) { return dateMillis_(b.createdAt) - dateMillis_(a.createdAt); });
  return { customer: row, recentTransactions: transactions.slice(0, 20) };
}

function saveLineAdmin_(user, ownerAdminId) {
  var lineUserId = String(user.lineUserId || '').trim();
  if (!/^U[0-9a-fA-F]{20,40}$/.test(lineUserId)) throw appError_('INVALID_LINE_USER_ID', 'LINE User ID ไม่ถูกต้อง');
  var sheet = getSheet_('AdminUsers');
  var existing = findRowByValue_(sheet, 'lineUserId', lineUserId);
  var row = {
    lineUserId: lineUserId,
    displayName: cleanText_(user.displayName || '', 100, 'ชื่อพนักงาน'),
    role: String(user.role || 'STAFF').toUpperCase() === 'OWNER' ? 'OWNER' : 'STAFF',
    isActive: user.isActive === undefined ? true : isTruthy_(user.isActive),
    updatedAt: new Date()
  };
  if (existing) updateRowObject_(sheet, existing.rowNumber, row);
  else { row.createdAt = new Date(); appendObject_(sheet, row); }
  logAdminActivity_(ownerAdminId, 'SAVE_LINE_ADMIN', 'ADMIN_USER', lineUserId, row.role);
  return row;
}

function listLineAdmins_() {
  return getRowsAsObjects_(getSheet_('AdminUsers'));
}

/* ========================================================================== */
/* 10. DASHBOARD, PAYMENTS, REPORTS                                            */
/* ========================================================================== */

function getDashboardSummary_() {
  var orders = getRowsAsObjects_(getSheet_('Orders'));
  var today = Utilities.formatDate(new Date(), APP.TIME_ZONE, 'yyyy-MM-dd');
  var todayOrders = orders.filter(function (r) {
    return Utilities.formatDate(new Date(r.createdAt), APP.TIME_ZONE, 'yyyy-MM-dd') === today;
  });
  var validToday = todayOrders.filter(function (r) { return r.status !== APP.STATUS.CANCELLED; });
  var stats = {
    todayRevenue: validToday.reduce(function (sum, r) { return sum + toNumber_(r.total, 0); }, 0),
    todayOrders: todayOrders.length,
    newOrders: todayOrders.filter(function (r) { return r.status === APP.STATUS.NEW; }).length,
    preparingOrders: orders.filter(function (r) { return r.status === APP.STATUS.PREPARING; }).length,
    readyOrders: orders.filter(function (r) { return r.status === APP.STATUS.READY; }).length,
    completedToday: todayOrders.filter(function (r) { return r.status === APP.STATUS.COMPLETED; }).length,
    cancelledToday: todayOrders.filter(function (r) { return r.status === APP.STATUS.CANCELLED; }).length
  };
  var days = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var key = Utilities.formatDate(d, APP.TIME_ZONE, 'yyyy-MM-dd');
    var dayRows = orders.filter(function (r) {
      return Utilities.formatDate(new Date(r.createdAt), APP.TIME_ZONE, 'yyyy-MM-dd') === key && r.status !== APP.STATUS.CANCELLED;
    });
    days.push({ date: key, revenue: dayRows.reduce(function (sum, r) { return sum + toNumber_(r.total, 0); }, 0), orders: dayRows.length });
  }
  return { stats: stats, last7Days: days, recentOrders: listOrders_({ limit: 10 }) };
}

function updatePaymentStatus_(orderId, status, slipUrl, adminId) {
  var next = String(status || '').toUpperCase();
  if (['PENDING', 'VERIFIED', 'REJECTED', 'UNPAID', 'PAID'].indexOf(next) === -1) throw appError_('INVALID_PAYMENT_STATUS', 'สถานะชำระเงินไม่ถูกต้อง');
  var order = findRowByValue_(getSheet_('Orders'), 'orderId', String(orderId));
  if (!order) throw appError_('ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ');
  updateRowObject_(getSheet_('Orders'), order.rowNumber, { paymentStatus: next, updatedAt: new Date() });
  var payments = getRowsAsObjectsWithNumbers_(getSheet_('Payments'));
  var payment = payments.filter(function (p) { return String(p.orderId) === String(orderId); })[0];
  if (payment) {
    updateRowObject_(getSheet_('Payments'), payment.rowNumber, {
      status: next, slipUrl: slipUrl || payment.slipUrl || '', verifiedBy: adminId,
      verifiedAt: next === 'VERIFIED' || next === 'PAID' ? new Date() : ''
    });
  }
  logAdminActivity_(adminId, 'UPDATE_PAYMENT', 'ORDER', orderId, next);
  return { orderId: orderId, paymentStatus: next };
}

/* ========================================================================== */
/* 11. IMGBB IMAGE UPLOAD                                                     */
/* ========================================================================== */

function uploadImageToImgBB_(imageBase64, fileName, adminId) {
  var apiKey = getScriptProperty_('IMGBB_API_KEY');
  if (!apiKey) throw appError_('IMGBB_NOT_CONFIGURED', 'กรุณาตั้งค่า IMGBB_API_KEY ใน Script Properties');
  var base64 = String(imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw appError_('INVALID_IMAGE', 'ข้อมูลรูปภาพไม่ถูกต้อง');
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > APP.MAX_IMAGE_BYTES) throw appError_('IMAGE_TOO_LARGE', 'รูปภาพต้องมีขนาดไม่เกิน 5 MB');
  var safeName = cleanText_(fileName || 'menu-image', 100, 'ชื่อไฟล์');
  var response = UrlFetchApp.fetch(APP.IMGBB_UPLOAD_URL + '?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    payload: { image: base64, name: safeName },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  var result;
  try { result = JSON.parse(body); } catch (err) { result = null; }
  if (code < 200 || code >= 300 || !result || !result.success || !result.data || !result.data.url) {
    throw appError_('IMGBB_UPLOAD_FAILED', 'อัปโหลดรูปไม่สำเร็จ: ' + (result && result.error ? result.error.message : 'HTTP ' + code));
  }
  logAdminActivity_(adminId, 'UPLOAD_IMAGE', 'IMAGE', result.data.id || '', safeName);
  return { url: result.data.url, displayUrl: result.data.display_url || result.data.url, deleteUrl: result.data.delete_url || '' };
}

/* ========================================================================== */
/* 12. LINE MESSAGING API: FLEX MESSAGES                                      */
/* ========================================================================== */

function sendNewOrderToLineGroup_(orderId) {
  var groupId = getScriptProperty_('LINE_GROUP_ID');
  if (!groupId) {
    writeNotificationLog_('GROUP', '', orderId, 'NEW_ORDER', 'SKIPPED', 'ยังไม่ได้ตั้งค่า LINE_GROUP_ID');
    return { sent: false, reason: 'LINE_GROUP_ID_NOT_CONFIGURED' };
  }
  var order = getOrderDetail_(orderId);
  var contents = buildNewOrderFlex_(order);
  var result = linePush_(groupId, [{ type: 'flex', altText: 'มีคำสั่งซื้อใหม่ ' + orderId, contents: contents }]);
  writeNotificationLog_('GROUP', groupId, orderId, 'NEW_ORDER', result.ok ? 'SENT' : 'FAILED', result.error || '');
  return result;
}

function sendOrderStatusToCustomer_(orderId) {
  var order = getOrderDetail_(orderId);
  var userId = String(order.customerLineUserId || '');
  if (!userId) return { ok: false, error: 'CUSTOMER_LINE_ID_MISSING' };
  var contents = buildCustomerStatusFlex_(order);
  var result = linePush_(userId, [{ type: 'flex', altText: 'อัปเดตสถานะออเดอร์ ' + orderId + ': ' + APP.STATUS_LABELS[order.status], contents: contents }]);
  writeNotificationLog_('CUSTOMER', userId, orderId, 'ORDER_STATUS', result.ok ? 'SENT' : 'FAILED', result.error || '');
  return result;
}


function sendOrderProgressToLineGroup_(orderId) {
  var groupId = getScriptProperty_('LINE_GROUP_ID');
  if (!groupId) return { ok: false, error: 'LINE_GROUP_ID_NOT_CONFIGURED' };
  var order = getOrderDetail_(orderId);
  var result = linePush_(groupId, [{
    type: 'flex', altText: 'อัปเดตออเดอร์ #' + orderId + ' - ' + (APP.STATUS_LABELS[order.status] || order.status),
    contents: buildNewOrderFlex_(order)
  }]);
  writeNotificationLog_('GROUP', groupId, orderId, 'ORDER_PROGRESS', result.ok ? 'SENT' : 'FAILED', result.error || '');
  return result;
}

function buildNewOrderFlex_(order) {
  var itemLines = (order.items || []).slice(0, 10).map(function (item) {
    var optionText = (item.options || []).map(function (o) { return o.optionName; }).join(', ');
    var title = String(item.productName) + ' × ' + toNumber_(item.quantity, 1);
    var detail = optionText ? { type: 'text', text: optionText, size: 'xs', color: '#888888', wrap: true, margin: 'xs' } : null;
    return {
      type: 'box', layout: 'vertical', spacing: 'none', margin: 'md',
      contents: [
        { type: 'box', layout: 'baseline', contents: [
          { type: 'text', text: title, size: 'sm', flex: 5, wrap: true },
          { type: 'text', text: money_(toNumber_(item.lineTotal, 0)), size: 'sm', align: 'end', flex: 2 }
        ] }
      ].concat(detail ? [detail] : [])
    };
  });
  if (order.items && order.items.length > 10) itemLines.push({ type: 'text', text: 'และอีก ' + (order.items.length - 10) + ' รายการ', size: 'xs', color: '#888888', margin: 'sm' });
  var orderParam = 'action=order_status&orderId=' + encodeURIComponent(order.orderId) + '&status=';
  var buttons = [];
  if (order.status === APP.STATUS.NEW) buttons.push(flexButton_('รับออเดอร์', orderParam + 'ACCEPTED', 'primary', '#16A34A'));
  if (order.status === APP.STATUS.ACCEPTED) buttons.push(flexButton_('เริ่มปรุงอาหาร', orderParam + 'PREPARING', 'primary', '#D97706'));
  if (order.status === APP.STATUS.PREPARING) buttons.push(flexButton_('อาหารพร้อมแล้ว', orderParam + 'READY', 'primary', '#16A34A'));
  if (order.status === APP.STATUS.READY) buttons.push(flexButton_('ปิดออเดอร์ / เสร็จสิ้น', orderParam + 'COMPLETED', 'primary', '#16A34A'));
  if ([APP.STATUS.NEW, APP.STATUS.ACCEPTED, APP.STATUS.PREPARING, APP.STATUS.READY].indexOf(order.status) !== -1) {
    buttons.push(flexButton_('ยกเลิกออเดอร์', orderParam + 'CANCELLED', 'secondary'));
  }
  if (!buttons.length) buttons.push({ type: 'text', text: 'รายการนี้ปิดแล้ว', size: 'sm', color: '#888888', align: 'center' });
  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#17372D', paddingAll: '16px', contents: [
      { type: 'text', text: order.status === APP.STATUS.NEW ? '🍜 มีคำสั่งซื้อใหม่!' : '📋 อัปเดตออเดอร์', color: '#FFFFFF', weight: 'bold', size: 'lg' },
      { type: 'text', text: '#' + order.orderId, color: '#D5E6DD', size: 'xs', margin: 'sm' }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: money_(toNumber_(order.total, 0)), size: '3xl', weight: 'bold', color: '#16834B' },
      { type: 'separator' },
      { type: 'text', text: 'รายการอาหาร', weight: 'bold', size: 'sm' }
    ].concat(itemLines).concat([
      { type: 'separator', margin: 'lg' },
      flexKeyValue_('ประเภท', orderTypeLabel_(order.orderType)),
      flexKeyValue_('ชำระเงิน', paymentLabel_(order.paymentMethod) + ' / ' + paymentStatusLabel_(order.paymentStatus)),
      flexKeyValue_('ลูกค้า', order.customerName || 'สมาชิก LINE'),
      order.tableNumber ? flexKeyValue_('โต๊ะ', order.tableNumber) : { type: 'filler' },
      order.note ? { type: 'text', text: 'หมายเหตุ: ' + order.note, size: 'xs', color: '#777777', wrap: true } : { type: 'filler' }
    ]) },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons }
  };
}

function buildCustomerStatusFlex_(order) {
  var status = String(order.status || 'NEW');
  var content = {
    NEW: ['รับคำสั่งซื้อแล้ว', 'ร้านได้รับรายการสั่งซื้อของคุณแล้วค่ะ', '#2563EB', '🧾'],
    ACCEPTED: ['ร้านรับออเดอร์แล้ว', 'ขอบคุณค่ะ ร้านยืนยันคำสั่งซื้อของคุณแล้ว', '#2563EB', '✅'],
    PREPARING: ['กำลังปรุงอาหาร', 'ทางร้านกำลังเตรียมอาหารให้คุณ กรุณารอสักครู่นะคะ', '#D97706', '🍳'],
    READY: ['อาหารพร้อมแล้ว!', order.orderType === 'delivery' ? 'อาหารของคุณพร้อมจัดส่งแล้วค่ะ' : 'อาหารของคุณพร้อมแล้ว สามารถมารับได้เลยค่ะ', '#16A34A', '🍜'],
    COMPLETED: ['ออเดอร์เสร็จสิ้น', 'ขอบคุณที่ใช้บริการร้านก๋วยเตี๋ยวโบราณ by เจ๊อ้นค่ะ', '#16A34A', '🎉'],
    CANCELLED: ['ยกเลิกคำสั่งซื้อ', 'รายการนี้ถูกยกเลิก' + (order.cancelReason ? ': ' + order.cancelReason : ''), '#DC2626', 'แจ้งเตือน']
  }[status] || ['อัปเดตคำสั่งซื้อ', 'สถานะคำสั่งซื้อของคุณมีการเปลี่ยนแปลง', '#2563EB', 'ℹ️'];
  return {
    type: 'bubble', size: 'kilo',
    header: { type: 'box', layout: 'vertical', backgroundColor: content[2], paddingAll: '16px', contents: [
      { type: 'text', text: APP.NAME, color: '#FFFFFF', size: 'sm', weight: 'bold' },
      { type: 'text', text: content[3] + ' ' + content[0], color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'md', wrap: true }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: content[1], size: 'sm', wrap: true, color: '#444444' },
      { type: 'separator' },
      flexKeyValue_('เลขออเดอร์', '#' + order.orderId),
      flexKeyValue_('ยอดรวม', money_(toNumber_(order.total, 0))),
      flexKeyValue_('สถานะ', APP.STATUS_LABELS[status] || status),
      flexKeyValue_('การชำระเงิน', paymentStatusLabel_(order.paymentStatus))
    ] },
    footer: { type: 'box', layout: 'vertical', contents: [
      { type: 'text', text: 'ขอบคุณที่ใช้บริการค่ะ', size: 'xs', color: '#888888', align: 'center' }
    ] }
  };
}

function flexButton_(label, postbackData, style, color) {
  var button = {
    type: 'button', style: style || 'secondary', height: 'sm',
    action: { type: 'postback', label: label, data: postbackData, displayText: label }
  };
  if (color) button.color = color;
  return button;
}

function flexKeyValue_(label, value) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      { type: 'text', text: String(label), size: 'xs', color: '#888888', flex: 2 },
      { type: 'text', text: String(value || '-'), size: 'xs', color: '#333333', flex: 5, wrap: true }
    ]
  };
}

function linePush_(to, messages) {
  var token = getScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED' };
  try {
    var response = UrlFetchApp.fetch(APP.LINE_API_BASE + '/message/push', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: messages }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    return { ok: code >= 200 && code < 300, statusCode: code, error: code >= 300 ? body : '' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function lineReply_(replyToken, messages) {
  var token = getScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !replyToken) return { ok: false, error: 'LINE_REPLY_NOT_CONFIGURED' };
  try {
    var response = UrlFetchApp.fetch(APP.LINE_API_BASE + '/message/reply', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    return { ok: code >= 200 && code < 300, statusCode: code, error: code >= 300 ? response.getContentText() : '' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

function writeNotificationLog_(targetType, targetId, orderId, messageType, status, errorMessage) {
  appendObject_(getSheet_('NotificationLogs'), {
    logId: newId_('NLOG'), targetType: targetType, targetId: targetId,
    orderId: orderId, messageType: messageType, status: status,
    errorMessage: String(errorMessage || '').substring(0, 1000), createdAt: new Date()
  });
}

/* ========================================================================== */
/* 13. LINE WEBHOOK EVENTS (TRUSTED PROXY REQUIRED)                           */
/* ========================================================================== */

/**
 * Processes only events forwarded by a proxy that has validated
 * X-Line-Signature against LINE_CHANNEL_SECRET. Do NOT expose this function
 * directly as an unauthenticated LINE webhook endpoint.
 */
function processVerifiedLineWebhook_(webhookBody) {
  var events = Array.isArray(webhookBody.events) ? webhookBody.events : [];
  events.forEach(function (event) {
    try {
      if (event.type === 'join' && event.source && event.source.groupId) {
        var props = PropertiesService.getScriptProperties();
        if (!props.getProperty('LINE_GROUP_ID')) props.setProperty('LINE_GROUP_ID', String(event.source.groupId));
      }
      if (event.type === 'postback') handleGroupPostback_(event);
    } catch (err) {
      Logger.log('LINE webhook event error: ' + err.message);
    }
  });
}

function handleGroupPostback_(event) {
  var source = event.source || {};
  var expectedGroupId = getScriptProperty_('LINE_GROUP_ID');
  if (!expectedGroupId || String(source.groupId || '') !== expectedGroupId) {
    lineReply_(event.replyToken, [{ type: 'text', text: 'ไม่อนุญาตให้จัดการออเดอร์จากกลุ่มนี้' }]);
    return;
  }
  var staffId = String(source.userId || '');
  var staff = findRowByValue_(getSheet_('AdminUsers'), 'lineUserId', staffId);
  if (!staff || !isTruthy_(staff.isActive)) {
    lineReply_(event.replyToken, [{ type: 'text', text: 'บัญชี LINE นี้ไม่มีสิทธิ์จัดการออเดอร์ กรุณาติดต่อเจ้าของร้าน' }]);
    return;
  }
  var params = parseQueryString_(event.postback && event.postback.data || '');
  if (params.action !== 'order_status') return;
  try {
    var status = String(params.status || '').toUpperCase();
    var note = '';
    if (status === APP.STATUS.CANCELLED) note = 'ยกเลิกจาก LINE Group';
    updateOrderStatus_(params.orderId, status, {
      type: 'LINE_ADMIN', id: staffId, note: note, cancelReason: note
    });
    lineReply_(event.replyToken, [{ type: 'text', text: 'อัปเดตออเดอร์ #' + params.orderId + ' เป็น ' + (APP.STATUS_LABELS[status] || status) + ' แล้ว' }]);
  } catch (err) {
    lineReply_(event.replyToken, [{ type: 'text', text: 'ดำเนินการไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด') }]);
  }
}

function parseQueryString_(query) {
  var result = {};
  String(query || '').split('&').forEach(function (part) {
    if (!part) return;
    var index = part.indexOf('=');
    var key = index >= 0 ? part.substring(0, index) : part;
    var value = index >= 0 ? part.substring(index + 1) : '';
    result[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' '));
  });
  return result;
}

/* ========================================================================== */
/* 14. LOGGING                                                                */
/* ========================================================================== */

function logAdminActivity_(adminId, action, entityType, entityId, details) {
  appendObject_(getSheet_('AdminActivityLogs'), {
    logId: newId_('ALOG'), adminId: adminId || '', action: action,
    entityType: entityType, entityId: entityId || '',
    details: String(details || '').substring(0, 1000), createdAt: new Date()
  });
}

function logCustomerEvent_(customerId, action, entityId, details) {
  // Customer activity is retained in the central audit log with a CUSTOMER actor.
  appendObject_(getSheet_('AdminActivityLogs'), {
    logId: newId_('ALOG'), adminId: 'CUSTOMER:' + customerId, action: action,
    entityType: 'CUSTOMER', entityId: entityId || '',
    details: String(details || '').substring(0, 1000), createdAt: new Date()
  });
}

/* ========================================================================== */
/* 15. GOOGLE SHEETS LOW-LEVEL HELPERS                                         */
/* ========================================================================== */

function getSheet_(name) {
  var sheet = getDatabase_().getSheetByName(name);
  if (!sheet) throw appError_('SHEET_NOT_FOUND', 'ไม่พบชีต ' + name + ' กรุณารัน setupSystem()');
  return sheet;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v || '').trim(); });
}

function getRowsAsObjects_(sheet) {
  var all = getRowsAsObjectsWithNumbers_(sheet);
  return all.map(function (row) {
    var copy = Object.assign({}, row);
    delete copy.rowNumber;
    return copy;
  });
}

function getRowsAsObjectsWithNumbers_(sheet) {
  var lastRow = sheet.getLastRow();
  var headers = getHeaders_(sheet);
  if (lastRow < 2 || !headers.length) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row, index) {
    var obj = { rowNumber: index + 2 };
    headers.forEach(function (header, i) { if (header) obj[header] = row[i]; });
    return obj;
  }).filter(function (obj) {
    return headers.some(function (header) { return header && obj[header] !== '' && obj[header] !== null; });
  });
}

function appendObject_(sheet, object) {
  var headers = getHeaders_(sheet);
  var values = headers.map(function (header) { return normalizeSheetValue_(object[header]); });
  sheet.appendRow(values);
}

function updateRowObject_(sheet, rowNumber, patch) {
  var headers = getHeaders_(sheet);
  var range = sheet.getRange(rowNumber, 1, 1, headers.length);
  var values = range.getValues()[0];
  headers.forEach(function (header, index) {
    if (Object.prototype.hasOwnProperty.call(patch, header)) values[index] = normalizeSheetValue_(patch[header]);
  });
  range.setValues([values]);
}

function getRowObject_(sheet, rowNumber) {
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  var row = {};
  headers.forEach(function (header, index) { row[header] = values[index]; });
  return row;
}

function findRowByValue_(sheet, columnName, value) {
  if (value === undefined || value === null || value === '') return null;
  var rows = getRowsAsObjectsWithNumbers_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][columnName]) === String(value)) return rows[i];
  }
  return null;
}

function normalizeSheetValue_(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  var text = String(value);
  if (/^[=+@]/.test(text) || /^-[^0-9]/.test(text)) return "'" + text;
  return text;
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return callback(); }
  finally { lock.releaseLock(); }
}

/* ========================================================================== */
/* 16. REQUEST / RESPONSE AND GENERAL HELPERS                                 */
/* ========================================================================== */

function parsePayload_(raw) {
  if (!raw) throw appError_('EMPTY_REQUEST', 'ไม่พบข้อมูลคำขอ');
  var value = String(raw);
  // Parse x-www-form-urlencoded body if the caller did not send e.parameter.
  if (value.indexOf('payload=') === 0) {
    value = value.substring(8).split('&')[0].replace(/\+/g, ' ');
    value = decodeURIComponent(value);
  }
  try {
    var parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') throw new Error('payload must be object');
    return parsed;
  } catch (err) {
    throw appError_('INVALID_JSON', 'รูปแบบ payload ไม่ถูกต้อง');
  }
}

function postMessageResponse_(requestId, result) {
  var props = PropertiesService.getScriptProperties();
  var targetOrigin = props.getProperty('FRONTEND_ORIGIN') || '*';
  if (targetOrigin !== '*' && !/^https:\/\//.test(targetOrigin)) targetOrigin = '*';
  var message = {
    channel: 'JAEON_GAS_API',
    requestId: requestId,
    result: result
  };
  var json = JSON.stringify(message)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var originJson = JSON.stringify(targetOrigin);
  var html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>(function(){var msg=' + json + ';try{window.top.postMessage(msg,' + originJson + ');}' +
    'catch(e){try{window.parent.postMessage(msg,' + originJson + ');}catch(ignore){}}})();</script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function successResult_(data) { return { ok: true, data: data }; }
function errorResult_(error) {
  return {
    ok: false,
    error: {
      code: error && error.code ? error.code : 'SERVER_ERROR',
      message: error && error.message ? String(error.message) : 'เกิดข้อผิดพลาดในระบบ'
    }
  };
}
function appError_(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}
function getScriptProperty_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function randomToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function hashText_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b + 256) % 256; return ('0' + v.toString(16)).slice(-2); }).join('');
}
function constantTimeEquals_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function getClientFingerprint_(value) { return String(value || '').substring(0, 256); }
function newId_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 20).toUpperCase(); }
function cleanText_(value, maxLength, label) {
  var text = String(value === undefined || value === null ? '' : value).trim();
  if (text.length > maxLength) throw appError_('TEXT_TOO_LONG', (label || 'ข้อความ') + 'ยาวเกิน ' + maxLength + ' ตัวอักษร');
  return text;
}
function validateHttpUrl_(value) {
  var url = String(value || '').trim();
  if (!url) return '';
  if (url.length > 2000 || !/^https:\/\//i.test(url)) throw appError_('INVALID_URL', 'URL ต้องขึ้นต้นด้วย https://');
  return url;
}
function toNumber_(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}
function isTruthy_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1' || String(value).toLowerCase() === 'yes';
}
function sortByOrder_(a, b) { return toNumber_(a.sortOrder, 0) - toNumber_(b.sortOrder, 0); }
function dateMillis_(value) {
  if (!value) return 0;
  var date = value instanceof Date ? value : new Date(value);
  var time = date.getTime();
  return isNaN(time) ? 0 : time;
}
function validatePositiveMoney_(amount, label) {
  var n = toNumber_(amount, -1);
  if (!isFinite(n) || n <= 0 || n > 1000000) throw appError_('INVALID_AMOUNT', (label || 'จำนวนเงิน') + 'ต้องมากกว่า 0 และไม่เกิน 1,000,000 บาท');
  return Math.round(n * 100) / 100;
}
function money_(amount) { return '฿' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function orderTypeLabel_(type) { return ({ dinein: 'รับประทานที่ร้าน', takeaway: 'ซื้อกลับบ้าน', delivery: 'จัดส่ง' })[type] || type || '-'; }
function paymentLabel_(method) { return ({ cash: 'เงินสด', promptpay: 'โอนพร้อมเพย์' })[method] || method || '-'; }
function paymentStatusLabel_(status) { return ({ UNPAID: 'ยังไม่ชำระ', PENDING: 'รอตรวจสอบ', VERIFIED: 'ตรวจสอบแล้ว', PAID: 'ชำระแล้ว', REJECTED: 'ไม่ผ่าน' })[status] || status || '-'; }
function escapeHtml_(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ========================================================================== */
/* 17. MANUAL UTILITIES FOR OWNER                                              */
/* ========================================================================== */

/**
 * Run after adding the LINE OA to the restaurant group. The LINE webhook proxy
 * will capture the group ID from a verified join event if LINE_GROUP_ID is blank.
 * You may also set LINE_GROUP_ID manually in Script Properties.
 */
function showSystemConfigurationChecklist() {
  var keys = [
    'SPREADSHEET_ID', 'ADMIN_PASSWORD_HASH', 'LINE_LOGIN_CHANNEL_ID',
    'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_GROUP_ID',
    'WEBHOOK_PROXY_SECRET', 'FRONTEND_ORIGIN', 'IMGBB_API_KEY'
  ];
  var props = PropertiesService.getScriptProperties().getProperties();
  var checklist = {};
  keys.forEach(function (key) { checklist[key] = !!props[key]; });
  Logger.log(JSON.stringify(checklist, null, 2));
  return checklist;
}

/** Test LINE OA push message to the configured restaurant group. */
function testLineGroupConnection() {
  var groupId = getScriptProperty_('LINE_GROUP_ID');
  if (!groupId) throw new Error('ยังไม่ได้ตั้งค่า LINE_GROUP_ID');
  var result = linePush_(groupId, [{ type: 'text', text: 'ทดสอบการเชื่อมต่อระบบร้าน ' + APP.NAME + ' สำเร็จ' }]);
  Logger.log(JSON.stringify(result));
  return result;
}

/** Add one test category from the script editor if desired. */
function addSampleCategory() {
  var name = 'ก๋วยเตี๋ยว';
  var existing = getRowsAsObjects_(getSheet_('Categories')).some(function (r) { return r.name === name; });
  if (existing) return { skipped: true, message: 'มีหมวดหมู่นี้แล้ว' };
  return saveCategory_({ name: name, sortOrder: 1, isActive: true }, 'OWNER');
}
