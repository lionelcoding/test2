// Clear previous global state (if reloaded)
let player = null;
let lessonData = {};

// API Configuration
const API_BASE = window.location.origin;
const API_ENDPOINTS = {
  auth: {
    login: `${API_BASE}/auth/login`,
    logout: `${API_BASE}/auth/logout`,
    status: `${API_BASE}/auth/status`
  },
  admin: {
    settings: `${API_BASE}/admin/settings`,
    setKey: `${API_BASE}/admin/set-key`,
    removeKey: `${API_BASE}/admin/remove-key`,
    models: `${API_BASE}/admin/models`
  },
  api: {
    whisper: `${API_BASE}/api/whisper`,
    chapterize: `${API_BASE}/api/chapterize`,
    processVideo: `${API_BASE}/api/process-video`,
    models: `${API_BASE}/api/models`
  }
};

function parseTranscript(raw) {
  const lines = raw.trim().split(/\n+/);
  return lines.map((text, idx) => ({ text, startTime: idx * 5 }));
}

function initLesson(data) {
  lessonData = data;

  // Show main grid, hide home screen and modal
  document.getElementById("app-grid").classList.remove("hidden");
  document.getElementById("home-screen").classList.add("hidden");
  document.getElementById("new-lesson-modal").classList.add("hidden");

  // Initialize or update Plyr
  if (!player) {
    player = new Plyr("#player", {
      controls: [
        "play-large",
        "play",
        "progress",
        "current-time",
        "mute",
        "volume",
        "settings",
        "fullscreen",
        "pip",
        "airplay",
      ],
      settings: ["speed"],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
    });
  }
  // Set source (auto-detection for YouTube vs mp4)
  if (data.videoUrl.includes("youtube.com") || data.videoUrl.includes("youtu.be")) {
    // Extract ID
    const idMatch = data.videoUrl.match(/(?:v=|be\/)([\w-]{11})/);
    if (idMatch) {
      player.source = {
        type: "video",
        sources: [
          {
            src: idMatch[1],
            provider: "youtube",
          },
        ],
      };
    }
  } else {
    player.source = {
      type: "video",
      sources: [{ src: data.videoUrl, type: "video/mp4" }],
    };
  }

  // After setting source, set up timeline markers
  setupTimelineMarkers();

  // Populate metadata
  document.getElementById("lesson-title").textContent = data.title || "Untitled Lesson";
  document.getElementById("lesson-description").textContent = data.description || "";

  // Render panels
  renderChapters();
  renderTranscript();
  renderXray();

  showToggleButton();
  
  // Ensure PiP functionality after a short delay to let Plyr initialize
  setTimeout(() => {
    ensurePip();
  }, 500);
  
  // Initialize back button functionality
  initializeBackButton();
}

// Function to return to home screen
function returnToHome() {
  // Hide lesson view
  document.getElementById("app-grid").classList.add("hidden");
  
  // Show home screen
  document.getElementById("home-screen").classList.remove("hidden");
  
  // Clear lesson data
  lessonData = {};
  
  // Reset search state
  searchMatches = [];
  currentSearchIndex = -1;
  searchTerm = "";
  
  // Clear search input if it exists
  const searchInput = document.getElementById('transcript-search');
  if (searchInput) {
    searchInput.value = '';
  }
  
  // Reset transcript highlights
  clearSearchHighlights();
  
  // Reset video player state
  if (player) {
    player.stop();
    prevHighlighted = null;
  }
  
  // Reload lessons list
  loadLessons();
  
  // Show success notification
  showNotification('Returned to home');
}

// Initialize back button event listener
function initializeBackButton() {
  const backButton = document.getElementById('back-to-home');
  if (backButton) {
    backButton.addEventListener('click', returnToHome);
  }
}

// ================== CHAPTERS ==================
function renderChapters() {
  const chaptersPanel = document.querySelector('[data-panel="chapters"]');
  chaptersPanel.innerHTML = "";
  lessonData.chapters.forEach((chapter, idx) => {
    const btn = document.createElement("button");
    btn.className =
      "w-full flex items-center space-x-3 py-2 text-left focus:outline-none hover:bg-zinc-800 rounded";

    btn.innerHTML = `
      <span class="shrink-0 flex justify-center items-center rounded-full w-8 h-8 bg-gray-700 text-sm font-medium">${
        idx + 1
      }</span>
      <span class="flex-1 text-sm">${chapter.title}</span>
    `;
    btn.addEventListener("click", () => {
      player.currentTime = chapter.startTime;
      player.play();
    });
    chaptersPanel.appendChild(btn);
  });
}

// ================ TRANSCRIPT ================
let prevHighlighted = null;
let searchMatches = [];
let currentSearchIndex = -1;
let searchTerm = "";

function renderTranscript() {
  const transcriptContainer = document.getElementById('transcript-content');
  if (!transcriptContainer) return;
  
  transcriptContainer.innerHTML = "";
  lessonData.transcript.forEach((line) => {
    const div = document.createElement("div");
    div.className = "transcript-line text-sm text-gray-300 cursor-pointer px-2 py-1 rounded hover:bg-zinc-700/50";
    div.textContent = line.text;
    div.dataset.startTime = line.startTime;
    div.addEventListener("click", () => {
      player.currentTime = line.startTime;
    });
    transcriptContainer.appendChild(div);
  });
  
  // Initialize search functionality
  initializeTranscriptSearch();
}

function initializeTranscriptSearch() {
  const searchInput = document.getElementById('transcript-search');
  const searchPrev = document.getElementById('search-prev');
  const searchNext = document.getElementById('search-next');
  
  if (!searchInput || !searchPrev || !searchNext) return;
  
  // Remove existing event listeners
  searchInput.removeEventListener('input', handleSearchInput);
  searchPrev.removeEventListener('click', searchPrevious);
  searchNext.removeEventListener('click', searchNextMatch);
  
  // Add event listeners
  searchInput.addEventListener('input', handleSearchInput);
  searchPrev.addEventListener('click', searchPrevious);
  searchNext.addEventListener('click', searchNextMatch);
  
  // Handle Enter key for navigation
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        searchPrevious();
      } else {
        searchNextMatch();
      }
    }
  });
}

function handleSearchInput(e) {
  searchTerm = e.target.value.trim();
  currentSearchIndex = -1;
  searchMatches = [];
  
  if (!searchTerm) {
    clearSearchHighlights();
    updateSearchUI();
    return;
  }
  
  performSearch();
}

