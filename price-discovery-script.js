// ════════════════════════════════════════════════════════════════
//  PRICE DISCOVERY GAME — Google Apps Script Additions
//  FIA 401 · Derivatives Lab
// ════════════════════════════════════════════════════════════════
//
//  HOW TO ADD TO YOUR EXISTING SCRIPT:
//  1. Open your Apps Script project (linked to your Google Sheet)
//  2. Create a new file: File → New → Script file → name it "PriceDiscovery"
//  3. Paste this ENTIRE file into it
//  4. In your EXISTING doGet() function, add this line at the top of the switch/if block:
//
//       var pdResult = handlePriceDiscovery(e);
//       if (pdResult) return pdResult;
//
//  5. Save and re-deploy: Deploy → Manage Deployments → Edit → New Version → Deploy
//
//  SHEETS CREATED AUTOMATICALLY:
//    PD_Game   — one row per game (current game is last row)
//    PD_Orders — one row per order submitted by a student
// ════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  ROUTER — called from your doGet()
// ─────────────────────────────────────────────────────────────
function handlePriceDiscovery(e) {
  var params = e.parameter;
  var action = params.action || '';
  if (!action.startsWith('pd_')) return null;  // not a PD action

  var callback = params.callback || '';

  try {
    var result;
    switch (action) {
      case 'pd_create_game':   result = pd_createGame(params);   break;
      case 'pd_get_state':     result = pd_getState(params);     break;
      case 'pd_submit_order':  result = pd_submitOrder(params);  break;
      case 'pd_open_round':    result = pd_openRound(params);    break;
      case 'pd_close_round':   result = pd_closeRound(params);   break;
      case 'pd_next_round':    result = pd_nextRound(params);    break;
      case 'pd_end_game':      result = pd_endGame(params);      break;
      default:                 result = { error: 'Unknown PD action: ' + action };
    }
  } catch (err) {
    result = { error: err.toString() };
  }

  var json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
//  SHEET HELPERS
// ─────────────────────────────────────────────────────────────
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getGameSheet() {
  return getOrCreateSheet('PD_Game', [
    'game_id', 'asset_name', 'asset_symbol', 'spot_price', 'num_rounds',
    'current_round', 'round_cue', 'status', 'clearing_prices', 'created_at', 'updated_at', 'lot_size'
  ]);
}

function getOrderSheet() {
  return getOrCreateSheet('PD_Orders', [
    'game_id', 'round', 'enroll_id', 'student_name', 'inst', 'side',
    'price', 'qty', 'strike', 'expiry', 'timestamp'
  ]);
}

function getActiveGame() {
  var sh = getGameSheet();
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  // Last row is the active game
  var row = data[data.length - 1];
  return rowToGame(row);
}

function rowToGame(row) {
  return {
    gameId:         row[0],
    assetName:      row[1],
    assetSymbol:    row[2],
    spotPrice:      parseFloat(row[3]) || 0,
    numRounds:      parseInt(row[4]) || 4,
    currentRound:   parseInt(row[5]) || 0,
    roundCue:       row[6],
    status:         row[7],
    clearingPrices: safeParseJson(row[8], []),
    createdAt:      row[9],
    updatedAt:      row[10],
    lotSize:        parseInt(row[11]) || 1   // col 12 — defaults to 1 for older rows
  };
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch(e) { return fallback; }
}

function updateGame(gameId, updates) {
  var sh = getGameSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === gameId) {
      var row = i + 1; // 1-indexed
      if ('currentRound'   in updates) sh.getRange(row, 6).setValue(updates.currentRound);
      if ('roundCue'       in updates) sh.getRange(row, 7).setValue(updates.roundCue);
      if ('status'         in updates) sh.getRange(row, 8).setValue(updates.status);
      if ('clearingPrices' in updates) sh.getRange(row, 9).setValue(JSON.stringify(updates.clearingPrices));
      sh.getRange(row, 11).setValue(new Date().toISOString());
      return true;
    }
  }
  return false;
}

function getOrdersForGame(gameId) {
  var sh = getOrderSheet();
  var data = sh.getDataRange().getValues();
  var orders = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === gameId) {
      orders.push({
        gameId:      data[i][0],
        round:       parseInt(data[i][1]),
        enrollId:    data[i][2],
        studentName: data[i][3],
        inst:        data[i][4],
        side:        data[i][5],
        price:       parseFloat(data[i][6]),
        qty:         parseInt(data[i][7]),
        strike:      data[i][8] || null,
        expiry:      data[i][9] || null,
        timestamp:   data[i][10]
      });
    }
  }
  return orders;
}

// ─────────────────────────────────────────────────────────────
//  AUTH HELPER
// ─────────────────────────────────────────────────────────────
var INSTRUCTOR_SECRET = 'IMTFD26_INSTRUCTOR';

function checkSecret(params) {
  return params.secret === INSTRUCTOR_SECRET;
}

