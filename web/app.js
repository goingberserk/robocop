// RoboCop AI - Demo Frontend.
// Es wird hier nichts gerechnet. Alles kommt aus den vorab erzeugten
// events/<clip>.json Dateien. Darum laeuft die Seite auf jedem Handy.

const CHART_W = 600;
const CHART_H = 220;

const player = document.getElementById("player");
const playBtn = document.getElementById("playBtn");
const clock = document.getElementById("clock");
const sceneLabel = document.getElementById("sceneLabel");
const chart = document.getElementById("chart");
const clipNav = document.getElementById("clipNav");
const logList = document.getElementById("log");
const footnote = document.getElementById("footnote");

const alertCard = document.getElementById("alertCard");
const alertScore = document.getElementById("alertScore");
const alertReason = document.getElementById("alertReason");
const alertWatch = document.getElementById("alertWatch");

const statScore = document.getElementById("statScore");
const statLead = document.getElementById("statLead");
const statAlerts = document.getElementById("statAlerts");

let current = null;
let hideAlertAt = null;

function formatClock(seconds) {
  let whole = Math.floor(seconds);
  let minutes = Math.floor(whole / 60);
  let rest = whole - minutes * 60;
  let mm = String(minutes).padStart(2, "0");
  let ss = String(rest).padStart(2, "0");
  return mm + ":" + ss;
}

function svgNode(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const key in attrs) {
    node.setAttribute(key, attrs[key]);
  }
  return node;
}

function pointFor(entry, duration) {
  const x = (entry.t / duration) * CHART_W;
  const y = CHART_H - (entry.score / 100) * CHART_H;
  return [x, y];
}

function drawChart(data) {
  chart.innerHTML = "";
  const duration = data.duration_s;

  // Schwellwertlinie
  const thresholdY = CHART_H - (data.threshold / 100) * CHART_H;
  chart.appendChild(svgNode("line", {
    x1: 0, y1: thresholdY, x2: CHART_W, y2: thresholdY,
    stroke: "#ffb020", "stroke-width": 1, "stroke-dasharray": "4 4", opacity: .5,
  }));

  // Marker fuer den echten Vorfall
  if (data.incident_t !== null && data.incident_t !== undefined) {
    const markerX = (data.incident_t / duration) * CHART_W;
    chart.appendChild(svgNode("line", {
      x1: markerX, y1: 0, x2: markerX, y2: CHART_H,
      stroke: "#ff3b47", "stroke-width": 1.5, opacity: .8,
    }));
  }

  // Flaeche + Linie
  let linePath = "";
  let index = 0;
  while (index < data.timeline.length) {
    const spot = pointFor(data.timeline[index], duration);
    if (index === 0) {
      linePath = "M " + spot[0] + " " + spot[1];
    } else {
      linePath = linePath + " L " + spot[0] + " " + spot[1];
    }
    index = index + 1;
  }

  if (linePath !== "") {
    const areaPath = linePath + " L " + CHART_W + " " + CHART_H + " L 0 " + CHART_H + " Z";
    chart.appendChild(svgNode("path", {
      d: areaPath, fill: "#35e0a1", opacity: .09,
    }));
    chart.appendChild(svgNode("path", {
      d: linePath, fill: "none", stroke: "#35e0a1", "stroke-width": 2,
      "vector-effect": "non-scaling-stroke",
    }));
  }

  // Abspielkopf
  const head = svgNode("line", {
    x1: 0, y1: 0, x2: 0, y2: CHART_H,
    stroke: "#e6edf3", "stroke-width": 1, opacity: .85, id: "playhead",
  });
  chart.appendChild(head);
}

function movePlayhead(seconds, duration) {
  const head = document.getElementById("playhead");
  if (!head) { return; }
  const x = (seconds / duration) * CHART_W;
  head.setAttribute("x1", x);
  head.setAttribute("x2", x);
}

