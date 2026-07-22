(function () {
  var shell = document.querySelector('.obz-qualify-shell');
  var form = document.getElementById('obz-qualifier-form');
  if (!shell || !form) return;

  var steps = Array.prototype.slice.call(document.querySelectorAll('.obz-qualify-step'));
  var progressLabel = document.getElementById('obz-progress-label');
  var progressBar = document.getElementById('obz-progress-bar');
  var qualifiedPanel = document.getElementById('obz-qualified');
  var calendarLink = document.getElementById('obz-calendar-link');
  var urlInput = document.getElementById('obz-store-url');
  var urlError = document.getElementById('obz-url-error');
  var calendarUrl = shell.getAttribute('data-calendar-url') || 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1XmoRqiA4UHt-lvjH5iLT4tOJ4mU1UFUPWJ45LTtkv_AWvelNNtonnoR9NFaCFzm3lc681Mcvi';
  var waitlistUrl = shell.getAttribute('data-waitlist-url') || 'https://retentionrules.com';
  var trackingEndpoint = shell.getAttribute('data-tracking-endpoint') || '';
  var storageKey = 'dtc_qualifier_latest';
  var currentStep = 0;
  var startedAt = new Date().toISOString();
  var answers = {
    annual_revenue: '',
    website_url: '',
    team_size: ''
  };

  function sessionId() {
    var key = 'dtc_qualifier_session_id';
    var existing = window.localStorage.getItem(key);
    if (existing) return existing;
    var value = 'dtc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem(key, value);
    return value;
  }

  var leadSessionId = sessionId();

  function payload(eventName, extra) {
    return Object.assign({
      event: eventName,
      session_id: leadSessionId,
      page: 'dtc_qualifier',
      path: window.location.pathname,
      referrer: document.referrer || '',
      source_url: window.location.href,
      started_at: startedAt,
      sent_at: new Date().toISOString(),
      answers: answers
    }, extra || {});
  }

  function track(eventName, extra) {
    var data = payload(eventName, extra);
    window.localStorage.setItem(storageKey, JSON.stringify(data));

    if (window.dataLayer && Array.isArray(window.dataLayer)) {
      window.dataLayer.push(data);
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, data);
    }
    if (typeof window.fbq === 'function') {
      window.fbq('trackCustom', eventName, data);
    }
    if (trackingEndpoint && navigator.sendBeacon) {
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      navigator.sendBeacon(trackingEndpoint, blob);
    } else if (trackingEndpoint) {
      fetch(trackingEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true
      }).catch(function () {});
    }
  }

  function showStep(index) {
    currentStep = index;
    steps.forEach(function (step, i) {
      step.classList.toggle('is-active', i === index);
    });
    if (progressLabel) progressLabel.textContent = 'Question ' + (index + 1) + ' of ' + steps.length;
    if (progressBar) progressBar.style.width = (((index + 1) / steps.length) * 100) + '%';
    track('dtc_qualifier_step_view', {
      step: index + 1,
      question_id: steps[index].getAttribute('data-question-id')
    });
  }

  function cleanUrl(value) {
    var trimmed = (value || '').trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) trimmed = 'https://' + trimmed;
    return trimmed;
  }

  function isValidStoreUrl(value) {
    try {
      var parsed = new URL(cleanUrl(value));
      return parsed.hostname.indexOf('.') > -1 && parsed.hostname.length > 4;
    } catch (error) {
      return false;
    }
  }

  function answerChoice(button) {
    var step = button.closest('.obz-qualify-step');
    var questionId = step.getAttribute('data-question-id');
    var selected = step.querySelectorAll('.obz-choice');
    Array.prototype.forEach.call(selected, function (choice) {
      choice.classList.toggle('is-selected', choice === button);
      choice.setAttribute('aria-checked', choice === button ? 'true' : 'false');
    });
    answers[questionId] = button.getAttribute('data-value');
    track('dtc_qualifier_answer', {
      step: currentStep + 1,
      question_id: questionId,
      answer: answers[questionId],
      answer_qualifies: button.getAttribute('data-qualifies') === 'true'
    });
    window.setTimeout(function () {
      if (currentStep < steps.length - 1) showStep(currentStep + 1);
      else finish();
    }, 180);
  }

  function answerUrl() {
    var value = cleanUrl(urlInput.value);
    if (!isValidStoreUrl(value)) {
      urlError.classList.add('is-visible');
      urlInput.focus();
      track('dtc_qualifier_url_error', { step: currentStep + 1, question_id: 'website_url' });
      return;
    }
    urlError.classList.remove('is-visible');
    answers.website_url = value;
    track('dtc_qualifier_answer', {
      step: currentStep + 1,
      question_id: 'website_url',
      answer: value,
      answer_qualifies: true
    });
    showStep(currentStep + 1);
  }

  function isQualified() {
    var revenueQualified = ['500k_1m', '1m_3m', '3m_10m', '10m_plus'].indexOf(answers.annual_revenue) > -1;
    var teamQualified = ['10_15', '16_50', '51_plus'].indexOf(answers.team_size) > -1;
    return revenueQualified && teamQualified && isValidStoreUrl(answers.website_url);
  }

  function calendarWithLeadData() {
    var params = new URLSearchParams({
      source: 'dtc_qualifier',
      session_id: leadSessionId,
      annual_revenue: answers.annual_revenue,
      team_size: answers.team_size,
      website_url: answers.website_url
    });
    return calendarUrl + (calendarUrl.indexOf('?') > -1 ? '&' : '?') + params.toString();
  }

  function finish() {
    var qualified = isQualified();
    var result = qualified ? 'qualified' : 'not_qualified';
    track('dtc_qualifier_complete', {
      result: result,
      qualified: qualified
    });
    form.hidden = true;
    if (progressLabel) progressLabel.textContent = qualified ? 'Qualified' : 'Not a fit yet';
    if (progressBar) progressBar.style.width = '100%';

    if (qualified) {
      calendarLink.href = calendarWithLeadData();
      qualifiedPanel.hidden = false;
      track('dtc_qualifier_calendar_shown', { result: result });
      return;
    }

    window.setTimeout(function () {
      window.location.href = waitlistUrl + '?source=dtc_qualifier&fit=not_yet';
    }, 450);
  }

  form.addEventListener('click', function (event) {
    var choice = event.target.closest('.obz-choice');
    if (choice) {
      answerChoice(choice);
      return;
    }
    if (event.target.closest('.obz-next-button')) {
      answerUrl();
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
  });

  if (urlInput) {
    urlInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        answerUrl();
      }
    });
    urlInput.addEventListener('input', function () {
      urlError.classList.remove('is-visible');
    });
  }

  showStep(0);
})();
