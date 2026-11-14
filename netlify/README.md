# Testnet Toolkit API — Netlify port (Edge Functions)

Port dari build Cloudflare Worker (`../src/index.js`, RUN 27) dan port
Vercel (`../vercel/`, RUN 29) ke **Netlify Free (Edge Functions)**.
Keputusan: Muy 14 Nov 14:36 WIB — "Cari alternatif yg lebih mudah"
(setelah Cloudflare mentok Turnstile + Vercel mentok verifikasi SMS
12 jam). Target tetap hanya +500 poin quest vAPI "List your API".

## Kenapa Netlify (terverifikasi dari dokumen resmi, 14 Nov 2026)

- **Signup via GitHub, tanpa verifikasi SMS/telepon, tanpa kartu
  kredit.** Alur: netlify.com → Sign up → GitHub → Authorize Netlify.
  Tidak ada langkah SMS di alur signup. (Sumber: dokumen Netlify +
  Self-Serve Subscription Agreement 4 Nov 2026 — tidak ada syarat
  verifikasi telepon/kartu di dalamnya.)
- **Free $0, 300 credits/bulan (hard cap).** Biaya: 15 credits per
  production deploy, 2 credits per 10.000 web request, 20 credits/GB
  bandwidth, 10 credits/GB-jam compute. Pemakaian kita ~1 rb
  request/bulan + beberapa deploy ≈ **di bawah 50 credits/bulan** —
  jauh di bawah 300. Bila credits habis, SEMUA site di akun di-pause
  sampai siklus berikutnya (tidak akan terjadi pada pemakaian ini).
- **Boleh komersial di paket gratis** (beda dari Vercel Hobby).
  Pengumuman resmi Netlify 12 Nov 2024: "On the Free plan, you can
  deploy commercial projects, personal sites, or other creative
  explorations." Agreement 4 Nov 2026 tidak membatasi jenis pemakaian;
  yang dilarang hanya menjual kembali layanan Netlify sebagai layanan
  mandiri (§2.5) dan memakai Functions sebagai compute mandiri di luar
  site (§2.8) — API ini bagian dari site (ada `public/index.html`),
  jadi patuh.
- **Selalu responsif (tidak tidur).** Edge Functions serverless:
  bangun per request, cold start hitungan ms. Recheck vAPI per jam
  tidak akan gagal karena tidur (beda dari Render/Koyeb free).
- **Deno Deploy shutdown TIDAK berpengaruh.** Edge Functions jalan di
  runtime Deno di infrastruktur Netlify sendiri, bukan di Deno Deploy.
  (Catatan jangka panjang: pengembangan runtime Deno berakhir ~Okt
  2027 — tidak relevan untuk quest ini; poin didapat saat listing live.)
- **Koyeb GAGAL jadi cadangan:** diakuisisi Mistral AI (Feb 2026),
  free Starter TIDAK tersedia lagi untuk pendaftar baru (Pro $29/bln),
  plus butuh kartu kredit ($29 hold) + instance tidur setelah 1 jam.

## RISIKO YANG MASIH ADA (jujur — baca sebelum deploy)

**Netlify punya filter anti-abuse yang kadang menandai akun gratis baru
sebagai spam.** Bila kena, satu-satunya jalan buka blokir adalah
verifikasi identitas via Stripe (upload KTP/dokumen resmi) ATAU
upgrade ke Pro (berbayar). Keduanya TIDAK BOLEH dilakukan (jangan
upload dokumen identitas, jangan bayar). Risiko ini tidak sistematis —
banyak signup GitHub lolos tanpa masalah — dan akun GitHub kita
(`duryanagy-wq`, sudah lama + ada repo) mengurangi risikonya, tapi
tidak menghilangkan. **Bila saat signup muncul permintaan upload
dokumen identitas / verifikasi Stripe: BERHENTI, laporkan, jangan
lanjutkan.** Fallback saat itu: retry Vercel besok 07:10 WIB (cron
`vercel-sms-retry-2026-11-15-0730`) atau Cloudflare via HP Muy.

