// URL Web App Google Apps Script Anda
const GOOGLE_SHEET_SCRIPT_URL = "https://docs.google.com/spreadsheets/d/1Y9PrBYHAkst8NZQpjm0QmU8FqMViA6JYN1H2SL0yMu4/edit?usp=sharing";

//======================================================
// 1. OTENTIKASI & NAVIGASI TAB
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
// 2. INISIALISASI GRAFIK REAL-TIME
//======================================================
let realtimeChart;
const maxDataPoints = 10;

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
// 3. KONEKSI MQTT BROKER
//======================================================
const broker = "broker.hivemq.com";
const port = 8884;
const clientID = "WebDashboard_" + Math.random().toString(16).substr(2, 8);

let client = null;
let esp32Timeout = null;

function initMQTT() {
  try {
    client = new Paho.MQTT.Client(broker, port, clientID);
    client.onConnectionLost = onConnectionLost;
    client.onMessageArrived = onMessageArrived;

    client.connect({
      useSSL: true,
      onSuccess: onConnect,
      onFailure: onFail,
      timeout: 4
    });
  } catch (e) {
    setOfflineStatus();
  }
}

function onConnect() {
  // Saat pertama kali masuk, status langsung diatur OFFLINE (menunggu paket data ESP32)
  setOfflineStatus();

  client.subscribe("kualitas_air/data");
  client.subscribe("water_system/sensor/status");
  client.subscribe("water_system/control/relay/feedback");
}

function onFail(err) {
  setOfflineStatus();
}

function onConnectionLost(responseObject) {
  setOfflineStatus();
}

function setOfflineStatus() {
  const status = document.getElementById("connection-status");
  status.innerText = "OFFLINE";
  status.className = "px-3 py-1 text-[10px] md:text-xs font-bold rounded bg-slate-400 text-white tracking-widest";
}

//======================================================
// 4. OLAH DATA & PENGIRIMAN KE GOOGLE SHEET
//======================================================
function processData(phVal, tdsVal) {
  const ph = parseFloat(phVal).toFixed(2);
  const tds = parseInt(tdsVal);

  document.getElementById("val-ph").innerText = ph;
  document.getElementById("val-tds").innerText = tds;

  const timeNow = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const isLayak = (ph >= 6.50 && ph <= 8.50 && tds >= 0 && tds <= 500);
  const statusText = isLayak ? "LAYAK" : "TIDAK LAYAK";

  const statusElem = document.getElementById("val-status");
  statusElem.innerText = statusText;
  statusElem.className = `text-2xl font-bold uppercase ${isLayak ? 'text-emerald-600' : 'text-red-500'}`;

  updateChart(timeNow, ph, tds);
  addTableRow(timeNow, ph, tds, statusText);
  sendDataToGoogleSheet(timeNow, ph, tds, statusText);
}

function onMessageArrived(message) {
  const topic = message.destinationName;
  const payload = message.payloadString;

  if (topic === "kualitas_air/data") {
    try {
      const data = JSON.parse(payload);
      
      // KETIKA ADA DATA MASUK DARI ESP32: Ubah status jadi ONLINE
      const status = document.getElementById("connection-status");
      status.innerText = "ONLINE";
      status.className = "px-3 py-1 text-[10px] md:text-xs font-bold rounded bg-emerald-500 text-white tracking-widest online-pulse";

      processData(data.ph, data.tds);

      // Jika dalam 10 detik ESP32 berhenti mengirim data, ubah kembali jadi OFFLINE
      if (esp32Timeout) clearTimeout(esp32Timeout);
      esp32Timeout = setTimeout(() => {
        setOfflineStatus();
      }, 10000);

    } catch (e) {
      console.error("Error Parse JSON:", e);
    }
  }

  if (topic === "water_system/sensor/status") {
    const statusElem = document.getElementById("val-status");
    statusElem.innerText = payload;
    statusElem.className = `text-2xl font-bold uppercase ${(payload === "LAYAK" || payload === "ONLINE") ? 'text-emerald-600' : 'text-red-500'}`;
  }

  if (topic === "water_system/control/relay/feedback") {
    updateButtonUI(payload === "ON");
  }
}

// Mengirim data otomatis ke Google Sheets via Web App
function sendDataToGoogleSheet(waktu, ph, tds, status) {
  if (!GOOGLE_SHEET_SCRIPT_URL) return;

  const payload = { waktu, ph, tds, status };

  fetch(GOOGLE_SHEET_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Gagal sinkronisasi Google Sheet:", err));
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
  realtimeChart.update();
}

function addTableRow(time, ph, tds, status) {
  const tbody = document.getElementById("history-table-body");
  
  if (tbody.children.length === 1 && tbody.children[0].cells.length === 1) {
    tbody.innerHTML = "";
  }

  const row = document.createElement("tr");
  const colorClass = (status === "LAYAK") ? "text-emerald-600 font-bold" : "text-red-500 font-bold";

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
// 6. KONTROL MANUAL MESIN
//======================================================
let isEngineOn = false;

function togglePower() {
  isEngineOn = !isEngineOn;
  const command = isEngineOn ? "ON" : "OFF";
  
  if (client && client.isConnected()) {
    const message = new Paho.MQTT.Message(command);
    message.destinationName = "kualitas_air/kontrol";
    client.send(message);
  }

  updateButtonUI(isEngineOn);
}

function updateButtonUI(isOn) {
  isEngineOn = isOn;
  const btn = document.getElementById("btn-power");
  if (isOn) {
    btn.innerText = "KONTROL MESIN: ON";
    btn.className = "w-full py-4 rounded font-bold text-white shadow bg-emerald-600 hover:bg-emerald-700 transition uppercase tracking-wider";
  } else {
    btn.innerText = "KONTROL MESIN: OFF";
    btn.className = "w-full py-4 rounded font-bold text-white shadow bg-slate-400 hover:bg-slate-500 transition uppercase tracking-wider";
  }
}