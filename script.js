// --- KONFIGURASI MQTT ---
const mqttBroker = "broker.hivemq.com";
const isHttps = location.protocol === 'https:';
const mqttPort = isHttps ? 8884 : 8000; 
const useSSL = isHttps;

let client = null;
let currentPowerState = false;
let isWaterLayak = false;

// Deteksi Alat Online/Offline
let lastDataTime = 0;
let isEspOnline = false;

// Variabel Grafik
let sensorChart;
let timeData = [];
let phData = [];
let tdsData = [];

// --- FITUR LOGIN & LOGOUT ---
function handleLogin(e) {
  e.preventDefault();
  if (document.getElementById('username').value === "admin" && document.getElementById('password').value === "admin123") {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    initChart(); 
    initMQTT(); 
  } else {
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function handleLogout() {
  if (client) client.disconnect();
  location.reload(); 
}

// --- MENU TITIK TIGA ---
function toggleMenu() {
  document.getElementById('dropdown-menu').classList.toggle('hidden');
}

function switchTab(tabName) {
  ['monitoring', 'info', 'about'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  document.getElementById('dropdown-menu').classList.add('hidden'); 
}

// --- INISIASI GRAFIK (2 SUMBU Y SEPERTI GAMBAR) ---
function initChart() {
  const ctx = document.getElementById('sensorChart').getContext('2d');
  sensorChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: timeData,
      datasets: [
        { 
          label: 'pH Air', 
          borderColor: '#0ea5e9', // Biru muda
          backgroundColor: '#0ea5e9',
          data: phData, 
          yAxisID: 'y',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 3
        },
        { 
          label: 'TDS (ppm)', 
          borderColor: '#f97316', // Orange kemerahan
          backgroundColor: '#f97316',
          data: tdsData, 
          yAxisID: 'y1',
          tension: 0.3, 
          borderWidth: 2,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 6 } }
      },
      scales: { 
        x: { 
          display: true, 
          grid: { display: false } 
        }, 
        y: { 
          type: 'linear', display: true, position: 'left', 
          min: 0, max: 14,
          title: { display: true, text: 'pH' }
        },
        y1: {
          type: 'linear', display: true, position: 'right',
          min: 0, max: 1000,
          title: { display: true, text: 'TDS (ppm)' },
          grid: { drawOnChartArea: false } // Hilangkan garis kotak bertabrakan
        }
      }
    }
  });
}

function updateChartData(ph, tds) {
  const now = new Date().toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
  
  if (timeData.length > 8) { 
    timeData.shift(); phData.shift(); tdsData.shift();
  }
  
  timeData.push(now);
  phData.push(ph);
  tdsData.push(tds);
  sensorChart.update();
}

// --- MQTT & STATUS ESP32 ---
function initMQTT() {
  const clientId = "Web_" + Math.random().toString(16).substring(2, 8);
  client = new Paho.MQTT.Client(mqttBroker, mqttPort, clientId);
  client.onMessageArrived = onMessageArrived;
  client.connect({ onSuccess: onConnect, useSSL: useSSL });
}

function onConnect() {
  client.subscribe("water_system/sensor/ph");
  client.subscribe("water_system/sensor/tds");
  client.subscribe("water_system/sensor/status");
  client.subscribe("water_system/control/power/feedback");
}

// Cek timeout alat setiap 2 detik
setInterval(() => {
  if (isEspOnline && (Date.now() - lastDataTime > 5000)) { 
    isEspOnline = false;
    updateStatusBadge(false);
  }
}, 2000);

function updateStatusBadge(isOnline) {
  const badge = document.getElementById('connection-status');
  if (isOnline) {
    badge.className = "px-3 py-1 text-[10px] md:text-xs font-bold rounded text-white tracking-widest online-pulse";
    badge.innerText = "ONLINE";
  } else {
    badge.className = "px-3 py-1 text-[10px] md:text-xs font-bold rounded bg-slate-400 text-white tracking-widest";
    badge.innerText = "OFFLINE";
    document.getElementById('val-status').innerText = "MENUNGGU...";
    document.getElementById('val-status').className = "text-2xl font-bold text-slate-400 uppercase";
    isWaterLayak = false;
    updatePowerButtonUI();
  }
}

