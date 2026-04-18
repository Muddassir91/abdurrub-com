# abdurrub.com — Muddassir Abdur Rub

Personal site for Muddassir Abdur Rub, Retention Strategist.

Static HTML, Tailwind via CDN, vanilla JS. No build step.

---

## File structure

```
Portfolio-Website/
├── CNAME                       custom domain for GitHub Pages (abdurrub.com)
├── index.html                  homepage
├── README.md
├── css/
│   └── styles.css              design system + animations
├── js/
│   └── main.js                 reveal, counters, mobile menu, marquee
├── images/
│   └── Mud-website-image.png   headshot
└── pages/
    ├── email-marketing.html
    ├── creative-strategy.html
    ├── blog.html               blog index (empty state)
    └── blog/
        └── _template.html      copy this to publish a new post
```

---

## Local preview

```bash
cd Portfolio-Website
python3 -m http.server 8000
```

Open http://localhost:8000/

---

## Deploy to GitHub Pages on abdurrub.com

1. Create a new GitHub repo (suggested name: `abdurrub-com` or `portfolio`).
2. Push the contents of this folder to the `main` branch.
3. In the repo: **Settings → Pages**.
   - Source: **Deploy from a branch**
   - Branch: `main` / root
4. The `CNAME` file is already set to `abdurrub.com`. GitHub Pages will pick it up.
5. At your domain registrar (where `abdurrub.com` is bought), set DNS:
   - `A` records pointing to GitHub's IPs (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`)
   - `CNAME` for `www` pointing to `<your-username>.github.io`
6. Wait 10–60 minutes for DNS to propagate. Site will be live at https://abdurrub.com.
7. Enable **Enforce HTTPS** in Settings → Pages once the cert is issued.

---

## Publishing a blog post

1. Copy `pages/blog/_template.html` → rename to your post slug, e.g. `pages/blog/retention-math.html`.
2. Open the new file. Replace every `{{ TOKEN }}` placeholder (title, summary, slug, date, body).
3. Open `pages/blog.html`. Inside the `<!-- POSTS -->` section, remove or hide the empty-state card and add a new `<article>` block linking to the post (a commented template is provided in the file).
4. Commit + push. The post is live in under a minute.

Send me the written post text, the slug you want, and a category — I will drop it in.

---

## What lives where

| Element | Location |
|---|---|
| Hero copy | `index.html` (top section) |
| Story / Who am I | `index.html` (`#about`) |
| Case studies | `index.html` (`#case-studies`) |
| Trust marquee | `index.html` (`.trust-strip`) |
| Calendar link | search-replace `calendar.app.google/LEcHPfT7csau1WCQ7` |
| CSOS quiz link | search-replace `adscreativestrategy.com/quiz` |
| Person schema | `<script type="application/ld+json">` block in `index.html` |
| Trust badge names | `index.html` (`.marquee-track`) |

---

## Voice rules baked in

- No em dashes or en dashes
- Active voice
- Reader-first language
- No "leverage", "dive deep", "game-changer", "revolutionary"
- No corporate passive
- Short, punchy sentences
- Marketer / direct response marketer / retention strategist (never "copywriter" in positioning)

---

## Performance

- No build step, no framework
- Tailwind via CDN (fine for a small site, can be swapped for compiled Tailwind later if needed)
- Inter + Archivo via Google Fonts with preconnect
- All SVG infographics inline (no extra HTTP requests)
- Mobile responsive, reduced-motion safe
