document.addEventListener('DOMContentLoaded', function () {
  // Initialize multi-link elements
  initMultiLinks();
  initReferenceIndex();
  initGuides();
  // Initialize Twitter widget
  loadTwitterWidget();
  // Initialize Instagram widget
  loadInstagramWidget();
});

async function initReferenceIndex() {
  const categoryList = document.querySelector('#category-list');
  if (!categoryList) return;

  try {
    const response = await fetch('./content/content2_with_titles.csv');
    if (!response.ok) throw new Error(`CSV request failed with ${response.status}`);

    const rows = parseCsv(await response.text());
    // Two nesting styles are understood:
    //  - dashes:  "Category", "- Subcategory", "-- Sub-subcategory" (divider rows, in order)
    //  - paths:   "Category / Subcategory / Sub-subcategory"
    // Link rows attach to the path in their Section column if it has one, otherwise to the divider above.
    const root = { children: new Map(), links: [] };
    const stack = [root];
    let current = null;

    const childOf = (parent, name) => {
      if (!parent.children.has(name)) parent.children.set(name, { children: new Map(), links: [] });
      return parent.children.get(name);
    };
    const nodeFromPath = path =>
      path.split('/').map(part => part.trim()).filter(Boolean).reduce((node, name) => childOf(node, name), root);
    const addNode = rawName => {
      if (rawName.includes('/')) return nodeFromPath(rawName);
      const [, dashes, name] = rawName.match(/^(-*)\s*(.*)$/);
      const depth = Math.min(dashes.length, stack.length - 1);
      const node = childOf(stack[depth], name);
      stack.length = depth + 1;
      stack.push(node);
      return node;
    };

    rows.slice(1).forEach(row => {
      const [section, type, content, , title = ''] = row.map(value => value.trim());
      const divider = section.match(/^---\s*(.*?)\s*---$/);
      if (divider) {
        current = addNode(divider[1]);
        return;
      }
      if (type.toLowerCase() !== 'link' || !content) return;
      const target = section.includes('/') ? nodeFromPath(section) : current || addNode(section || 'Ungrouped');
      target.links.push({ url: content, title });
    });

    const categories = root.children;
    renderCategories(categoryList, categories);
  } catch (error) {
    console.error('Unable to load the research index:', error);
    categoryList.innerHTML = '';
    const message = document.createElement('p');
    message.className = 'reference-index__status';
    message.textContent = 'The link collection could not be loaded.';
    categoryList.appendChild(message);
  }
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const nextCharacter = csv[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === ',' && !insideQuotes) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(field);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Force-directed graph: Category — Subcategory — Link. Top-level categories are
// visible at first; clicking a node reveals its children (and closes its siblings).
// d3-force handles layout; each tick we move absolutely-positioned divs and redraw SVG lines.
// Top-level categories whose children only appear once clicked
// Images shown in the empty quadrant while a section is active. Keys are category paths
// (longest matching prefix wins); a sentence can also override with data-image.
const SECTION_IMAGES = {
  'Websites of nature': './content/Websitesofnature.jpg',
  'Link rot / Benefits of letting go of': './content/benefitsoflettinggo.jpg',
  'Internet in organic': './content/internetinorganic.jpg',
};
function imageForPath(path) {
  const norm = p => p.split('/').map(s => s.trim().toLowerCase()).join(' / ');
  const target = norm(path);
  const key = Object.keys(SECTION_IMAGES)
    .filter(k => target.startsWith(norm(k)))
    .sort((a, b) => b.length - a.length)[0];
  return key ? SECTION_IMAGES[key] : null;
}

const PREVIEW_EXCLUDED = new Set(['Internet in organic']);

function renderCategories(container, categories) {
  container.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'graph-lines');
  container.appendChild(svg);

  // Turn the Map tree into plain items: { id, type, title, url, children }
  let counter = 0;
  const toItem = (name, data, parent) => {
    const item = { id: `n${counter++}`, type: 'category', title: name, parent, children: [] };
    data.children.forEach((child, childName) => item.children.push(toItem(childName, child, item)));
    data.links.forEach(({ url, title }) =>
      item.children.push({ id: `n${counter++}`, type: 'link', title: title || formatLinkLabel(url), url, parent: item, children: [] })
    );
    return item;
  };
  const tops = [];
  categories.forEach((data, name) => tops.push(toItem(name, data, null)));

  const expanded = new Set();
  const nodes = [];
  let links = [];
  const els = new Map(); // id -> div
  const paths = new Map(); // "src>tgt" -> svg line

  const size = () => ({ w: container.clientWidth, h: container.clientHeight });

  const simulation = d3
    .forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(l => (l.target.type === 'link' ? 150 : 120)).strength(0.35))
    .force('charge', d3.forceManyBody().strength(-150).distanceMin(10).distanceMax(300))
    .force('collide', rectCollide(10))
    .force('x', d3.forceX().strength(0.008))
    .force('y', d3.forceY().strength(0.012))
    .alphaDecay(0.04)
    .velocityDecay(0.6)
    .on('tick', tick);

  // Box-shaped collision using each element's real size, so cards never overlap
  function rectCollide(pad) {
    let ns = [];
    const force = () => {
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            const ox = (a.w + b.w) / 2 + pad - Math.abs(b.x - a.x);
            const oy = (a.h + b.h) / 2 + pad - Math.abs(b.y - a.y);
            if (ox <= 0 || oy <= 0) continue;
            const aw = a.fx != null ? 0 : b.fx != null ? 1 : 0.5; // share of the push taken by a
            const bw = 1 - aw;
            if (ox < oy) {
              const s = Math.sign(b.x - a.x) || 1;
              if (a.fx == null) a.x -= s * ox * aw;
              if (b.fx == null) b.x += s * ox * bw;
            } else {
              const s = Math.sign(b.y - a.y) || 1;
              if (a.fy == null) a.y -= s * oy * aw;
              if (b.fy == null) b.y += s * oy * bw;
            }
          }
        }
      }
    };
    force.initialize = n => (ns = n);
    return force;
  }

  // A picture parked in the quadrant opposite the active node. It is a pinned node in the
  // simulation, so graph nodes are pushed out of its way.
  let imgNode = null;
  let imgEl = null;
  let imgUrl = null;
  function setImage(url) {
    if (url === imgUrl) return;
    imgUrl = url;
    if (imgEl) {
      const old = imgEl;
      old.classList.remove('graph-image--visible');
      setTimeout(() => old.remove(), 500);
    }
    if (imgNode) nodes.splice(nodes.indexOf(imgNode), 1);
    imgEl = imgNode = null;
    if (!url) { simulation.nodes(nodes); simulation.alpha(0.3).restart(); return; }
    const el = document.createElement('img');
    el.className = 'graph-image';
    el.alt = '';
    el.addEventListener('load', () => {
      if (imgEl !== el) return;
      imgNode = { id: '__image', w: el.offsetWidth, h: el.offsetHeight, x: 0, y: 0, qx: 1, qy: 1 };
      nodes.push(imgNode);
      placeImage();
      simulation.nodes(nodes);
      simulation.force('link').links(links);
      simulation.alpha(0.5).restart();
      requestAnimationFrame(() => el.classList.add('graph-image--visible'));
    });
    el.src = url;
    imgEl = el;
    container.insertBefore(el, svg.nextSibling);
  }
  // choose the quadrant (of the graph panel) diagonally opposite the active node
  function placeImage(active) {
    if (!imgNode) return;
    if (active) { imgNode.qx = active.x > 0 ? -1 : 1; imgNode.qy = active.y > 0 ? -1 : 1; }
    const { w, h } = size();
    imgNode.fx = imgNode.x = imgNode.qx * w * 0.25;
    imgNode.fy = imgNode.y = imgNode.qy * h * 0.25;
    imgEl.style.left = `${w / 2 + imgNode.fx}px`;
    imgEl.style.top = `${h / 2 + imgNode.fy}px`;
  }

  function visibleItems() {
    const out = [];
    const walk = item => {
      out.push(item);
      // second-level nodes are always shown; deeper levels need their parent opened
      if (expanded.has(item.id) || (!item.parent && !PREVIEW_EXCLUDED.has(item.title))) item.children.forEach(walk);
    };
    tops.forEach(walk);
    return out;
  }

  function update() {
    const { w, h } = size();
    const items = visibleItems();
    const keep = new Set(items.map(i => i.id));

    // remove vanished nodes
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (!keep.has(nodes[i].id) && nodes[i] !== imgNode) {
        const gone = nodes[i];
        const el = els.get(gone.id);
        els.delete(gone.id);
        nodes.splice(i, 1);
        if (el) {
          // glide back into the nearest surviving ancestor, fading out, then remove
          let anc = gone.parent;
          while (anc && !keep.has(anc.id)) anc = anc.parent;
          el.classList.add('graph-node--leaving');
          el.style.pointerEvents = 'none';
          if (anc) {
            el.style.left = `${w / 2 + anc.x}px`;
            el.style.top = `${h / 2 + anc.y}px`;
          }
          setTimeout(() => el.remove(), 500);
        }
      }
    }
    // add new nodes, born at their parent's position
    const have = new Set(nodes.map(n => n.id));
    items.forEach((item, index) => {
      if (have.has(item.id)) return;
      const el = item.type === 'link' ? createLinkEl(item) : createCategoryEl(item);
      container.appendChild(el);
      els.set(item.id, el);
      item.w = el.offsetWidth;
      item.h = el.offsetHeight;
      const origin = item.parent && nodes.includes(item.parent) ? item.parent : null;
      if (origin) {
        // fan siblings out in an arc pointing away from the middle, past the parent's edge
        const sibs = origin.children;
        const k = sibs.indexOf(item);
        const base = Math.atan2(origin.y || 0.01, origin.x || 0.01);
        const spread = Math.min(Math.PI * 1.2, 0.5 * sibs.length);
        const angle = base + (sibs.length > 1 ? (k / (sibs.length - 1) - 0.5) * spread : 0);
        const dist = 12; // start tucked at the parent; springs + collision push outward
        item.x = origin.x + Math.cos(angle) * dist;
        item.y = origin.y + Math.sin(angle) * dist;
      } else {
        item.x = (seeded(index + 1) - 0.5) * w * 0.6;
        item.y = (seeded(index + 7) - 0.5) * h * 0.6;
      }
      nodes.push(item);
      requestAnimationFrame(() => el.classList.add('graph-node--visible'));
    });
    // the single open node is the deepest expanded one; its ancestors stay lit as the path
    const active = items.find(i => expanded.has(i.id) && !i.children.some(c => expanded.has(c.id)));
    const activeId = active ? active.id : null;
    placeImage(active);
    const pathIds = new Set();
    for (let p = active; p; p = p.parent) pathIds.add(p.id);
    items.forEach(item => {
      const el = els.get(item.id);
      if (el) el.classList.toggle('is-open', expanded.has(item.id));
      // in focus = an opened node or a child of one; everything else greys out once something is open
      const focused = expanded.size === 0 || pathIds.has(item.id) || (item.parent && item.parent.id === activeId);
      item.focused = !!focused;
      if (el) el.classList.toggle('graph-node--gray', !focused);
      const open = expanded.has(item.id);
      if (open) { item.fx = item.x; item.fy = item.y; } else { item.fx = item.fy = null; }
    });

    links.length = 0;
    items.forEach(item => item.parent && links.push({ source: item.parent.id, target: item.id }));

    // rebuild svg lines
    paths.forEach(p => p.remove());
    paths.clear();
    links.forEach(l => {
      const line = document.createElementNS(NS, 'line');
      svg.appendChild(line);
      paths.set(`${l.source}>${l.target}`, line);
      const t = items.find(i => i.id === l.target);
      if (t && !(t.focused && t.parent.focused)) line.setAttribute('class', 'is-gray');
    });

    simulation.nodes(nodes);
    simulation.force('link').links(links);
    simulation.alpha(0.5).restart();
  }

  function createCategoryEl(item) {
    const el = document.createElement('div');
    el.className = `graph-node graph-node--category${item.parent ? '' : ' graph-node--top'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'node__label category__name';
    button.textContent = item.title;
    if (item.children.length === 0) {
      button.disabled = true;
    } else {
      button.addEventListener('click', () => toggle(item));
    }
    el.appendChild(button);
    return el;
  }

  function createLinkEl(item) {
    const link = document.createElement('a');
    link.className = 'graph-node graph-node--link node__link card';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = item.url;
    const titleEl = document.createElement('span');
    titleEl.className = 'card__title';
    titleEl.textContent = `${item.title} `;
    const arrow = document.createElement('span');
    arrow.className = 'card__arrow';
    arrow.textContent = '↗';
    titleEl.appendChild(arrow);
    link.appendChild(titleEl);
    return link;
  }

  function collapse(item) {
    expanded.delete(item.id);
    item.children.forEach(collapse);
  }

  function toggle(item) {
    const siblings = item.parent ? item.parent.children : tops;
    const willOpen = !expanded.has(item.id);
    siblings.forEach(s => s !== item && collapse(s));
    if (willOpen) expanded.add(item.id); else collapse(item);
    update();
  }

  function tick() {
    const { w, h } = size();
    const cx = w / 2;
    const cy = h / 2;
    placeImage();
    nodes.forEach(d => {
      const el = els.get(d.id);
      if (!el) return;
      const hw = el.offsetWidth / 2;
      const hh = el.offsetHeight / 2;
      d.x = Math.max(-cx + hw + 4, Math.min(cx - hw - 4, d.x));
      d.y = Math.max(-cy + hh + 4, Math.min(cy - hh - 4, d.y));
      el.style.left = `${cx + d.x}px`;
      el.style.top = `${cy + d.y}px`;
    });
    links.forEach(l => {
      const line = paths.get(`${l.source.id ?? l.source}>${l.target.id ?? l.target}`);
      if (!line || typeof l.source !== 'object') return;
      line.setAttribute('x1', cx + l.source.x);
      line.setAttribute('y1', cy + l.source.y);
      line.setAttribute('x2', cx + l.target.x);
      line.setAttribute('y2', cy + l.target.y);
    });
  }

  window.addEventListener('resize', () => simulation.alpha(0.3).restart());
  container._graph = {
    // path like "Link rot / Realities of link rot"; opens each level, then everything under the last one
    openCategory(path, image) {
      setImage(image || imageForPath(path));
      const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const chain = [];
      let level = tops;
      for (const part of path.split('/')) {
        const hit = level.find(i => norm(i.title).startsWith(norm(part)));
        if (!hit) break;
        chain.push(hit);
        level = hit.children;
      }
      if (!chain.length) return;
      const wanted = new Set(chain.map(i => i.id));
      const gather = item => { if (item.children.length) wanted.add(item.id); item.children.forEach(gather); };
      const same = [...wanted].every(id => expanded.has(id));
      let open = 0;
      expanded.forEach(() => open++);
      if (same && open === wanted.size) return;
      tops.forEach(t => t !== chain[0] && collapse(t));
      chain.forEach((item, i) => {
        const next = chain[i + 1];
        if (next) item.children.forEach(c => c !== next && collapse(c));
      });
      wanted.forEach(id => expanded.add(id));
      update();
    },
  };
  update();
}

// Stable pseudo-random number in [0, 1)
function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}


function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatLinkLabel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const finalPart = pathParts.at(-1);

    if (!finalPart || finalPart.toLowerCase() === host.toLowerCase()) return host;

    const readablePath = decodeURIComponent(finalPart)
      .replace(/\.(html?|php)$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();

    return readablePath && readablePath.length < 54 ? `${host} — ${readablePath}` : host;
  } catch (_error) {
    return url;
  }
}

  // Configuration
const DECAY_TIME = 90000; // 90 seconds in milliseconds
  let DECAY_ENABLED = true; // Can be toggled

  function initMultiLinks() {
  // Find all elements with data-multi-links attribute
    const multiLinkElements = document.querySelectorAll('[data-multi-links]');
    
  // Add click handler to each element
    multiLinkElements.forEach(element => {
    element.style.cursor = 'pointer';
      element.classList.add('multi-link');
      
    element.addEventListener('click', function(event) {
      // Prevent default link behavior
      event.preventDefault();
      
      try {
        // Parse the JSON data
        const linksData = JSON.parse(element.getAttribute('data-multi-links'));
        
        // Handle single link or multiple links
        if (linksData.length === 1) {
          const { url, description } = linksData[0];
          createIframe(url, description, 0, element);
        } else if (linksData.length > 1) {
          // Create iframes for each link with proper index
          linksData.forEach((linkData, index) => {
            const { url, description } = linkData;
            createIframe(url, description, index, element);
          });
        }
        else if (linksData.length === 0) {
          // If no links, just show the description
          const description = element.getAttribute('data-description') || element.textContent;
          element.classList.add('multi-link-active');
          setTimeout(() => {
            element.classList.remove('multi-link-active');
          }, DECAY_TIME);
        }
      } catch (error) {
        console.error('Error parsing multi-links data:', error);
      }
    });
    });
  }

  function showLinkMenu(event, element, links) {
    event.stopPropagation();
    
    // Remove any existing menus
    const existingMenus = document.querySelectorAll('.link-menu');
    existingMenus.forEach(menu => menu.remove());
    
    // Create menu element
    const menu = document.createElement('div');
    menu.className = 'link-menu';
    
    // Add links to the menu
    links.forEach(link => {
      const linkElement = document.createElement('a');
      linkElement.href = '#';
      linkElement.textContent = link.title || link.url;
    linkElement.addEventListener('click', e => {
        e.preventDefault();
        menu.remove();
        createIframe(link.url, link.title || element.textContent);
      });
      menu.appendChild(linkElement);
    });
    
    // Position the menu near the element
    const rect = element.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + window.scrollY}px`;
    
    // Add to body and display
    document.body.appendChild(menu);
    menu.style.display = 'block';
    
    // Close menu when clicking elsewhere
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== element) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }

