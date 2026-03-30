var http = require('http');
var util = require('util');
var htmlencode = require('htmlencode').htmlEncode;
const https = require('https');

/**
 * Sends a log message to Graylog GELF HTTP input
 * @param {Object} logData - The log payload (event, payload, protocolData)
 */
function sendToGraylog(logData) {
  // 1. Prepare the JSON payload
  const postData = JSON.stringify(logData);

  // 2. Setup request options (Note: use 'https' for port 443)
  const options = {
    hostname: 'adapt2.sis.pitt.edu',
    port: 443,
    path: '/graylog-gelf/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  // 3. Create the request
  const graylogReq = https.request(options, (res) => {
    // We must consume the response data to free up memory
    res.on('data', () => {}); 
    if (res.statusCode >= 300) {
      console.warn(`[Graylog] Warning: Received status ${res.statusCode}`);
    }
  });

  // 4. Handle connection errors
  graylogReq.on('error', (e) => {
    console.error(`[Graylog] Error: ${e.message}`);
  });

  // 5. CRITICAL: Write the data and call .end()
  graylogReq.write(postData);
  graylogReq.end();
}

var ACOSPITT = function () { };

ACOSPITT.addToHead = function (params) {
  params.headContent += '<script src="/static/pitt/jquery.min.js" type="text/javascript"></script>\n';
  params.headContent += '<script src="/static/pitt/events.js" type="text/javascript"></script>\n';
  return true;
};

ACOSPITT.addToBody = function (params, req) {
  if (req.query.usr && req.query.grp && req.query.sid && req.query['example-id']) {
    params.bodyContent += '<input type="hidden" name="acos-usr" value="' + htmlencode(req.query.usr) + '"/>\n';
    params.bodyContent += '<input type="hidden" name="acos-grp" value="' + htmlencode(req.query.grp) + '"/>\n';
    params.bodyContent += '<input type="hidden" name="acos-sid" value="' + htmlencode(req.query.sid) + '"/>\n';
    params.bodyContent += '<input type="hidden" name="acos-example-id" value="' + htmlencode(req.query['example-id']) + '"/>\n';

    // This is a fixed value for JSVEE animations
    if (req.params.contentType === 'jsvee') {
      params.bodyContent += '<input type="hidden" name="acos-app" value="35"/>\n';
    } else if (req.params.contentType === 'jsparsons' || req.params.contentType === 'combo') {
      params.bodyContent += '<input type="hidden" name="acos-app" value="38"/>\n';
    }

    return true;
  } else {
    return false;
  }
};

ACOSPITT.initialize = function (req, params, handlers, cb) {
  // Initialize the protocol
  var result = ACOSPITT.addToHead(params, req);
  result = result && ACOSPITT.addToBody(params, req);

  if (result && req.query['example-id']) {
    params.name = req.query['example-id'];
  } else {
    params.error = 'Initialization error';
  }

  if (!params.error) {
    // Initialize the content type (and content package)
    handlers.contentTypes[req.params.contentType].initialize(req, params, handlers, function () {
      cb();
    });
  } else {
    cb();
  }

};

ACOSPITT.handleEvent = function (event, payload, req, res, protocolData, responseObj, cb) {
  sendToGraylog({ event, payload, protocolData });

  // Jsvee
  if (event === 'line' && protocolData.app && parseInt(protocolData.app, 10) === 35) {
    var endpoint = "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=-1&svc=ACOS";
    endpoint = util.format(endpoint, protocolData.app, protocolData['example-id'], payload,
      protocolData.usr, protocolData.grp, protocolData.sid);
    console.log('[ACOSPITT] sending line event to CBUM: ' + endpoint);
    http.get(endpoint, function (result) {
      console.log('[ACOSPITT] CBUM response: ' + result.statusCode + ' - ' + result.statusMessage);
      if (result.statusCode === 200) {
        res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      } else {
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      }
      cb(event, payload, req, res, protocolData, responseObj);
    }).on('error', function (e) {
      console.error('[ACOSPITT] error fetching from CBUM: ' + e.message);
      res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    });
  } 
  // Parsons problems
  else if (event === 'grade' && protocolData.app && parseInt(protocolData.app, 10) === 38) {
    var endpoint = "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=%s&svc=ACOS"; // jshint ignore:line
    endpoint = util.format(endpoint, protocolData.app, 'ps_problems', protocolData['example-id'],
      protocolData.usr, protocolData.grp, protocolData.sid, payload.points);
    console.log('[ACOSPITT] sending grade event to CBUM: ' + endpoint);
    http.get(endpoint, function (result) {
      console.log('[ACOSPITT] CBUM response: ' + result.statusCode + ' - ' + result.statusMessage);
      if (result.statusCode === 200) {
        res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      } else {
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      }
      cb(event, payload, req, res, protocolData, responseObj);
    }).on('error', function (e) {
      console.error('[ACOSPITT] error fetching from CBUM: ' + e.message);
      res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    });
  } 
  // PCEX
  else if (["46", "47"].includes(`${payload.um_application_id}`) || 
           ["46", "47"].includes(`${payload.event_data?.um_application_id}`)) {
    // send grade/explanation events to the user modeling server
    const is_explanation_event = event === 'log' && payload.event_type === 'explanation';
    if (event === 'grade' || is_explanation_event) {
      const params = {
        app: payload.um_application_id || payload.event_data?.um_application_id,
        usr: protocolData.usr,
        grp: protocolData.grp,
        sid: protocolData.sid,
      }

      if (event === 'grade') {
        params.act = 'PCEX_Challenge';
        params.sub = payload.event_data.goal_name;
        params.res = payload.points;
      } else if (is_explanation_event) {
        params.act = payload.goal_name;
        params.sub = payload.line_number;
        params.res = -1;
      }

      const endpoint = util.format(
        "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=%s&svc=ACOS", 
        params.app, params.act, params.sub, params.usr, params.grp, params.sid, params.res);
      console.log('[ACOSPITT] sending event to CBUM: ' + endpoint);
      http.get(endpoint, function (result) {
        console.log('[ACOSPITT] CBUM response: ' + result.statusCode + ' - ' + result.statusMessage);
        if (result.statusCode === 200) {
          res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
        } else {
          res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
        }
        cb(event, payload, req, res, protocolData, responseObj);
      }).on('error', function (e) {
        console.error('[ACOSPITT] error fetching from CBUM: ' + e.message);
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
        cb(event, payload, req, res, protocolData, responseObj);
      });
    } else {
      console.warn('[ACOSPITT] unsupported event for PCEX: ' + event);
      res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    }
  }
  // Unsupported events
  else {
    console.warn('[ACOSPITT] unsupported event: ' + event);
    res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
    cb(event, payload, req, res, protocolData, responseObj);
  }
};

ACOSPITT.register = function (handlers, app) {
  handlers.protocols.pitt = ACOSPITT;
};

ACOSPITT.namespace = 'pitt';
ACOSPITT.packageType = 'protocol';

ACOSPITT.meta = {
  'name': 'pitt',
  'shortDescription': 'Protocol to load content by using the Pittsburgh protocol and to communicate with user modeling server.',
  'description': '',
  'author': 'Mohammad Hassany',
  'license': 'MIT',
  'version': '0.2.0',
  'url': ''
};

module.exports = ACOSPITT;
