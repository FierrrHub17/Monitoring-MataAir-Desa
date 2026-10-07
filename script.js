//======================================================
// KONFIGURASI
//======================================================
const GOOGLE_SHEET_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx5xlRAVi6Uhk-f_mGg56FPSD1l6CSw8Y7AqMmHi2xC31XOpsSU4wYYyxfWnwdEw2Op/exec";

//======================================================
// 1. LOGIN & NAVIGASI
//======================================================
function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById("username").value;
  const pass = document.getElementById("password").value;

  if (user === "admin" && pass === "admin123") {
    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("dashboard-section").classList.remove("hidden");
    initMQTT();
    initChart();
  } else {
    document.getElementById("login-error").classList.remove("hidden");
  }
}

function handleLogout() {
  document.getElementById("dashboard-section").classList.add("hidden");
  document.getElementById("login-section").classList.remove("hidden");
  if (client && client.isConnected()) {
    client.disconnect();
  }
  toggleMenu(true);
}

function toggleMenu(forceClose = false) {
  const menu = document.getElementById("dropdown-menu");
  if (forceClose) {
    menu.classList.add("hidden");
  } else {
    menu.classList.toggle("hidden");
  }
}

function switchTab(tabName) {
  document.getElementById("tab-monitoring").classList.add("hidden");
  document.getElementById("tab-info").classList.add("hidden");
  document.getElementById("tab-about").classList.add("hidden");
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
  toggleMenu(true);
}

//======================================================
// 2. GRAFIK
//======================================================
let realtimeChart;
const maxDataPoints = 12;

function initChart() {
  const ctx = document.getElementById('sensorChart').getContext('2d');
  realtimeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'pH Air',
          data: [],
          borderColor: '#1e88e5',
          backgroundColor: 'rgba(30, 136, 229, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          yAxisID: 'y'
        },
        {
          label: 'TDS (ppm)',
          data: [],
          borderColor: '#e65100',
          backgroundColor: 'rgba(230, 81, 0, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { display: true },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 0,
          max: 14,
          title: { display: true, text: 'pH' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          min: 0,
          max: 1000,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'TDS (ppm)' }
        }
      }
    }
  });
}

//======================================================
// 3. MQTT (HiveMQ WSS)
//======================================================
const broker = "broker.hivemq.com";
const port = 8884;
const clientID = "WebDashboard_" + Math.random().toString(16).substr(2, 8);

let client = null;
let lastPH = null;
let lastTDS = null;
let lastStatus = "MENUNGGU...";
let lastMachine = "OFFLINE";
let esp32Timeout = null;

function initMQTT() {
  client = new Paho.MQTT.Client(broker, port, clientID);
  client.onConnectionLost = onConnectionLost;
  client.onMessageArrived = onMessageArrived;

  client.connect({
    useSSL: true,
    onSuccess: onConnect,
    onFailure: onFail,
    timeout: 5,
    keepAliveInterval: 30
  });
}

function onConnect() {
  console.log("MQTT Connected!");
  setOfflineStatus();

  client.subscribe("water_system/pH");
  client.subscribe("water_system/TDS");
  client.subscribe("water_system/status");
  client.subscribe("water_system/machine");
  client.subscribe("water_system/stsP");
  client.subscribe("water_system/jmlhB");
}

function onFail(err) {
  console.warn("MQTT Gagal:", err);
  setOfflineStatus();
}

function onConnectionLost(responseObject) {
  if (responseObject.errorCode !== 0) {
    setOfflineStatus();
    setTimeout(initMQTT, 3000);
  }
}

function setOfflineStatus() {
  const status = document.getElementById("connection-status");
  status.innerText = "OFFLINE";
  status.className = "px-3 py-1 text-[10px] md:text-xs font-bold rounded bg-slate-400 text-white tracking-widest";
}

function setOnlineStatus() {
  const status = document.getElementById("connection-status");
  status.innerText = "ONLINE";
  status.className = "px-3 py-1 text-[10px] md:text-xs font-bold rounded bg-emerald-500 text-white tracking-widest online-pulse";
}