// Add Twitter widget script
function loadTwitterWidget() {
  const script = document.createElement('script');
  script.src = 'https://platform.twitter.com/widgets.js';
  script.async = true;
  document.head.appendChild(script);
}

// Extract tweet ID from URL
function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

// Check if URL is a tweet
function isTweetUrl(url) {
  return url.includes('twitter.com') || url.includes('x.com');
}

// Create tweet embed
function createTweetEmbed(url, description, index, clickedElement) {
    const container = document.createElement('div');
  container.className = 'iframe-container tweet-container';
    
  // Create header
    const header = document.createElement('div');
    header.className = 'iframe-header';
    
  // Create controls container
  const controls = document.createElement('div');
  controls.className = 'iframe-controls';

  // Create open in new tab button
  const newTabButton = document.createElement('button');
  newTabButton.className = 'iframe-control';
  newTabButton.innerHTML = '↗';
  newTabButton.title = 'Open in new tab';
  newTabButton.onclick = () => {
    window.open(url, '_blank');
  };

  // Create close button
  const closeButton = document.createElement('button');
  closeButton.className = 'iframe-control';
  closeButton.innerHTML = '×';
  closeButton.onclick = () => {
    container.remove();
  };

  // Add buttons to controls
  controls.appendChild(newTabButton);
  controls.appendChild(closeButton);

  // Add controls to header
  header.appendChild(controls);

  // Create tweet container
  const tweetContainer = document.createElement('div');
  tweetContainer.className = 'tweet-content';

  // Add all elements to container
  container.appendChild(header);
  container.appendChild(tweetContainer);

  // Add description as caption if it exists
  if (description) {
    const caption = document.createElement('div');
    caption.className = 'iframe-caption';
    caption.textContent = description;
    container.appendChild(caption);
  }

  // Add to document
  document.body.appendChild(container);

  // Make draggable
  makeDraggable(container, header);

  // Position near the clicked element
  positionNearElement(container, clickedElement);

  // Embed the tweet
  const tweetId = extractTweetId(url);
  if (tweetId) {
    twttr.widgets
      .createTweet(tweetId, tweetContainer, {
        align: 'center',
      })
      .catch(err => {
        console.error('Error embedding tweet:', err);
      });
  }

  // Set up decay timer if enabled
  if (DECAY_ENABLED) {
    const startTime = Date.now();
    const fadeInterval = setInterval(() => {
      if (document.body.contains(container)) {
        const elapsed = Date.now() - startTime;
        const opacity = Math.max(0, 1 - elapsed / DECAY_TIME);
        container.style.opacity = opacity;

        if (opacity <= 0) {
          clearInterval(fadeInterval);
          container.remove();
        }
      } else {
        clearInterval(fadeInterval);
      }
    }, 50);
  }

  return container;
}