function performSearch() {
  const transcriptLines = document.querySelectorAll('.transcript-line');
  searchMatches = [];
  
  transcriptLines.forEach((line, lineIndex) => {
    const originalText = lessonData.transcript[lineIndex].text;
    
    if (!searchTerm) {
      line.innerHTML = originalText;
      return;
    }
    
    // Case-insensitive search
    const regex = new RegExp(searchTerm, 'gi');
    const matches = [...originalText.matchAll(regex)];
    
    if (matches.length > 0) {
      matches.forEach(match => {
        searchMatches.push({
          lineIndex,
          matchIndex: match.index,
          element: line
        });
      });
      
      // Highlight matches in the text
      let highlightedText = originalText;
      let offset = 0;
      
      matches.forEach((match, index) => {
        const start = match.index + offset;
        const end = start + match[0].length;
        const matchNumber = searchMatches.length - matches.length + index + 1;
        
        highlightedText = 
          highlightedText.substring(0, start) +
          `<mark class="search-highlight bg-yellow-400 text-black px-1 rounded relative" data-match-index="${matchNumber - 1}">` +
          `<span class="search-number absolute -top-2 -right-1 text-xs bg-yellow-600 text-white rounded-full w-4 h-4 flex items-center justify-center" style="font-size: 10px;">${matchNumber}</span>` +
          match[0] +
          '</mark>' +
          highlightedText.substring(end);
        
        offset += `<mark class="search-highlight bg-yellow-400 text-black px-1 rounded relative" data-match-index="${matchNumber - 1}"><span class="search-number absolute -top-2 -right-1 text-xs bg-yellow-600 text-white rounded-full w-4 h-4 flex items-center justify-center" style="font-size: 10px;">${matchNumber}</span></mark>`.length - match[0].length;
      });
      
      line.innerHTML = highlightedText;
    } else {
      line.innerHTML = originalText;
    }
  });
  
  updateSearchUI();
  
  // If there are matches, highlight the first one
  if (searchMatches.length > 0) {
    currentSearchIndex = 0;
    highlightCurrentMatch();
  }
}

function clearSearchHighlights() {
  const transcriptLines = document.querySelectorAll('.transcript-line');
  transcriptLines.forEach((line, index) => {
    // Only clear if lessonData exists and has transcript
    if (lessonData.transcript && lessonData.transcript[index]) {
      line.innerHTML = lessonData.transcript[index].text;
    }
  });
}

function updateSearchUI() {
  const searchResultsInfo = document.getElementById('search-results-info');
  const searchCurrent = document.getElementById('search-current');
  const searchTotal = document.getElementById('search-total');
  const searchPrev = document.getElementById('search-prev');
  const searchNext = document.getElementById('search-next');
  
  if (!searchResultsInfo || !searchCurrent || !searchTotal || !searchPrev || !searchNext) return;
  
  if (searchMatches.length === 0 || !searchTerm) {
    searchResultsInfo.classList.add('hidden');
    searchPrev.disabled = true;
    searchNext.disabled = true;
  } else {
    searchResultsInfo.classList.remove('hidden');
    searchCurrent.textContent = currentSearchIndex + 1;
    searchTotal.textContent = searchMatches.length;
    
    searchPrev.disabled = currentSearchIndex <= 0;
    searchNext.disabled = currentSearchIndex >= searchMatches.length - 1;
  }
}

function searchNextMatch() {
  if (searchMatches.length === 0) return;
  
  currentSearchIndex = (currentSearchIndex + 1) % searchMatches.length;
  highlightCurrentMatch();
  updateSearchUI();
}

function searchPrevious() {
  if (searchMatches.length === 0) return;
  
  currentSearchIndex = currentSearchIndex <= 0 ? searchMatches.length - 1 : currentSearchIndex - 1;
  highlightCurrentMatch();
  updateSearchUI();
}

function highlightCurrentMatch() {
  if (currentSearchIndex < 0 || currentSearchIndex >= searchMatches.length) return;
  
  // Remove previous current match highlighting
  document.querySelectorAll('.search-highlight').forEach(el => {
    el.classList.remove('bg-blue-500', 'text-white');
    el.classList.add('bg-yellow-400', 'text-black');
  });
  
  // Highlight current match
  const currentMatch = searchMatches[currentSearchIndex];
  const currentHighlight = currentMatch.element.querySelector(`.search-highlight[data-match-index="${currentSearchIndex}"]`);
  
  if (currentHighlight) {
    currentHighlight.classList.remove('bg-yellow-400', 'text-black');
    currentHighlight.classList.add('bg-blue-500', 'text-white');
    
    // Scroll to the current match
    currentMatch.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function syncTranscript() {
  const currentTime = player.currentTime;
  let activeLine = null;
  document.querySelectorAll(".transcript-line").forEach((el) => {
    const start = parseFloat(el.dataset.startTime);
    if (start <= currentTime) activeLine = el;
  });
  if (activeLine !== prevHighlighted) {
    if (prevHighlighted) prevHighlighted.classList.remove("bg-blue-700/50");
    if (activeLine) {
      activeLine.classList.add("bg-blue-700/50");
      activeLine.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    prevHighlighted = activeLine;
  }
}

// Ensure event attached once
function attachTimeUpdate() {
  player.off("timeupdate", syncTranscript);
  player.on("timeupdate", syncTranscript);
}

// ================= X-RAY (placeholder) =================
function renderXray() {
  const xrayPanel = document.querySelector('[data-panel="xray"]');
  xrayPanel.innerHTML = "<p class=\"text-sm text-gray-400\">X-ray extraction coming soon…</p>";
}

// ================ TAB SYSTEM (unchanged) ================
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

function setActiveTab(tabEl) {
  tabs.forEach((t) => {
    const isActive = t === tabEl;
    t.classList.toggle("text-blue-400", isActive);
    t.classList.toggle("border-b-2", isActive);
    t.classList.toggle("border-blue-400", isActive);
    t.classList.toggle("text-gray-400", !isActive);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    setActiveTab(tab);
    panels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== target);
    });
  });
});
setActiveTab(document.querySelector('[data-tab="chapters"]'));

// =============== FORM HANDLING ===============
const form = document.getElementById("videoForm");
// OPTIONAL: Trigger GitHub Actions repository_dispatch event
async function triggerGitHubDeploy(payload) {
  /*
    // Uncomment and set your GitHub details + token to enable automatic deploy.
    const GITHUB_OWNER = "your-username";
    const GITHUB_REPO = "your-repo";
    const GITHUB_TOKEN = "YOUR_PAT"; // Store securely!

    await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "generate_player",
        client_payload: payload,
      }),
    });
  */
  console.log("Dispatch payload:", payload);
}