// --- PROSES DATA ---
let tempPh = null; 

function onMessageArrived(message) {
  const topic = message.destinationName;
  const payload = message.payloadString;

  lastDataTime = Date.now();
  if (!isEspOnline) {
    isEspOnline = true;
    updateStatusBadge(true);
  }

  if (topic === "water_system/sensor/ph") {
    tempPh = parseFloat(payload).toFixed(2);
    document.getElementById('val-ph').innerText = tempPh;
  } 
  else if (topic === "water_system/sensor/tds") {
    document.getElementById('val-tds').innerText = payload;
    if (tempPh !== null) updateChartData(tempPh, payload); 
  } 
  else if (topic === "water_system/sensor/status") {
    const el = document.getElementById('val-status');
    isWaterLayak = (payload === "LAYAK");

    if (isWaterLayak) {
      el.innerText = "LAYAK";
      el.className = "text-2xl font-medium text-[#22c55e] uppercase"; // Hijau seperti gambar
    } else {
      el.innerText = "TIDAK LAYAK";
      el.className = "text-2xl font-medium text-red-500 uppercase";
    }
    updatePowerButtonUI();
    addHistoryRow();
  }
  else if (topic === "water_system/control/power/feedback") {
    currentPowerState = (payload === "ON");
    updatePowerButtonUI();
  }
}

// --- KONTROL MESIN ---
function togglePower() {
  if (!isWaterLayak || !isEspOnline) return;
  const newState = currentPowerState ? "OFF" : "ON";
  const msg = new Paho.MQTT.Message(newState);
  msg.destinationName = "water_system/control/power";
  client.send(msg);
}

function updatePowerButtonUI() {
  const btn = document.getElementById('btn-power');
  if (!isEspOnline) {
    btn.disabled = true;
    btn.className = "w-full py-4 rounded font-bold text-white bg-slate-300 cursor-not-allowed uppercase tracking-wider";
    btn.innerText = "OFFLINE";
  } else if (!isWaterLayak) {
    btn.disabled = true;
    btn.className = "w-full py-4 rounded font-bold text-white bg-slate-300 cursor-not-allowed uppercase tracking-wider";
    btn.innerText = "TERKUNCI (AIR BURUK)";
  } else {
    btn.disabled = false;
    if (currentPowerState) {
      btn.className = "w-full py-4 rounded font-bold text-white shadow-md bg-blue-500 hover:bg-blue-600 cursor-pointer uppercase tracking-wider";
      btn.innerText = "KONTROL MESIN: ON";
    } else {
      btn.className = "w-full py-4 rounded font-bold text-white shadow-md bg-[#22c55e] hover:bg-[#16a34a] cursor-pointer uppercase tracking-wider"; // Hijau terang sesuai gambar
      btn.innerText = "KONTROL MESIN: OFF";
    }
  }
}

// --- TABEL RIWAYAT ---
function addHistoryRow() {
  const ph = document.getElementById('val-ph').innerText;
  const tds = document.getElementById('val-tds').innerText;
  const statusEl = document.getElementById('val-status');
  const statusText = statusEl.innerText;
  const statusColor = statusText === "LAYAK" ? "text-[#22c55e]" : "text-red-500";
  const now = new Date().toLocaleTimeString('id-ID');
  
  const tbody = document.getElementById('history-table-body');
  if (tbody.children[0] && tbody.children[0].innerText.includes("Belum ada data")) { tbody.innerHTML = ''; }

  const row = document.createElement('tr');
  row.className = "border-b border-slate-50";
  row.innerHTML = `
    <td class="py-3 px-2 text-slate-500">${now}</td>
    <td class="py-3 px-2 font-medium">${ph}</td>
    <td class="py-3 px-2 font-medium">${tds}</td>
    <td class="py-3 px-2 font-bold ${statusColor}">${statusText}</td>
  `;
  tbody.insertBefore(row, tbody.firstChild);
  if (tbody.children.length > 8) tbody.removeChild(tbody.lastChild);
}