// Clock and Date
function updateClock() {
    const now = new Date();
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(n => String(n).padStart(2, "0"));
    document.getElementById("current-time").innerHTML = 
        `${time[0]}:${time[1]}<span class="gray">:${time[2]}</span>`;
}

function updateDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const month = months[now.getMonth()];
    document.getElementById("current-date").innerHTML = 
        `${day}. <span class="gray">${month}</span>`;
}

updateClock();
updateDate();
setInterval(updateClock, 1000);

// Data Generation
const TOTAL_POINTS = 600;
const SECONDS_PER_POINT = 1;

function makeSeries(mean, min, max, jitter) {
    const arr = [];
    let v = mean;
    for (let i = 0; i < TOTAL_POINTS; i++) {
        v += (Math.random() - 0.5) * jitter;
        v = Math.max(min, Math.min(max, v));
        arr.push(v);
    }
    return arr;
}

const HR = makeSeries(89, 82, 99, 1.4);
const ABP_SYS = makeSeries(120, 100, 140, 2.0);
const ABP_DIA = makeSeries(70, 60, 90, 1.5);
const ABP_MBP = ABP_SYS.map((v, i) => (v + 2 * ABP_DIA[i]) / 3);

const METRIC_DATA = {
    rr:    { label: "RR",    color: "#FFF268", data: makeSeries(13, 3, 20, 0.6) },
    spo2:  { label: "SpO₂",  color: "#0AE1FF", data: makeSeries(95, 88, 99, 0.8) },
    abp:   { label: "ABP",   color: "#FF343B", data: ABP_MBP },
    pulse: { label: "Pulse", color: "#8A38F5", data: makeSeries(89, 82, 99, 1.4) },
    temp:  { label: "Temp",  color: "#FD9928", data: makeSeries(36.3, 35.6, 36.8, 0.05) }
};

// State
let currentIndex = 59;
let isPaused = true;
let windowSeconds = 300;
const activeOverlays = new Set();
const events = [];

// Time window presets
const TIME_PRESETS = {
    short: 30,
    medium: 300,
    full: 600
};

// DOM Elements
const chartsContainer = document.getElementById("chartsContainer");
const overlayRows = document.getElementById("overlayRows");
const pauseBtn = document.getElementById("pauseBtn");
const popup = document.getElementById("eventPopup");
const eventsPanel = document.getElementById("eventsPanel");
const hrSvg = document.getElementById("hrChart");

const displays = {
    hr: document.getElementById("hr-value"),
    spo2: document.getElementById("spo2-value"),
    rr: document.getElementById("rr-value"),
    systolic: document.getElementById("systolic-value"),
    diastolic: document.getElementById("diastolic-value"),
    pulse: document.getElementById("pulse-value"),
    temp: document.getElementById("temp-value")
};

// Window Utils
function getWindowRange() {
    if (windowSeconds === "full") return { start: 0, end: TOTAL_POINTS - 1 };
    const length = Math.floor(windowSeconds / SECONDS_PER_POINT);
    return { start: Math.max(0, currentIndex - length + 1), end: currentIndex };
}

function getWindowSlice(arr) {
    const { start, end } = getWindowRange();
    return arr.slice(start, end + 1);
}

// Update time button active state based on current zoom
function updateTimeButtonState() {
    const buttons = document.querySelectorAll(".time-btn");
    buttons.forEach(btn => btn.classList.remove("active"));
    
    const trendLineImg = document.querySelector(".trend-line");
    
    if (windowSeconds === TIME_PRESETS.short) {
        document.querySelector('[data-window="30"]').classList.add("active");
        if (trendLineImg) trendLineImg.src = "Elements/Trends_Line_30s.svg";
    } else if (windowSeconds === TIME_PRESETS.medium) {
        document.querySelector('[data-window="300"]').classList.add("active");
        if (trendLineImg) trendLineImg.src = "Elements/Trends_Line.svg";
    } else if (windowSeconds >= TIME_PRESETS.full || windowSeconds === "full") {
        document.querySelector('[data-window="full"]').classList.add("active");
        if (trendLineImg) trendLineImg.src = "Elements/Trends_Line_30m.svg";
    }
}

