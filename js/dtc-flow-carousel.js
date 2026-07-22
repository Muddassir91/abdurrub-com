(function () {
  var carousel = document.querySelector('[data-obz-carousel]');
  if (!carousel) return;

  var slides = Array.prototype.slice.call(carousel.querySelectorAll('[data-flow-slide]'));
  var prev = carousel.querySelector('[data-obz-prev]');
  var next = carousel.querySelector('[data-obz-next]');
  var current = carousel.querySelector('[data-obz-current]');
  var total = carousel.querySelector('[data-obz-total]');
  var dotsWrap = carousel.querySelector('[data-obz-dots]');
  var index = 0;
  var previousIndex = 0;
  var locked = false;
  var initialized = false;
  var autoTimer = null;
  var autoMs = 4000;

  if (total) total.textContent = String(slides.length).padStart(2, '0');

  function makeDots() {
    if (!dotsWrap) return;
    slides.forEach(function (_, dotIndex) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Show flow ' + (dotIndex + 1));
      button.addEventListener('click', function () {
        go(dotIndex);
      });
      dotsWrap.appendChild(button);
    });
  }

  function scheduleAuto() {
    window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(function () {
      if (!document.hidden) show(index + 1);
      scheduleAuto();
    }, autoMs);
  }

  function go(nextIndex) {
    show(nextIndex);
    scheduleAuto();
  }

  function show(nextIndex) {
    if (locked || (initialized && nextIndex === index)) return;
    locked = true;
    initialized = true;
    previousIndex = index;
    index = (nextIndex + slides.length) % slides.length;
    slides.forEach(function (slide, slideIndex) {
      slide.classList.remove('is-active', 'is-exiting-left', 'is-entering-right');
      if (slideIndex === previousIndex && previousIndex !== index) {
        slide.classList.add('is-exiting-left');
      }
      if (slideIndex === index) {
        slide.classList.add('is-active', 'is-entering-right');
      }
    });
    if (current) current.textContent = String(index + 1).padStart(2, '0');
    if (dotsWrap) {
      Array.prototype.forEach.call(dotsWrap.children, function (dot, dotIndex) {
        dot.classList.toggle('is-active', dotIndex === index);
      });
    }
    window.setTimeout(function () {
      locked = false;
    }, 520);
  }

  makeDots();
  if (prev) prev.addEventListener('click', function () { go(index - 1); });
  if (next) next.addEventListener('click', function () { go(index + 1); });
  document.addEventListener('visibilitychange', scheduleAuto);
  show(0);
  scheduleAuto();
})();
