import { Hono } from 'hono'
import { html } from 'hono/html'
import { Bindings } from '../types'

const dashboardRouter = new Hono<{ Bindings: Bindings }>()

dashboardRouter.get('/', (c) => {
  return c.html(
    <html lang="id">
      <head>
        <title>Dashboard Pekerja OPAI</title>
        <script src="https://cdn.tailwindcss.com"></script>
        {html`
        <style>
          .tab-content { display: none; }
          .tab-content.active { display: block; }
        </style>
        `}
      </head>
      <body class="bg-gray-50 text-gray-800 font-sans min-h-screen">
        <nav class="bg-blue-800 text-white shadow-md">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16 items-center">
              <div class="flex items-center space-x-4">
                <span class="font-bold text-xl tracking-wider">OPAI WORKER</span>
                <button onclick="switchTab('inbox')" class="px-3 py-2 rounded-md hover:bg-blue-700 focus:bg-blue-900 transition">Antrean Inbox</button>
                <button onclick="switchTab('gopay')" class="px-3 py-2 rounded-md hover:bg-blue-700 focus:bg-blue-900 transition">Sambungkan GoPay</button>
              </div>
              <a href="/api/auth/logout" class="text-sm bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded transition">Keluar</a>
            </div>
          </div>
        </nav>

        <main class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          
          {/* TAB 1: GOPAY CONNECTOR */}
          <div id="tab-gopay" class="tab-content">
            <h2 class="text-2xl font-bold mb-4">Manajemen Akun GoPay</h2>
            <div class="bg-white p-6 rounded-lg shadow-sm border border-gray-200 w-full max-w-md">
              <div id="gopay-step-1">
                <label class="block text-sm font-medium text-gray-700 mb-1">Nomor HP (Awali dengan 8...)</label>
                <div class="flex mb-4">
                  <span class="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">+62</span>
                  <input type="text" id="gp_phone" class="flex-1 block w-full border border-gray-300 rounded-none rounded-r-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500" placeholder="81234567890" />
                </div>

                <label class="block text-sm font-medium text-gray-700 mb-1">PIN GoPay</label>
                <input type="password" id="gp_pin" class="mb-4 block w-full border border-gray-300 rounded-md px-3 py-2" placeholder="6 Digit PIN" />

                <label class="block text-sm font-medium text-gray-700 mb-1">Kirim OTP Via</label>
                <select id="gp_channel" class="mb-6 block w-full border border-gray-300 rounded-md px-3 py-2">
                  <option value="otp_wa">WhatsApp (Sangat Disarankan)</option>
                  <option value="otp_sms">SMS</option>
                  <option value="otp_email">Email</option>
                </select>

                <button onclick="requestGopayOtp()" id="btn_req" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition">Koneksikan Akun</button>
              </div>

              <div id="gopay-step-2" class="hidden mt-4 pt-4 border-t border-gray-200">
                <label class="block text-sm font-medium text-gray-700 mb-1">Masukkan Kode OTP</label>
                <input type="text" id="gp_otp" class="mb-4 block w-full border border-gray-300 rounded-md px-3 py-2 text-center tracking-widest text-lg font-bold" placeholder="• • • • • •" />
                <button onclick="verifyGopayOtp()" id="btn_ver" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition">Verifikasi OTP & Selesaikan</button>
              </div>

              <div id="gp_msg" class="mt-4 text-sm font-medium text-center"></div>
            </div>
          </div>

          {/* TAB 2: INBOX JOBS */}
          <div id="tab-inbox" class="tab-content active">
             <div class="flex justify-between items-center mb-4">
               <h2 class="text-2xl font-bold">Live Payment Inbox</h2>
               <button onclick="fetchJobs()" class="bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm py-1 px-3 rounded shadow-sm flex items-center transition">
                 🔄 Refresh Data
               </button>
             </div>
             
             <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
               <div class="overflow-x-auto">
                 <table class="min-w-full divide-y divide-gray-200">
                   <thead class="bg-gray-50">
                     <tr>
                       <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID Transaksi</th>
                       <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Akun</th>
                       <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paket</th>
                       <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                       <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                       <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tanggal</th>
                     </tr>
                   </thead>
                   <tbody id="jobs-tbody" class="bg-white divide-y divide-gray-200">
                      <tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500">Memuat data...</td></tr>
                   </tbody>
                 </table>
               </div>
             </div>
          </div>

        </main>

        {html`
        <script>
          // =========================
          // LOGIKA TAB & UI
          // =========================
          function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + tabId).classList.add('active');
            if(tabId === 'inbox') fetchJobs();
          }

          // Format tanggal helper
          function formatDate(isoString) {
            if(!isoString) return '-';
            const d = new Date(isoString);
            return d.toLocaleString('id-ID', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'});
          }

          // =========================
          // LOGIKA JOBS / INBOX
          // =========================
          async function fetchJobs() {
            const tbody = document.getElementById('jobs-tbody');
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500">Memuat data...</td></tr>';
            
            try {
              const res = await fetch('/admin/api/jobs');
              const json = await res.json();
              
              if(json.status === 'success' && json.data.length > 0) {
                tbody.innerHTML = json.data.map(job => {
                  let statusBadge = 'bg-gray-100 text-gray-800';
                  if(job.status === 'paid') statusBadge = 'bg-green-100 text-green-800';
                  if(job.status === 'pending') statusBadge = 'bg-yellow-100 text-yellow-800';
                  if(job.status === 'cancelled' || job.status === 'expired') statusBadge = 'bg-red-100 text-red-800';

                  return \`
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">\${job.id}</td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-medium text-gray-900">\${job.account_name}</div>
                        <div class="text-sm text-gray-500">\${job.account_email}</div>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 uppercase">\${job.plan_kind}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${job.provider}</td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full \${statusBadge}">
                          \${job.status.toUpperCase()}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${formatDate(job.created_at)}</td>
                    </tr>
                  \`;
                }).join('');
              } else {
                tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500">Belum ada transaksi.</td></tr>';
              }
            } catch(e) {
              tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-sm text-red-500">Gagal memuat data jaringan.</td></tr>';
            }
          }

          // Panggil fetchJobs saat halaman pertama dimuat
          document.addEventListener("DOMContentLoaded", fetchJobs);
          // Auto-refresh tiap 30 detik
          // setInterval(fetchJobs, 30000);


          // =========================
          // LOGIKA GOPAY CONNECTOR
          // =========================
          async function requestGopayOtp() {
            const phone = document.getElementById('gp_phone').value;
            const pin = document.getElementById('gp_pin').value;
            const channel = document.getElementById('gp_channel').value;
            const msg = document.getElementById('gp_msg');
            const btn = document.getElementById('btn_req');

            if(!phone || !pin) { msg.innerHTML = "<span class='text-red-500'>Lengkapi Nomor & PIN!</span>"; return; }

            btn.disabled = true; btn.innerText = "Memproses..."; msg.innerHTML = "<span class='text-blue-500'>Berkomunikasi dengan Gojek...</span>";

            try {
              const res = await fetch('/admin/api/gopay/request-otp', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ phone, pin, channel })
              });
              const data = await res.json();
              
              if(res.ok) {
                if(data.status === "success") {
                  msg.innerHTML = \`<span class='text-green-600'>\${data.message}</span>\`;
                } else if(data.status === "awaiting_otp") {
                  msg.innerHTML = \`<span class='text-yellow-600'>\${data.message}</span>\`;
                  document.getElementById('gopay-step-2').classList.remove('hidden');
                }
              } else {
                msg.innerHTML = \`<span class='text-red-600'>Gagal: \${data.error}</span>\`;
              }
            } catch(e) {
              msg.innerHTML = "<span class='text-red-600'>Kesalahan jaringan!</span>";
            }
            btn.disabled = false; btn.innerText = "Koneksikan Akun";
          }

          async function verifyGopayOtp() {
            const phone = document.getElementById('gp_phone').value;
            const otp = document.getElementById('gp_otp').value;
            const channel = document.getElementById('gp_channel').value;
            const msg = document.getElementById('gp_msg');
            const btn = document.getElementById('btn_ver');

            if(!otp) { msg.innerHTML = "<span class='text-red-500'>Masukkan OTP!</span>"; return; }

            btn.disabled = true; btn.innerText = "Memverifikasi...";

            try {
              const res = await fetch('/admin/api/gopay/verify-otp', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ phone, otp, channel })
              });
              const data = await res.json();

              if(res.ok) {
                msg.innerHTML = \`<span class='text-green-600'>\${data.message}</span>\`;
                document.getElementById('gopay-step-2').classList.add('hidden');
              } else {
                msg.innerHTML = \`<span class='text-red-600'>Gagal: \${data.error}</span>\`;
              }
            } catch(e) {
              msg.innerHTML = "<span class='text-red-600'>Kesalahan jaringan!</span>";
            }
            btn.disabled = false; btn.innerText = "Verifikasi OTP & Selesaikan";
          }
        </script>
        `}
      </body>
    </html>
  )
})

export default dashboardRouter