## Struktur folder ini (paket deploy — upload ke repo yang SUDAH ADA)

Repo: `https://github.com/duryanagy-wq/testnet-toolkit-vercel`
(Public, sudah berisi port Vercel di root. Netlify mengabaikan folder
`api/` Vercel; Vercel mengabaikan `netlify.toml` + `netlify/` +
`public/` — keduanya bisa hidup berdampingan di satu repo.)

| File lokal (folder ini) | Upload ke repo sebagai |
|---|---|
| `netlify.toml` | `netlify.toml` (ROOT repo) |
| `public/index.html` | `public/index.html` |
| `edge-functions/api.js` | `netlify/edge-functions/api.js` |
| `openapi.json` | `netlify/openapi.json` |
| `test/harness.mjs`, `test/serve.mjs` | `netlify/test/harness.mjs`, `netlify/test/serve.mjs` |
| `README.md` (file ini) | `netlify/README.md` |

## Desain port (yang berubah vs Vercel)

- **Runtime Deno** (Netlify Edge Functions). Hanya API Web standar
  yang dipakai (`fetch`, `btoa`/`atob`, `BigInt`,
  `AbortSignal.timeout`) — jalan tanpa perubahan di Deno.
- **Default export berupa fungsi** `(request) => handler.fetch(request)`
  — Netlify mengharapkan default-export function, bukan objek
  `{ fetch }` (Vercel/Workers). Logika di dalamnya TIDAK berubah.
- **Semua path publik di bawah `/api/...`**, dideklarasikan di
  `netlify.toml` (`/api` DAN `/api/*` — glob `/api/*` saja tidak
  menangkap bare `/api`). Tanpa rewrite: `resource.url` di offer x402
  selalu sama dengan URL yang dipanggil probe vAPI.
- **Satu sumber kebenaran OpenAPI:** `openapi.json` (file) HARUS sama
  persis dengan konstanta `OPENAPI` di `edge-functions/api.js`
  (harness mengecek ini).
- **Harga + payout TIDAK berubah:** $0,001/call (1000 atomic USDC),
  payTo wallet agent `0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C`, USDC
  kanonis Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  (eip155:8453), skema `exact`, maxTimeoutSeconds 120.
- `servers.url` masih **placeholder**
  `https://testnet-toolkit.netlify.app` — ganti ke URL site asli bila
  nama site berbeda (lihat langkah A3).

## Verifikasi lokal (sudah dilakukan RUN 31 — 14 Nov 2026)

```bash
cd netlify
NODE_USE_ENV_PROXY=1 node test/harness.mjs   # 119 passed, 0 failed
NODE_USE_ENV_PROXY=1 node test/serve.mjs 8787  # lalu, di terminal lain:
# vapi check (grader resmi CLI v0.13.0, via runner proxy-aware):
#   node ../../vapi-cli/run-cli23.mjs check "http://localhost:8787/api/v1/gas?chain=sepolia"
# Hasil per endpoint: 9 passed, 2 warnings, 0 failed
# (warning: bazaar_metadata_missing + discovery_missing — keduanya opsional)
# HTTP nyata: /api/v1/gas?chain=sepolia → 402 + header PAYMENT-REQUIRED
# + CORS; /api → 200; /api/openapi.json → 200; chain buruk → 400.
```

Satu jalur BELUM teruji lokal (disengaja): sukses berbayar (payment valid
→ facilitator verify+settle → data 200). Tidak bisa diuji tanpa
pembayaran nyata $0,001 — dan aturan keras melarang bayar. Jalur ini
teruji otomatis saat aktivasi pasca-deploy (probe vAPI melakukan paid
call sungguhan + konfirmasi payout sebelum listing live).

## Deploy — langkah PERSIS (langkah parent — browser task)

### A. Upload file ke repo GitHub yang SUDAH ADA (sesi GitHub `duryanagy-wq` aktif)

