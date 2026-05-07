// Mobile menu
(function(){
  var btn = document.getElementById('menuBtn');
  var menu = document.getElementById('mobileMenu');
  if (btn && menu) {
    btn.addEventListener('click', function(){
      var isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }
})();

// Nav scroll state
(function(){
  var nav = document.getElementById('nav');
  if (!nav) return;
  function onScroll(){ if (window.scrollY > 8) nav.classList.add('scrolled'); else nav.classList.remove('scrolled'); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// Reveal on scroll
(function(){
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach(function(el){ el.classList.add('visible'); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(function(el){ io.observe(el); });
})();

// Animated counter on the big-figure when it scrolls into view
(function(){
  var el = document.querySelector('.big-figure');
  if (!el || !('IntersectionObserver' in window)) return;
  var raw = el.firstChild ? (el.firstChild.textContent || '') : '';
  var match = raw.match(/\$([\d.]+)([MKB]?)/);
  if (!match) return;
  var target = parseFloat(match[1]);
  var unit = match[2] || '';
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;
  var animated = false;
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting || animated) return;
      animated = true;
      var start = performance.now();
      var dur = 1400;
      function tick(now){
        var t = Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        var val = (target * eased).toFixed(target % 1 ? 2 : 0);
        if (target >= 1) val = parseFloat(val).toFixed(target % 1 ? 2 : 0);
        el.firstChild.nodeValue = '$' + val + unit;
        if (t < 1) requestAnimationFrame(tick);
        else el.firstChild.nodeValue = '$' + target + unit;
      }
      requestAnimationFrame(tick);
      io.unobserve(el);
    });
  }, { threshold: 0.4 });
  // Start the value at 0 so the animation has somewhere to count from
  el.firstChild.nodeValue = '$0' + unit;
  io.observe(el);
})();

// Lightbox
(function(){
  var modal = document.getElementById('lightbox');
  var img = document.getElementById('lightboxImg');
  var closeBtn = document.getElementById('lightboxClose');
  if (!modal || !img) return;
  function open(src){ img.src = src; modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close(){ modal.classList.remove('open'); img.src = ''; document.body.style.overflow = ''; }
  document.querySelectorAll('[data-lightbox]').forEach(function(el){
    el.addEventListener('click', function(e){
      e.preventDefault();
      var src = el.getAttribute('data-lightbox');
      if (src) open(src);
    });
  });
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
})();