// ─────────────────────────────────────────────────────────────
//  ACTION: CREATE GAME
// ─────────────────────────────────────────────────────────────
function pd_createGame(params) {
  if (!checkSecret(params)) return { error: 'Unauthorized' };

  var gameId    = 'PD_' + Date.now();
  var assetName = params.assetName || 'Stock';
  var symbol    = params.assetSymbol || '';
  var spot      = parseFloat(params.spotPrice) || 0;
  var numRounds = parseInt(params.numRounds) || 4;
  var lotSize   = parseInt(params.lotSize) || 1;
  var cue       = params.roundCue || 'Round 1 begins. Submit your orders.';

  var sh = getGameSheet();
  sh.appendRow([
    gameId, assetName, symbol, spot, numRounds,
    1, cue, 'waiting', '[]',
    new Date().toISOString(), new Date().toISOString(), lotSize
  ]);

  // Also clear old orders for cleanliness (optional — comment out if you want history)
  // getOrderSheet().clearContents(); // removes headers too — safer not to do this

  return { success: true, gameId: gameId, message: 'Game created. Use pd_open_round to begin trading.' };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: GET STATE
// ─────────────────────────────────────────────────────────────
function pd_getState(params) {
  var game = getActiveGame();
  if (!game) return { status: 'no_game' };

  var orders = getOrdersForGame(game.gameId);

  return {
    gameId:         game.gameId,
    assetName:      game.assetName,
    assetSymbol:    game.assetSymbol,
    spotPrice:      game.spotPrice,
    numRounds:      game.numRounds,
    currentRound:   game.currentRound,
    roundCue:       game.roundCue,
    status:         game.status,
    clearingPrices: game.clearingPrices,
    lotSize:        game.lotSize,
    orders:         orders
  };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: SUBMIT ORDER
// ─────────────────────────────────────────────────────────────
function pd_submitOrder(params) {
  var game = getActiveGame();
  if (!game) return { error: 'No active game' };
  if (game.status !== 'open') return { error: 'Round is not open' };

  var enrollId = params.enrollId || 'Unknown';
  var round    = parseInt(params.round) || game.currentRound;
  var inst     = params.inst || 'spot';
  var side     = params.side || 'buy';
  var price    = parseFloat(params.price);
  var qty      = parseInt(params.qty) || 1;

  if (!price || price <= 0) return { error: 'Invalid price' };
  if (!['spot','futures','call','put'].includes(inst)) return { error: 'Invalid instrument' };
  if (!['buy','sell'].includes(side)) return { error: 'Invalid side' };

  var sh = getOrderSheet();
  sh.appendRow([
    game.gameId, round, enrollId,
    params.studentName || enrollId,
    inst, side, price, qty,
    params.strike || '', params.expiry || '',
    new Date().toISOString()
  ]);

  return { success: true };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: OPEN ROUND
// ─────────────────────────────────────────────────────────────
function pd_openRound(params) {
  if (!checkSecret(params)) return { error: 'Unauthorized' };
  var game = getActiveGame();
  if (!game) return { error: 'No active game' };
  updateGame(game.gameId, { status: 'open' });
  return { success: true, message: 'Round ' + game.currentRound + ' is now open for trading.' };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: CLOSE ROUND
//  The instructor page computes clearing prices client-side and sends them.
//  We just store them here.
// ─────────────────────────────────────────────────────────────
function pd_closeRound(params) {
  if (!checkSecret(params)) return { error: 'Unauthorized' };
  var game = getActiveGame();
  if (!game) return { error: 'No active game' };

  // Clearing prices computed by client and sent as JSON string
  var newCp = safeParseJson(params.clearingPrices, []);

  // Merge with existing clearing prices (from previous rounds)
  var existing = game.clearingPrices || [];
  var merged = existing.concat(newCp);

  updateGame(game.gameId, { status: 'closed', clearingPrices: merged });
  return { success: true, clearingPrices: merged };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: NEXT ROUND
// ─────────────────────────────────────────────────────────────
function pd_nextRound(params) {
  if (!checkSecret(params)) return { error: 'Unauthorized' };
  var game = getActiveGame();
  if (!game) return { error: 'No active game' };

  var nextRound = game.currentRound + 1;
  if (nextRound > game.numRounds) return { error: 'All rounds completed. End the game.' };

  var cue = params.roundCue || 'Round ' + nextRound;
  updateGame(game.gameId, { currentRound: nextRound, roundCue: cue, status: 'waiting' });
  return { success: true, round: nextRound };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: END GAME
// ─────────────────────────────────────────────────────────────
function pd_endGame(params) {
  if (!checkSecret(params)) return { error: 'Unauthorized' };
  var game = getActiveGame();
  if (!game) return { error: 'No active game' };
  updateGame(game.gameId, { status: 'ended' });
  return { success: true, message: 'Game ended. Final results visible on projector.' };
}

// ════════════════════════════════════════════════════════════════
//  HOW TO INTEGRATE INTO YOUR EXISTING doGet()
//  ─────────────────────────────────────────────────────────────
//  Your existing doGet() function probably looks like:
//
//  function doGet(e) {
//    var action = e.parameter.action;
//    // ... existing switch/if ...
//  }
//
//  Change it to:
//
//  function doGet(e) {
//    // Price Discovery routing — ADD THESE 2 LINES FIRST:
//    var pdResult = handlePriceDiscovery(e);
//    if (pdResult) return pdResult;
//
//    // ... your existing code below unchanged ...
//    var action = e.parameter.action;
//    // ...
//  }
// ════════════════════════════════════════════════════════════════
