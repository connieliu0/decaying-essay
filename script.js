document.addEventListener('DOMContentLoaded', function () {
  // Initialize multi-link elements
  initMultiLinks();
  // Initialize Twitter widget
  loadTwitterWidget();
  // Initialize Instagram widget
  loadInstagramWidget();
});

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
        } else {
          // Create iframes for each link with proper index
          linksData.forEach((linkData, index) => {
            const { url, description } = linkData;
            createIframe(url, description, index, element);
          });
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
  
  // Find the center of the page
  const pageCenter = windowWidth / 2;
  
  // Find the main content area (400px wide, centered)
  const mainContentLeft = pageCenter - 200; // 200px is half of 400px
  const mainContentRight = pageCenter + 200;
  
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