// Enhanced form submit handler with AI processing
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const url = document.getElementById("video-url").value.trim();
  const transcriptRaw = document.getElementById("transcriptInput").value.trim();
  const submitBtn = form.querySelector('button[type="submit"]');
  
  // Disable form during processing
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';
  
  // Show progress modal
  showProgressModal('Initializing...');
  
  try {
    let transcript = [];
    let chapters = [];
    
    if (transcriptRaw) {
      // Use manual transcript
      transcript = parseTranscript(transcriptRaw);
      
      // Generate chapters from transcript
      submitBtn.textContent = 'Generating chapters...';
      updateProgressModal('Generating chapters from transcript...');
      
      try {
        const chapterResponse = await fetch(API_ENDPOINTS.api.chapterize, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            transcript: transcriptRaw
          })
        });
        
        if (chapterResponse.ok) {
          const chapterData = await chapterResponse.json();
          chapters = chapterData.chapters;
        } else {
          console.error('Chapter generation failed, using fallback');
          chapters = transcript.map((l, idx) => ({
            title: `Chapter ${idx + 1}`,
            startTime: l.startTime,
          }));
        }
      } catch (error) {
        console.error('Chapter generation error:', error);
        chapters = transcript.map((l, idx) => ({
          title: `Chapter ${idx + 1}`,
          startTime: l.startTime,
        }));
      }
    } else {
      // Use AI pipeline for both transcription and chapters
      submitBtn.textContent = 'Transcribing video...';
      updateProgressModal('Extracting audio from video...');
      
      try {
        updateProgressModal('Sending to AI for transcription (this may take a few minutes)...');
        
        const processResponse = await fetch(API_ENDPOINTS.api.processVideo, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            videoUrl: url,
            language: 'en'
          })
        });
        
        if (processResponse.ok) {
          const processData = await processResponse.json();
          transcript = processData.transcript;
          chapters = processData.chapters;
          
          // Update the transcript textarea with the generated transcript
          document.getElementById("transcriptInput").value = 
            transcript.map(t => t.text).join('\n');
        } else {
          const errorData = await processResponse.json();
          throw new Error(errorData.message || 'Failed to process video');
        }
      } catch (error) {
        console.error('AI processing failed, using fallback:', error);
        alert(`AI processing failed: ${error.message}. Using manual mode.`);
        
        // Fallback to manual mode
        transcript = [];
        chapters = [
          { title: "Introduction", startTime: 0 },
          { title: "Main Content", startTime: 30 },
          { title: "Conclusion", startTime: 90 }
        ];
      }
    }
    
    const newLesson = {
      videoUrl: url,
      title: transcriptRaw ? "Custom Lesson" : "AI Generated Lesson",
      description: transcriptRaw ? "Lesson with manual transcript and AI chapters" : "Fully AI generated lesson",
      chapters: chapters,
      transcript: transcript,
    };
    
    initLesson(newLesson);
    attachTimeUpdate();
    
    // Reload lessons after creation
    setTimeout(() => {
      loadLessons();
    }, 1000);
    
    // Trigger deploy workflow
    triggerGitHubDeploy(newLesson);
    
  } catch (error) {
    console.error('Form submission error:', error);
    hideProgressModal();
    alert(`Error: ${error.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Lesson';
    hideProgressModal();
  }
});

// =============== ACTION BAR BUTTONS (unchanged) ===============
function noop() {
  alert("Feature coming soon 🚧");
}
["btn-tldr", "btn-blog", "btn-agent", "ask-ai-btn"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", noop);
});

// Utility class for action buttons (unchanged)
const style = document.createElement("style");
style.textContent = `
  .action-btn {
    @apply text-white leading-[20px] h-9 text-sm bg-transparent flex text-center font-medium justify-center items-center cursor-pointer px-4 py-2 gap-[6px] border-[#7980864d] border-[1px] rounded-[6.4px] hover:bg-zinc-800 transition;
  }
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
`;
document.head.appendChild(style);

// ======== SIDEBAR TOGGLE =========
const sidebarEl = document.getElementById("sidebar");
const toggleBtn = document.getElementById("toggle-sidebar");
const chevronIcon = document.getElementById("chevron-icon");
const mainGrid = document.getElementById("main-grid");

toggleBtn?.addEventListener("click", () => {
  const isHidden = sidebarEl.classList.toggle("hidden");
  // Rotate chevron depending on state (pointing right when sidebar hidden)
  chevronIcon.classList.toggle("rotate-180", isHidden);
  
  // Update grid columns when sidebar is toggled (only on large screens)
  if (window.innerWidth >= 1024) {
    if (isHidden) {
      mainGrid.classList.remove("lg:grid-cols-[1fr_410px]");
      mainGrid.classList.add("lg:grid-cols-1");
    } else {
      mainGrid.classList.remove("lg:grid-cols-1");
      mainGrid.classList.add("lg:grid-cols-[1fr_410px]");
    }
  }
});

// Show toggle button only after lesson loaded and on large screens
function showToggleButton() {
  if (window.innerWidth >= 1024) {
    toggleBtn?.classList.remove("hidden");
    toggleBtn?.classList.add("flex");
  }
}

// Handle window resize
window.addEventListener("resize", () => {
  if (window.innerWidth < 1024) {
    toggleBtn?.classList.add("hidden");
    toggleBtn?.classList.remove("flex");
    // Reset sidebar visibility on mobile
    sidebarEl?.classList.remove("hidden");
  } else {
    showToggleButton();
  }
});

// ======== Ensure PiP control is included ========
// When player first initialized, controls already defined; we add pip if not
function ensurePip() {
  if (!player) {
    console.log('No player available for PiP');
    return;
  }
  if (!player.elements.controls) {
    console.log('No player controls available for PiP');
    return;
  }
  
  // Check if PiP is supported
  console.log('Checking PiP support:', {
    pictureInPictureEnabled: document.pictureInPictureEnabled,
    playerType: player.provider,
    isYouTube: player.provider === 'youtube'
  });
  
  if (!document.pictureInPictureEnabled) {
    console.log('Picture-in-Picture is not supported in this browser');
    return;
  }
  
  // For YouTube videos, PiP might not work through Plyr
  // Add manual PiP button if needed
  const pipButton = player.elements.controls.querySelector('[data-plyr="pip"]');
  if (pipButton) {
    console.log('PiP control found in Plyr');
    // Make sure it's visible
    pipButton.style.display = 'block';
  } else {
    console.log('PiP control not found, adding manual implementation');
    addManualPipButton();
  }
}

function addManualPipButton() {
  if (!player || !player.elements.controls) return;
  
  // Find the settings button to insert before it
  const settingsButton = player.elements.controls.querySelector('[data-plyr="settings"]');
  if (!settingsButton) return;
  
  // Create PiP button
  const pipButton = document.createElement('button');
  pipButton.className = 'plyr__control plyr__control--overlaid';
  pipButton.type = 'button';
  pipButton.setAttribute('data-plyr', 'pip');
  pipButton.setAttribute('aria-label', 'Picture-in-Picture');
  pipButton.style.cssText = 'display: flex; align-items: center; justify-content: center;';
  pipButton.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
      <rect x="8" y="8" width="8" height="6" rx="1" ry="1"/>
    </svg>
  `;
  
  // Add click handler
  pipButton.addEventListener('click', () => {
    console.log('PiP button clicked, player provider:', player.provider);
    
    if (player.provider === 'youtube') {
      // For YouTube, try to use the iframe's PiP if available
      const iframe = player.elements.wrapper.querySelector('iframe');
      if (iframe && iframe.requestPictureInPicture) {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture();
        } else {
          iframe.requestPictureInPicture().catch(err => {
            console.log('YouTube PiP failed:', err);
            alert('Picture-in-Picture is not available for YouTube videos in this browser. Try using a direct video file instead.');
          });
        }
      } else {
        console.log('YouTube iframe does not support PiP');
        alert('Picture-in-Picture is not available for YouTube videos. Try using a direct video file (.mp4) instead.');
      }
    } else if (player.media && player.media.requestPictureInPicture) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
      } else {
        player.media.requestPictureInPicture()
          .then(() => {
            console.log('PiP activated successfully');
            pipButton.style.opacity = '0.7';
          })
          .catch(err => {
            console.log('PiP failed:', err);
            alert('Picture-in-Picture failed: ' + err.message);
          });
      }
    } else {
      console.log('No PiP support available');
      alert('Picture-in-Picture is not supported for this video type.');
    }
  });
  
  // Insert before settings button
  settingsButton.parentNode.insertBefore(pipButton, settingsButton);
  
  // Listen for PiP events to update button state
  if (player.media) {
    player.media.addEventListener('enterpictureinpicture', () => {
      pipButton.style.opacity = '0.7';
      pipButton.setAttribute('aria-label', 'Exit Picture-in-Picture');
    });
    
    player.media.addEventListener('leavepictureinpicture', () => {
      pipButton.style.opacity = '1';
      pipButton.setAttribute('aria-label', 'Picture-in-Picture');
    });
  }
}

