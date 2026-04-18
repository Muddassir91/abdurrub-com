/* =========================================================
   Muddassir | Portfolio
   ========================================================= */

(function () {
  'use strict';

  // -------- Reveal on scroll --------
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          if (entry.target.classList.contains('timeline')) {
            entry.target.classList.add('in-view');
          }
          if (entry.target.classList.contains('infographic')) {
            entry.target.classList.add('in-view');
          }
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal, .timeline, .infographic').forEach((el) => revealObserver.observe(el));

  // -------- Animated stat counters --------
  function animateCount(el) {
    const target = Number(el.dataset.target || 0);
    const decimals = Number(el.dataset.decimals || 0);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1600;
    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = target * eased;
      el.textContent = prefix + value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          countObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );
  document.querySelectorAll('[data-target]').forEach((el) => countObserver.observe(el));

  // -------- Smooth scroll for anchors --------
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const id = this.getAttribute('href');
      if (id.length <= 1) return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const menu = document.querySelector('.mobile-menu');
        if (menu) menu.classList.remove('open');
      }
    });
  });

  // -------- Mobile menu toggle --------
  const menuBtn = document.querySelector('[data-menu-btn]');
  const menu = document.querySelector('.mobile-menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      menu.classList.toggle('open');
      const isOpen = menu.classList.contains('open');
      menuBtn.setAttribute('aria-expanded', String(isOpen));
    });
  }

  // -------- Marquee duplicate (seamless loop) --------
  document.querySelectorAll('.marquee-track').forEach((track) => {
    const items = Array.from(track.children);
    items.forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
  });

  // -------- Nav shadow on scroll --------
  const nav = document.querySelector('[data-nav]');
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 8) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
