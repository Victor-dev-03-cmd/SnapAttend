(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function m(tag, css, value) {
    var node = window.mango.j(tag, null, value === undefined ? [] : [String(value)]);
    if (css) node.className = css;
    return node;
  }
  if (!window.mango || !window.mango.j) {
    $('login-feedback').textContent = 'The Mango interface could not load. Please refresh when online.';
    return;
  }
  var studentToken = '';
  var demo = false;
  var requests = [];
  var sending = false;
  var poller = null;

  function message(text) { $('location-status').textContent = text; }
  function errorText(err) { return (err && err.message) || 'Something went wrong'; }
  function showStudent(name, klass) {
    $('student-name').textContent = name;
    $('student-class').textContent = klass;
    $('student-gate').hidden = true;
    $('student-panel').hidden = false;
  }
  async function api(path, options) {
    options = options || {};
    options.credentials = 'same-origin';
    options.headers = Object.assign({'accept':'application/json'}, options.headers || {});
    if (studentToken) options.headers['x-student-token'] = studentToken;
    if (options.body && typeof options.body !== 'string') {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    var response = await fetch(path, options);
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw Error(body.error || 'Request failed');
    return body;
  }
  function renderRequests(items) {
    var container = $('student-requests');
    container.textContent = '';
    requests = items || [];
    if (!requests.length) {
      container.appendChild(m('p', '', 'No pending requests. Your location is not being tracked.'));
      $('request-share').disabled = true;
      $('request-note').textContent = 'No pending request';
      return;
    }
    $('request-share').disabled = false;
    $('request-note').textContent = '1 request needs your decision';
    requests.forEach(function (request) {
      var entry = m('div', 'request-entry');
      entry.appendChild(m('strong', '', demo ? 'Example guardian request — demo only' : 'School safety location request'));
      entry.appendChild(m('small', '', 'Expires: ' + new Date(request.expires_at).toLocaleTimeString()));
      var button = m('button', '', 'Choose to share my location');
      button.type = 'button';
      button.addEventListener('click', function () { shareLocation('parent_request', request.id); });
      entry.appendChild(button);
      container.appendChild(entry);
    });
  }
  async function checkRequests() {
    if (demo || !studentToken || document.hidden) return;
    try {
      var data = await api('/api/student/me');
      renderRequests(data.pending_requests);
    } catch (err) {
      message('Unable to check school safety requests: ' + errorText(err));
    }
  }
  $('student-login').addEventListener('click', async function () {
    var token = $('student-token').value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token)) {
      $('login-feedback').textContent = 'Enter the private 64-character access code issued by your school.';
      return;
    }
    studentToken = token;
    $('login-feedback').textContent = 'Checking your access...';
    try {
      var result = await api('/api/student/me');
      $('student-token').value = '';
      $('login-feedback').textContent = '';
      showStudent(result.student.name, result.student.class_name);
      renderRequests(result.pending_requests);
      poller = setInterval(checkRequests, 30000);
    } catch (err) {
      studentToken = '';
      $('login-feedback').textContent = errorText(err);
    }
  });
  $('student-demo').addEventListener('click', function () {
    demo = true;
    showStudent('Student Example', 'Grade 8A · fictional school');
    renderRequests([{id:'demo-request',expires_at:new Date(Date.now() + 900000).toISOString()}]);
    message('Demo only. No location is requested automatically.');
  });
  $('student-signout').addEventListener('click', function () {
    studentToken = '';
    demo = false;
    requests = [];
    if (poller) clearInterval(poller);
    poller = null;
    $('location-consent').checked = false;
    $('location-result').hidden = true;
    $('student-gate').hidden = false;
    $('student-panel').hidden = true;
    $('student-token').value = '';
    message('No location has been requested.');
  });
  function locationError(err) {
    if (err && err.code === 1) return 'Location permission denied. You can enable location in your browser settings; nothing was shared.';
    if (err && err.code === 2) return 'Your device could not determine its location. Nothing was shared.';
    if (err && err.code === 3) return 'GPS request timed out. Nothing was shared.';
    return 'Could not obtain location. Nothing was shared.';
  }
  function mapUrl(latitude, longitude) {
    return 'https://www.google.com/maps?q=' + latitude.toFixed(6) + ',' + longitude.toFixed(6);
  }
  function showPosition(position, delivery) {
    var link = mapUrl(position.latitude, position.longitude);
    $('location-map').href = link;
    $('location-result').hidden = false;
    $('location-accuracy').textContent = 'Reported device accuracy: approximately ±' + Math.round(position.accuracy_m) + ' metres. Not a guarantee of your exact position.';
    $('delivery-status').textContent = delivery;
  }
  async function shareLocation(kind, requestId) {
    if (sending) return;
    if (!$('location-consent').checked) {
      message('First choose the location-sharing consent checkbox. Nothing has been shared.');
      return;
    }
    if (kind === 'parent_request' && !requests.some(function (r) { return r.id === requestId; })) {
      message('This location request is no longer available. Nothing has been shared.');
      return;
    }
    if (!navigator.geolocation || !window.isSecureContext) {
      message('GPS is unavailable. Open this page over HTTPS on a device with location support. Nothing was shared.');
      return;
    }
    sending = true;
    $('location-result').hidden = true;
    message('Asking your device for a one-time location. You may deny permission.');
    navigator.geolocation.getCurrentPosition(async function (fix) {
      var position = {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracy_m: fix.coords.accuracy,
        observed_at: new Date(fix.timestamp).toISOString()
      };
      if (!isFinite(position.latitude) || !isFinite(position.longitude) || !isFinite(position.accuracy_m)) {
        sending = false; message('Invalid GPS position. Nothing shared.'); return;
      }
      if (demo) {
        showPosition(position, 'DEMO ONLY: This map link remains in your browser. No location was sent to SnapAttend, parents or the school.');
        message(kind === 'sos' ? 'SOS demo — NOT sent. In a real emergency, contact a trusted adult or emergency services.' : 'Demo location preview only — NOT sent.');
        sending = false;
        return;
      }
      if (!navigator.onLine) {
        showPosition(position, 'OFFLINE: Location was NOT sent. Do not rely on the app for emergency response.');
        message('Offline. Nothing was sent. Contact a trusted adult or emergency services directly.');
        sending = false;
        return;
      }
      try {
        var response = await api('/api/student/safety-events', {
          method:'POST', body:{kind:kind,request_id:requestId || null,position:position,consent_to_share:true}
        });
        showPosition(position, 'Saved for school staff only. WhatsApp and push delivery are NOT configured, so no parent notification has been sent.');
        message(kind === 'sos' ? 'SOS location saved in school system, but no emergency message was sent. Please seek immediate help.' : 'One-time location recorded. Messaging not configured.');
        if (kind === 'parent_request') await checkRequests();
      } catch (err) {
        showPosition(position, 'NOT SENT: ' + errorText(err));
        message('Location could not be submitted. No one was notified.');
      } finally { sending = false; }
    }, function (err) {
      message(locationError(err));
      sending = false;
    }, {enableHighAccuracy:true, maximumAge:0, timeout:20000});
  }
  $('safe-checkin').addEventListener('click', function () { shareLocation('checkin'); });
  $('request-share').addEventListener('click', function () { if (requests.length) shareLocation('parent_request',requests[0].id); });
  $('student-sos').addEventListener('click', function () { shareLocation('sos'); });
  api('/api/health').then(function (health) {
    if (health.mode === 'ui-preview') {
      $('preview-warning').hidden = false;
      $('student-demo').hidden = false;
      $('login-feedback').textContent = 'This deployment is UI preview only; school accounts are not active here.';
    }
  }).catch(function () {});
})();