// Rendering with D3
function renderLine(svg, data, color) {
    const svgEl = d3.select(svg);
    svgEl.selectAll("*").remove();
    
    const [w, h] = [1094, 60];
    svgEl.attr("viewBox", `0 0 ${w} ${h}`)
         .attr("preserveAspectRatio", "none");

    // Grid lines
    for (let i = 0; i <= 5; i++) {
        const y = (h / 5) * i;
        svgEl.append("line")
            .attr("x1", 0)
            .attr("x2", w)
            .attr("y1", y)
            .attr("y2", y)
            .attr("stroke", i === 0 || i === 5 ? "#555" : "#222")
            .attr("stroke-width", i === 0 || i === 5 ? 1.4 : 0.8);
    }

    if (data.length < 2) return;

    const minV = d3.min(data);
    const maxV = d3.max(data);
    const range = maxV - minV || 1;

    const xScale = d3.scaleLinear()
        .domain([0, data.length - 1])
        .range([0, w]);

    const yScale = d3.scaleLinear()
        .domain([minV, maxV])
        .range([h - 3, 3]);

    const line = d3.line()
        .x((d, i) => xScale(i))
        .y(d => yScale(d))
        .curve(d3.curveLinear);

    svgEl.append("path")
        .datum(data)
        .attr("d", line)
        .attr("stroke", color)
        .attr("fill", "none")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round");
}

function renderMarkers() {
    chartsContainer.querySelectorAll(".marker").forEach(m => m.remove());
    const { start, end } = getWindowRange();
    const visibleLen = end - start + 1;

    events.forEach(ev => {
        if (ev.index < start || ev.index > end) return;
        const row = ev.metric === "hr" ? document.getElementById("hrRow") 
            : overlayRows.querySelector(`.overlay-row[data-metric="${ev.metric}"]`);
        if (!row) return;

        const svg = row.querySelector("svg");
        const rect = svg.getBoundingClientRect();
        const x = rect.left + ((ev.index - start) / (visibleLen - 1 || 1)) * rect.width;

        const dot = document.createElement("div");
        dot.className = "marker";
        dot.style.left = (x - row.getBoundingClientRect().left) + "px";
        row.appendChild(dot);
    });
}

function updateDisplayValues() {
    displays.hr.textContent = Math.round(HR[currentIndex]);
    displays.spo2.textContent = Math.round(METRIC_DATA.spo2.data[currentIndex]);
    displays.rr.textContent = Math.round(METRIC_DATA.rr.data[currentIndex]);
    displays.pulse.textContent = Math.round(METRIC_DATA.pulse.data[currentIndex]);
    displays.temp.textContent = Math.round(METRIC_DATA.temp.data[currentIndex]);
    displays.systolic.textContent = Math.round(ABP_SYS[currentIndex]);
    displays.diastolic.textContent = Math.round(ABP_DIA[currentIndex]);
}

function renderCharts() {
    renderLine(hrSvg, getWindowSlice(HR), "#44E35C");

    overlayRows.querySelectorAll(".overlay-row").forEach(row => {
        const id = row.dataset.metric;
        renderLine(row.querySelector("svg"), getWindowSlice(METRIC_DATA[id].data), METRIC_DATA[id].color);
    });

    renderMarkers();
}

// Animation Loop
let lastStepTime = performance.now();
let lastDisplayTime = performance.now();

function stepData(now) {
    if (!isPaused && now - lastStepTime >= 250) {
        lastStepTime = now;
        currentIndex = (currentIndex + 1) % TOTAL_POINTS;
    }
}

function stepDisplayData(now) {
    if (now - lastDisplayTime >= 2000) {
        lastDisplayTime = now;
        currentIndex = (currentIndex + 1) % TOTAL_POINTS;
    }
}

function loop(now) {
    const timestamp = now || performance.now();
    
    if (isPaused) {
        stepDisplayData(timestamp);
        updateDisplayValues();
    } else {
        stepData(timestamp);
        updateDisplayValues();
        renderCharts();
    }
    
    requestAnimationFrame(loop);
}

// Initial render
updateDisplayValues();
renderCharts();
requestAnimationFrame(loop);

// Overlays
function addOverlay(id) {
    if (activeOverlays.has(id)) return;
    activeOverlays.add(id);

    const row = document.createElement("div");
    row.className = "chart-row overlay-row";
    row.dataset.metric = id;
    row.draggable = true;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("chart-svg");
    row.appendChild(svg);

    row.addEventListener("dragstart", () => row.classList.add("dragging"));
    row.addEventListener("dragend", e => {
        row.classList.remove("dragging");
        const rect = chartsContainer.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || 
            e.clientY < rect.top || e.clientY > rect.bottom) {
            removeOverlay(id);
        }
    });

    overlayRows.appendChild(row);
    requestAnimationFrame(() => {
        row.classList.add("visible");
        renderCharts();
    });
    document.querySelector(`.folder[data-metric="${id}"]`).classList.add("active");
}