// =============== SETTINGS MODAL ===============
class SettingsManager {
  constructor() {
    this.modal = document.getElementById('settings-modal');
    this.loginForm = document.getElementById('login-form');
    this.settingsContent = document.getElementById('settings-content');
    this.isAuthenticated = false;
    
    this.initEventListeners();
  }

  initEventListeners() {
    // Modal controls
    document.getElementById('settings-btn').addEventListener('click', () => this.openModal());
    document.getElementById('close-settings').addEventListener('click', () => this.closeModal());
    
    // Login form
    document.getElementById('adminLoginForm').addEventListener('submit', (e) => this.handleLogin(e));
    
    // API key management
    document.getElementById('save-openai-key').addEventListener('click', () => this.saveApiKey('openai'));
    document.getElementById('save-gemini-key').addEventListener('click', () => this.saveApiKey('gemini'));
    
    // Settings
    document.getElementById('save-prompt').addEventListener('click', () => this.savePrompt());
    document.getElementById('model-select').addEventListener('change', (e) => this.saveModel(e.target.value));
    
    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => this.logout());
    
    // Close modal on backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
  }

  async openModal() {
    this.modal.classList.remove('hidden');
    await this.checkAuthStatus();
  }

  closeModal() {
    this.modal.classList.add('hidden');
  }

  async checkAuthStatus() {
    try {
      const response = await fetch(API_ENDPOINTS.auth.status, {
        credentials: 'include'
      });
      
      if (response.ok) {
        this.isAuthenticated = true;
        this.showSettingsContent();
        await this.loadSettings();
      } else {
        this.isAuthenticated = false;
        this.showLoginForm();
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      this.showLoginForm();
    }
  }

  showLoginForm() {
    this.loginForm.classList.remove('hidden');
    this.settingsContent.classList.add('hidden');
  }

  showSettingsContent() {
    this.loginForm.classList.add('hidden');
    this.settingsContent.classList.remove('hidden');
  }

  async handleLogin(e) {
    e.preventDefault();
    
    const password = document.getElementById('admin-password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';
    
    try {
      const response = await fetch(API_ENDPOINTS.auth.login, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        this.isAuthenticated = true;
        this.showSettingsContent();
        await this.loadSettings();
        document.getElementById('admin-password').value = '';
      } else {
        alert(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login';
    }
  }

  async loadSettings() {
    try {
      const response = await fetch(API_ENDPOINTS.admin.settings, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const settings = await response.json();
        this.updateUI(settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  updateUI(settings) {
    // Update key status
    document.getElementById('openai-status').textContent = 
      settings.keyStatus.openai ? '✓ Configured' : 'Not configured';
    document.getElementById('openai-status').className = 
      settings.keyStatus.openai ? 'text-sm text-green-400' : 'text-sm text-gray-400';
    
    document.getElementById('gemini-status').textContent = 
      settings.keyStatus.gemini ? '✓ Configured' : 'Not configured';
    document.getElementById('gemini-status').className = 
      settings.keyStatus.gemini ? 'text-sm text-green-400' : 'text-sm text-gray-400';
    
    // Update model dropdown
    const modelSelect = document.getElementById('model-select');
    modelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    settings.availableModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      option.selected = model.id === settings.model;
      modelSelect.appendChild(option);
    });
    
    // Update prompt
    document.getElementById('chapter-prompt').value = settings.chapterPrompt || '';
  }

  async saveApiKey(provider) {
    const keyInput = document.getElementById(`${provider}-key`);
    const key = keyInput.value.trim();
    
    if (!key) {
      alert('Please enter an API key');
      return;
    }
    
    const saveBtn = document.getElementById(`save-${provider}-key`);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
      const response = await fetch(API_ENDPOINTS.admin.setKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ provider, key })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        keyInput.value = '';
        await this.loadSettings();
        alert(`${provider} API key saved successfully`);
      } else {
        alert(data.error || 'Failed to save API key');
      }
    } catch (error) {
      console.error('Save key error:', error);
      alert('Failed to save API key');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }

  async savePrompt() {
    const prompt = document.getElementById('chapter-prompt').value.trim();
    
    if (!prompt) {
      alert('Please enter a prompt');
      return;
    }
    
    const saveBtn = document.getElementById('save-prompt');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    try {
      const response = await fetch(API_ENDPOINTS.admin.settings, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ chapterPrompt: prompt })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        alert('Prompt saved successfully');
      } else {
        alert(data.error || 'Failed to save prompt');
      }
    } catch (error) {
      console.error('Save prompt error:', error);
      alert('Failed to save prompt');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Prompt';
    }
  }

  async saveModel(model) {
    if (!model) return;
    
    try {
      const response = await fetch(API_ENDPOINTS.admin.settings, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ model })
      });
      
      if (response.ok) {
        console.log('Model saved successfully');
      }
    } catch (error) {
      console.error('Save model error:', error);
    }
  }

  async logout() {
    try {
      await fetch(API_ENDPOINTS.auth.logout, {
        method: 'POST',
        credentials: 'include'
      });
      
      this.isAuthenticated = false;
      this.showLoginForm();
    } catch (error) {
      console.error('Logout error:', error);
    }
  }
}

// Initialize settings manager
const settingsManager = new SettingsManager();

// =============== NEW LESSON MODAL ===============
function openNewLessonModal() {
  document.getElementById('new-lesson-modal').classList.remove('hidden');
}

function closeNewLessonModal() {
  document.getElementById('new-lesson-modal').classList.add('hidden');
}

// Add event listeners for new lesson modal
document.getElementById('new-lesson-btn').addEventListener('click', openNewLessonModal);
document.getElementById('close-new-lesson').addEventListener('click', closeNewLessonModal);

// Add event listener for second new lesson button
document.addEventListener('DOMContentLoaded', function() {
  const secondNewBtn = document.getElementById('new-lesson-btn-2');
  if (secondNewBtn) {
    secondNewBtn.addEventListener('click', openNewLessonModal);
  }
});

// Close modal on backdrop click
document.getElementById('new-lesson-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('new-lesson-modal')) {
    closeNewLessonModal();
  }
});

// Close modal on escape key and handle back navigation
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Check if modal is open first
    if (!document.getElementById('new-lesson-modal').classList.contains('hidden')) {
      closeNewLessonModal();
    }
    // If modal is not open and we're in lesson view, go back to home
    else if (!document.getElementById('app-grid').classList.contains('hidden')) {
      returnToHome();
    }
  }
});

// =============== SIDEBAR NAVIGATION ===============
function initializeSidebarNavigation() {
  // Add click handlers for sidebar navigation items
  const sidebarItems = document.querySelectorAll('#home-screen .cursor-pointer');
  
  sidebarItems.forEach(item => {
    item.addEventListener('click', function() {
      const itemName = this.querySelector('span').textContent;
      
      // Reset all items to default state
      sidebarItems.forEach(i => {
        i.classList.remove('text-blue-400', 'bg-blue-900/20');
        i.classList.add('text-gray-400');
      });
      
      // Highlight clicked item
      this.classList.remove('text-gray-400');
      this.classList.add('text-blue-400', 'bg-blue-900/20');
      
      // Handle different navigation actions
      switch(itemName) {
        case 'My Lessons':
          showNotification('My Lessons feature coming soon!');
          break;
        case 'Recent':
          showNotification('Recent lessons feature coming soon!');
          break;
        case 'Favorites':
          showNotification('Favorites feature coming soon!');
          break;
        case 'Trash':
          showNotification('Trash feature coming soon!');
          break;
      }
    });
  });
  
  // Search functionality
  updateSearchFunctionality();
}

