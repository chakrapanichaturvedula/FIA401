// ============================================================
// PriceDiscovery.gs â FIA 401 Price Discovery Game (v5)
// NSE-style continuous matching Â· Price-time priority Â· Cancel
// ============================================================

// âââââââââ SHEET SETUP ââââââââââ
function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.appendRow(headers);
  }
  return sh;
}

function getGameSheet() {
  return getOrCreateSheet('PD_Game', [
    'game_id','asset_name','asset_symbol','spot_price','num_rounds',
    'current_round','round_cue','status','discovery_prices','created_at','updated_at','lot_size'
  ]);
}

function getOrdersSheet() {
  return getOrCreateSheet('PD_Orders', [
    'order_id','game_id','round','student_id','student_name',
    'side','instrument','strike','expiry','price','qty','filled_qty','timestamp','status'
  ]);
}

function getTradesSheet() {
  return getOrCreateSheet('PD_Trades', [
    'trade_id','game_id','round','instrument','strike','expiry',
    'price','qty','buy_order_id','sell_order_id','timestamp'
  ]);
}

// ââââââââââ ROW CONVERTERS ââââââââââ
function rowToGame(row) {
  return {
    gameId: row[0], assetName: row[1], assetSymbol: row[2],
    spotPrice: parseFloat(row[3]) || 0,
    numRounds: parseInt(row[4]) || 3,
    currentRound: parseInt(row[5]) || 1,
    roundCue: row[6] || '',
    status: row[7] || 'waiting',
    discoveryPrices: JSON.parse(row[8] || '[]'),
    createdAt: row[9], updatedAt: row[10],
    lotSize: parseInt(row[11]) || 1
  };
}

function rowToOrder(row) {
  return {
    orderId:    row[0],  gameId:     row[1],
    round:      parseInt(row[2]) || 1,
    studentId:  row[3],  studentName: row[4],
    side:       row[5],  instrument:  row[6],
    strike:     parseFloat(row[7]) || 0,
    expiry:     row[8] || '',
    price:      parseFloat(row[9]) || 0,
    qty:        parseInt(row[10]) || 0,
    filledQty:  parseInt(row[11]) || 0,
    timestamp:  row[12],
    status:     row[13] || 'open'
  };
}

function rowToTrade(row) {
  return {
    tradeId:     row[0],  gameId:    row[1],
    round:       parseInt(row[2]) || 1,
    instrument:  row[3],
    strike:      parseFloat(row[4]) || 0,
    expiry:      row[5] || '',
    price:       parseFloat(row[6]) || 0,
    qty:         parseInt(row[7]) || 0,
    buyOrderId:  row[8],  sellOrderId: row[9],
    timestamp:   row[10]
  };
}

// ââââââââââ GAME LOOKUP ââââââââââ
function getGameById(gameId) {
  var sh = getGameSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == gameId) return { row: rowToGame(data[i]), rowIndex: i + 1 };
  }
  return null;
}

function getLatestGame() {
  var sh = getGameSheet();
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  return { row: rowToGame(data[data.length - 1]), rowIndex: data.length };
}

function resolveGame(params) {
  return params.gameId ? getGameById(params.gameId) : getLatestGame();
}

function updateGameRow(rowIndex, updates) {
  var sh = getGameSheet();
  var row = sh.getRange(rowIndex, 1, 1, 12).getValues()[0];
  if (updates.status          !== undefined) row[7]  = updates.status;
  if (updates.currentRound    !== undefined) row[5]  = updates.currentRound;
  if (updates.roundCue        !== undefined) row[6]  = updates.roundCue;
  if (updates.discoveryPrices !== undefined) row[8]  = JSON.stringify(updates.discoveryPrices);
  row[10] = new Date().toISOString();
  sh.getRange(rowIndex, 1, 1, 12).setValues([row]);
}

// ââââââââââ MATCHING ENGINE ââââââââââ
// Instrument key: groups orders that can trade against each other
function instrumentKey(o) {
  if (o.instrument === 'spot')    return 'spot';
  if (o.instrument === 'futures') return 'futures|' + o.expiry;
  return o.instrument + '|' + o.strike + '|' + o.expiry;
}

