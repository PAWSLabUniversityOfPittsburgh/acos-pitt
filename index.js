var http = require('http');
var util = require('util');
var htmlencode = require('htmlencode').htmlEncode;

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
  // Jsvee
  if (event === 'line' && protocolData.app && parseInt(protocolData.app, 10) === 35) {
    var endpoint = "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=-1&svc=ACOS";
    endpoint = util.format(endpoint, protocolData.app, protocolData['example-id'], payload,
      protocolData.usr, protocolData.grp, protocolData.sid);

    http.get(endpoint, function (result) {
      if (result.statusCode === 200) {
        res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      } else {
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      }
      cb(event, payload, req, res, protocolData, responseObj);
    }).on('error', function () {
      res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    });
  } 
  // Parsons problems
  else if (event === 'grade' && protocolData.app && parseInt(protocolData.app, 10) === 38) {
    var endpoint = "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=%s&svc=ACOS"; // jshint ignore:line
    endpoint = util.format(endpoint, protocolData.app, 'ps_problems', protocolData['example-id'],
      protocolData.usr, protocolData.grp, protocolData.sid, payload.points);

    http.get(endpoint, function (result) {
      if (result.statusCode === 200) {
        res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      } else {
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      }
      cb(event, payload, req, res, protocolData, responseObj);
    }).on('error', function () {
      res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    });
  } 
  // pcex explanation
  else if (event === 'log' && 
    payload.um_application_id && parseInt(payload.um_application_id, 10) === 46 &&
    payload.event_type === 'explanation' && payload.goal_name && payload.line_number) {
    var pcexExplanationEndpoint = "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=-1&svc=ACOS";
    pcexExplanationEndpoint = util.format(
      pcexExplanationEndpoint,
      parseInt(payload.um_application_id, 10),
      encodeURIComponent(payload.goal_name),
      encodeURIComponent(payload.line_number),
      protocolData.usr,
      protocolData.grp,
      protocolData.sid
    );

    http.get(pcexExplanationEndpoint, function (result) {
      if (result.statusCode === 200) {
        res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      } else {
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      }
      cb(event, payload, req, res, protocolData, responseObj);
    }).on('error', function () {
      res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    });
  } 
  // pcex challenge result
  else if (event === 'grade' && 
    payload.event_data.um_application_id && parseInt(payload.event_data.um_application_id, 10) === 47 &&
    payload.event_data.goal_name && payload.points) {
    var pcexGradeEndpoint = "http://adapt2.sis.pitt.edu/cbum/um?app=%s&act=%s&sub=%s&usr=%s&grp=%s&sid=%s&res=%s&svc=ACOS";
    pcexGradeEndpoint = util.format(
      pcexGradeEndpoint,
      parseInt(payload.event_data.um_application_id, 10),
      'PCEX_Challenge',
      encodeURIComponent(payload.event_data.goal_name),
      protocolData.usr,
      protocolData.grp,
      protocolData.sid,
      payload.points
    );

    http.get(pcexGradeEndpoint, function (result) {
      if (result.statusCode === 200) {
        res.json({ 'status': 'OK', 'protocol': responseObj.protocol, 'content': responseObj.content });
      } else {
        res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      }
      cb(event, payload, req, res, protocolData, responseObj);
    }).on('error', function () {
      res.json({ 'status': 'ERROR', 'protocol': responseObj.protocol, 'content': responseObj.content });
      cb(event, payload, req, res, protocolData, responseObj);
    });
  } else {
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
  'author': 'Teemu Sirkiä & Mohammad Hassany',
  'license': 'MIT',
  'version': '0.2.0',
  'url': ''
};

module.exports = ACOSPITT;