1. Buka `https://github.com/duryanagy-wq/testnet-toolkit-vercel`.
2. Upload file-file dari tabel di atas ke path repo masing-masing
   (Add file → Upload files; buat folder lewat nama path saat upload).
   JANGAN ubah isi file apa pun. JANGAN hapus file Vercel yang sudah ada.
3. **PENTING sebelum import:** nama site Netlify menentukan URL.
   Default yang dipakai di kode: **`testnet-toolkit`** →
   `https://testnet-toolkit.netlify.app`. Bila nama itu sudah dipakai,
   ganti `servers.url` di `edge-functions/api.js` (konstanta OPENAPI)
   DAN di `openapi.json` ke URL asli, jalankan ulang harness
   (harus tetap 119/119), lalu upload ulang sebelum import.

### B. Akun + import Netlify (browser task)

1. `netlify.com` → Sign Up → **"Continue with GitHub"** (tanpa kartu
   kredit, tanpa SMS). Authorize Netlify di GitHub.
   - Bila muncul permintaan verifikasi email: klik link verifikasi
     yang dikirim ke `duryanagy@gmail.com` (Gmail bisa dibuka di Chrome
     9224 / HP Muy).
   - **Bila muncul permintaan upload dokumen identitas / verifikasi
     Stripe: BERHENTI dan laporkan — JANGAN upload dokumen, JANGAN
     upgrade ke Pro.** (Lihat "RISIKO" di atas.)
2. Setelah masuk dashboard: Add new site → Import an existing project
   → GitHub → pilih `testnet-toolkit-vercel`.
3. Site settings: **Base directory** = (kosong / root repo),
   **Build command** = (kosong — tidak ada build step),
   **Publish directory** = `public`. (Netlify membaca `netlify.toml`
   dari root; Edge Functions dari `netlify/edge-functions`.)
4. Deploy site → tunggu "Site is live". Catat Site URL:
   `https://<site>.netlify.app`.
5. Verifikasi di browser: `https://<site>.netlify.app/api` → 200
   (info); `https://<site>.netlify.app/api/v1/gas?chain=sepolia` →
   402 + header `PAYMENT-REQUIRED`.

### C. Verifikasi + publish + aktivasi (agent — CLI di VM, tanpa browser)

```bash
cd ~/workspace/user/farming/vapi-2026-11-08/vapi-cli
# 1. vapi check terhadap URL publik (target: 9 passed, 2 warnings, 0 failed):
NODE_USE_ENV_PROXY=1 node run-cli23.mjs check "https://<site>.netlify.app/api/v1/gas?chain=sepolia"
NODE_USE_ENV_PROXY=1 node run-cli23.mjs check "https://<site>.netlify.app/api/v1/balance?chain=base-sepolia&address=0x0F4D4e842fd210380D57C6D5cef204D4F75f6121"
NODE_USE_ENV_PROXY=1 node run-cli23.mjs check "https://<site>.netlify.app/api/v1/faucets?chain=sepolia"
# 2. Publish (mode openapi; catat slug yang dikembalikan):
NODE_USE_ENV_PROXY=1 node run-cli23.mjs publish "https://<site>.netlify.app/api/openapi.json" --mode openapi --select gas,balance,faucets --name "Testnet Toolkit" --description "Live testnet gas prices, ETH balances and a verified faucet directory for Sepolia and Base Sepolia." --category data
#    Bila --select menolak nama gas,balance,faucets, coba operationId: getGas,getBalance,getFaucets.
# 3. Aktivasi (listing LIVE → quest selesai +500 poin):
NODE_USE_ENV_PROXY=1 node run-cli23.mjs publish activate <slug>
# 4. Verifikasi quest "List your API" selesai di halaman Earn vAPI.
```

Catatan aktivasi: probe vAPI melakukan **paid call sungguhan**
($0,001) untuk konfirmasi payout — itu bagian dari alur aktivasi,
bukan pembayaran dari kita.