//======================================================
// 4. TERIMA DATA DARI ESP32
//======================================================
function onMessageArrived(message) {
  const topic = message.destinationName;
  const payload = message.payloadString.trim();

  console.log(`[MQTT] ${topic} → ${payload}`);

  setOnlineStatus();
  if (esp32Timeout) clearTimeout(esp32Timeout);
  esp32Timeout = setTimeout(setOfflineStatus, 12000);

  if (topic === "water_system/pH") {
    lastPH = payload;
    document.getElementById("val-ph").innerText = payload;
  }

  if (topic === "water_system/TDS") {
    lastTDS = payload;
    document.getElementById("val-tds").innerText = payload;
  }

  if (topic === "water_system/status") {
    lastStatus = payload;
    const el = document.getElementById("val-status");
    el.innerText = payload;
    el.className = `text-2xl font-bold uppercase ${payload === "AMAN" ? "text-emerald-600" : "text-red-500"}`;
  }

  if (topic === "water_system/machine") {
    lastMachine = payload;
    document.getElementById("val-machine").innerText = payload;
    updateMachineButton(payload);
  }

  if (topic === "water_system/stsP") {
    const el = document.getElementById("val-stsp");
    el.innerText = payload;
    el.className = `text-xl font-bold uppercase ${payload === "ISI" ? "text-amber-500" : "text-slate-600"}`;
  }

  if (topic === "water_system/jmlhB") {
    document.getElementById("val-jmlhb").innerText = payload;
  }

  if (lastPH !== null && lastTDS !== null && lastPH !== "ERR") {
    const timeNow = new Date().toLocaleTimeString('id-ID', { hour12: false });
    updateChart(timeNow, parseFloat(lastPH), parseInt(lastTDS));
    addTableRow(timeNow, lastPH, lastTDS, lastStatus);
    sendDataToGoogleSheet(timeNow, lastPH, lastTDS, lastStatus);
  }
}

//======================================================
// 5. GRAFIK & TABEL
//======================================================
function updateChart(time, ph, tds) {
  if (!realtimeChart) return;

  realtimeChart.data.labels.push(time);
  realtimeChart.data.datasets[0].data.push(ph);
  realtimeChart.data.datasets[1].data.push(tds);

  if (realtimeChart.data.labels.length > maxDataPoints) {
    realtimeChart.data.labels.shift();
    realtimeChart.data.datasets[0].data.shift();
    realtimeChart.data.datasets[1].data.shift();
  }
  realtimeChart.update('none');
}

function addTableRow(time, ph, tds, status) {
  const tbody = document.getElementById("history-table-body");

  if (tbody.children.length === 1 && tbody.children[0].cells.length === 1) {
    tbody.innerHTML = "";
  }

  const row = document.createElement("tr");
  const colorClass = (status === "AMAN") ? "text-emerald-600 font-bold" : "text-red-500 font-bold";

  row.innerHTML = `
    <td class="py-2.5 px-2">${time}</td>
    <td class="py-2.5 px-2">${ph}</td>
    <td class="py-2.5 px-2">${tds}</td>
    <td class="py-2.5 px-2 ${colorClass}">${status}</td>
  `;

  tbody.insertBefore(row, tbody.firstChild);

  if (tbody.children.length > 8) {
    tbody.removeChild(tbody.lastChild);
  }
}

//======================================================
// 6. GOOGLE SHEET
//======================================================
function sendDataToGoogleSheet(waktu, ph, tds, status) {
  if (!GOOGLE_SHEET_SCRIPT_URL) return;

  const payload = { waktu, ph, tds, status };

  fetch(GOOGLE_SHEET_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Gagal kirim ke Google Sheet:", err));
}

//======================================================
// 7. UPDATE TOMBOL MESIN
//======================================================
function updateMachineButton(status) {
  const btn = document.getElementById("btn-power");
  btn.innerText = "MESIN: " + status;

  if (status === "ONLINE" || status === "MENGISI") {
    btn.className = "w-full py-4 rounded font-bold text-white shadow bg-emerald-600 transition uppercase tracking-wider cursor-default";
  } else {
    btn.className = "w-full py-4 rounded font-bold text-white shadow bg-slate-400 transition uppercase tracking-wider cursor-default";
  }
}