// Simple notification system
function showNotification(message) {
  // Remove existing notification
  const existingNotification = document.getElementById('temp-notification');
  if (existingNotification) {
    existingNotification.remove();
  }
  
  const notification = document.createElement('div');
  notification.id = 'temp-notification';
  notification.className = 'fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transform transition-all duration-300';
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

// Initialize sidebar navigation when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  initializeSidebarNavigation();
  initializeMobileSidebar();
  loadLessons();
  
  // Initialize back button functionality
  initializeBackButton();
  
  // Initialize lesson selection and deletion
  initializeLessonSelection();
});

// Initialize lesson selection event listeners
function initializeLessonSelection() {
  const selectAllBtn = document.getElementById('select-all-btn');
  const clearSelectionBtn = document.getElementById('clear-selection-btn');
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  const deployGithubBtn = document.getElementById('deploy-github-btn');
  
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', selectAllLessons);
  }
  
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', clearSelection);
  }
  
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', deleteSelectedLessons);
  }
  
  if (deployGithubBtn) {
    deployGithubBtn.addEventListener('click', deployToGitHubPages);
  }
}

// =============== LESSONS MANAGEMENT ===============
let selectedLessons = new Set();

async function loadLessons() {
  try {
    const response = await fetch('/api/lessons');
    const data = await response.json();
    
    if (data.success) {
      displayLessons(data.lessons);
    } else {
      console.error('Failed to load lessons:', data.error);
    }
  } catch (error) {
    console.error('Error loading lessons:', error);
  }
}

function displayLessons(lessons) {
  const welcomeSection = document.getElementById('welcome-section');
  const lessonsSection = document.getElementById('lessons-section');
  const lessonsGrid = document.getElementById('lessons-grid');
  const noLessons = document.getElementById('no-lessons');
  
  // Clear selection when lessons are reloaded
  selectedLessons.clear();
  
  if (lessons.length === 0) {
    // Show welcome section if no lessons
    welcomeSection.classList.remove('hidden');
    lessonsSection.classList.add('hidden');
  } else {
    // Show lessons section
    welcomeSection.classList.add('hidden');
    lessonsSection.classList.remove('hidden');
    noLessons.classList.add('hidden');
    
    // Clear existing lessons
    lessonsGrid.innerHTML = '';
    
    // Create lesson cards
    lessons.forEach(lesson => {
      const card = createLessonCard(lesson);
      lessonsGrid.appendChild(card);
    });
  }
  
  // Update selection UI
  updateSelectionUI();
}

function createLessonCard(lesson) {
  const card = document.createElement('div');
  card.className = 'bg-zinc-900 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow group relative';
  card.dataset.lessonId = lesson.id;
  
  const tagsHtml = lesson.tags.map(tag => 
    `<span class="px-2 py-1 bg-blue-900/30 text-blue-300 text-xs rounded-full">${tag}</span>`
  ).join('');
  
  const formattedDate = new Date(lesson.createdAt).toLocaleDateString();
  const duration = formatDuration(lesson.duration);
  
  card.innerHTML = `
    <div class="relative">
      <!-- Selection Checkbox -->
      <div class="absolute top-2 left-2 z-10">
        <input 
          type="checkbox" 
          id="select-${lesson.id}"
          class="lesson-checkbox w-4 h-4 text-blue-600 bg-zinc-800 border-zinc-600 rounded focus:ring-blue-500 focus:ring-2"
          data-lesson-id="${lesson.id}"
        />
      </div>
      
      <img 
        src="${lesson.thumbnailUrl || '/api/placeholder-thumbnail'}" 
        alt="${lesson.title}"
        class="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300 lesson-thumbnail"
        onerror="this.src='/api/placeholder-thumbnail'"
      />
      <div class="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-sm">
        ${duration}
      </div>
      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100 lesson-overlay">
        <div class="bg-blue-600 rounded-full p-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-white">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        </div>
      </div>
    </div>
    
    <div class="p-4 lesson-content">
      <h3 class="text-lg font-semibold text-white mb-2 line-clamp-2">${lesson.title}</h3>
      <p class="text-gray-400 text-sm mb-3 line-clamp-3">${lesson.description}</p>
      
      <div class="flex flex-wrap gap-1 mb-3">
        ${tagsHtml}
      </div>
      
      <div class="flex justify-between items-center text-xs text-gray-500 mb-3">
        <span>Created ${formattedDate}</span>
        <span>${lesson.chapters ? lesson.chapters.length : 0} chapters</span>
      </div>
      
      <!-- Page Link Button -->
      <div class="flex gap-2">
        <button 
          class="page-link-btn flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          onclick="openLessonPage(${lesson.id})"
          title="Open individual lesson page"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
          </svg>
          Open Page
        </button>
        <button 
          class="watch-here-btn flex-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors"
          onclick="loadLessonById(${lesson.id})"
          title="Watch lesson here"
        >
          Watch Here
        </button>
      </div>
    </div>
  `;
  
  // Add event listeners
  const checkbox = card.querySelector('.lesson-checkbox');
  const thumbnail = card.querySelector('.lesson-thumbnail');
  const overlay = card.querySelector('.lesson-overlay');
  
  // Checkbox event
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    handleLessonSelection(lesson.id, e.target.checked);
  });
  
  // Click events for lesson loading (only on thumbnail and overlay)
  [thumbnail, overlay].forEach(element => {
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      loadLessonById(lesson.id);
    });
  });
  
  return card;
}

// =============== LESSON PAGE FUNCTIONS ===============

// Open individual lesson page
function openLessonPage(lessonId) {
  const pageUrl = `./pages/lesson-${lessonId}.html`;
  window.open(pageUrl, '_blank');
}