// Add Instagram embed script
function loadInstagramWidget() {
  const script = document.createElement('script');
  script.src = '//www.instagram.com/embed.js';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

// Extract Instagram post ID from URL
function extractInstagramId(url) {
  // Handle both regular posts and reels
  const regex = /instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Check if URL is an Instagram post
function isInstagramUrl(url) {
  return url.includes('instagram.com');
}

// Create Instagram embed
function createInstagramEmbed(url, description, index, clickedElement) {
  const container = document.createElement('div');
  container.className = 'iframe-container instagram-container';
  
  // Create header
  const header = document.createElement('div');
  header.className = 'iframe-header';
  
  // Create controls container
    const controls = document.createElement('div');
    controls.className = 'iframe-controls';
    
  // Create open in new tab button
  const newTabButton = document.createElement('button');
  newTabButton.className = 'iframe-control';
  newTabButton.innerHTML = '↗';
  newTabButton.title = 'Open in new tab';
  newTabButton.onclick = () => {
    window.open(url, '_blank');
  };
  
  // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'iframe-control';
  closeButton.innerHTML = '×';
  closeButton.onclick = () => {
    container.remove();
  };
  
  // Add buttons to controls
  controls.appendChild(newTabButton);
    controls.appendChild(closeButton);
  
  // Add controls to header
    header.appendChild(controls);
    
  // Create Instagram container
  const instagramContainer = document.createElement('div');
  instagramContainer.className = 'instagram-content';
  
  // Create loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.textContent = 'Loading Instagram content...';
  loadingIndicator.style.padding = '20px';
  loadingIndicator.style.color = '#888';
  instagramContainer.appendChild(loadingIndicator);
  
  // Create actual Instagram embed
  const postId = extractInstagramId(url);
  if (postId) {
    const blockquote = document.createElement('blockquote');
    blockquote.className = 'instagram-media';
    blockquote.setAttribute('data-instgrm-permalink', url);
    blockquote.setAttribute('data-instgrm-version', '14');
    blockquote.style.margin = '0';
    blockquote.style.width = '100%';
    
    // Add some placeholder content until Instagram loads
    blockquote.innerHTML = `<div style="padding: 16px; background: #f8f8f8; text-align: center;">
      <p>Instagram post by @${url.split('/')[3]}</p>
      <p><a href="${url}" target="_blank" rel="noopener">View on Instagram</a></p>
    </div>`;
    
    instagramContainer.appendChild(blockquote);
  }
  
  // Add all elements to container
    container.appendChild(header);
  container.appendChild(instagramContainer);
  
  // Add description as caption if it exists
  if (description) {
    const caption = document.createElement('div');
    caption.className = 'iframe-caption';
    caption.textContent = description;
    container.appendChild(caption);
  }
  
  // Add to document
    document.body.appendChild(container);
    
  // Make draggable
  makeDraggable(container, header);
  
  // Position near the clicked element
  positionNearElement(container, clickedElement);
  
  // Process Instagram embeds with retry
  function processEmbed() {
    if (window.instgrm) {
      window.instgrm.Embeds.process();
      // Remove loading indicator after processing
      if (loadingIndicator.parentNode) {
        loadingIndicator.parentNode.removeChild(loadingIndicator);
      }
    } else {
      // If Instagram embed script hasn't loaded yet, try again after a delay
      setTimeout(processEmbed, 500);
    }
  }
  
  // Start processing
  processEmbed();
  
  // Watch for Instagram iframe loading and resize container if needed
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Check if an iframe was added
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.tagName === 'IFRAME') {
            // Give iframe time to load and adjust its height
            setTimeout(() => {
              const iframe = node;
              if (iframe && iframe.clientHeight > 0) {
                // Adjust container height if needed
                const totalHeight = header.offsetHeight + iframe.clientHeight;
                if (description) {
                  const caption = container.querySelector('.iframe-caption');
                  if (caption) {
                    totalHeight += caption.offsetHeight;
                  }
                }
                container.style.height = `${Math.min(800, totalHeight)}px`;
              }
            }, 1000);
          }
        }
      }
    }
  });
  
  // Start observing the container for added iframes
  observer.observe(instagramContainer, { childList: true, subtree: true });
  
  // Set up decay timer if enabled
  if (DECAY_ENABLED) {
    const startTime = Date.now();
    const fadeInterval = setInterval(() => {
      if (document.body.contains(container)) {
        const elapsed = Date.now() - startTime;
        const opacity = Math.max(0, 1 - (elapsed / DECAY_TIME));
        container.style.opacity = opacity;
        
        if (opacity <= 0) {
          clearInterval(fadeInterval);
          container.remove();
          observer.disconnect(); // Clean up observer
        }
      } else {
        clearInterval(fadeInterval);
        observer.disconnect(); // Clean up observer
      }
    }, 50);
  }
  
  return container;
}