// NSE-style continuous order matching with price-time priority.
// Called after every new order is placed.
function matchOrders(gameId, round) {
  var sh   = getOrdersSheet();
  var tsh  = getTradesSheet();
  var data = sh.getDataRange().getValues();
  var newTrades = [];

  // Group open/partial orders by instrument key
  var groups = {};
  for (var i = 1; i < data.length; i++) {
    var o = rowToOrder(data[i]);
    if (o.gameId != gameId || o.round != round) continue;
    if (o.status !== 'open' && o.status !== 'partial') continue;
    var rem = o.qty - o.filledQty;
    if (rem <= 0) continue;
    var key = instrumentKey(o);
    if (!groups[key]) groups[key] = { buys: [], sells: [] };
    o._rowIndex = i + 1;  // remember sheet row for updates
    if (o.side === 'buy') groups[key].buys.push(o);
    else                  groups[key].sells.push(o);
  }

  for (var key in groups) {
    var g = groups[key];

    // Price-time priority:
    //   Buys  â highest price first; ties by earliest timestamp
    //   Sells â lowest price first; ties by earliest timestamp
    g.buys.sort(function(a, b) {
      if (b.price !== a.price) return b.price - a.price;
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    g.sells.sort(function(a, b) {
      if (a.price !== b.price) return a.price - b.price;
      return new Date(a.timestamp) - new Date(b.timestamp);
    });

    while (g.buys.length > 0 && g.sells.length > 0) {
      var bestBuy  = g.buys[0];
      var bestSell = g.sells[0];

      // No match: bid is lower than ask â market not crossed
      if (bestBuy.price < bestSell.price) break;

      // Trade price = resting (passive) order's price.
      // Resting order is the one placed first (earlier timestamp).
      var tradePrice = (new Date(bestBuy.timestamp) <= new Date(bestSell.timestamp))
                       ? bestBuy.price    // buy was resting; sell trades at bid price
                       : bestSell.price;  // sell was resting; buy trades at ask price

      var buyRem   = bestBuy.qty  - bestBuy.filledQty;
      var sellRem  = bestSell.qty - bestSell.filledQty;
      var tradeQty = Math.min(buyRem, sellRem);

      var tradeId = 'T' + Date.now() + '_' + newTrades.length;
      var ts = new Date().toISOString();

      tsh.appendRow([
        tradeId, gameId, round,
        bestBuy.instrument, bestBuy.strike, bestBuy.expiry,
        tradePrice, tradeQty,
        bestBuy.orderId, bestSell.orderId, ts
      ]);
      newTrades.push({
        tradeId: tradeId, price: tradePrice, qty: tradeQty,
        instrument: bestBuy.instrument, strike: bestBuy.strike,
        expiry: bestBuy.expiry, timestamp: ts
      });

      // Update buy order
      bestBuy.filledQty += tradeQty;
      var buyStatus = (bestBuy.filledQty >= bestBuy.qty) ? 'filled' : 'partial';
      sh.getRange(bestBuy._rowIndex, 12).setValue(bestBuy.filledQty);
      sh.getRange(bestBuy._rowIndex, 14).setValue(buyStatus);
      if (buyStatus === 'filled') g.buys.shift();

      // Update sell order
      bestSell.filledQty += tradeQty;
      var sellStatus = (bestSell.filledQty >= bestSell.qty) ? 'filled' : 'partial';
      sh.getRange(bestSell._rowIndex, 12).setValue(bestSell.filledQty);
      sh.getRange(bestSell._rowIndex, 14).setValue(sellStatus);
      if (sellStatus === 'filled') g.sells.shift();
    }
  }
  return newTrades;es;
}

// Compute last trade price per instrument for a given round
function computeDiscoveryPrices(gameId, round) {
  var tsh  = getTradesSheet();
  var data = tsh.getDataRange().getValues();
  var last = {};
  for (var i = 1; i < data.length; i++) {
    var t = rowToTrade(data[i]);
    if (t.gameId != gameId || t.round != round) continue;
    var key = t.instrument === 'spot' ? 'spot' : (t.instrument + '|' + t.strike + '|' + t.expiry);
    if (!last[key] || new Date(t.timestamp) > new Date(last[key].timestamp)) {
      last[key] = t;
    }
  }
  return Object.values(last).map(function(t) {
    return { round: round, instrument: t.instrument, strike: t.strike, expiry: t.expiry, price: t.price };
  });
}

// ââââââââââ API ACTIONS ââââââââââ

function createGame(params) {
  var sh = getGameSheet();
  var gameId = 'PD_' + Date.now();
  sh.appendRow([
    gameId,
    params.assetName   || 'Asset',
    params.assetSymbol || '',
    parseFloat(params.spotPrice) || 0,
    parseInt(params.numRounds)   || 3,
    1, params.roundCue || '', 'waiting', '[]',
    new Date().toISOString(), new Date().toISOString(),
    parseInt(params.lotSize) || 1
  ]);
  return { success: true, gameId: gameId };
}

function openRound(params) {
  var g = resolveGame(params);
  if (!g) return { error: 'No game found' };
  updateGameRow(g.rowIndex, { status: 'open', roundCue: params.roundCue || g.row.roundCue });
  return { success: true };
}

function closeRound(params) {
  var g = resolveGame(params);
  if (!g) return { error: 'No game found' };
  // Persist last-trade prices for this round (price discovery from actual trades only)
  var dp       = computeDiscoveryPrices(g.row.gameId, g.row.currentRound);
  var existing = (g.row.discoveryPrices || []).filter(function(e) { return e.round != g.row.currentRound; });
  updateGameRow(g.rowIndex, { status: 'closed', discoveryPrices: existing.concat(dp) });
  return { success: true, discoveryPrices: dp };
}

function nextRound(params) {
  var g = resolveGame(params);
  if (!g) return { error: 'No game found' };
  var next = g.row.currentRound + 1;
  if (next > g.row.numRounds) {
    updateGameRow(g.rowIndex, { status: 'ended' });
    return { success: true, ended: true };
  }
  updateGameRow(g.rowIndex, { currentRound: next, status: 'waiting', roundCue: params.roundCue || '' });
  return { success: true, currentRound: next };
}

function endGame(params) {
  var g = resolveGame(params);
  if (!g) return { error: 'No game found' };
  updateGameRow(g.rowIndex, { status: 'ended' });
  return { success: true };
}

// placeOrder: save to sheet, then run matching engine immediately
function placeOrder(params) {
  var g = resolveGame(params);
  if (!g) return { error: 'No game found' };
  if (g.row.status !== 'open') return { error: 'Round is not open for trading' };

  var sh      = getOrdersSheet();
  var orderId = 'O' + Date.now() + '_' + (Math.random() * 9999 | 0);
  var ts      = new Date().toISOString();

  sh.appendRow([
    orderId,
    g.row.gameId,
    g.row.currentRound,
    params.studentId  || params.enrollId || '',
    params.studentName || '',
    params.side,
    params.instrument || params.inst || 'spot',
    parseFloat(params.strike) || 0,
    params.expiry || '',
    parseFloat(params.price) || 0,
    parseInt(params.qty) || 1,
    0,      // filled_qty starts at 0
    ts,
    'open'
  ]);

  var trades = matchOrders(g.row.gameId, g.row.currentRound);
  return { success: true, orderId: orderId, newTrades: trades };
}

// cancelOrder: student cancels their own open or partially filled order
function cancelOrder(params) {
  var sh        = getOrdersSheet();
  var data      = sh.getDataRange().getValues();
  var studentId = params.studentId || params.enrollId || '';
  for (var i = 1; i < data.length; i++) {
    var o = rowToOrder(data[i]);
    if (o.orderId !== params.orderId) continue;
    if (o.studentId !== studentId) return { error: 'Not your order' };
    if (o.status !== 'open' && o.status !== 'partial') return { error: 'Cannot cancel: status is ' + o.status };
    sh.getRange(i + 1, 14).setValue('cancelled');
    return { success: true };
  }
  return { error: 'Order not found' };
}

// getState: open order book + recent trades + student's own orders
function getState(params) {
  var g = resolveGame(params);
  if (!g) return { status: 'no_game' };
  var game      = g.row;
  var studentId = params.studentId || params.enrollId || '';

  var osh   = getOrdersSheet();
  var oData = osh.getDataRange().getValues();
  var openBids = [], openAsks = [], myOrders = [];

  for (var i = 1; i < oData.length; i++) {
    var o = rowToOrder(oData[i]);
    if (o.gameId != game.gameId || o.round != game.currentRound) continue;

    // Open order book: only orders with remaining quantity
    if (o.status === 'open' || o.status === 'partial') {
      var rem = o.qty - o.filledQty;
      if (rem > 0) {
        var entry = {
          orderId: o.orderId, price: o.price, qty: rem,
          instrument: o.instrument, strike: o.strike,
          expiry: o.expiry, timestamp: o.timestamp
        };
        if (o.side === 'buy') openBids.push(entry);
        else                  openAsks.push(entry);
      }
    }

    // Student's own orders (all statuses)
    if (studentId && o.studentId == studentId) {
      myOrders.push({
        orderId: o.orderId, side: o.side,
        instrument: o.instrument, strike: o.strike, expiry: o.expiry,
        price: o.price, qty: o.qty, filledQty: o.filledQty,
        status: o.status, timestamp: o.timestamp
      });
    }
  }

  // Sort order book (price-time priority order)
  openBids.sort(function(a, b) { return b.price !== a.price ? b.price - a.price : new Date(a.timestamp) - new Date(b.timestamp); });
  openAsks.sort(function(a, b) { return a.price !== b.price ? a.price - b.price : new Date(a.timestamp) - new Date(b.timestamp); });
  myOrders.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  // Recent trades for current round (newest first)
  var tsh   = getTradesSheet();
  var tData = tsh.getDataRange().getValues();
  var trades = [];
  for (var j = 1; j < tData.length; j++) {
    var t = rowToTrade(tData[j]);
    if (t.gameId != game.gameId || t.round != game.currentRound) continue;
    trades.push({
      price: t.price, qty: t.qty,
      instrument: t.instrument, strike: t.strike, expiry: t.expiry,
      timestamp: t.timestamp
    });
  }
  trades.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  return {
    gameId: game.gameId,  assetName: game.assetName, assetSymbol: game.assetSymbol,
    spotPrice: game.spotPrice, numRounds: game.numRounds, currentRound: game.currentRound,
    roundCue: game.roundCue,   status: game.status,     lotSize: game.lotSize,
    discoveryPrices: game.discoveryPrices,
    orderBook: { bids: openBids.slice(0, 10), asks: openAsks.slice(0, 10) },
    trades:    trades.slice(0, 30),
    myOrders:  myOrders
  };
}

// ââââââââââ MAIN ROUTER ââââââââââ
function doGet(e) {
  var p  = e.parameter || {};
  var cb = p.callback;
  var result;
  try {
    var a = p.action;
    if      (a === 'createGame'  || a === 'pd_create_game')  result = createGame(p);
    else if (a === 'openRound'   || a === 'pd_open_round')   result = openRound(p);
    else if (a === 'closeRound'  || a === 'pd_close_round')  result = closeRound(p);
    else if (a === 'nextRound'   || a === 'pd_next_round')   result = nextRound(p);
    else if (a === 'endGame'     || a === 'pd_end_game')     result = endGame(p);
    else if (a === 'placeOrder'  || a === 'pd_submit_order') result = placeOrder(p);
    else if (a === 'cancelOrder')                            result = cancelOrder(p);
    else if (a === 'getState'    || a === 'pd_get_state')    result = getState(p);
    else result = { error: 'Unknown action: ' + a };
  } catch(err) {
    result = { error: err.message, stack: err.stack };
  }
  var json = JSON.stringify(result);
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