// Regenerate all lesson pages
async function regenerateAllPages() {
  try {
    showNotification('Regenerating all lesson pages...');
    
    const response = await fetch('/api/regenerate-pages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    
    if (result.success) {
      showNotification(`✅ Successfully regenerated ${result.pagesCount} lesson pages`);
    } else {
      showNotification('❌ Failed to regenerate pages: ' + result.error);
    }
  } catch (error) {
    console.error('Error regenerating pages:', error);
    showNotification('❌ Error regenerating pages');
  }
}

// Check if lesson pages exist
async function checkLessonPages() {
  try {
    const response = await fetch('/api/pages/status');
    const result = await response.json();
    
    if (result.success) {
      console.log(`Found ${result.pagesCount} lesson pages`);
      return result.pages;
    }
    
    return [];
  } catch (error) {
    console.error('Error checking lesson pages:', error);
    return [];
  }
}

// =============== LESSON SELECTION ===============
function handleLessonSelection(lessonId, isSelected) {
  if (isSelected) {
    selectedLessons.add(lessonId);
  } else {
    selectedLessons.delete(lessonId);
  }
  
  // Update visual state of the lesson card
  const lessonCard = document.querySelector(`[data-lesson-id="${lessonId}"]`);
  if (lessonCard) {
    if (isSelected) {
      lessonCard.classList.add('lesson-card-selected');
    } else {
      lessonCard.classList.remove('lesson-card-selected');
    }
  }
  
  updateSelectionUI();
}

function updateSelectionUI() {
  const selectedCount = selectedLessons.size;
  const bulkActionsBar = document.getElementById('bulk-actions-bar');
  const selectedCountSpan = document.getElementById('selected-count');
  const selectAllBtn = document.getElementById('select-all-btn');
  
  // Update selected count text
  selectedCountSpan.textContent = `${selectedCount} lesson${selectedCount !== 1 ? 's' : ''} selected`;
  
  // Show/hide bulk actions bar
  if (selectedCount > 0) {
    bulkActionsBar.classList.remove('hidden');
  } else {
    bulkActionsBar.classList.add('hidden');
  }
  
  // Update select all button text
  const totalLessons = document.querySelectorAll('.lesson-checkbox').length;
  if (selectedCount === totalLessons && totalLessons > 0) {
    selectAllBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 11l3 3 8-8"/>
      </svg>
      Deselect All
    `;
  } else {
    selectAllBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 11l3 3 8-8"/>
        <path d="M21 12c0 1.67-.4 3.24-1.1 4.64"/>
        <path d="M3 3l18 18"/>
      </svg>
      Select All
    `;
  }
}

function selectAllLessons() {
  const checkboxes = document.querySelectorAll('.lesson-checkbox');
  const totalLessons = checkboxes.length;
  const selectedCount = selectedLessons.size;
  
  if (selectedCount === totalLessons) {
    // Deselect all
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
      selectedLessons.delete(checkbox.dataset.lessonId);
      const lessonCard = document.querySelector(`[data-lesson-id="${checkbox.dataset.lessonId}"]`);
      if (lessonCard) {
        lessonCard.classList.remove('lesson-card-selected');
      }
    });
  } else {
    // Select all
    checkboxes.forEach(checkbox => {
      checkbox.checked = true;
      selectedLessons.add(checkbox.dataset.lessonId);
      const lessonCard = document.querySelector(`[data-lesson-id="${checkbox.dataset.lessonId}"]`);
      if (lessonCard) {
        lessonCard.classList.add('lesson-card-selected');
      }
    });
  }
  
  updateSelectionUI();
}

function clearSelection() {
  selectedLessons.clear();
  document.querySelectorAll('.lesson-checkbox').forEach(checkbox => {
    checkbox.checked = false;
    const lessonCard = document.querySelector(`[data-lesson-id="${checkbox.dataset.lessonId}"]`);
    if (lessonCard) {
      lessonCard.classList.remove('lesson-card-selected');
    }
  });
  updateSelectionUI();
}

// =============== LESSON DELETION ===============
async function deleteSelectedLessons() {
  if (selectedLessons.size === 0) {
    showNotification('No lessons selected');
    return;
  }
  
  const lessonCount = selectedLessons.size;
  const confirmMessage = `Are you sure you want to delete ${lessonCount} lesson${lessonCount !== 1 ? 's' : ''}? This action cannot be undone.`;
  
  if (!confirm(confirmMessage)) {
    return;
  }
  
  try {
    const deletePromises = Array.from(selectedLessons).map(lessonId => 
      fetch(`/api/lessons/${lessonId}`, { method: 'DELETE' })
    );
    
    showNotification('Deleting lessons...');
    
    const responses = await Promise.allSettled(deletePromises);
    
    let successCount = 0;
    let failCount = 0;
    
    responses.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.ok) {
        successCount++;
      } else {
        failCount++;
        console.error(`Failed to delete lesson ${Array.from(selectedLessons)[index]}:`, result.reason);
      }
    });
    
    // Clear selection and reload lessons
    clearSelection();
    await loadLessons();
    
    // Show result notification
    if (failCount === 0) {
      showNotification(`Successfully deleted ${successCount} lesson${successCount !== 1 ? 's' : ''}`);
    } else {
      showNotification(`Deleted ${successCount} lesson${successCount !== 1 ? 's' : ''}, failed to delete ${failCount}`);
    }
    
  } catch (error) {
    console.error('Error deleting lessons:', error);
    showNotification('Error deleting lessons');
  }
}

// =============== GITHUB PAGES DEPLOYMENT ===============
async function deployToGitHubPages() {
  const deployBtn = document.getElementById('deploy-github-btn');
  const originalText = deployBtn.innerHTML;
  
  // Show loading state
  deployBtn.disabled = true;
  deployBtn.innerHTML = `
    <svg class="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Deploying...
  `;
  
  try {
    // Show initial progress
    showProgressModal('Preparing deployment...');
    
    // Get deployment configuration from user (optional)
    const config = await getDeploymentConfig();
    
    // Handle cancellation
    if (!config) {
      hideProgressModal();
      return;
    }
    
    updateProgressModal('Generating static files...');
    
    // Call the deployment API
    const response = await fetch('/api/github/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    const result = await response.json();
    
    console.log('Deployment API response:', result);
    
    if (result.success) {
      updateProgressModal('Deployment successful!');
      
      // Hide progress modal after a short delay
      setTimeout(() => {
        hideProgressModal();
        
        // Show success modal with deployment URL
        showDeploymentSuccessModal(result.deploymentUrl, result.lessonsCount);
      }, 1000);
      
      showNotification(`Successfully deployed ${result.lessonsCount} lessons to GitHub Pages!`);
      
    } else {
      throw new Error(result.error || 'Deployment failed');
    }
    
  } catch (error) {
    console.error('Deployment error:', error);
    hideProgressModal();
    
    // Show error modal
    showDeploymentErrorModal(error.message);
    
    showNotification('Deployment failed: ' + error.message);
    
  } finally {
    // Restore button state
    deployBtn.disabled = false;
    deployBtn.innerHTML = originalText;
  }
}

// Get deployment configuration from user
async function getDeploymentConfig() {
  return new Promise((resolve) => {
    // Show configuration modal
    const modal = document.createElement('div');
    modal.id = 'deployment-config-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-zinc-900 rounded-lg p-8 max-w-md w-full mx-4">
        <h2 class="text-2xl font-bold text-white mb-4">GitHub Deployment Configuration</h2>
        
        <div class="mb-4 p-3 bg-blue-900 bg-opacity-50 rounded-lg">
          <p class="text-blue-300 text-sm">
            📝 <strong>Note:</strong> Make sure you have a GitHub token set up in your environment variables. 
            If the repository doesn't exist, it will be created automatically.
          </p>
        </div>
        
        <div class="mb-4">
          <label class="block text-zinc-300 mb-2">GitHub Username:</label>
          <input type="text" id="github-username" class="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" 
                 placeholder="your-github-username" required>
          <p class="text-zinc-500 text-sm mt-1">Your GitHub username (e.g., "johndoe")</p>
        </div>
        
        <div class="mb-4">
          <label class="block text-zinc-300 mb-2">Repository Name:</label>
          <input type="text" id="github-repo-name" class="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" 
                 placeholder="player-deployment" value="player-deployment" required>
          <p class="text-zinc-500 text-sm mt-1">Just the repository name (e.g., "my-lessons"). Do NOT include your username.</p>
        </div>
        
        <div class="mb-4">
          <label class="block text-zinc-300 mb-2">Branch:</label>
          <input type="text" id="github-branch" class="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white" 
                 placeholder="gh-pages" value="gh-pages" required>
          <p class="text-zinc-500 text-sm mt-1">Branch for GitHub Pages (usually "gh-pages")</p>
        </div>
        
        <div class="mb-6 p-3 bg-zinc-800 rounded-lg">
          <p class="text-zinc-400 text-sm mb-2">Your lessons will be deployed to:</p>
          <p class="text-blue-300 font-mono text-sm" id="url-preview">https://[username].github.io/[repository-name]/</p>
        </div>
        
        <div class="flex space-x-4">
          <button id="deploy-confirm-btn" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors">
            Deploy
          </button>
          <button id="deploy-cancel-btn" class="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors">
            Cancel
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus on username input
    document.getElementById('github-username').focus();
    
    // Update URL preview when user types
    function updateUrlPreview() {
      const username = document.getElementById('github-username').value || '[username]';
      const repoName = document.getElementById('github-repo-name').value || '[repository-name]';
      document.getElementById('url-preview').textContent = `https://${username}.github.io/${repoName}/`;
    }
    
    document.getElementById('github-username').addEventListener('input', updateUrlPreview);
    document.getElementById('github-repo-name').addEventListener('input', updateUrlPreview);
    
    // Handle confirm button
    document.getElementById('deploy-confirm-btn').addEventListener('click', () => {
      const username = document.getElementById('github-username').value.trim();
      const repoName = document.getElementById('github-repo-name').value.trim();
      const branch = document.getElementById('github-branch').value.trim();
      
      if (!username) {
        showNotification('Please enter your GitHub username');
        return;
      }
      
      if (!repoName) {
        showNotification('Please enter a repository name');
        return;
      }
      
      // Remove modal
      modal.remove();
      
      const config = {
        repoOwner: username,
        repoName: repoName,
        branch: branch || 'gh-pages'
      };
      
      console.log('Deployment configuration:', config);
      
      resolve(config);
    });
    
    // Handle cancel button
    document.getElementById('deploy-cancel-btn').addEventListener('click', () => {
      modal.remove();
      resolve(null); // Return null to cancel deployment
    });
    
    // Handle enter key in form
    modal.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('deploy-confirm-btn').click();
      }
    });
  });
}

