/* Mobile nav for the system.css pages.
   Injects a hamburger + dropdown panel so Home and every page are
   reachable on phones. Self-contained: also injects its own styles. */
(function () {
  'use strict';

  function init() {
    var nav = document.querySelector('.nav');
    var inner = nav && nav.querySelector('.nav-inner');
    var links = nav && nav.querySelector('.nav-links');
    if (!nav || !inner || !links) return;
    if (nav.querySelector('.nav-burger')) return; // already initialised

    // ---- styles ----
    var css = ''
      + '.nav-burger{display:none}'
      + '.nav-mobile-panel{display:none}'
      + '@media(max-width:768px){'
      + '.nav-inner{position:relative}'
      + '.nav .dropdown-menu{display:none!important}' // hide desktop hover submenu (replaced by mobile panel)
      + '.nav-burger{display:inline-flex;align-items:center;justify-content:center;'
      + 'width:44px;height:44px;margin-left:4px;padding:0;border:0;background:transparent;'
      + 'cursor:pointer;color:var(--ink,#14323a);-webkit-tap-highlight-color:transparent}'
      + '.nav-burger svg{width:26px;height:26px;display:block}'
      + '.nav-mobile-panel{position:absolute;top:100%;left:0;right:0;flex-direction:column;'
      + 'align-items:stretch;background:#fff;border-bottom:1px solid var(--rule,#e7e2d9);'
      + 'box-shadow:0 14px 30px rgba(0,0,0,.10);padding:6px 0;'
      + 'max-height:0;overflow:hidden;transition:max-height .22s ease}'
      + '.nav.nav-open .nav-mobile-panel{display:flex}'
      + '.nav-mobile-panel a{display:block;padding:13px 22px;text-decoration:none;'
      + 'color:var(--ink,#14323a);font-family:"Changa One","Impact",sans-serif;'
      + 'letter-spacing:.06em;font-size:1rem;border-bottom:1px solid rgba(0,0,0,.05)}'
      + '.nav-mobile-panel a:last-child{border-bottom:0}'
      + '.nav-mobile-panel a:hover{color:var(--teal,#0f766e)}'
      + '.nav-mobile-panel a.nav-cta{margin:10px 18px 6px;border-radius:4px;text-align:center;'
      + 'background:var(--teal,#0f766e);color:#fff;border-bottom:0}'
      + '}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // ---- build flat link list (dedupe by href, skip the bar CTA) ----
    var seen = {};
    var items = [{ href: '/', text: 'Home' }];
    Array.prototype.forEach.call(links.querySelectorAll('a'), function (a) {
      if (a.classList.contains('nav-cta')) return;
      var href = a.getAttribute('href');
      if (!href || seen[href]) return;
      seen[href] = true;
      items.push({ href: href, text: (a.textContent || '').trim() });
    });
    var cta = links.querySelector('a.nav-cta');

    var panel = document.createElement('div');
    panel.className = 'nav-mobile-panel nav-links-mobile';
    items.forEach(function (it) {
      var a = document.createElement('a');
      a.href = it.href;
      a.textContent = it.text;
      panel.appendChild(a);
    });
    if (cta) {
      var c = document.createElement('a');
      c.href = cta.getAttribute('href');
      c.textContent = (cta.textContent || '').trim();
      c.className = 'nav-cta';
      panel.appendChild(c);
    }

    // ---- hamburger button ----
    var btn = document.createElement('button');
    btn.className = 'nav-burger';
    btn.setAttribute('aria-label', 'Menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

    inner.appendChild(btn);
    nav.appendChild(panel);

    function setOpen(open) {
      nav.classList.toggle('nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
      panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0px';
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!nav.classList.contains('nav-open'));
    });
    panel.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setOpen(false);
    });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('nav-open') && !nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) setOpen(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