function buildLog(data) {
  logList.innerHTML = "";
  let index = 0;
  while (index < data.timeline.length) {
    const entry = data.timeline[index];
    const row = document.createElement("li");
    row.dataset.t = entry.t;

    if (entry.score >= data.threshold) {
      row.className = "hot";
    } else if (entry.score >= data.threshold * 0.6) {
      row.className = "warm";
    }

    const stamp = document.createElement("span");
    stamp.className = "t";
    stamp.textContent = formatClock(entry.t) + " " + String(Math.round(entry.score)).padStart(3, " ");

    const text = document.createElement("span");
    text.textContent = entry.reason;

    row.appendChild(stamp);
    row.appendChild(text);
    logList.appendChild(row);
    index = index + 1;
  }
}

function currentScore(data, seconds) {
  let value = 0;
  let index = 0;
  while (index < data.timeline.length) {
    if (data.timeline[index].t <= seconds) {
      value = data.timeline[index].score;
    }
    index = index + 1;
  }
  return value;
}

function alertAt(data, seconds) {
  let found = null;
  let index = 0;
  while (index < data.alerts.length) {
    const alert = data.alerts[index];
    if (seconds >= alert.t && seconds < alert.t + 8) {
      found = alert;
    }
    index = index + 1;
  }
  return found;
}

function tick() {
  if (!current) { return; }
  const seconds = player.currentTime;
  const duration = current.duration_s;

  clock.textContent = formatClock(seconds) + " / " + formatClock(duration);
  movePlayhead(seconds, duration);

  const score = currentScore(current, seconds);
  statScore.textContent = Math.round(score);

  const active = alertAt(current, seconds);
  if (active) {
    alertScore.textContent = "score " + Math.round(active.score);
    alertReason.textContent = active.reason;
    alertWatch.textContent = active.watch ? "Beobachten: " + active.watch : "";
    alertCard.hidden = false;
  } else {
    alertCard.hidden = true;
  }

  const rows = logList.querySelectorAll("li");
  let index = 0;
  while (index < rows.length) {
    const rowTime = Number(rows[index].dataset.t);
    rows[index].style.opacity = rowTime <= seconds ? "1" : "0.28";
    index = index + 1;
  }
}

async function loadClip(name) {
  const response = await fetch("events/" + name + ".json");
  const data = await response.json();
  current = data;

  player.src = data.video;
  player.load();

  sceneLabel.textContent = [data.label, data.location].filter(Boolean).join(" · ");
  statAlerts.textContent = data.alerts.length;
  statLead.textContent = data.lead_time_s !== null && data.lead_time_s !== undefined
    ? data.lead_time_s + "s"
    : "—";

  drawChart(data);
  buildLog(data);
  alertCard.hidden = true;
  clock.textContent = "00:00 / " + formatClock(data.duration_s);

  const buttons = clipNav.querySelectorAll(".clip-btn");
  let index = 0;
  while (index < buttons.length) {
    buttons[index].setAttribute("aria-current", buttons[index].dataset.clip === name ? "true" : "false");
    index = index + 1;
  }
}

async function boot() {
  const response = await fetch("events/index.json");
  const manifest = await response.json();

  footnote.textContent = manifest.footnote || "";

  let index = 0;
  while (index < manifest.clips.length) {
    const item = manifest.clips[index];
    const button = document.createElement("button");
    button.className = "clip-btn";
    button.dataset.clip = item.id;
    button.textContent = item.title;
    button.addEventListener("click", function () { loadClip(item.id); });
    clipNav.appendChild(button);
    index = index + 1;
  }

  if (manifest.clips.length > 0) {
    await loadClip(manifest.clips[0].id);
  }
}

playBtn.addEventListener("click", function () {
  if (player.paused) {
    player.play();
    playBtn.textContent = "Pause";
  } else {
    player.pause();
    playBtn.textContent = "Abspielen";
  }
});

player.addEventListener("timeupdate", tick);
player.addEventListener("seeked", tick);
player.addEventListener("ended", function () { playBtn.textContent = "Abspielen"; });

boot();