// Update the main createIframe function to handle Instagram embeds
function createIframe(url, description, index, clickedElement) {
  // If URL is empty, just show the description
  if (!url || url.trim() === '') {
    const container = document.createElement('div');
    container.className = 'iframe-container';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'iframe-header';
    
    // Create controls container
    const controls = document.createElement('div');
    controls.className = 'iframe-controls';
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'iframe-control';
    closeButton.innerHTML = '×';
    closeButton.onclick = () => {
      container.remove();
    };
    
    // Add button to controls
    controls.appendChild(closeButton);
    
    // Add controls to header
    header.appendChild(controls);
    
    // Create content div
    const content = document.createElement('div');
    content.className = 'iframe-content';
    content.style.paddingTop = '20px';
    content.style.paddingBottom = '20px';
    content.style.height = '100%';
    content.style.textAlign = 'center';
    content.style.color = '#666';
    content.textContent = description || 'No content available';
    
    // Add all elements to container
    container.appendChild(header);
    container.appendChild(content);
    
    // Add to document
    document.body.appendChild(container);
    
    // Make draggable
    makeDraggable(container, header);
    
    // Position near the clicked element
    positionNearElement(container, clickedElement);
    
    // Set up decay timer if enabled
    if (DECAY_ENABLED) {
      const startTime = Date.now();
      const fadeInterval = setInterval(() => {
        if (document.body.contains(container)) {
          const elapsed = Date.now() - startTime;
          const opacity = Math.max(0, 1 - (elapsed / DECAY_TIME));
          container.style.opacity = opacity;
          
          if (opacity <= 0) {
            clearInterval(fadeInterval);
            container.remove();
          }
        } else {
          clearInterval(fadeInterval);
        }
      }, 50);
    }
    
    return container;
  }
  
  if (isTweetUrl(url)) {
    return createTweetEmbed(url, description, index, clickedElement);
  } else if (isInstagramUrl(url)) {
    return createInstagramEmbed(url, description, index, clickedElement);
  }
  
  const container = document.createElement('div');
  container.className = 'iframe-container';

  // Create header
  const header = document.createElement('div');
  header.className = 'iframe-header';

  // Create controls container
  const controls = document.createElement('div');
  controls.className = 'iframe-controls';

  // Create open in new tab button
  const newTabButton = document.createElement('button');
  newTabButton.className = 'iframe-control';
  newTabButton.innerHTML = '↗';
  newTabButton.title = 'Open in new tab';
  newTabButton.onclick = () => {
    window.open(url, '_blank');
  };

  // Create close button
  const closeButton = document.createElement('button');
  closeButton.className = 'iframe-control';
  closeButton.innerHTML = '×';
  closeButton.onclick = () => {
    container.remove();
  };

  // Add buttons to controls
  controls.appendChild(newTabButton);
  controls.appendChild(closeButton);

  // Add controls to header
  header.appendChild(controls);

  // Create iframe
  const iframe = document.createElement('iframe');
  iframe.className = 'iframe-content';

  // Build the URL for the iframe - using Wayback Machine to preserve fragments
  let iframeUrl = url;

  // If the URL contains a fragment, handle it separately to preserve it
  if (url.includes('#')) {
    // Split the URL into base and fragment
    const [baseUrl, fragment] = url.split('#');
    // Only encode the base URL part and preserve the fragment
    iframeUrl = `https://web.archive.org/web/${baseUrl}#${fragment}`;
  } else {
    // No fragment, use the URL as is
    iframeUrl = `https://web.archive.org/web/${url}`;
  }

  iframe.src = iframeUrl;

  // Add all elements to container
  container.appendChild(header);
  container.appendChild(iframe);

  // Add description as caption if it exists
  if (description) {
    const caption = document.createElement('div');
    caption.className = 'iframe-caption';
    caption.textContent = description;
    container.appendChild(caption);
  }

  // Add to document
  document.body.appendChild(container);
    
    // Make draggable
    makeDraggable(container, header);
    
  // Position near the clicked element
  positionNearElement(container, clickedElement);

  // Set z-index to be on top
  container.style.zIndex = getHighestZIndex();

  // Set up decay timer if enabled
    if (DECAY_ENABLED) {
    const startTime = Date.now();
    const fadeInterval = setInterval(() => {
      if (document.body.contains(container)) {
        const elapsed = Date.now() - startTime;
        const opacity = Math.max(0, 1 - (elapsed / DECAY_TIME));
        container.style.opacity = opacity;

        if (opacity <= 0) {
          clearInterval(fadeInterval);
        container.remove();
        }
      } else {
        clearInterval(fadeInterval);
      }
    }, 50);
  }

    return container;
  }
  
  function makeDraggable(element, handle) {
  let pos1 = 0,
    pos2 = 0,
    pos3 = 0,
    pos4 = 0;
    
    handle.onmousedown = dragMouseDown;
    
    function dragMouseDown(e) {
      e.preventDefault();
      // Get mouse position at start
      pos3 = e.clientX;
      pos4 = e.clientY;
      
      // Bring to front
      element.style.zIndex = getHighestZIndex() + 1;
      
      // Mouse events
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }
    
    function elementDrag(e) {
      e.preventDefault();
      // Calculate new position
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      
      // Set new position
    element.style.top = element.offsetTop - pos2 + 'px';
    element.style.left = element.offsetLeft - pos1 + 'px';
    }
    
    function closeDragElement() {
      // Stop moving when mouse button is released
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }
  
  function getHighestZIndex() {
    return Math.max(
    ...Array.from(document.querySelectorAll('.iframe-container')).map(
      el => parseInt(window.getComputedStyle(el).zIndex) || 0
    ),
      99
    );
  }

// Function to position container near clicked element but not over main content
function positionNearElement(container, element) {
  if (!element) return;
  
  // Get element's position
  const rect = element.getBoundingClientRect();
  
  // Get window dimensions
  const windowWidth = window.innerWidth;
  
  // Get container dimensions
  const containerWidth = parseInt(getComputedStyle(container).width) || 400;
  const containerHeight = parseInt(getComputedStyle(container).height) || 500;
  
  // Use the essay's actual left-aligned bounds.
  const mainContent = document.querySelector('.app');
  const mainContentRect = mainContent ? mainContent.getBoundingClientRect() : rect;
  const mainContentLeft = mainContentRect.left;
  const mainContentRight = mainContentRect.right;
  
  // Static counter to alternate placement
  if (typeof window.iframeCounter === 'undefined') {
    window.iframeCounter = 0;
  } else {
    window.iframeCounter++;
  }
  
  // Determine available space on left and right sides
  const availableSpaceRight = windowWidth - mainContentRight - containerWidth - 40; // 40px safety margin
  const availableSpaceLeft = mainContentLeft - 40; // 40px safety margin
  
  // Determine if we should position to the left or right based on alternating pattern
  let left;
  
  if (window.iframeCounter % 2 === 0) {
    // Even count - position on the right
    // Calculate a random position within the available space on the right
    const maxRightOffset = Math.max(0, availableSpaceRight);
    const rightOffset = Math.floor(Math.random() * maxRightOffset);
    left = mainContentRight + 20 + rightOffset;
  } else {
    // Odd count - position on the left
    // Calculate a random position within the available space on the left
    const maxLeftOffset = Math.max(0, availableSpaceLeft - containerWidth);
    const leftOffset = Math.floor(Math.random() * maxLeftOffset);
    left = leftOffset + 20; // 20px minimum margin from edge
  }
  
  // Calculate absolute position
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  
  // Calculate vertical center alignment
  // Get the vertical center of the clicked element
  const elementVerticalCenter = rect.top + (rect.height / 2);
  
  // Position the iframe so its middle aligns with the element's middle
  const top = elementVerticalCenter + scrollTop - (containerHeight / 2);
  
  // Apply position
  container.style.position = 'absolute';
  container.style.left = `${left + scrollLeft}px`;
  container.style.top = `${Math.max(0, top)}px`; // Ensure it's not positioned above the page
  
  // Clear any previous right property that might have been set
  container.style.right = '';
  }


// ---- draggable guides + reading line ----
function initGuides() {
  const root = document.documentElement;
  const vHandle = document.querySelector('#split-handle');
  const hHandle = document.querySelector('#read-line');
  if (!vHandle || !hHandle) return;

  // Position state lives in JS, so dragging never depends on measuring the handle
  const state = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
  const setSplit = x => {
    state.x = Math.min(window.innerWidth * 0.75, Math.max(window.innerWidth * 0.25, x));
    root.style.setProperty('--split', `${state.x}px`);
    window.dispatchEvent(new Event('resize')); // lets the graph re-settle
  };
  const setLine = y => {
    state.y = Math.min(window.innerHeight - 20, Math.max(20, y));
    root.style.setProperty('--line-y', `${state.y}px`);
  };
  setSplit(state.x);
  setLine(state.y);
  window.addEventListener('resize', () => { setLine(state.y); });

  const drag = (handle, axis, apply) => {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const offset = (axis === 'x' ? event.clientX : event.clientY) - (axis === 'x' ? state.x : state.y);
      handle.classList.add('is-dragging');
      document.body.style.userSelect = 'none';
      const move = e => {
        apply((axis === 'x' ? e.clientX : e.clientY) - offset);
        scheduleCheck();
      };
      const up = () => {
        handle.classList.remove('is-dragging');
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  };
  drag(vHandle, 'x', setSplit);
  drag(hHandle, 'y', setLine);

  const sentences = Array.from(document.querySelectorAll('.sent[data-category]'));
  let active = null;
  let queued = false;

  function check() {
    queued = false;
    const y = hHandle.getBoundingClientRect().top + hHandle.offsetHeight / 2;
    const hit = sentences.find(el => Array.from(el.getClientRects()).some(r => y >= r.top && y <= r.bottom));
    if (hit === active) return;
    if (active) active.classList.remove('is-reading');
    active = hit || null;
    if (!active) return; // keep the last category open between sentences
    active.classList.add('is-reading');
    const graph = document.querySelector('#category-list')._graph;
    if (graph) graph.openCategory(active.dataset.category, active.dataset.image);
    else { active.classList.remove('is-reading'); active = null; setTimeout(scheduleCheck, 500); } // graph not ready yet
  }
  function scheduleCheck() {
    if (!queued) { queued = true; requestAnimationFrame(check); }
  }
  window.addEventListener('scroll', scheduleCheck, { passive: true });
  window.addEventListener('resize', scheduleCheck);
  window.addEventListener('load', scheduleCheck);
  setTimeout(scheduleCheck, 800); // after the graph has loaded
}