// Show deployment success modal
function showDeploymentSuccessModal(deploymentUrl, lessonsCount) {
  // Remove existing modal if any
  const existingModal = document.getElementById('deployment-success-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  const modal = document.createElement('div');
  modal.id = 'deployment-success-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-zinc-900 rounded-lg p-8 max-w-md w-full mx-4 text-center">
      <div class="mb-4">
        <div class="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h3 class="text-xl font-semibold text-white mb-2">Deployment Successful!</h3>
        <p class="text-gray-300 mb-4">Your ${lessonsCount} lesson${lessonsCount !== 1 ? 's' : ''} have been deployed to GitHub Pages</p>
        
        <div class="bg-zinc-800 rounded-lg p-4 mb-4">
          <p class="text-sm text-gray-400 mb-2">Deployment URL:</p>
          <div class="flex items-center gap-2">
            <input 
              type="text" 
              value="${deploymentUrl}" 
              class="flex-1 bg-zinc-700 text-white px-3 py-2 rounded text-sm"
              readonly
              id="deployment-url-input"
            />
            <button 
              onclick="copyDeploymentUrl()"
              class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
              title="Copy URL"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="flex gap-2 justify-center">
          <button 
            onclick="window.open('${deploymentUrl}', '_blank')"
            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
          >
            Open Deployment
          </button>
          <button 
            onclick="closeDeploymentSuccessModal()"
            class="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeDeploymentSuccessModal();
    }
  });
}

// Show deployment error modal
function showDeploymentErrorModal(error) {
  // Remove existing modal if any
  const existingModal = document.getElementById('deployment-error-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  const modal = document.createElement('div');
  modal.id = 'deployment-error-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-zinc-900 rounded-lg p-8 max-w-md w-full mx-4 text-center">
      <div class="mb-4">
        <div class="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </div>
        <h3 class="text-xl font-semibold text-white mb-2">Deployment Failed</h3>
        <p class="text-gray-300 mb-4">There was an error deploying your lessons to GitHub Pages</p>
        
        <div class="bg-zinc-800 rounded-lg p-4 mb-4">
          <p class="text-sm text-gray-400 mb-2">Error Details:</p>
          <p class="text-sm text-red-400">${error}</p>
        </div>
        
        <div class="text-sm text-gray-400 mb-4">
          Please check your GitHub configuration and try again.
        </div>
        
        <button 
          onclick="closeDeploymentErrorModal()"
          class="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded"
        >
          Close
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeDeploymentErrorModal();
    }
  });
}

// Helper functions for modals
function copyDeploymentUrl() {
  const input = document.getElementById('deployment-url-input');
  input.select();
  document.execCommand('copy');
  showNotification('Deployment URL copied to clipboard!');
}

function closeDeploymentSuccessModal() {
  const modal = document.getElementById('deployment-success-modal');
  if (modal) {
    modal.remove();
  }
}

function closeDeploymentErrorModal() {
  const modal = document.getElementById('deployment-error-modal');
  if (modal) {
    modal.remove();
  }
}

async function loadLessonById(lessonId) {
  try {
    const response = await fetch(`/api/lessons/${lessonId}`);
    const data = await response.json();
    
    if (data.success) {
      initLesson(data.lesson);
    } else {
      console.error('Failed to load lesson:', data.error);
      showNotification('Failed to load lesson');
    }
  } catch (error) {
    console.error('Error loading lesson:', error);
    showNotification('Error loading lesson');
  }
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Update search functionality to search lessons
function updateSearchFunctionality() {
  const searchInput = document.querySelector('#home-screen input[placeholder="Search lessons..."]');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(function() {
      const searchTerm = this.value.toLowerCase();
      if (searchTerm.length > 0) {
        searchLessons(searchTerm);
      } else {
        loadLessons(); // Reload all lessons
      }
    }, 300));
  }
}

async function searchLessons(searchTerm) {
  try {
    const response = await fetch(`/api/lessons/search/${encodeURIComponent(searchTerm)}`);
    const data = await response.json();
    
    if (data.success) {
      displayLessons(data.lessons);
    } else {
      console.error('Search failed:', data.error);
    }
  } catch (error) {
    console.error('Error searching lessons:', error);
  }
}

// Debounce function for search
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// =============== MOBILE SIDEBAR TOGGLE ===============
function initializeMobileSidebar() {
  const mobileToggle = document.getElementById('mobile-sidebar-toggle');
  const sidebar = document.getElementById('home-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  if (!mobileToggle || !sidebar || !overlay) return;
  
  function toggleSidebar() {
    const isOpen = !sidebar.classList.contains('-translate-x-full');
    
    if (isOpen) {
      // Close sidebar
      sidebar.classList.add('-translate-x-full');
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
    } else {
      // Open sidebar
      sidebar.classList.remove('-translate-x-full');
      overlay.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }
  
  function closeSidebar() {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
  
  // Toggle button click
  mobileToggle.addEventListener('click', toggleSidebar);
  
  // Overlay click to close
  overlay.addEventListener('click', closeSidebar);
  
  // Close on escape key (only on mobile)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sidebar.classList.contains('-translate-x-full') && window.innerWidth < 768) {
      closeSidebar();
    }
  });
  
  // Close sidebar when switching to desktop view
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      closeSidebar();
    }
  });
}