function removeOverlay(id) {
    activeOverlays.delete(id);
    const row = overlayRows.querySelector(`.overlay-row[data-metric="${id}"]`);
    if (row) row.remove();
    const folder = document.querySelector(`.folder[data-metric="${id}"]`);
    if (folder) folder.classList.remove("active");
}

// Hammer.js Drag
document.querySelectorAll(".folder[draggable]").forEach(folder => {
    const mc = new Hammer(folder);
    let isDragging = false;
    
    mc.on("panstart", () => {
        isDragging = true;
        folder.classList.add("dragging");
        Object.assign(folder.style, { position: "fixed", zIndex: "1000", pointerEvents: "none" });
    });
    
    mc.on("panmove", e => {
        if (isDragging) Object.assign(folder.style, { left: e.center.x + "px", top: e.center.y + "px" });
    });
    
    mc.on("panend", e => {
        folder.classList.remove("dragging");
        Object.assign(folder.style, { position: "", zIndex: "", pointerEvents: "", left: "", top: "" });
        
        const rect = chartsContainer.getBoundingClientRect();
        if (e.center.x > rect.left && e.center.x < rect.right && 
            e.center.y > rect.top && e.center.y < rect.bottom) {
            addOverlay(folder.dataset.metric);
        }
        isDragging = false;
    });
});

// Pause/Live
pauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? "Go Live" : "Pause";
    if (isPaused) renderCharts(); // Render current state when pausing
});

// Refresh Button - regenerates data while keeping overlays
const refreshBtn = document.getElementById("refreshBtn");
refreshBtn.addEventListener("click", () => {
    // Regenerate all data series
    const newHR = makeSeries(89, 82, 99, 1.4);
    const newABP_SYS = makeSeries(120, 100, 140, 2.0);
    const newABP_DIA = makeSeries(70, 60, 90, 1.5);
    const newABP_MBP = newABP_SYS.map((v, i) => (v + 2 * newABP_DIA[i]) / 3);
    
    // Update global data arrays
    HR.length = 0;
    HR.push(...newHR);
    ABP_SYS.length = 0;
    ABP_SYS.push(...newABP_SYS);
    ABP_DIA.length = 0;
    ABP_DIA.push(...newABP_DIA);
    ABP_MBP.length = 0;
    ABP_MBP.push(...newABP_MBP);
    
    // Regenerate metric data
    METRIC_DATA.rr.data = makeSeries(13, 3, 20, 0.6);
    METRIC_DATA.spo2.data = makeSeries(95, 88, 99, 0.8);
    METRIC_DATA.abp.data = newABP_MBP;
    METRIC_DATA.pulse.data = makeSeries(89, 82, 99, 1.4);
    METRIC_DATA.temp.data = makeSeries(36.3, 35.6, 36.8, 0.05);
    
    // Reset to current position and render
    currentIndex = 59;
    renderCharts();
});

// Clear Overlays Button - removes all overlay charts and marked events
const clearBtn = document.getElementById("clearBtn");
clearBtn.addEventListener("click", () => {
    // Remove all overlay rows
    overlayRows.querySelectorAll(".overlay-row").forEach(row => {
        const metric = row.dataset.metric;
        activeOverlays.delete(metric);
        row.remove();
        const folder = document.querySelector(`.folder[data-metric="${metric}"]`);
        if (folder) folder.classList.remove("active");
    });
    
    // Clear all marked events
    events.length = 0;
    updateEventsPanel();
    renderCharts(); // Re-render to remove markers
});

// Time Window with smooth zoom transitions
document.querySelectorAll(".time-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const val = btn.dataset.window;
        const newWindowSeconds = val === "full" ? TIME_PRESETS.full : Number(val);
        
        // Smooth transition to new window size
        animateWindowTransition(windowSeconds, newWindowSeconds);
    });
});

function animateWindowTransition(from, to) {
    const duration = 300; // ms
    const startTime = performance.now();
    const fromVal = from === "full" ? TIME_PRESETS.full : from;
    const toVal = to === "full" ? TIME_PRESETS.full : to;
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function for smooth transition
        const eased = 1 - Math.pow(1 - progress, 3);
        
        windowSeconds = fromVal + (toVal - fromVal) * eased;
        
        if (isPaused) renderCharts();
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            windowSeconds = to === TIME_PRESETS.full ? "full" : to;
            updateTimeButtonState();
            if (isPaused) renderCharts();
        }
    }
    
    requestAnimationFrame(animate);
}