// =============== PROGRESS MODAL ===============
function showProgressModal(message) {
  // Remove existing modal if any
  hideProgressModal();
  
  const modal = document.createElement('div');
  modal.id = 'progress-modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
      <div class="mb-4">
        <svg class="animate-spin h-12 w-12 text-blue-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
      <h3 class="text-lg font-semibold text-gray-900 mb-2">Processing Video</h3>
      <p id="progress-message" class="text-gray-600">${message}</p>
      <div class="mt-4 text-sm text-gray-500">
        This may take several minutes depending on video length
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

function updateProgressModal(message) {
  const progressMessage = document.getElementById('progress-message');
  if (progressMessage) {
    progressMessage.textContent = message;
  }
}

function hideProgressModal() {
  const modal = document.getElementById('progress-modal');
  if (modal) {
    modal.remove();
  }
}

// =============== TIMELINE MARKERS ===============
function renderTimelineMarkers() {
  const progressBar = document.querySelector('.plyr__progress');
  if (!progressBar || !player || !lessonData.chapters) return;
  // Ensure the progress bar is positioned relatively
  progressBar.style.position = 'relative';
  // Remove existing markers
  progressBar.querySelectorAll('.timeline-marker').forEach(el => el.remove());

  const duration = player.duration;
  if (!duration || isNaN(duration) || duration === Infinity) return;

  lessonData.chapters.forEach((chapter, idx) => {
    if (chapter.startTime >= 0 && chapter.startTime <= duration) {
      const percent = (chapter.startTime / duration) * 100;
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';
      marker.style.left = `${percent}%`;
      marker.title = chapter.title || `Chapter ${idx + 1}`;
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        player.currentTime = chapter.startTime;
      });
      progressBar.appendChild(marker);
    }
  });
}

function setupTimelineMarkers() {
  if (!player) return;
  player.off('loadedmetadata', renderTimelineMarkers);
  player.on('loadedmetadata', renderTimelineMarkers);
  // If metadata already loaded (duration known), render immediately
  if (player.duration && !isNaN(player.duration) && player.duration !== Infinity) {
    renderTimelineMarkers();
  }
}

// GitHub Pages deployment modifications
if (window.IS_GITHUB_PAGES) {
  console.log('GitHub Pages deployment mode enabled');
  
  // Override loadLessons to use embedded data
  window.originalLoadLessons = loadLessons;
  loadLessons = function() {
    console.log('Loading embedded lessons:', window.EMBEDDED_LESSONS?.length || 0);
    displayLessons(window.EMBEDDED_LESSONS || []);
  };
  
  // Keep lesson navigation functional
  window.originalLoadLessonById = loadLessonById;
  loadLessonById = function(lessonId) {
    const lesson = window.EMBEDDED_LESSONS.find(l => l.id == lessonId);
    if (lesson) {
      console.log('Loading lesson:', lesson.title);
      initLesson(lesson);
    } else {
      showNotification('Lesson not found in deployed version');
    }
  };
  
  // Add openLessonPage function for deployment
  window.openLessonPage = function(lessonId) {
    const lesson = window.EMBEDDED_LESSONS.find(l => l.id == lessonId);
    if (lesson) {
      console.log('Opening lesson page:', lesson.title);
      // Navigate to the individual lesson page
      window.location.href = `pages/lesson-${lessonId}.html`;
    } else {
      showNotification('Lesson page not found in deployed version');
    }
  };
  
  // Wait for DOM to be ready, then setup deployment features
  document.addEventListener('DOMContentLoaded', function() {
    console.log('Setting up deployment features...');
    
    // Ensure dashboard is shown on page load
    const homeScreen = document.getElementById('home-screen');
    const appGrid = document.getElementById('app-grid');
    
    if (homeScreen && appGrid) {
      homeScreen.classList.remove('hidden');
      appGrid.classList.add('hidden');
    }
    
    // Auto-load lessons for dashboard
    if (window.EMBEDDED_LESSONS && window.EMBEDDED_LESSONS.length > 0) {
      console.log('Auto-loading lessons for dashboard');
      loadLessons();
    }
    
    // Disable lesson creation form
    const form = document.getElementById('videoForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        showNotification('❌ Lesson creation is not available in deployed version');
      });
    }
    
    // Disable lesson editing/deletion buttons
    const disableServerFeatures = () => {
      // Disable create lesson buttons
      const createBtns = document.querySelectorAll('#new-lesson-btn, #new-lesson-btn-2');
      createBtns.forEach(btn => {
        if (btn) {
          btn.disabled = true;
          btn.title = 'Not available in deployed version';
          btn.style.opacity = '0.5';
          btn.onclick = (e) => {
            e.preventDefault();
            showNotification('❌ Lesson creation is not available in deployed version');
          };
        }
      });
      
      // Disable edit buttons
      document.querySelectorAll('button[onclick*="editLesson"]').forEach(btn => {
        btn.disabled = true;
        btn.title = 'Not available in deployed version';
        btn.style.opacity = '0.5';
      });
      
      // Disable delete buttons and selection features
      document.querySelectorAll('button[onclick*="deleteLesson"], .lesson-checkbox, #select-all-btn, #delete-selected-btn').forEach(btn => {
        btn.disabled = true;
        btn.title = 'Not available in deployed version';
        btn.style.opacity = '0.5';
      });
      
      // Disable GitHub deployment button
      const deployBtn = document.getElementById('deploy-github-btn');
      if (deployBtn) {
        deployBtn.disabled = true;
        deployBtn.title = 'Not available in deployed version';
        deployBtn.style.opacity = '0.5';
      }
      
      // Disable regenerate pages button
      const regenerateBtn = document.getElementById('regenerate-pages-btn');
      if (regenerateBtn) {
        regenerateBtn.disabled = true;
        regenerateBtn.title = 'Not available in deployed version';
        regenerateBtn.style.opacity = '0.5';
      }
    };
    
    // Initial disable
    disableServerFeatures();
    
    // Re-disable after lesson list updates
    const originalDisplayLessons = displayLessons;
    displayLessons = function(lessons) {
      originalDisplayLessons(lessons);
      setTimeout(disableServerFeatures, 100);
    };
    
    // Add deployment banner
    const banner = document.createElement('div');
    banner.className = 'bg-blue-900 bg-opacity-50 text-blue-200 p-3 rounded-lg mb-4';
    banner.innerHTML = `
      <div class="flex items-center">
        <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"/>
        </svg>
        <span><strong>Deployed Version</strong> - View lessons, play videos, search transcripts, and navigate chapters. Creation and editing features are disabled.</span>
      </div>
    `;
    
    const contentArea = document.querySelector('.flex-1.overflow-y-auto.p-8');
    if (contentArea) {
      contentArea.insertBefore(banner, contentArea.firstChild);
    }
  });
  
  // Keep all viewing features functional
  // (transcript search, timeline markers, chapters, etc. remain unchanged)
}