// D3 Zoom for chart container
function setupChartZoom() {
    const container = d3.select(chartsContainer);
    
    // Calculate scale extent based on time presets
    const maxScale = TIME_PRESETS.full / TIME_PRESETS.short; // 600/30 = 20x
    const minScale = 1;
    
    const zoom = d3.zoom()
        .scaleExtent([minScale, maxScale])
        .on("zoom", (event) => {
            handleZoom(event.transform.k);
        });
    
    container.call(zoom);
    
    // Prevent default touch behavior
    container.on("touchstart", (event) => {
        if (event.touches && event.touches.length > 1) {
            event.preventDefault();
        }
    }, { passive: false });
}

function handleZoom(scale) {
    // Map scale to window seconds
    // scale 1 = full view (600s)
    // scale 20 = shortest view (30s)
    const newWindowSeconds = Math.max(
        TIME_PRESETS.short,
        Math.min(TIME_PRESETS.full, TIME_PRESETS.full / scale)
    );
    
    windowSeconds = newWindowSeconds;
    updateTimeButtonState();
    if (isPaused) renderCharts();
}

// Initialize zoom on page load
window.addEventListener("DOMContentLoaded", () => {
    setupChartZoom();
    updateTimeButtonState();
});

// Events
let pendingEventMetric = null;
let pendingEventIndex = null;

function showEventPopup(clientX, clientY, row) {
    const metric = row.id === "hrRow" ? "hr" : row.dataset.metric;
    const svg = row.querySelector("svg");
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const { start, end } = getWindowRange();
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const absoluteIndex = start + Math.round(frac * (end - start));

    pendingEventMetric = metric;
    pendingEventIndex = absoluteIndex;

    const containerRect = chartsContainer.getBoundingClientRect();
    Object.assign(popup.style, {
        left: (clientX - containerRect.left + 8) + "px",
        top: (clientY - containerRect.top + 8) + "px",
        display: "flex"
    });
}

// Double-click for desktop
chartsContainer.addEventListener("dblclick", e => {
    if (!isPaused) return;
    const row = e.target.closest(".chart-row");
    if (!row) return;
    showEventPopup(e.clientX, e.clientY, row);
});

// Double-tap for iPad/mobile
let lastTapTime = 0;
let lastTapTarget = null;

chartsContainer.addEventListener("touchend", e => {
    if (!isPaused) return;
    
    const row = e.target.closest(".chart-row");
    if (!row) return;
    
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime;
    
    if (timeSinceLastTap < 300 && lastTapTarget === row) {
        // Double tap detected
        const touch = e.changedTouches[0];
        showEventPopup(touch.clientX, touch.clientY, row);
        lastTapTime = 0;
        lastTapTarget = null;
    } else {
        lastTapTime = now;
        lastTapTarget = row;
    }
});

popup.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
        popup.style.display = "none";
        if (pendingEventMetric != null && pendingEventIndex != null) {
            events.push({ metric: pendingEventMetric, index: pendingEventIndex, type: btn.dataset.type });
            pendingEventMetric = null;
            pendingEventIndex = null;
            updateEventsPanel();
            if (isPaused) renderCharts();
        }
    });
});

function updateEventsPanel() {
    if (events.length === 0) {
        eventsPanel.style.display = "none";
        return;
    }
    eventsPanel.style.display = "flex";
    eventsPanel.innerHTML = '<div class="events-title">Marked Events</div><div class="events-items-container"></div>';
    
    const container = eventsPanel.querySelector('.events-items-container');

    events.forEach(ev => {
        const seconds = ev.index * SECONDS_PER_POINT;
        const timeStr = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        const label = ev.metric === "hr" ? "HR" : METRIC_DATA[ev.metric].label;

        const div = document.createElement("div");
        div.className = "event-item";
        div.innerHTML = `
            <div class="event-metric">${label}</div>
            <div class="event-type">${ev.type}</div>
            <div class="event-time">${timeStr}</div>
        `;
        div.addEventListener("click", () => {
            const half = windowSeconds === "full" ? 0 : Math.floor(windowSeconds / (2 * SECONDS_PER_POINT));
            currentIndex = (ev.index + half) % TOTAL_POINTS;
            isPaused = true;
            pauseBtn.textContent = "Go Live";
        });
        container.appendChild(div);
    });
}
